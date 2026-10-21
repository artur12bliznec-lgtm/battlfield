import * as THREE from 'three';
import './materials.js';
import { MeshBuilder, solid } from './builder.js';
import { profile, box as roundedBox, beam, lathe, rounded, slab } from '../models/kit.js';
import { random } from '../models/textures.js';

/*
 * Техника на улицах: легковушки, «буханка», автобус, армейский грузовик,
 * бронетранспортёр и танк — целые и сгоревшие.
 *
 * Как и у остальных предметов (props.js): основание на y = 0, перед смотрит
 * на +Z, левый борт — +X. Каждая модель строится один раз, а на карте её
 * копии — отдельные узлы с общим мешем (instance: true), поэтому машины
 * могут быть подробными и почти не утяжеляют файл карты.
 *
 * Модель: { builder, collision: [[x0, y0, z0, x1, y1, z1], ...], instance: true }.
 */

const DEG = Math.PI / 180;
const cache = new Map();

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, { ...make(), instance: true, key });
  return cache.get(key);
}

/**
 * Та же модель другого цвета: геометрия общая (на карте — один меш на все
 * копии), меняется только материал краски template → paint.
 */
function repaint(model, template, paint) {
  if (paint === template) return model;
  const key = `${model.key}>${paint}`;
  if (!cache.has(key)) cache.set(key, { ...model, remap: { [template]: paint } });
  return cache.get(key);
}

/** Матрица: сдвиг, поворот (рад, порядок YXZ) и масштаб (число или [x, y, z]). */
function mat(x = 0, y = 0, z = 0, { ry = 0, rx = 0, rz = 0, s = 1 } = {}) {
  const scale = Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), scale);
}

/* ------------------------------------------------------------------ */
/* Грани с заданной стороной                                           */
/* ------------------------------------------------------------------ */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function faceTri(b, m, p0, p1, p2, want) {
  if (dot(cross(sub(p1, p0), sub(p2, p0)), want) < 0) b.triangle(m, p0, p2, p1);
  else b.triangle(m, p0, p1, p2);
}

function faceQuad(b, m, p0, p1, p2, p3, want) {
  if (dot(cross(sub(p1, p0), sub(p2, p0)), want) < 0) b.quad(m, p0, p3, p2, p1);
  else b.quad(m, p0, p1, p2, p3);
}

/** Многоугольник лицом в сторону want: pts — вершины, flat — они же в 2D (для разбиения на треугольники). */
function facePoly(b, m, pts, flat, want) {
  const tris = THREE.ShapeUtils.triangulateShape(flat.map(([u, v]) => new THREE.Vector2(u, v)), []);
  for (const [i, j, k] of tris) faceTri(b, m, pts[i], pts[j], pts[k], want);
}

/**
 * Боковая поверхность кабины: x = side · width(y) — борт, заваленный внутрь.
 * outline — контур [[z, y], ...] на этой поверхности.
 */
function onSide(outline, side, width, out = 0) {
  return outline.map(([z, y]) => [side * (width(y) + out), y, z]);
}

/** Плоская деталь на борту (стекло, наклейка) — одна грань наружу. */
function sideFace(b, m, outline, side, width, out = 0) {
  facePoly(b, m, onSide(outline, side, width, out), outline, [side, 0, 0]);
}

/** Тонкая деталь на борту толщиной t (внутрь): стойка, накладка. Контур — выпуклый. */
function sidePanel(b, m, outline, side, width, out = 0.004, t = 0.035) {
  const o = onSide(outline, side, width, out);
  const i = onSide(outline, side, width, out - t);
  facePoly(b, m, o, outline, [side, 0, 0]);
  facePoly(b, m, i, outline, [-side, 0, 0]);
  const n = outline.length;
  const cz = outline.reduce((s, p) => s + p[0], 0) / n;
  const cy = outline.reduce((s, p) => s + p[1], 0) / n;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const [z0, y0] = outline[k];
    const [z1, y1] = outline[k1];
    let nz = y1 - y0;
    let ny = -(z1 - z0);
    if (nz * ((z0 + z1) / 2 - cz) + ny * ((y0 + y1) / 2 - cy) < 0) [nz, ny] = [-nz, -ny];
    faceQuad(b, m, o[k], o[k1], i[k1], i[k], [0, ny, nz]);
  }
}

/** Брусок между точками a и c с сечением w × t (w — вдоль side; по умолчанию — поперёк, по X или Y). */
function bar(b, m, a, c, w, t, side = null) {
  if (!side) {
    const d = sub(c, a);
    side = Math.abs(d[0]) < 0.7 * Math.hypot(...d) ? [1, 0, 0] : [0, 1, 0];
  }
  b.add(m, solid(beam(a, c, w, t, side)));
}

/** Цилиндр вдоль оси X с центром (x, y, z). */
function cylX(b, m, x, y, z, r, len, seg = 12, crease = 40) {
  b.add(m, solid(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, y, z), crease));
}

/** Цилиндр вдоль оси Z. */
function cylZ(b, m, x, y, z, r, len, seg = 12, crease = 40) {
  b.add(m, solid(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2).translate(x, y, z), crease));
}

/** Скруглённый брусок по центру и размерам. */
function rbox(b, m, [x, y, z], [w, h, d], r, crease = 35) {
  b.add(m, solid(roundedBox(w, h, d, r).translate(x, y, z), crease));
}

/** Нижний край кузова с полукруглыми арками колёс: точки [z, y] от зада к переду. */
function sillWithArches(y0, arches) {
  const pts = [];
  for (const { z, y, r } of arches) {
    const a0 = Math.asin(Math.max(-1, Math.min(1, (y0 - y) / r)));
    const steps = 9;
    for (let k = 0; k <= steps; k++) {
      // от заднего края арки (угол π − a0) через верх к переднему (a0)
      const a = Math.PI - a0 - ((Math.PI - 2 * a0) * k) / steps;
      pts.push([z + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* Колёса                                                              */
/* ------------------------------------------------------------------ */

/**
 * Колесо с осью вдоль X, внешняя сторона — на +X. style: 'steel' (штампованный
 * диск с колпаком), 'truck' (грузовой с гайками), 'army' (широкий с грунтозацепами).
 * burnt — только ржавый диск, без шины.
 */
function wheelBuilder(r, w, { rim = 0.6, style = 'steel', burnt = false } = {}) {
  return cachedPart(`wheel:${r}:${w}:${rim}:${style}:${burnt}`, () => {
    const b = new MeshBuilder();
    const h = w / 2;
    const R = r * rim; // радиус закраины диска
    const metal = burnt ? 'rust' : style === 'steel' ? 'metalGrey' : 'armyGreen';
    if (!burnt) {
      // шина: сечение — скруглённый прямоугольник
      const tire = [[R * 0.98, -h * 0.86], [R * 1.12, -h], [r * 0.93, -h * 0.98], [r - 0.012, -h * 0.84], [r, -h * 0.55], [r, h * 0.55], [r - 0.012, h * 0.84], [r * 0.93, h * 0.98], [R * 1.12, h], [R * 0.98, h * 0.86]];
      b.add('tire', solid(lathe(tire, style === 'steel' ? 16 : 18, 'x'), 50));
      if (style === 'army') {
        // грунтозацепы: косые выступы по протектору
        const lug = solid(new THREE.BoxGeometry(w * 0.42, 0.035, 0.07));
        const n = 16;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          for (const sx of [-1, 1]) {
            const m = new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(sx * w * 0.24, r + 0.008, 0)).multiply(new THREE.Matrix4().makeRotationY(sx * 0.35));
            b.add('tire', lug, m);
          }
        }
      }
    }
    // диск: «тарелка» наружу, обод и центр
    const dish = [[R * 1.0, h * 0.84], [R * 0.93, h * 0.62], [R * 0.78, h * 0.5], [R * 0.55, h * 0.56], [R * 0.36, h * 0.7], [R * 0.3, h * 0.8], [0.001, h * 0.8]];
    b.add(metal, solid(lathe(dish, 14, 'x'), 50));
    if (burnt) {
      // без шины виден обод с закраинами
      b.add(metal, solid(lathe([[R * 0.97, -h * 0.9], [R * 1.07, -h * 0.82], [R * 0.98, -h * 0.7], [R * 0.95, 0], [R * 0.98, h * 0.7], [R * 1.07, h * 0.82], [R * 0.97, h * 0.9]], 14, 'x'), 50));
    }
    if (style === 'steel' && !burnt) {
      // хромированный колпак
      b.add('chrome', solid(lathe([[R * 0.62, h * 0.8], [R * 0.6, h * 0.92], [R * 0.45, h * 1.02], [R * 0.2, h * 1.06], [0.001, h * 1.07]], 12, 'x'), 50));
    } else {
      // ступица и гайки
      b.add(burnt ? 'rust' : 'metalDark', solid(lathe([[R * 0.34, h * 0.8], [R * 0.32, h * 1.0], [R * 0.2, h * 1.12], [0.001, h * 1.14]], 12, 'x'), 50));
      const nuts = style === 'steel' ? 4 : 8;
      for (let k = 0; k < nuts; k++) {
        const a = (k / nuts) * Math.PI * 2;
        b.add(burnt ? 'rust' : 'metalDark', solid(new THREE.CylinderGeometry(R * 0.06, R * 0.06, 0.03, 6).rotateZ(Math.PI / 2).translate(h * 0.86, Math.sin(a) * R * 0.45, Math.cos(a) * R * 0.45)));
      }
      // отверстия в диске
      if (style !== 'steel') {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6 + 1 / 12) * Math.PI * 2;
          b.add('interiorDark', solid(new THREE.CylinderGeometry(R * 0.11, R * 0.11, 0.01, 8).rotateZ(Math.PI / 2).translate(h * 0.6, Math.sin(a) * R * 0.66, Math.cos(a) * R * 0.66)));
        }
      }
    }
    return b;
  });
}

const parts = new Map();
function cachedPart(key, make) {
  if (!parts.has(key)) parts.set(key, make());
  return parts.get(key);
}

/** Поставить колесо: центр (x, y, z), внешняя сторона — к своему борту. tilt — завал (рад). */
function putWheel(b, wheel, x, y, z, { steer = 0, tilt = 0 } = {}) {
  const m = mat(x, y, z, { ry: steer, rz: tilt });
  if (x < 0) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  appendMirrored(wheel, b, m);
}

/** appendTo с исправлением порядка вершин, если матрица зеркальная. */
function appendMirrored(source, target, m) {
  if (m.determinant() > 0) {
    source.appendTo(target, m);
    return;
  }
  const flipped = new MeshBuilder();
  for (const [material, bk] of source.buckets) {
    const out = flipped.bucket(material);
    out.position.push(...bk.position);
    out.normal.push(...bk.normal);
    out.uv.push(...bk.uv);
    for (let i = 0; i < bk.index.length; i += 3) out.index.push(bk.index[i], bk.index[i + 2], bk.index[i + 1]);
  }
  flipped.appendTo(target, m);
}

/* ------------------------------------------------------------------ */
/* Легковушки                                                          */
/* ------------------------------------------------------------------ */

/*
 * Седан — «классика» (как ВАЗ-2107), хэтчбек — трёхдверная «восьмёрка».
 * Кузов — боковой профиль с арками, выдавленный на ширину машины, со
 * скруглёнными рёбрами. Кабина — стойки, крыша и стёкла на заваленных внутрь
 * бортах; у сгоревшей стёкол нет и видно выгоревший салон.
 */
const CARS = {
  sedan: {
    width: 1.62,
    wheels: { r: 0.29, w: 0.18, track: 0.68, front: 1.24, rear: -1.18 },
    body: [[2.03, 0.36], [2.06, 0.47], [2.065, 0.62], [2.05, 0.76], [1.96, 0.8], [1.5, 0.835], [1.0, 0.875], [0.96, 0.9], [-1.48, 0.93], [-1.56, 0.955], [-1.98, 0.965], [-2.05, 0.92], [-2.07, 0.75], [-2.06, 0.5], [-2.03, 0.36]],
    belt: [0.96, 0.9, -1.48, 0.93], // линия низа окон: z0, y0 → z1, y1
    cabin: { roof: 1.39, front: 0.3, back: -0.92, base: 0.735, slope: 0.24 },
    // стёкла и стойки по контуру [z, y]
    windshield: [0.955, 0.3],
    rearGlass: [-1.46, -0.93],
    pillars: { b: [-0.215, -0.31], c: [-0.88, -1.1] },
    doors: [0.95, -0.26, -0.82],
    handles: [0.36, -0.7],
    lamps: 'rect',
  },
  hatch: {
    width: 1.65,
    wheels: { r: 0.28, w: 0.18, track: 0.69, front: 1.27, rear: -1.19 },
    body: [[1.97, 0.36], [2.0, 0.5], [1.99, 0.65], [1.86, 0.715], [1.2, 0.815], [0.92, 0.88], [0.88, 0.89], [-1.55, 0.975], [-1.8, 0.99], [-1.95, 0.955], [-2.0, 0.75], [-1.99, 0.5], [-1.96, 0.36]],
    belt: [0.88, 0.89, -1.55, 0.975],
    cabin: { roof: 1.37, front: 0.12, back: -1.1, base: 0.75, slope: 0.22 },
    windshield: [0.875, 0.13],
    rearGlass: [-1.77, -1.12],
    pillars: { b: [-0.52, -0.61], c: [-1.06, -1.32] },
    doors: [0.87, -0.56],
    handles: [-0.36],
    lamps: 'wedge',
  },
};

/**
 * Легковушка: kind — 'sedan' | 'hatch', paint — материал краски,
 * burnt — сгоревшая: без шин и стёкол, на ржавых дисках.
 */
export function car(kind = 'sedan', paint = 'carRed', burnt = false) {
  if (burnt) return cached(`car:${kind}:burnt`, () => buildCar(CARS[kind], kind, 'burnt', true));
  return repaint(cached(`car:${kind}`, () => buildCar(CARS[kind], kind, 'carRed', false)), 'carRed', paint);
}

function buildCar(S, kind, paint, burnt) {
  const b = new MeshBuilder();
  const rnd = random(kind === 'sedan' ? 7 : 8);
  const W = S.width / 2;
  const { r, w, track, front, rear } = S.wheels;
  const rimR = r * 0.6;
  // сгоревшая стоит на дисках: кузов ниже на толщину шины
  const drop = burnt ? -(r - rimR) + 0.01 : 0;
  const body = new MeshBuilder(); // кузов собираем отдельно, потом опускаем

  // --- кузов: профиль с арками и вырезом салона между моторным отсеком и багажником ---
  const [bz0, by0, bz1, by1] = S.belt;
  const belt = (z) => by0 + ((z - bz0) / (bz1 - bz0)) * (by1 - by0);
  const floorY = 0.56;
  const cabin0 = S.windshield[0] - 0.06;
  const cabin1 = S.rearGlass[0] + 0.06;
  const sill = sillWithArches(0.33, [{ z: rear, y: r, r: r + 0.1 }, { z: front, y: r, r: r + 0.1 }]);
  const upper = [];
  for (const [z, y] of S.body) {
    upper.push([z, y]);
    if (z === bz0) upper.push([cabin0, belt(cabin0)], [cabin0 - 0.002, floorY], [cabin1 + 0.002, floorY], [cabin1, belt(cabin1)]);
  }
  body.add(paint, solid(profile([...upper, ...sill], S.width, { bevel: 0.07, bevelSegments: 3, curveSegments: 4 }), 40));
  // борта салона — двери
  for (const side of [-1, 1]) sidePanel(body, paint, [[cabin0, floorY - 0.04], [cabin0, belt(cabin0)], [cabin1, belt(cabin1)], [cabin1, floorY - 0.04]], side, () => W, 0, 0.05);
  // низ: днище, глушитель
  body.box('metalDark', -W + 0.26, 0.2, rear - r - 0.35, W - 0.26, 0.335, front + r + 0.3);
  cylZ(body, burnt ? 'rust' : 'metalDark', -0.42, 0.25, S.body.at(-1)[0] + 0.05, 0.028, 0.5, 8);

  // --- кабина ---
  const { roof, front: roofFront, back: roofBack, base, slope } = S.cabin;
  const width = (y) => base - slope * (y - by0);
  const [wsBase, wsTop] = S.windshield;
  const [rgBase, rgTop] = S.rearGlass;
  const top = roof - 0.01;
  // крыша
  const roofPath = [[roofFront + 0.04, roof - 0.03], [roofFront - 0.02, roof + 0.015], [roofBack + 0.05, roof + 0.025], [roofBack - 0.03, roof - 0.02]];
  body.add(paint, solid(profile(roofPath, 2 * width(roof) + 0.03, { bevel: 0.025, bevelSegments: 2 }), 40));
  // стойки: передние вдоль лобового стекла, средние, задние — широкие
  for (const side of [-1, 1]) {
    const A0 = [side * (width(belt(wsBase)) - 0.035), belt(wsBase), wsBase + 0.015];
    const A1 = [side * (width(top) - 0.035), top, wsTop - 0.01];
    bar(body, paint, A0, A1, 0.085, 0.06);
    const [bp0, bp1] = S.pillars.b;
    sidePanel(body, paint, [[bp0, belt(bp0) - 0.01], [bp0, top], [bp1, top], [bp1, belt(bp1) - 0.01]], side, width, 0.004, 0.06);
    const [cp0, cp1] = S.pillars.c;
    sidePanel(body, paint, [[cp0, top], [rgTop - 0.02, top], [rgBase, belt(rgBase) - 0.01], [cp1, belt(cp1) - 0.01]], side, width, 0.004, 0.06);
    bar(body, paint, [side * (width(belt(rgBase)) - 0.035), belt(rgBase), rgBase - 0.01], [side * (width(top) - 0.035), top, rgTop + 0.01], 0.085, 0.06);
  }

  // --- стёкла или пустые проёмы ---
  if (!burnt) {
    const g = 'carGlass';
    const ws = [[-(width(belt(wsBase)) - 0.05), belt(wsBase) + 0.005, wsBase], [width(belt(wsBase)) - 0.05, belt(wsBase) + 0.005, wsBase], [width(top) - 0.05, top - 0.005, wsTop], [-(width(top) - 0.05), top - 0.005, wsTop]];
    faceQuad(body, g, ...ws, [0, wsBase - wsTop, top - belt(wsBase)]);
    const rg = [[-(width(belt(rgBase)) - 0.05), belt(rgBase) + 0.005, rgBase], [width(belt(rgBase)) - 0.05, belt(rgBase) + 0.005, rgBase], [width(top) - 0.05, top - 0.005, rgTop], [-(width(top) - 0.05), top - 0.005, rgTop]];
    faceQuad(body, g, ...rg, [0, rgTop - rgBase, -(top - belt(rgBase))]);
    const [bp0, bp1] = S.pillars.b;
    const [cp0, cp1] = S.pillars.c;
    for (const side of [-1, 1]) {
      sideFace(body, g, [[wsBase - 0.02, belt(wsBase - 0.02)], [wsTop + 0.01, top - 0.01], [bp0 + 0.01, top - 0.01], [bp0 + 0.01, belt(bp0)]], side, width, -0.012);
      sideFace(body, g, [[bp1 - 0.01, belt(bp1)], [bp1 - 0.01, top - 0.01], [cp0 + 0.01, top - 0.01], [cp1 + 0.01, belt(cp1)]], side, width, -0.012);
    }
  }
  // салон: пол, сиденья, панель приборов, руль (руль слева — у +X)
  const inner = 'carInterior';
  const fw = W - 0.05;
  faceQuad(body, burnt ? 'burntInterior' : inner, [-fw, floorY + 0.004, cabin1], [fw, floorY + 0.004, cabin1], [fw, floorY + 0.004, cabin0], [-fw, floorY + 0.004, cabin0], [0, 1, 0]);
  const seatZ = S.pillars.b[1] + 0.12;
  const rearSeatZ = cabin1 + 0.16;
  if (!burnt) {
    for (const sx of [-0.34, 0.34]) {
      rbox(body, inner, [sx, floorY + 0.1, seatZ + 0.22], [0.46, 0.14, 0.46], 0.05);
      body.add(inner, solid(roundedBox(0.46, 0.56, 0.12, 0.05).rotateX(-0.2).translate(sx, floorY + 0.38, seatZ), 35));
      rbox(body, inner, [sx, floorY + 0.71, seatZ - 0.06], [0.26, 0.15, 0.09], 0.03);
    }
    rbox(body, inner, [0, floorY + 0.09, rearSeatZ + 0.28], [2 * fw - 0.06, 0.14, 0.42], 0.05);
    body.add(inner, solid(roundedBox(2 * fw - 0.06, 0.46, 0.13, 0.05).rotateX(-0.25).translate(0, floorY + 0.33, rearSeatZ), 35));
  } else {
    // выгоревшие сиденья — одни рамы с пружинами
    for (const sx of [-0.34, 0.34]) {
      const y0 = floorY + 0.14;
      for (const dx of [-0.21, 0.21]) {
        bar(body, 'rust', [sx + dx, y0, seatZ], [sx + dx, y0 + 0.5, seatZ - 0.1], 0.02, 0.02);
        bar(body, 'rust', [sx + dx, y0, seatZ], [sx + dx, y0, seatZ + 0.42], 0.02, 0.02);
      }
      bar(body, 'rust', [sx - 0.21, y0 + 0.5, seatZ - 0.1], [sx + 0.21, y0 + 0.5, seatZ - 0.1], 0.02, 0.02);
      for (let k = 1; k <= 4; k++) bar(body, 'rust', [sx - 0.2, y0 + k * 0.1, seatZ - k * 0.02], [sx + 0.2, y0 + k * 0.1, seatZ - k * 0.02], 0.012, 0.012);
      for (let k = 1; k <= 3; k++) bar(body, 'rust', [sx - 0.2, y0, seatZ + k * 0.1], [sx + 0.2, y0, seatZ + k * 0.1], 0.012, 0.012);
    }
    for (let k = 0; k <= 4; k++) bar(body, 'rust', [-fw + 0.06, floorY + 0.12 + k * 0.08, rearSeatZ - k * 0.02], [fw - 0.06, floorY + 0.12 + k * 0.08, rearSeatZ - k * 0.02], 0.014, 0.014);
  }
  const dashZ = cabin0 - 0.13;
  rbox(body, burnt ? 'burntInterior' : inner, [0, belt(dashZ) - 0.05, dashZ], [2 * fw, 0.22, 0.26], 0.04);
  const wheelRing = new THREE.TorusGeometry(0.17, 0.018, 6, 16).rotateX(-62 * DEG).translate(0.36, belt(dashZ) + 0.08, dashZ - 0.24);
  body.add(burnt ? 'rust' : 'plasticBlack', solid(wheelRing, 50));
  bar(body, burnt ? 'rust' : 'plasticBlack', [0.36, belt(dashZ) + 0.02, dashZ - 0.1], [0.36, belt(dashZ) + 0.08, dashZ - 0.24], 0.04, 0.04);

  // --- перед: фары, решётка, бампер, номер ---
  const zf = S.body[1][0]; // передняя плоскость
  const metal = burnt ? 'rust' : 'chrome';
  const lens = burnt ? 'interiorDark' : 'headlight';
  if (S.lamps === 'rect') {
    for (const sx of [-1, 1]) {
      body.box(metal, sx * 0.3, 0.58, zf - 0.03, sx * 0.76, 0.75, zf + 0.012);
      for (const lx of [0.42, 0.63]) body.box(lens, sx * (lx - 0.085), 0.595, zf, sx * (lx + 0.085), 0.735, zf + 0.022);
      body.box(burnt ? 'interiorDark' : 'turnSignal', sx * 0.52, 0.47, zf - 0.02, sx * 0.74, 0.535, zf + 0.012);
    }
    body.box('plasticBlack', -0.29, 0.58, zf - 0.03, 0.29, 0.74, zf + 0.004);
    for (let k = 0; k < 4; k++) body.box(metal, -0.28, 0.6 + k * 0.04, zf, 0.28, 0.612 + k * 0.04, zf + 0.014);
    body.box(metal, -0.3, 0.735, zf - 0.02, 0.3, 0.75, zf + 0.016);
  } else {
    // узкие фары клином и решётка из трёх щелей
    for (const sx of [-1, 1]) {
      body.box(lens, sx * 0.28, 0.54, zf - 0.035, sx * 0.76, 0.64, zf + 0.004);
      body.box(burnt ? 'interiorDark' : 'turnSignal', sx * 0.62, 0.46, zf - 0.02, sx * 0.78, 0.52, zf + 0.012);
    }
    body.box('plasticBlack', -0.27, 0.54, zf - 0.035, 0.27, 0.64, zf + 0.002);
    for (let k = 0; k < 3; k++) body.box(burnt ? 'rust' : 'metalDark', -0.26, 0.555 + k * 0.03, zf, 0.26, 0.565 + k * 0.03, zf + 0.01);
  }
  const bumper = (z, dir) => {
    const bm = burnt ? 'rust' : S.lamps === 'rect' ? 'chrome' : 'plasticBlack';
    if (burnt && dir > 0) return; // отвалился — лежит перед машиной
    rbox(body, bm, [0, 0.42, z + dir * 0.04], [S.width + 0.04, 0.12, 0.1], 0.03);
    for (const sx of [-1, 1]) rbox(body, bm, [sx * (W + 0.005), 0.42, z - dir * 0.12], [0.06, 0.11, 0.26], 0.025);
    if (S.lamps === 'rect' && !burnt) body.box('plasticBlack', -W, 0.405, z + dir * 0.09 - 0.01, W, 0.435, z + dir * 0.09 + 0.01);
    if (!burnt) {
      body.box('plate', -0.26, 0.37, z + dir * 0.095 - 0.004, 0.26, 0.475, z + dir * 0.095 + 0.004);
      for (let k = 0; k < 6; k++) body.box('plasticBlack', -0.2 + k * 0.07, 0.39, z + dir * 0.1 - 0.004, -0.15 + k * 0.07, 0.455, z + dir * 0.1 + 0.004);
    }
  };
  bumper(zf, 1);

  // --- зад: фонари, номер, бампер ---
  const zr = S.body.at(-2)[0];
  for (const sx of [-1, 1]) {
    if (burnt) {
      body.box('interiorDark', sx * 0.4, 0.6, zr - 0.012, sx * 0.78, 0.78, zr + 0.02);
    } else {
      body.box('taillight', sx * 0.4, 0.62, zr - 0.02, sx * 0.78, 0.78, zr + 0.02);
      body.box('turnSignal', sx * 0.4, 0.6, zr - 0.024, sx * 0.55, 0.66, zr + 0.02);
      body.box('headlight', sx * 0.56, 0.6, zr - 0.024, sx * 0.66, 0.64, zr + 0.02);
    }
  }
  bumper(zr, -1);

  // --- борта: двери, ручки, молдинги, зеркала, антенна ---
  const seam = burnt ? 'interiorDark' : 'seam';
  const archTop = (z) => Math.max(0.45, ...[front, rear].map((az) => (Math.abs(z - az) < r + 0.1 ? r + Math.sqrt((r + 0.1) ** 2 - (z - az) ** 2) + 0.03 : 0)));
  for (const side of [-1, 1]) {
    const x = side * (W + 0.001);
    for (const z of S.doors) body.box(seam, x - 0.003, archTop(z), z - 0.006, x + 0.003, belt(z) - 0.02, z + 0.006);
    // нижний край дверей
    body.box(seam, x - 0.003, 0.45, S.doors.at(-1), x + 0.003, 0.46, S.doors[0]);
    for (const z of S.handles) body.box(metal, x - 0.012 * side, 0.79, z - 0.06, x + 0.012 * side, 0.81, z + 0.06);
    body.box(burnt ? 'rust' : 'plasticBlack', x - 0.01 * side, 0.58, S.doors.at(-1) + 0.02, x + 0.01 * side, 0.62, S.doors[0] - 0.02);
    if (!burnt) {
      // зеркало на ножке
      const mz = wsBase - 0.08;
      const my = belt(mz) + 0.06;
      bar(body, 'plasticBlack', [side * (width(my) - 0.02), my, mz], [side * (W + 0.07), my + 0.02, mz - 0.03], 0.03, 0.03);
      rbox(body, 'plasticBlack', [side * (W + 0.1), my + 0.03, mz - 0.04], [0.13, 0.085, 0.055], 0.02);
      body.box('chrome', side * (W + 0.04) - 0.05, my, mz - 0.07, side * (W + 0.04) + 0.05, my + 0.06, mz - 0.067);
    }
  }
  if (!burnt) {
    // дворники и антенна
    for (const sx of [-0.32, 0.18]) bar(body, 'plasticBlack', [sx, belt(wsBase) + 0.02, wsBase - 0.02], [sx + 0.38, belt(wsBase) + 0.03, wsBase - 0.05], 0.015, 0.012);
    body.add('plasticBlack', solid(new THREE.CylinderGeometry(0.004, 0.006, 0.7, 5).rotateX(-0.25).translate(0.72, 0.84 + 0.35, front + 0.3)));
  }
  body.appendTo(b, mat(0, drop, 0, { rz: burnt ? (rnd() - 0.5) * 0.04 : 0, rx: burnt ? 0.015 : 0 }));
  if (burnt) b.add('rust', solid(roundedBox(S.width + 0.04, 0.1, 0.12, 0.03), 35), mat(0.12, 0.05, zf + 0.34, { ry: 0.22, rz: 0.04 }));

  // --- колёса ---
  const wheel = wheelBuilder(r, w, { rim: 0.6, style: 'steel', burnt });
  const wy = burnt ? rimR + 0.012 : r;
  for (const z of [front, rear]) {
    for (const side of [-1, 1]) putWheel(b, wheel, side * track, wy, z, { steer: z === front && !burnt ? (kind === 'sedan' ? 0.12 : -0.08) : 0, tilt: burnt ? side * 0.06 : 0 });
  }

  const h = S.cabin.roof + 0.03 + drop;
  return { builder: b, collision: [[-W - 0.03, 0, S.body.at(-2)[0] - 0.1, W + 0.03, h, S.body[2][0] + 0.12]] };
}

/* ------------------------------------------------------------------ */
/* «Буханка», автобус, армейский грузовик                              */
/* ------------------------------------------------------------------ */

/** Прямоугольник со скруглёнными углами: точки [u, v] против часовой стрелки. */
function roundRect(u0, v0, u1, v1, r, seg = 3) {
  const pts = [];
  const corner = (cu, cv, a0) => {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (k / seg) * (Math.PI / 2);
      pts.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]);
    }
  };
  corner(u1 - r, v0 + r, -Math.PI / 2);
  corner(u1 - r, v1 - r, 0);
  corner(u0 + r, v1 - r, Math.PI / 2);
  corner(u0 + r, v0 + r, Math.PI);
  return pts;
}

/** Окно на плоском борту x = side·X: стекло (или чёрный проём) в резиновой рамке. */
function flatWindow(b, side, X, z0, y0, z1, y1, r, burnt) {
  const frame = roundRect(z0 - 0.035, y0 - 0.035, z1 + 0.035, y1 + 0.035, r + 0.03);
  const pane = roundRect(z0, y0, z1, y1, r);
  const flat = (pts, out) => pts.map(([z, y]) => [side * (X + out), y, z]);
  facePoly(b, burnt ? 'burnt' : 'plasticBlack', flat(frame, 0.004), frame, [side, 0, 0]);
  facePoly(b, 'interiorDark', flat(pane, 0.006), pane, [side, 0, 0]); // за стеклом — темнота салона
  if (!burnt) facePoly(b, 'carGlass', flat(pane, 0.009), pane, [side, 0, 0]);
}

/** Фара: хромированный ободок и стекло, смотрит на +Z. */
function roundLamp(b, x, y, z, r, burnt, lens = 'headlight') {
  b.add(burnt ? 'rust' : 'chrome', solid(lathe([[r * 1.25, -0.02], [r * 1.3, 0.02], [r * 1.12, 0.05], [r * 0.98, 0.05]], 14, 'z').translate(x, y, z), 50));
  b.add(burnt ? 'interiorDark' : lens, solid(lathe([[r, 0.02], [r * 0.9, 0.05], [r * 0.5, 0.068], [0.001, 0.072]], 14, 'z').translate(x, y, z), 50));
}

/** УАЗ-«буханка»: кузов-«батон» со скруглёнными рёбрами. */
export function van(paint = 'carGreen', burnt = false) {
  if (!burnt && paint !== 'carGreen') return repaint(van('carGreen'), 'carGreen', paint);
  return cached(`van:${burnt ? 'burnt' : paint}`, () => {
    const b = new MeshBuilder();
    const body = new MeshBuilder();
    const P = burnt ? 'burnt' : paint;
    const W = 0.97;
    const r = 0.38;
    const front = 1.23;
    const rear = -1.07;
    const drop = burnt ? -(r - r * 0.55) + 0.01 : 0;
    // профиль: почти вертикальный перед, скруглённые углы крыши, арки колёс
    const top = [[2.16, 0.52], [2.2, 0.62], [2.21, 1.2], ['q', 2.2, 1.24, 2.19, 1.28], [2.12, 1.76], ['q', 2.08, 2.06, 1.72, 2.06], [-1.86, 2.06], ['q', -2.18, 2.06, -2.18, 1.74], [-2.18, 0.56], [-2.14, 0.52]];
    const sill = sillWithArches(0.5, [{ z: rear, y: r, r: r + 0.1 }, { z: front, y: r, r: r + 0.1 }]);
    body.add(P, solid(profile([...top, ...sill], 2 * W, { bevel: 0.16, bevelSegments: 4, curveSegments: 6 }), 40));
    body.box('metalDark', -W + 0.3, 0.34, rear - 0.6, W - 0.3, 0.52, front + 0.6);
    // водосток вдоль крыши
    for (const side of [-1, 1]) body.box(P, side * (W - 0.01), 1.93, -1.85, side * (W + 0.015), 1.95, 1.8);
    // лобовое стекло из двух половин, наклон по передней стенке
    const fz = (y) => 2.12 + ((1.76 - y) / (1.76 - 1.28)) * 0.07 + 0.004;
    for (const sx of [-1, 1]) {
      const x0 = sx * 0.05;
      const x1 = sx * 0.82;
      const pts = [[x0, 1.32], [x1, 1.32], [sx * 0.8, 1.72], [sx * 0.05, 1.72]];
      facePoly(body, 'interiorDark', pts.map(([x, y]) => [x, y, fz(y) + 0.002]), pts, [0, 0.15, 1]);
      if (!burnt) facePoly(body, 'carGlass', pts.map(([x, y]) => [x, y, fz(y) + 0.005]), pts, [0, 0.15, 1]);
      const fr = pts.map(([x, y]) => [x + (x === x0 ? -sx * 0.03 : sx * 0.03), y + (y < 1.5 ? -0.03 : 0.03)]);
      facePoly(body, burnt ? 'burnt' : 'plasticBlack', fr.map(([x, y]) => [x, y, fz(y) + 0.001]), fr, [0, 0.15, 1]);
    }
    // окна по бортам: двери кабины и салон
    const wins = [[1.32, 1.95], [0.35, 1.05], [-0.48, 0.22], [-1.32, -0.62]];
    for (const side of [-1, 1]) {
      for (const [z0, z1] of wins) flatWindow(body, side, W, z0, 1.36, z1, 1.82, 0.08, burnt);
      // двери: кабина и боковая дверь салона (справа)
      const seams = side < 0 ? [1.28, 2.0, -0.55, 0.3] : [1.28, 2.0];
      for (const z of seams) body.box(burnt ? 'interiorDark' : 'seam', side * W - 0.004, 0.62, z - 0.005, side * W + 0.004, 1.9, z + 0.005);
      body.box(burnt ? 'rust' : 'chrome', side * (W + 0.01), 1.22, 1.38, side * (W + 0.025), 1.25, 1.5);
      // подножка и зеркало на длинном кронштейне
      body.box('metalDark', side * (W - 0.1), 0.48, 1.35, side * (W + 0.08), 0.52, 1.95);
      if (!burnt) {
        bar(body, 'metalDark', [side * W, 1.6, 2.05], [side * (W + 0.22), 1.72, 2.12], 0.025, 0.025);
        rbox(body, 'plasticBlack', [side * (W + 0.24), 1.68, 2.1], [0.05, 0.2, 0.13], 0.02);
      }
    }
    // перед: круглые фары, решётка, поворотники, бампер, номер
    for (const sx of [-1, 1]) {
      roundLamp(body, sx * 0.64, 0.98, 2.2, 0.09, burnt);
      body.box(burnt ? 'interiorDark' : 'turnSignal', sx * 0.6, 1.12, 2.19, sx * 0.7, 1.16, 2.225);
    }
    body.box('plasticBlack', -0.36, 0.8, 2.19, 0.36, 1.12, 2.215);
    for (let k = 0; k < 9; k++) body.box(burnt ? 'rust' : P, -0.34 + k * 0.085, 0.82, 2.205, -0.31 + k * 0.085, 1.1, 2.225);
    rbox(body, burnt ? 'rust' : 'metalDark', [0, 0.6, 2.24], [2.0, 0.15, 0.12], 0.03);
    if (!burnt) body.box('plate', -0.26, 0.55, 2.3, 0.26, 0.66, 2.306);
    // зад: две двери с окошками, фонари, бампер
    body.box(burnt ? 'interiorDark' : 'seam', -0.005, 0.62, -2.186, 0.005, 1.9, -2.17);
    for (const sx of [-1, 1]) {
      const pane = roundRect(sx * 0.12, 1.38, sx * 0.62, 1.8, 0.06).map(([x, y]) => [x, y]);
      const p = sx < 0 ? pane : pane;
      facePoly(body, 'interiorDark', p.map(([x, y]) => [x, y, -2.184]), p, [0, 0, -1]);
      if (!burnt) facePoly(body, 'carGlass', p.map(([x, y]) => [x, y, -2.188]), p, [0, 0, -1]);
      body.box(burnt ? 'interiorDark' : 'taillight', sx * 0.82, 0.8, -2.2, sx * 0.92, 1.05, -2.17);
      body.box(burnt ? 'rust' : 'chrome', sx * 0.08, 1.15, -2.2, sx * 0.2, 1.18, -2.18);
    }
    rbox(body, burnt ? 'rust' : 'metalDark', [0, 0.6, -2.24], [2.0, 0.15, 0.12], 0.03);
    body.appendTo(b, mat(0, drop, 0, { rz: burnt ? 0.02 : 0, rx: burnt ? -0.01 : 0 }));
    const wheel = wheelBuilder(r, 0.22, { rim: 0.55, style: 'truck', burnt });
    for (const z of [front, rear]) for (const side of [-1, 1]) putWheel(b, wheel, side * 0.72, burnt ? r * 0.55 + 0.01 : r, z, { tilt: burnt ? side * 0.05 : 0 });
    return { builder: b, collision: [[-W - 0.05, 0, -2.3, W + 0.05, 2.08 + drop, 2.32]] };
  });
}

/**
 * Городской автобус (как ЛиАЗ-677): низ краски paint, верх кремовый, большие
 * окна. Собран из частей, чтобы у сгоревшего были пустые проёмы и рамы сидений.
 */
export function bus(paint = 'carYellow', burnt = false) {
  if (!burnt && paint !== 'carYellow') return repaint(bus('carYellow'), 'carYellow', paint);
  return cached(`bus:${burnt ? 'burnt' : paint}`, () => {
    const b = new MeshBuilder();
    const body = new MeshBuilder();
    const P = burnt ? 'burnt' : paint;
    const U = burnt ? 'burnt' : 'busCream';
    const W = 1.25;
    const L = 5.25;
    const r = 0.5;
    const front = 2.95;
    const rear = -2.2;
    const drop = burnt ? -(r - r * 0.55) + 0.02 : 0;
    const floorY = 0.95;
    const winY0 = 1.5;
    const winY1 = 2.5;
    // низ кузова до подоконников: профиль с арками
    const lower = [[L - 0.05, 0.42], [L + 0.02, 0.6], [L + 0.03, winY0], [-L, winY0], [-L, 0.55], [-L + 0.06, 0.42]];
    const sill = sillWithArches(0.42, [{ z: rear, y: r, r: r + 0.1 }, { z: front, y: r, r: r + 0.1 }]);
    // в салоне — пол ниже подоконников: вырез сверху
    const cut = [[L - 1.2, winY0], [L - 1.2, floorY], [-L + 1.3, floorY], [-L + 1.3, winY0]];
    const lowerPath = [lower[0], lower[1], lower[2], ...cut, lower[3], lower[4], lower[5], ...sill];
    body.add(P, solid(profile(lowerPath, 2 * W, { bevel: 0.1, bevelSegments: 3 }), 40));
    for (const side of [-1, 1]) sidePanel(body, P, [[L - 1.2, floorY - 0.05], [L - 1.2, winY0], [-L + 1.3, winY0], [-L + 1.3, floorY - 0.05]], side, () => W, 0, 0.06);
    body.box('metalDark', -W + 0.35, 0.3, -L + 0.4, W - 0.35, 0.43, L - 0.4);
    // крыша со скруглёнными краями
    body.add(U, solid(profile([[L + 0.03, winY1], [L + 0.02, 2.75], ['q', L - 0.02, 3.0, L - 0.35, 3.0], [-L + 0.3, 3.0], ['q', -L, 3.0, -L, 2.72], [-L, winY1]], 2 * W, { bevel: 0.14, bevelSegments: 3, curveSegments: 5 }), 40));
    // простенки между окнами (кремовые), перед и зад — сплошные
    const pitch = 1.2;
    const z0 = -L + 1.3;
    const z1 = L - 1.2;
    const posts = [];
    for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / Math.round((z1 - z0) / pitch)) posts.push(z);
    for (const side of [-1, 1]) {
      for (const z of posts) body.box(U, side * (W - 0.07), winY0 - 0.01, z - 0.07, side * W, winY1 + 0.01, z + 0.07);
      body.box(U, side * (W - 0.07), winY0, z1, side * W, winY1, L - 0.1);
      body.box(U, side * (W - 0.12), winY0 - 0.15, L - 0.1, side * W, winY1 + 0.05, L + 0.03); // угловые стойки
      body.box(U, side * (W - 0.07), winY0, -L + 0.02, side * W, winY1, z0);
      body.box(U, side * 0.8, winY0, -L + 0.02, side * (W - 0.07), winY1, -L + 0.12); // задняя стенка вокруг окна
    }
    body.box(U, -0.8, winY0, -L + 0.02, 0.8, 1.75, -L + 0.12);
    body.box(U, -0.8, 2.45, -L + 0.02, 0.8, winY1, -L + 0.12);
    // стёкла
    for (const side of [-1, 1]) {
      for (let k = 0; k < posts.length - 1; k++) {
        const pane = [[posts[k] + 0.07, winY0], [posts[k + 1] - 0.07, winY0], [posts[k + 1] - 0.07, winY1], [posts[k] + 0.07, winY1]];
        if (!burnt) sideFace(body, 'carGlass', pane, side, () => W, -0.03);
        body.box(burnt ? 'burnt' : 'plasticBlack', side * (W - 0.035), winY0 - 0.015, posts[k] + 0.07, side * (W + 0.002), winY0 + 0.015, posts[k + 1] - 0.07);
      }
    }
    // лобовое стекло и маршрутоуказатель
    const fz = L + 0.035;
    if (!burnt) {
      for (const sx of [-1, 1]) facePoly(body, 'carGlass', [[sx * 0.04, winY0 - 0.15, fz], [sx * (W - 0.12), winY0 - 0.15, fz], [sx * (W - 0.12), winY1 + 0.05, fz], [sx * 0.04, winY1 + 0.05, fz]], [[sx * 0.04, winY0 - 0.15], [sx * (W - 0.12), winY0 - 0.15], [sx * (W - 0.12), winY1 + 0.05], [sx * 0.04, winY1 + 0.05]], [0, 0, 1]);
    }
    // приборная панель водителя
    rbox(body, burnt ? 'burntInterior' : 'carInterior', [0, winY0 + 0.05, L - 0.3], [2 * W - 0.3, 0.2, 0.5], 0.05);
    body.box('plasticBlack', -0.04, winY0 - 0.15, fz - 0.02, 0.04, winY1 + 0.05, fz + 0.01);
    body.box('plasticBlack', -0.85, 2.62, fz - 0.02, 0.85, 2.86, fz + 0.012);
    if (!burnt) for (let k = 0; k < 7; k++) body.box('turnSignal', -0.6 + k * 0.18, 2.69, fz + 0.01, -0.5 + k * 0.18, 2.79, fz + 0.016);
    // фары, бампер, номер
    for (const sx of [-1, 1]) {
      roundLamp(body, sx * 0.9, 0.82, L + 0.02, 0.09, burnt);
      roundLamp(body, sx * 0.68, 0.82, L + 0.02, 0.07, burnt, 'turnSignal');
    }
    rbox(body, burnt ? 'rust' : 'metalDark', [0, 0.5, L + 0.08], [2 * W + 0.04, 0.2, 0.14], 0.04);
    if (!burnt) body.box('plate', -0.26, 0.47, L + 0.15, 0.26, 0.58, L + 0.156);
    // зад: окно, решётка двигателя, фонари
    if (!burnt) facePoly(body, 'carGlass', [[-0.8, 1.75, -L + 0.01], [0.8, 1.75, -L + 0.01], [0.8, 2.45, -L + 0.01], [-0.8, 2.45, -L + 0.01]], [[-0.8, 1.75], [0.8, 1.75], [0.8, 2.45], [-0.8, 2.45]], [0, 0, -1]);
    for (let k = 0; k < 8; k++) body.box(burnt ? 'rust' : 'metalDark', -0.7, 0.75 + k * 0.07, -L - 0.02, 0.7, 0.78 + k * 0.07, -L + 0.01);
    for (const sx of [-1, 1]) body.box(burnt ? 'interiorDark' : 'taillight', sx * 0.95, 0.8, -L - 0.02, sx * 1.15, 1.1, -L + 0.01);
    rbox(body, burnt ? 'rust' : 'metalDark', [0, 0.5, -L - 0.06], [2 * W + 0.04, 0.2, 0.14], 0.04);
    // двери справа (−X): створки с остеклением
    const doors = [[L - 1.15, L - 0.45], [-0.55, 0.65], [-L + 0.45, -L + 1.25]];
    for (const [d0, d1] of doors) {
      const x = -W - 0.006;
      body.box(burnt ? 'burnt' : 'plasticBlack', x - 0.004, 0.45, d0, x + 0.03, winY1 + 0.02, d1);
      const mid = (d0 + d1) / 2;
      for (const [a, c] of [[d0 + 0.05, mid - 0.025], [mid + 0.025, d1 - 0.05]]) {
        if (!burnt) sideFace(body, 'carGlass', [[a, 0.75], [c, 0.75], [c, winY1 - 0.04], [a, winY1 - 0.04]], -1, () => W, 0.012);
        else body.box('interiorDark', x - 0.008, 0.75, a, x + 0.02, winY1 - 0.04, c);
      }
    }
    // полоса и отбойник по бортам, зеркала
    for (const side of [-1, 1]) {
      body.box(burnt ? 'rust' : 'plasticBlack', side * (W - 0.01), 0.95, -L + 0.1, side * (W + 0.02), 1.02, L - 0.1);
      if (!burnt) {
        bar(body, 'metalDark', [side * W, 2.3, L - 0.1], [side * (W + 0.25), 2.25, L + 0.15], 0.03, 0.03);
        rbox(body, 'plasticBlack', [side * (W + 0.27), 2.05, L + 0.17], [0.06, 0.35, 0.2], 0.02);
      }
    }
    // салон: пол, сиденья парами вдоль бортов
    faceQuad(body, burnt ? 'burntInterior' : 'carInterior', [-W + 0.06, floorY + 0.004, z0], [W - 0.06, floorY + 0.004, z0], [W - 0.06, floorY + 0.004, z1], [-W + 0.06, floorY + 0.004, z1], [0, 1, 0]);
    for (let z = z0 + 0.6; z < z1 - 0.3; z += 0.85) {
      for (const sx of [-1, 1]) {
        if (sx < 0 && z > -0.8 && z < 0.9) continue; // у средней двери — площадка
        const x = sx * (W - 0.45);
        if (!burnt) {
          rbox(body, 'seatRed', [x, floorY + 0.42, z], [0.82, 0.1, 0.42], 0.04);
          rbox(body, 'seatRed', [x, floorY + 0.75, z - 0.2], [0.82, 0.55, 0.09], 0.04);
          body.box('metalGrey', x - 0.3, floorY, z - 0.02, x - 0.26, floorY + 0.42, z + 0.02);
        } else {
          for (const dx of [-0.38, 0.38]) bar(body, 'rust', [x + dx, floorY, z], [x + dx, floorY + 1.0, z - 0.22], 0.025, 0.025);
          for (let k = 0; k < 3; k++) bar(body, 'rust', [x - 0.38, floorY + 0.45 + k * 0.25, z - 0.1 - k * 0.05], [x + 0.38, floorY + 0.45 + k * 0.25, z - 0.1 - k * 0.05], 0.02, 0.02);
        }
      }
    }
    if (!burnt) for (let z = z0 + 0.3; z < z1; z += 1.6) body.box('metalGrey', -0.02, floorY, z - 0.02, 0.02, 2.55, z + 0.02); // поручни
    body.appendTo(b, mat(0, drop, 0, { rz: burnt ? -0.015 : 0 }));
    // колёса: сзади спаренные
    const wheel = wheelBuilder(r, 0.28, { rim: 0.58, style: 'truck', burnt });
    for (const side of [-1, 1]) {
      putWheel(b, wheel, side * 0.98, burnt ? r * 0.58 : r, front, {});
      putWheel(b, wheel, side * 1.0, burnt ? r * 0.58 : r, rear, {});
      if (!burnt) putWheel(b, wheel, side * 0.7, r, rear, {});
    }
    return { builder: b, collision: [[-W - 0.05, 0, -L - 0.15, W + 0.05, 3.0 + drop, L + 0.15]] };
  });
}

/** Армейский грузовик (как «Урал-4320»): капот, кабина, кузов с тентом, три моста. */
export function truck(burnt = false) {
  return cached(`truck:${burnt}`, () => {
    const b = new MeshBuilder();
    const body = new MeshBuilder();
    const P = burnt ? 'burnt' : 'armyGreen';
    const r = 0.535;
    const axles = [2.35, -1.175, -2.575];
    const drop = burnt ? -(r - r * 0.5) + 0.02 : 0;
    // рама
    for (const sx of [-0.45, 0.45]) body.box('metalDark', sx - 0.07, 0.72, -3.6, sx + 0.07, 0.98, 3.55);
    // капот: профиль сбоку, со скруглёнными рёбрами
    body.add(P, solid(profile([[3.62, 0.95], [3.66, 1.72], [3.55, 1.8], [2.15, 1.92], [2.15, 0.95]], 1.3, { bevel: 0.06, bevelSegments: 2 }), 40));
    // решётка радиатора
    body.box('metalDark', -0.55, 1.0, 3.64, 0.55, 1.68, 3.68);
    for (let k = 0; k < 10; k++) body.box(burnt ? 'rust' : P, -0.52 + k * 0.115, 1.03, 3.67, -0.47 + k * 0.115, 1.66, 3.7);
    // крылья над передними колёсами с фарами
    for (const side of [-1, 1]) {
      const fender = [[3.55, 1.12], [3.6, 1.42], [3.2, 1.5], [1.9, 1.52], [1.72, 1.3], [1.7, 1.12], ['q', 2.35, 1.62, 3.0, 1.12]];
      body.add(P, solid(profile(fender, 0.55, { bevel: 0.04, bevelSegments: 2 }).translate(side * 0.98, 0, 0), 40));
      roundLamp(body, side * 0.98, 1.6, 3.42, 0.1, burnt);
      body.add(burnt ? 'rust' : P, solid(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 12).rotateX(Math.PI / 2).translate(side * 0.98, 1.6, 3.33), 40));
      body.box(burnt ? 'interiorDark' : 'turnSignal', side * 0.8, 1.53, 3.45, side * 0.9, 1.58, 3.52);
    }
    // кабина
    const cab = [[2.15, 0.95], [2.15, 2.0], [2.05, 2.86], [0.65, 2.86], [0.6, 0.95]];
    body.add(P, solid(profile(cab, 2.3, { bevel: 0.08, bevelSegments: 3 }), 40));
    const cw = 1.15;
    // лобовое стекло (две половины) и боковые окна
    for (const sx of [-1, 1]) {
      const pts = [[sx * 0.05, 2.05], [sx * 1.0, 2.05], [sx * 0.98, 2.7], [sx * 0.05, 2.7]];
      const z = (y) => 2.15 - ((y - 2.0) / 0.86) * 0.1 + 0.01;
      facePoly(body, 'interiorDark', pts.map(([x, y]) => [x, y, z(y) + 0.001]), pts, [0, 0.12, 1]);
      if (!burnt) facePoly(body, 'carGlass', pts.map(([x, y]) => [x, y, z(y) + 0.004]), pts, [0, 0.12, 1]);
      flatWindow(body, sx, cw, 1.15, 2.05, 1.95, 2.65, 0.06, burnt);
      body.box(burnt ? 'interiorDark' : 'seam', sx * cw - 0.004, 1.05, 1.08, sx * cw + 0.004, 2.75, 1.09);
      body.box(burnt ? 'rust' : 'metalDark', sx * (cw + 0.005), 1.7, 1.2, sx * (cw + 0.025), 1.73, 1.32);
      // подножки, бензобаки, зеркала
      body.box('metalDark', sx * 1.0, 0.7, 1.2, sx * 1.22, 0.74, 1.9);
      body.box('metalDark', sx * 1.0, 1.0, 1.2, sx * 1.22, 1.04, 1.9);
      body.add(burnt ? 'rust' : P, solid(new THREE.CylinderGeometry(0.26, 0.26, 0.9, 14).rotateX(Math.PI / 2).translate(sx * 1.0, 0.95, 0.0), 40));
      if (!burnt) {
        bar(body, 'metalDark', [sx * cw, 2.5, 2.05], [sx * (cw + 0.3), 2.55, 2.2], 0.03, 0.03);
        rbox(body, 'plasticBlack', [sx * (cw + 0.32), 2.4, 2.22], [0.06, 0.3, 0.2], 0.02);
      }
    }
    // запасное колесо за кабиной и выхлопная труба
    const spare = wheelBuilder(r, 0.36, { rim: 0.55, style: 'army', burnt });
    spare.appendTo(body, mat(0, 1.75, 0.33, { ry: Math.PI / 2, s: 0.95 }));
    body.add(burnt ? 'rust' : 'metalDark', solid(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 10).translate(0.95, 2.35, 0.55)));
    // бампер с лебёдкой
    rbox(body, burnt ? 'rust' : 'metalDark', [0, 0.92, 3.75], [2.3, 0.22, 0.16], 0.03);
    body.add(burnt ? 'rust' : 'metalDark', solid(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 12).rotateZ(Math.PI / 2).translate(0, 0.85, 3.58)));
    if (!burnt) body.box('plate', -0.26, 0.86, 3.835, 0.26, 0.97, 3.841);
    // кузов: пол, борта из досок
    const bed = { z0: -3.65, z1: 0.06, y: 1.45, top: 2.05, w: 1.25 };
    body.box(burnt ? 'burnt' : 'armyDark', -bed.w, bed.y - 0.12, bed.z0, bed.w, bed.y, bed.z1);
    const plank = burnt ? 'burnt' : 'armyGreen';
    for (let k = 0; k < 4; k++) {
      const y0 = bed.y + k * 0.15;
      if (burnt && k === 3) continue;
      for (const side of [-1, 1]) body.box(plank, side * bed.w - 0.04, y0, bed.z0, side * bed.w + 0.04, y0 + 0.13, bed.z1);
      body.box(plank, -bed.w, y0, bed.z0 - 0.04, bed.w, y0 + 0.13, bed.z0 + 0.04);
      body.box(plank, -bed.w, y0, bed.z1 - 0.04, bed.w, y0 + 0.13, bed.z1 + 0.04);
    }
    // дуги тента и сам тент
    const arcs = [];
    for (let k = 0; k < 5; k++) arcs.push(bed.z0 + 0.1 + (k / 4) * (bed.z1 - bed.z0 - 0.2));
    const bow = (z, m) => {
      const pts = [[-bed.w, bed.top], [-bed.w, 2.85], [-0.9, 3.05], [0, 3.12], [0.9, 3.05], [bed.w, 2.85], [bed.w, bed.top]];
      for (let k = 0; k < pts.length - 1; k++) bar(body, m, [pts[k][0], pts[k][1], z], [pts[k + 1][0], pts[k + 1][1], z], 0.05, 0.03, [0, 0, 1]);
    };
    if (!burnt) {
      // тент — «туннель» над кузовом, по нему проступают дуги и ремни
      const w = bed.w + 0.03;
      const tent = [[-w, bed.y + 0.45], [w, bed.y + 0.45], [w, 2.86], ['q', w - 0.05, 3.06, 0.9, 3.09], ['q', 0, 3.16, -0.9, 3.09], ['q', -w + 0.05, 3.06, -w, 2.86]];
      const len = bed.z1 - bed.z0 + 0.04;
      body.add('canvas', solid(slab(tent, len, { bevel: 0.05, bevelSegments: 2, curveSegments: 5 }).translate(0, 0, (bed.z0 + bed.z1) / 2), 35));
      for (const z of arcs) {
        const pts = [[-w - 0.015, bed.y + 0.5], [-w - 0.015, 2.86], [-0.9, 3.105], [0, 3.17], [0.9, 3.105], [w + 0.015, 2.86], [w + 0.015, bed.y + 0.5]];
        for (let k = 0; k < pts.length - 1; k++) bar(body, 'canvas', [pts[k][0], pts[k][1], z], [pts[k + 1][0], pts[k + 1][1], z], 0.06, 0.02, [0, 0, 1]);
      }
      for (const side of [-1, 1]) for (const y of [2.1, 2.55]) body.box('plasticBlack', side * (w + 0.003), y, bed.z0 + 0.05, side * (w + 0.015), y + 0.025, bed.z1 - 0.05);
    } else {
      for (const z of arcs) bow(z, 'rust');
      // обрывки тента
      body.box('burntInterior', -bed.w, 2.6, -1.5, -bed.w + 0.02, 2.9, -0.4);
    }
    // задние фонари и брызговики
    for (const sx of [-1, 1]) {
      body.box(burnt ? 'interiorDark' : 'taillight', sx * 1.0, 1.2, -3.7, sx * 1.15, 1.32, -3.66);
      body.box('plasticBlack', sx * 1.25, 0.25, -3.1, sx * 0.75, 0.95, -3.12);
    }
    body.appendTo(b, mat(0, drop, 0, { rz: burnt ? 0.025 : 0, rx: burnt ? 0.01 : 0 }));
    const wheel = wheelBuilder(r, 0.36, { rim: 0.55, style: 'army', burnt });
    for (const z of axles) for (const side of [-1, 1]) putWheel(b, wheel, side * 1.0, burnt ? r * 0.55 + 0.01 : r, z, { tilt: burnt ? side * 0.04 : 0, steer: z > 0 && !burnt ? 0.1 : 0 });
    return { builder: b, collision: [[-1.3, 0, -3.7, 1.3, 2.9 + drop, 3.85], [-1.3, 0, -3.7, 1.3, (burnt ? 2.1 : 3.15) + drop, 0.3]] };
  });
}

/* ------------------------------------------------------------------ */
/* Бронетехника: БТР и танк                                            */
/* ------------------------------------------------------------------ */

/**
 * Корпус по сечениям: stations — [{ z, pts: [[x, y], ...] }], у всех сечений
 * одинаковое число точек (обход по кругу). Торцы закрываются.
 */
function hull(b, m, stations) {
  const n = stations[0].pts.length;
  const ring = (s) => s.pts.map(([x, y]) => [x, y, s.z]);
  const centre = (s) => {
    const cx = s.pts.reduce((a, p) => a + p[0], 0) / n;
    const cy = s.pts.reduce((a, p) => a + p[1], 0) / n;
    return [cx, cy, s.z];
  };
  for (let i = 0; i < stations.length - 1; i++) {
    const A = ring(stations[i]);
    const B = ring(stations[i + 1]);
    const ca = centre(stations[i]);
    const cb = centre(stations[i + 1]);
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const mid = [(A[k][0] + A[k1][0] + B[k][0] + B[k1][0]) / 4, (A[k][1] + A[k1][1] + B[k][1] + B[k1][1]) / 4, (A[k][2] + B[k][2]) / 2];
      const c = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, mid[2]];
      faceQuad(b, m, A[k], A[k1], B[k1], B[k], sub(mid, c));
    }
  }
  const first = stations[0];
  const last = stations.at(-1);
  facePoly(b, m, ring(first), first.pts, [0, 0, Math.sign(first.z - stations[1].z)]);
  facePoly(b, m, ring(last), last.pts, [0, 0, Math.sign(last.z - stations.at(-2).z)]);
}

/** Шестигранное сечение корпуса: низ, самая широкая часть, крыша. */
const hexSection = (z, [bw, by], [mw, my], [tw, ty]) => ({ z, pts: [[bw, by], [mw, my], [tw, ty], [-tw, ty], [-mw, my], [-bw, by]] });

/** Люк: круглая крышка (открытая — откинута на петле). */
function hatch(b, m, x, y, z, r, open = 0) {
  const g = new THREE.CylinderGeometry(r, r, 0.05, 14);
  if (open) {
    g.translate(0, 0, r).rotateX(-open).translate(0, 0, -r);
    b.add('interiorDark', solid(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.01, 14).translate(x, y + 0.005, z)));
  }
  b.add(m, solid(g.translate(x, y + 0.03, z), 40));
  b.add(m, solid(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.04, 14).translate(x, y + 0.01, z), 40));
}

/** Камуфляж бронетехники: оливковый с бурыми и чёрными пятнами. */
const ARMOR = 'armyCamo';

/** Бронетранспортёр (как БТР-80): восемь колёс, башенка с КПВТ. */
export function apc(burnt = false) {
  return cached(`apc:${burnt}`, () => {
    const b = new MeshBuilder();
    const body = new MeshBuilder();
    const P = burnt ? 'burnt' : ARMOR;
    const r = 0.55;
    const axles = [2.5, 1.05, -0.75, -2.2];
    const drop = burnt ? -(r - r * 0.5) + 0.02 : 0;
    const main = (z) => hexSection(z, [0.85, 0.5], [1.45, 1.38], [1.12, 2.0]);
    hull(body, P, [
      hexSection(3.83, [0.8, 1.0], [1.25, 1.12], [1.0, 1.25]),
      hexSection(3.35, [0.85, 0.56], [1.42, 1.3], [1.1, 1.49]),
      main(2.35),
      main(-2.9),
      hexSection(-3.45, [0.85, 0.62], [1.45, 1.38], [1.1, 1.95]),
      hexSection(-3.83, [0.8, 0.86], [1.3, 1.38], [1.05, 1.85]),
    ]);
    // башня: усечённый конус, маска, КПВТ и ПКТ
    const tz = 1.35;
    const turret = new THREE.CylinderGeometry(0.47, 0.62, 0.42, 14).translate(0, 2.21, tz);
    body.add(P, solid(turret, 40));
    body.add(P, solid(new THREE.CylinderGeometry(0.66, 0.66, 0.06, 14).translate(0, 2.02, tz), 40));
    rbox(body, P, [0, 2.24, tz + 0.55], [0.36, 0.26, 0.2], 0.04);
    const gunDrop = burnt ? -0.12 : 0;
    const gun = new MeshBuilder();
    gun.add(burnt ? 'rust' : 'metalDark', solid(new THREE.CylinderGeometry(0.045, 0.05, 1.9, 10).rotateX(Math.PI / 2).translate(-0.05, 0, 0.95)));
    gun.add(burnt ? 'rust' : 'metalDark', solid(new THREE.CylinderGeometry(0.065, 0.065, 0.28, 10).rotateX(Math.PI / 2).translate(-0.05, 0, 1.85)));
    gun.add(burnt ? 'rust' : 'metalDark', solid(new THREE.CylinderGeometry(0.022, 0.022, 0.55, 8).rotateX(Math.PI / 2).translate(0.12, 0, 0.28)));
    gun.appendTo(body, mat(0, 2.24, tz + 0.6, { rx: -gunDrop }));
    // прицел и дымовые гранатомёты
    rbox(body, P, [0.2, 2.47, tz + 0.15], [0.16, 0.12, 0.22], 0.03);
    body.box('interiorDark', 0.13, 2.45, tz + 0.26, 0.27, 2.51, tz + 0.262);
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const a = (sx > 0 ? 125 : 235) * DEG + (k - 1) * 0.18 * sx;
        body.add(burnt ? 'rust' : 'armyDark', solid(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8).rotateX(-0.6).rotateY(a).translate(Math.sin(a) * 0.55, 2.2, tz + Math.cos(a) * 0.55)));
      }
    }
    // люки водителя и командира, смотровые блоки на лобовом листе
    for (const sx of [-1, 1]) {
      hatch(body, P, sx * 0.45, 1.98, 2.55, 0.28, burnt && sx > 0 ? 1.9 : 0);
      for (let k = 0; k < 3; k++) body.box('glassDark', sx * 0.45 - 0.2 + k * 0.14, 1.9, 2.77, sx * 0.45 - 0.1 + k * 0.14, 1.97, 2.8);
    }
    hatch(body, P, 0, 2.0, -1.2, 0.3, burnt ? 2.1 : 0);
    // борта: двери между 2-м и 3-м мостом, бойницы, поручни
    for (const side of [-1, 1]) {
      // контур боковой двери на верхнем скошенном листе
      const xs = (y) => side * (1.45 - ((y - 1.38) / 0.62) * 0.33 + 0.006);
      const seamMat = burnt ? 'interiorDark' : 'seam';
      for (const z of [0.05, 0.75]) bar(body, seamMat, [xs(1.42), 1.42, z], [xs(1.86), 1.86, z], 0.012, 0.01, [0, 0, 1]);
      bar(body, seamMat, [xs(1.86), 1.86, 0.05], [xs(1.86), 1.86, 0.75], 0.012, 0.01, [0, 1, 0]);
      body.box(burnt ? 'rust' : 'metalDark', xs(1.6) - 0.02, 1.58, 0.6, xs(1.6) + 0.02, 1.62, 0.7);
      for (const z of [1.7, -1.45, -2.4]) {
        const y = 1.62;
        const xs = side * (1.45 - ((y - 1.38) / 0.62) * 0.33);
        body.add('interiorDark', solid(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10).rotateZ(Math.PI / 2).rotateZ(side * 0.49).translate(xs + side * 0.005, y, z)));
      }
      bar(body, burnt ? 'rust' : 'armyDark', [side * 1.1, 2.05, 2.1], [side * 1.1, 2.05, -2.7], 0.03, 0.03, [0, 1, 0]);
    }
    // корма: решётки моторного отсека, выхлопные короба, антенны
    for (let k = 0; k < 7; k++) body.box('metalDark', -0.8, 2.0, -2.2 - k * 0.17, 0.8, 2.025, -2.13 - k * 0.17);
    for (const sx of [-1, 1]) {
      body.box(burnt ? 'rust' : 'metalDark', sx * 0.75, 1.55, -3.86, sx * 1.05, 1.75, -3.7);
      if (!burnt) body.add('metalDark', solid(new THREE.CylinderGeometry(0.006, 0.012, 2.6, 5).translate(sx * 0.95, 3.3, -3.0)));
    }
    body.add(burnt ? 'rust' : 'metalDark', solid(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16).rotateX(Math.PI / 2).translate(0, 1.15, -3.84)));
    // фары и буксирные крюки на носу
    for (const sx of [-1, 1]) {
      roundLamp(body, sx * 0.9, 1.3, 3.62, 0.07, burnt);
      body.box('metalDark', sx * 0.5 - 0.06, 0.95, 3.7, sx * 0.5 + 0.06, 1.05, 3.92);
    }
    body.appendTo(b, mat(0, drop, 0, { rz: burnt ? -0.03 : 0 }));
    const wheel = wheelBuilder(r, 0.34, { rim: 0.5, style: 'army', burnt });
    axles.forEach((z, i) => {
      for (const side of [-1, 1]) {
        if (burnt && side > 0 && i === 0) continue; // колесо оторвано
        putWheel(b, wheel, side * 1.18, burnt ? r * 0.5 + 0.01 : r, z, { tilt: burnt ? side * 0.05 : 0, steer: i < 2 && !burnt ? (i ? 0.06 : 0.12) : 0 });
      }
    });
    if (burnt) putWheel(b, wheel, 2.3, 0.17, 3.6, { tilt: Math.PI / 2 - 0.15 }); // лежит рядом
    return { builder: b, collision: [[-1.45, 0, -3.85, 1.45, 2.1 + drop, 3.85], [-0.65, 2.0 + drop, tz - 0.65, 0.65, 2.45 + drop, tz + 0.65]] };
  });
}

/* --- танк --- */

const TANK = {
  wheelY: 0.45,
  wheelR: 0.375,
  wheels: [2.3, 1.45, 0.6, -0.25, -1.1, -1.95],
  idler: { z: 3.05, y: 0.58, r: 0.3 },
  sprocket: { z: -2.95, y: 0.62, r: 0.33 },
  rollers: [1.6, 0.25, -1.1],
  trackX: 1.39,
  trackW: 0.58,
  turretZ: 0.35,
  roof: 1.42,
};

/** Каток: резиновый бандаж, диск со спицами, ступица. Ось — X, наружу +X. */
function roadWheelBuilder(burnt) {
  return cachedPart(`roadWheel:${burnt}`, () => {
    const b = new MeshBuilder();
    const R = TANK.wheelR;
    const metal = burnt ? 'rust' : 'armyDark';
    if (!burnt) b.add('tire', solid(lathe([[R * 0.84, -0.17], [R, -0.15], [R, 0.15], [R * 0.84, 0.17]], 18, 'x'), 50));
    b.add(metal, solid(lathe([[R * 0.86, 0.15], [R * 0.8, 0.11], [R * 0.4, 0.09], [R * 0.3, 0.14], [0.001, 0.15]], 18, 'x'), 50));
    b.add(metal, solid(lathe([[R * 0.84, -0.16], [R * 0.86, 0], [R * 0.84, 0.16]], 18, 'x'), 50));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.add('interiorDark', solid(new THREE.CylinderGeometry(R * 0.11, R * 0.11, 0.005, 8).rotateZ(Math.PI / 2).translate(0.105, Math.sin(a) * R * 0.6, Math.cos(a) * R * 0.6)));
    }
    b.add(metal, solid(lathe([[R * 0.22, 0.14], [R * 0.2, 0.2], [0.001, 0.21]], 10, 'x'), 50));
    return b;
  });
}

/** Звёздочка (ведущее колесо) или ленивец: диск с зубьями по краю. */
function sprocketBuilder(r, teeth, burnt) {
  return cachedPart(`sprocket:${r}:${teeth}:${burnt}`, () => {
    const b = new MeshBuilder();
    const metal = burnt ? 'rust' : 'armyDark';
    b.add(metal, solid(lathe([[r * 0.85, -0.12], [r * 0.85, 0.12], [r * 0.3, 0.14], [0.001, 0.16]], 16, 'x'), 50));
    b.add(metal, solid(lathe([[0.001, -0.14], [r * 0.3, -0.13], [r * 0.85, -0.12]], 16, 'x'), 50));
    if (teeth) {
      const tooth = solid(new THREE.BoxGeometry(0.22, 0.07, 0.06));
      for (let k = 0; k < teeth; k++) b.add(metal, tooth, new THREE.Matrix4().makeRotationX((k / teeth) * Math.PI * 2).multiply(new THREE.Matrix4().makeTranslation(0, r * 0.9, 0)));
    }
    return b;
  });
}

/** Путь гусеницы (по осевой линии траков): [z, y] по кругу — низ, ленивец, верх, звёздочка. */
function trackPath(broken = false) {
  const T = TANK;
  const t = 0.04; // половина толщины трака
  const pts = [];
  const arc = (cz, cy, r, a0, a1, steps) => {
    for (let k = 0; k <= steps; k++) {
      const a = a0 + ((a1 - a0) * k) / steps;
      pts.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  const bottom = T.wheelY - T.wheelR - t;
  // низ: от звёздочки к ленивцу
  pts.push([T.sprocket.z + 0.2, bottom + 0.06]);
  for (const z of [...T.wheels].reverse()) pts.push([z, bottom]);
  pts.push([T.idler.z - 0.25, bottom + 0.08]);
  if (broken) return pts.map(([z, y]) => [z, Math.max(y, t)]);
  // вокруг ленивца — вверх
  arc(T.idler.z, T.idler.y, T.idler.r + t, -Math.PI / 2 + 0.45, Math.PI / 2, 6);
  // верх: провисает между поддерживающими роликами
  for (const z of T.rollers) pts.push([z + 0.35, 1.05 + t - 0.03], [z, 1.06 + t + 0.05]);
  // вокруг звёздочки — вниз
  arc(T.sprocket.z, T.sprocket.y, T.sprocket.r + t, Math.PI / 2, Math.PI * 1.5 - 0.5, 6);
  return pts;
}

/** Гусеница из отдельных траков вдоль пути (на борту side). */
function track(b, side, burnt, broken = false) {
  const path = trackPath(broken);
  const closed = !broken;
  const segs = [];
  let total = 0;
  for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
    const a = path[i];
    const c = path[(i + 1) % path.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    segs.push({ a, c, len, at: total });
    total += len;
  }
  const pitch = 0.142;
  const link = solid(new THREE.BoxGeometry(TANK.trackW, 0.075, 0.12));
  const horn = solid(new THREE.BoxGeometry(0.06, 0.07, 0.07));
  const m = burnt ? 'rust' : 'track';
  for (let d = 0; d < total - 0.05; d += pitch) {
    const s = segs.find((g) => d >= g.at && d < g.at + g.len) ?? segs.at(-1);
    const t = (d - s.at) / s.len;
    const z = s.a[0] + (s.c[0] - s.a[0]) * t;
    const y = s.a[1] + (s.c[1] - s.a[1]) * t;
    const ang = Math.atan2(s.c[1] - s.a[1], s.c[0] - s.a[0]);
    const mx = mat(side * TANK.trackX, y, z, { rx: -ang });
    b.add(m, link, mx);
    b.add(m, horn, mx.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.07, 0)));
  }
}

/** Ходовая часть одного борта: катки, ленивец, звёздочка, ролики, гусеница. */
function runningGear(b, side, { burnt = false, missing = [], broken = false } = {}) {
  const T = TANK;
  const road = roadWheelBuilder(burnt);
  T.wheels.forEach((z, i) => {
    if (!missing.includes(i)) putWheel(b, road, side * T.trackX, T.wheelY, z);
  });
  putWheel(b, sprocketBuilder(T.idler.r, 0, burnt), side * T.trackX, T.idler.y, T.idler.z);
  putWheel(b, sprocketBuilder(T.sprocket.r, 12, burnt), side * T.trackX, T.sprocket.y, T.sprocket.z);
  for (const z of T.rollers) cylX(b, burnt ? 'rust' : 'armyDark', side * (T.trackX - 0.05), 1.0, z, 0.11, 0.2, 10);
  track(b, side, burnt, broken);
}

/** Блок динамической защиты «Контакт-1» на поверхности: center, нормаль normal. */
function eraBlock(b, m, center, normal, along, size = [0.26, 0.11, 0.3]) {
  const n = new THREE.Vector3(...normal).normalize();
  const x = new THREE.Vector3(...along);
  x.sub(n.clone().multiplyScalar(x.dot(n))).normalize();
  const z = x.clone().cross(n);
  const basis = new THREE.Matrix4().makeBasis(x, n, z);
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]).applyMatrix4(basis).translate(...center);
  b.add(m, solid(g));
}

/** Башня танка (как Т-72Б): литой купол, «Контакт-1», пушка 125 мм, командирская башенка. */
function tankTurretBuilder(burnt) {
  return cachedPart(`tankTurret:${burnt}`, () => {
    const b = new MeshBuilder();
    const P = burnt ? 'burnt' : ARMOR;
    const metal = burnt ? 'burnt' : 'armyDark';
    // купол: полусфера, вытянутая вперёд и приплюснутая
    const dome = new THREE.SphereGeometry(1, 24, 9, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = dome.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const front = v.z > 0;
      v.set(v.x * 1.12, v.y * 0.66, v.z * (front ? 1.32 : 1.02));
      if (v.y > 0.5) v.y = 0.5 + (v.y - 0.5) * 0.6; // плоская крыша
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    b.add(P, solid(dome, 45));
    b.add(P, solid(new THREE.CylinderGeometry(1.12, 1.15, 0.12, 24).translate(0, 0.0, 0.05), 40));
    // маска пушки и пушка: ствол с термокожухом, эжектор
    rbox(b, P, [0, 0.3, 1.3], [0.62, 0.42, 0.42], 0.08);
    const gun = new MeshBuilder();
    gun.add(metal, solid(new THREE.CylinderGeometry(0.075, 0.09, 4.7, 14).rotateX(Math.PI / 2).translate(0, 0, 2.35), 40));
    for (let k = 0; k < 4; k++) gun.add(metal, solid(new THREE.CylinderGeometry(0.108, 0.108, 0.62, 14).rotateX(Math.PI / 2).translate(0, 0, 0.55 + k * 0.95 + (k > 0 ? 0.7 : 0)), 40));
    gun.add(metal, solid(new THREE.CylinderGeometry(0.14, 0.14, 0.6, 16).rotateX(Math.PI / 2).translate(0, 0, 1.45), 40));
    for (let k = 0; k < 6; k++) gun.add(metal, solid(new THREE.CylinderGeometry(0.118, 0.118, 0.04, 14).rotateX(Math.PI / 2).translate(0, 0, 0.3 + k * 0.82), 40));
    gun.box(metal, -0.05, 0.08, 4.2, 0.05, 0.16, 4.35);
    gun.appendTo(b, mat(0, 0.3, 1.45, { rx: burnt ? 0.07 : 0 }));
    // «Контакт-1»: шевроном по лбу башни
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        for (const [row, h] of [[0, 0.16], [1, 0.38]]) {
          const a = sx * (22 + k * 11 + row * 4) * DEG;
          const rr = 1.0 - row * 0.12;
          const cx = Math.sin(a) * 1.12 * rr;
          const cz = Math.cos(a) * 1.32 * rr;
          eraBlock(b, burnt ? 'burnt' : 'armyDark', [cx, h + 0.06, cz], [Math.sin(a) * 0.8, 0.35 + row * 0.35, Math.cos(a)], [0, 1, 0]);
        }
      }
    }
    // командирская башенка с пулемётом НСВТ, люк наводчика
    b.add(P, solid(new THREE.CylinderGeometry(0.4, 0.43, 0.16, 16).translate(-0.48, 0.58, -0.15), 40));
    hatch(b, P, -0.48, 0.64, -0.15, 0.3, burnt ? 1.6 : 0);
    rbox(b, metal, [-0.48, 0.78, 0.15], [0.16, 0.14, 0.42], 0.03);
    b.add(metal, solid(new THREE.CylinderGeometry(0.022, 0.026, 1.25, 8).rotateX(Math.PI / 2).translate(-0.48, 0.8, 0.95)));
    hatch(b, P, 0.5, 0.52, 0.0, 0.28, 0);
    // прожектор «Луна» справа от пушки
    b.add(metal, solid(new THREE.CylinderGeometry(0.17, 0.17, 0.26, 14).rotateX(Math.PI / 2).translate(-0.62, 0.62, 1.15), 40));
    b.add(burnt ? 'interiorDark' : 'glassDark', solid(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 14).rotateX(Math.PI / 2).translate(-0.62, 0.62, 1.29)));
    // гранатомёты «Туча» по бокам
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const a = sx * (62 + k * 9) * DEG;
        b.add(metal, solid(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8).rotateX(-0.9).rotateY(a).translate(Math.sin(a) * 1.0, 0.5, Math.cos(a) * 1.05)));
      }
    }
    // ящики на корме башни и шноркель
    rbox(b, metal, [0, 0.36, -1.08], [1.4, 0.36, 0.34], 0.03);
    b.add(metal, solid(new THREE.CylinderGeometry(0.09, 0.09, 1.7, 10).rotateZ(Math.PI / 2).translate(0, 0.62, -1.02)));
    return b;
  });
}

/**
 * Танк (как Т-72Б). state: 'intact' — целый, 'burnt' — сгоревший (башня на
 * месте, пушка опущена), 'wreck' — башню сорвало взрывом (лежит отдельно,
 * tankTurret), гусеница порвана.
 */
export function tank(state = 'intact') {
  return cached(`tank:${state}`, () => {
    const b = new MeshBuilder();
    const burnt = state !== 'intact';
    const wrecked = state === 'wreck';
    const P = burnt ? 'burnt' : ARMOR;
    const metal = burnt ? 'burnt' : 'armyDark';
    const T = TANK;
    // корпус: профиль сбоку с верхним и нижним лобовым листом
    const side = [[3.48, 0.86], [2.25, T.roof], [-3.3, T.roof], [-3.48, 1.3], [-3.42, 0.55], [-3.0, 0.42], [2.95, 0.42]];
    b.add(P, solid(profile(side, 2.2, { bevel: 0.03, bevelSegments: 1 }), 30));
    // надгусеничные полки и бортовые экраны
    for (const sx of [-1, 1]) {
      b.add(P, solid(profile([[3.42, 0.98], [3.3, 1.12], [-3.45, 1.16], [-3.45, 1.1], [3.25, 1.06]], 0.62, { bevel: 0.01 }).translate(sx * 1.41, 0, 0), 30));
      const skirt = [];
      for (let k = 0; k < 6; k++) {
        if (burnt && sx > 0 && (k === 1 || k === 4)) continue; // сорваны
        skirt.push(k);
        const z0 = 2.9 - k * 1.02;
        b.box(burnt ? 'burnt' : 'rubberSkirt', sx * 1.72, 0.66, z0 - 0.98, sx * 1.76, 1.12, z0);
      }
      // ящики и бочки на полках
      if (sx > 0) for (let k = 0; k < 3; k++) rbox(b, metal, [sx * 1.42, 1.32, 1.2 - k * 0.95], [0.5, 0.36, 0.8], 0.04);
      else for (let k = 0; k < 2; k++) rbox(b, metal, [sx * 1.42, 1.3, 0.6 - k * 1.3], [0.5, 0.32, 1.1], 0.04);
    }
    // «Контакт-1» на верхнем лобовом листе
    const gl = new THREE.Vector3(0, 3.48 - 2.25, T.roof - 0.86).normalize(); // нормаль листа
    for (let row = 0; row < 3; row++) {
      for (let k = -3; k <= 3; k++) {
        if (row === 0 && Math.abs(k) < 1) continue; // люк механика
        const t = 0.22 + row * 0.27;
        const z = 2.25 + t * (3.48 - 2.25);
        const y = T.roof + t * (0.86 - T.roof);
        eraBlock(b, burnt ? 'burnt' : 'armyDark', [k * 0.3, y + gl.y * 0.06, z + gl.z * 0.06], [0, gl.y, gl.z], [1, 0, 0], [0.27, 0.1, 0.24]);
      }
    }
    // люк механика-водителя, фары, буксирные крюки
    hatch(b, P, 0, T.roof - 0.03, 2.05, 0.26, burnt ? 1.2 : 0);
    for (const sx of [-1, 1]) {
      roundLamp(b, sx * 0.85, 1.12, 3.0, 0.06, burnt);
      b.box(metal, sx * 0.7 - 0.07, 0.6, 3.38, sx * 0.7 + 0.07, 0.72, 3.62);
    }
    // корма: бочки, бревно, решётки моторного отсека
    for (const sx of [-1, 1]) b.add(metal, solid(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14).rotateZ(Math.PI / 2).translate(sx * 0.6, 1.36, -3.72), 40));
    b.add(burnt ? 'burntInterior' : 'bark', solid(new THREE.CylinderGeometry(0.12, 0.12, 3.1, 10).rotateZ(Math.PI / 2).translate(0, 0.98, -3.62), 40));
    for (let k = 0; k < 9; k++) b.box('metalDark', -0.9, T.roof, -1.6 - k * 0.18, 0.9, T.roof + 0.02, -1.52 - k * 0.18);
    // ходовая часть
    runningGear(b, 1, { burnt, missing: wrecked ? [2] : [], broken: wrecked });
    runningGear(b, -1, { burnt });
    if (wrecked) {
      // гусеница слетела и лежит перед танком, погон башни открыт
      const loose = new MeshBuilder();
      for (let k = 0; k < 16; k++) {
        const m = mat(T.trackX, 0.04, T.idler.z + 0.45 + k * 0.142, { ry: k * 0.02 });
        loose.add('rust', solid(new THREE.BoxGeometry(T.trackW, 0.075, 0.12)), m);
      }
      loose.appendTo(b, mat(0, 0, 0, { ry: 0.05 }));
      b.add('interiorDark', solid(new THREE.CylinderGeometry(1.0, 1.0, 0.02, 24).translate(0, T.roof + 0.005, T.turretZ)));
      b.add('rust', solid(new THREE.TorusGeometry(1.05, 0.06, 6, 24).rotateX(Math.PI / 2).translate(0, T.roof + 0.04, T.turretZ), 40));
    } else {
      tankTurretBuilder(burnt).appendTo(b, mat(0, T.roof, T.turretZ, { ry: burnt ? 0.35 : 0 }));
    }
    const collision = [[-1.78, 0, -3.95, 1.78, T.roof + 0.05, 3.55]];
    if (!wrecked) collision.push([-1.15, T.roof, T.turretZ - 1.1, 1.15, T.roof + 0.65, T.turretZ + 1.4], [-0.15, T.roof + 0.15, T.turretZ + 1.4, 0.15, T.roof + 0.45, T.turretZ + 6.1]);
    return { builder: b, collision };
  });
}

/** Сорванная взрывом башня танка: лежит на боку, вверх дном. */
export function tankTurret() {
  return cached('tankTurret', () => {
    const b = new MeshBuilder();
    const m = mat(0, 0, 0, { rz: 2.55, rx: 0.12 });
    tankTurretBuilder(true).appendTo(b, m);
    // днище башни — тёмное, с выгоревшим погоном
    b.add('interiorDark', solid(new THREE.CylinderGeometry(1.05, 1.05, 0.02, 24).translate(0, -0.06, 0.05)), m);
    let minY = Infinity;
    for (const bk of b.buckets.values()) for (let i = 1; i < bk.position.length; i += 3) minY = Math.min(minY, bk.position[i]);
    const lifted = new MeshBuilder();
    b.appendTo(lifted, mat(0, -minY - 0.05, 0));
    return { builder: lifted, collision: [[-1.2, 0, -1.3, 1.2, 1.6, 1.5], [-0.3, 0, 1.4, 0.3, 0.6, 5.8]] };
  });
}
