import * as THREE from 'three';
import { MeshBuilder, solid } from './builder.js';
import { profile, box as roundedBox, beam } from '../models/kit.js';
import { signIndex, signRect } from './textures.js';
import { random } from '../models/textures.js';

/*
 * Предметы на улицах: машины, баррикады, фонари, деревья, мусор...
 * Каждый предмет строится один раз в своих координатах (основание на y = 0,
 * перед смотрит на +Z) и копируется по карте с поворотом. У каждого есть
 * упрощённые коробки для физики.
 *
 * Предмет: { builder, collision: [[x0, y0, z0, x1, y1, z1], ...] }.
 */

const Y = new THREE.Vector3(0, 1, 0);
const cache = new Map();

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** Поставить предмет: x, y, z — точка основания, yaw — поворот (рад) вокруг вертикали. */
export function placeProp(target, collision, prop, x, y, z, yaw = 0, scale = 1) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y, yaw), new THREE.Vector3(scale, scale, scale));
  prop.builder.appendTo(target, m, prop.remap);
  if (collision) for (const box of prop.collision) addCollisionBox(collision, box, m);
  return m;
}

/** Коробка для физики (в координатах предмета) с преобразованием m. */
export function addCollisionBox(collision, [x0, y0, z0, x1, y1, z1], m = null) {
  if (!m) {
    collision.box('collision', x0, y0, z0, x1, y1, z1);
    return;
  }
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  collision.add('collision', g, m);
}

const cyl = (r0, r1, h, seg = 10) => new THREE.CylinderGeometry(r1, r0, h, seg);
const at = (g, x, y, z) => g.translate(x, y, z);

/* ------------------------------------------------------------------ */
/* Машины и бронетехника — в vehicles.js                               */
/* ------------------------------------------------------------------ */

export { car, van, bus, truck, apc, tank, tankTurret } from './vehicles.js';

/* ------------------------------------------------------------------ */
/* Баррикады                                                           */
/* ------------------------------------------------------------------ */

/** Стенка из мешков с песком длиной length (вдоль X), rows рядов. */
export function sandbags(length = 3, rows = 4, seed = 1) {
  return cached(`sandbags:${length}:${rows}:${seed}`, () => {
    const b = new MeshBuilder();
    const rnd = random(seed);
    // мешок — сплющенная «подушка»: многогранник со сглаженными нормалями
    const bag = new THREE.IcosahedronGeometry(1, 1).scale(0.3, 0.095, 0.19);
    const data = solid(bag, 70);
    for (let r = 0; r < rows; r++) {
      const n = Math.max(1, Math.round(length / 0.54) - (r % 2));
      const off = r % 2 ? 0.27 : 0;
      for (let k = 0; k < n; k++) {
        const x = -length / 2 + 0.27 + off + k * 0.54;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x + (rnd() - 0.5) * 0.04, 0.08 + r * 0.15, (rnd() - 0.5) * 0.06),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.08)),
          new THREE.Vector3(1, 1, 1),
        );
        b.add(rnd() < 0.5 ? 'sandbag' : 'sandbagDark', data, m);
      }
    }
    return { builder: b, collision: [[-length / 2, 0, -0.2, length / 2, rows * 0.155 + 0.02, 0.2]] };
  });
}

/** Бетонный блок «нью-джерси». */
export function jersey() {
  return cached('jersey', () => {
    const b = new MeshBuilder();
    const g = profile([[0.3, 0], [0.3, 0.08], [0.12, 0.26], [0.08, 0.81], [-0.08, 0.81], [-0.12, 0.26], [-0.3, 0.08], [-0.3, 0]], 3.0, { bevel: 0.02 });
    b.add('concreteWall', solid(g.rotateY(Math.PI / 2)));
    b.box('signRed', -1.4, 0.55, 0.095, -1.0, 0.7, 0.11);
    b.box('signRed', 1.0, 0.55, 0.095, 1.4, 0.7, 0.11);
    return { builder: b, collision: [[-1.5, 0, -0.3, 1.5, 0.81, 0.3]] };
  });
}

/** Противотанковый ёж из трёх балок. */
export function hedgehog() {
  return cached('hedgehog', () => {
    const b = new MeshBuilder();
    const s = 0.85;
    const pairs = [[[-s, 0.05, -s * 0.4], [s, 1.25, s * 0.4]], [[s * 0.4, 0.05, -s], [-s * 0.4, 1.25, s]], [[0, 0.05, s * 0.95], [0, 1.4, -s * 0.95]]];
    for (const [a, c] of pairs) {
      b.add('rust', solid(beam(a, c, 0.12, 0.012, [0, 1, 0])));
      b.add('rust', solid(beam(a, c, 0.012, 0.12, [0, 1, 0])));
    }
    return { builder: b, collision: [[-0.9, 0, -0.9, 0.9, 1.3, 0.9]] };
  });
}

/** Бетонный куб-заграждение. */
export function block() {
  return cached('block', () => {
    const b = new MeshBuilder();
    b.add('concreteWall', solid(roundedBox(1.2, 0.95, 1.2, 0.05).translate(0, 0.475, 0), 30));
    return { builder: b, collision: [[-0.6, 0, -0.6, 0.6, 0.95, 0.6]] };
  });
}

/* ------------------------------------------------------------------ */
/* Улица                                                               */
/* ------------------------------------------------------------------ */

/** Фонарь: столб с изогнутой консолью, светильник над дорогой (+Z). */
export function streetLamp() {
  return cached('streetLamp', () => {
    const b = new MeshBuilder();
    b.add('metalGrey', solid(at(cyl(0.12, 0.07, 7.6, 6), 0, 3.8, 0), 40));
    b.add('metalGrey', solid(at(cyl(0.16, 0.14, 0.8, 6), 0, 0.4, 0), 40));
    const arm = [[0, 7.5, 0], [0, 7.95, 0.35], [0, 8.1, 0.9], [0, 8.1, 1.6]];
    for (let k = 0; k < arm.length - 1; k++) b.add('metalGrey', solid(beam(arm[k], arm[k + 1], 0.08, 0.08, [1, 0, 0])));
    b.box('metalGrey', -0.17, 7.97, 1.5, 0.17, 8.13, 2.2);
    b.box('lampGlass', -0.13, 7.95, 1.6, 0.13, 7.97, 2.1);
    return { builder: b, collision: [[-0.15, 0, -0.15, 0.15, 7.6, 0.15]] };
  });
}

/** Старинный фонарь на площади: чугунная опора и три плафона. */
export function plazaLamp() {
  return cached('plazaLamp', () => {
    const b = new MeshBuilder();
    b.add('metalDark', solid(new THREE.LatheGeometry([[0.0, 0], [0.32, 0], [0.32, 0.2], [0.2, 0.3], [0.16, 0.9], [0.09, 1.1], [0.07, 4.2], [0.1, 4.3], [0, 4.35]].map(([r, h]) => new THREE.Vector2(r, h)), 10), 50));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const ex = Math.sin(a) * 0.6;
      const ez = Math.cos(a) * 0.6;
      b.add('metalDark', solid(beam([0, 4.0, 0], [ex, 4.15, ez], 0.05, 0.05, [0, 1, 0])));
      b.add('lampGlass', solid(at(cyl(0.13, 0.2, 0.42, 8), ex, 4.38, ez), 30));
      b.add('metalDark', solid(at(cyl(0.22, 0.05, 0.14, 8), ex, 4.66, ez), 30));
    }
    return { builder: b, collision: [[-0.25, 0, -0.25, 0.25, 4.4, 0.25]] };
  });
}

/** Светофор: столб и секция над тротуаром, сигналы смотрят на +Z. */
export function trafficLight() {
  return cached('trafficLight', () => {
    const b = new MeshBuilder();
    b.add('metalGrey', solid(at(cyl(0.08, 0.07, 3.4, 8), 0, 1.7, 0), 40));
    b.box('metalDark', -0.17, 2.3, -0.12, 0.17, 3.3, 0.14);
    [['lightRed', 3.05], ['lightAmber', 2.8], ['lightGreen', 2.55]].forEach(([m, yy]) => {
      b.add(m, solid(at(cyl(0.09, 0.09, 0.04, 10).rotateX(Math.PI / 2), 0, yy, 0.15)));
      b.box('metalDark', -0.12, yy + 0.1, 0.14, 0.12, yy + 0.12, 0.26);
    });
    return { builder: b, collision: [[-0.1, 0, -0.1, 0.1, 3.4, 0.1]] };
  });
}

/** Дорожный знак: 'stop' | 'crossing' | 'main' | 'noEntry'. */
export function roadSign(kind = 'crossing') {
  return cached(`roadSign:${kind}`, () => {
    const b = new MeshBuilder();
    b.add('metalGrey', solid(at(cyl(0.04, 0.04, 2.6, 6), 0, 1.3, 0), 30));
    const yy = 2.35;
    if (kind === 'noEntry' || kind === 'stop') {
      b.add('signRed', solid(at(cyl(0.35, 0.35, 0.03, kind === 'stop' ? 8 : 20).rotateX(Math.PI / 2), 0, yy, 0.05)));
      b.box('signWhite', -0.22, yy - 0.05, 0.065, 0.22, yy + 0.05, 0.075);
    } else if (kind === 'crossing') {
      b.box('signBlue', -0.3, yy - 0.3, 0.035, 0.3, yy + 0.3, 0.065);
      b.triangle('signWhite', [-0.22, yy - 0.2, 0.07], [0.22, yy - 0.2, 0.07], [0, yy + 0.2, 0.07]);
    } else {
      b.add('signYellow', solid(new THREE.BoxGeometry(0.45, 0.45, 0.03).rotateZ(Math.PI / 4).translate(0, yy, 0.05)));
      b.add('signWhite', solid(new THREE.BoxGeometry(0.56, 0.56, 0.02).rotateZ(Math.PI / 4).translate(0, yy, 0.035)));
    }
    return { builder: b, collision: [[-0.06, 0, -0.06, 0.06, 2.6, 0.06]] };
  });
}

/** Скамейка: деревянные рейки на бетонных ножках. */
export function bench() {
  return cached('bench', () => {
    const b = new MeshBuilder();
    for (const x of [-0.8, 0.8]) b.box('concreteWall', x - 0.08, 0, -0.25, x + 0.08, 0.42, 0.22);
    for (let k = 0; k < 3; k++) b.box('bench', -1.0, 0.42, -0.24 + k * 0.16, 1.0, 0.47, -0.12 + k * 0.16);
    for (let k = 0; k < 2; k++) b.box('bench', -1.0, 0.62 + k * 0.17, -0.3, 1.0, 0.74 + k * 0.17, -0.26);
    for (const x of [-0.8, 0.8]) b.box('metalDark', x - 0.03, 0.42, -0.31, x + 0.03, 0.92, -0.26);
    return { builder: b, collision: [[-1.0, 0, -0.32, 1.0, 0.9, 0.24]] };
  });
}

export function bin() {
  return cached('bin', () => {
    const b = new MeshBuilder();
    b.add('metalGreen', solid(at(cyl(0.22, 0.26, 0.85, 10), 0, 0.425, 0), 40));
    b.add('metalDark', solid(at(cyl(0.28, 0.28, 0.05, 10), 0, 0.87, 0), 40));
    return { builder: b, collision: [[-0.27, 0, -0.27, 0.27, 0.9, 0.27]] };
  });
}

/** Мусорный контейнер. */
export function dumpster(color = 'containerGreen') {
  return cached(`dumpster:${color}`, () => {
    const b = new MeshBuilder();
    b.box(color, -0.95, 0.15, -0.6, 0.95, 1.15, 0.6);
    b.box('metalDark', -1.0, 1.15, -0.65, 1.0, 1.22, 0.62);
    for (const [x, z] of [[-0.8, -0.45], [0.8, -0.45], [-0.8, 0.45], [0.8, 0.45]]) b.add('tire', solid(at(cyl(0.075, 0.075, 0.06, 8).rotateZ(Math.PI / 2), x, 0.075, z)));
    return { builder: b, collision: [[-1.0, 0, -0.65, 1.0, 1.22, 0.65]] };
  });
}

function signQuad(b, text, cx, cy, z, h, maxW = 99) {
  const r = signRect(signIndex(text));
  let w = h * r.aspect;
  if (w > maxW) {
    h *= maxW / w;
    w = maxW;
  }
  b.quad('signs', [cx - w / 2, cy - h / 2, z], [cx + w / 2, cy - h / 2, z], [cx + w / 2, cy + h / 2, z], [cx - w / 2, cy + h / 2, z], [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]]);
  return w;
}

/** Остановка: навес, стекло сзади, скамейка, табличка. Открыта к +Z. */
export function busStop() {
  return cached('busStop', () => {
    const b = new MeshBuilder();
    for (const x of [-1.9, 1.9]) for (const z of [-0.75, 0.6]) b.box('metalGrey', x - 0.05, 0, z - 0.05, x + 0.05, 2.5, z + 0.05);
    b.box('metalGrey', -2.1, 2.5, -0.95, 2.1, 2.62, 0.85);
    b.box('glassLight', -1.9, 0.15, -0.77, 1.9, 2.4, -0.73);
    b.box('glassLight', -1.92, 0.15, -0.7, -1.88, 2.4, 0.55);
    b.box('metalGrey', -1.6, 0.42, -0.7, 1.6, 0.48, -0.3);
    for (const x of [-1.2, 1.2]) b.box('metalDark', x - 0.04, 0, -0.6, x + 0.04, 0.42, -0.4);
    const w = signQuad(b, 'ОСТАНОВКА', 0, 2.82, 0.0, 0.32);
    b.box('signBlue', -w / 2 - 0.05, 2.62, -0.04, w / 2 + 0.05, 3.02, -0.005);
    return { builder: b, collision: [[-2.0, 0, -0.8, 2.0, 2.6, -0.7], [-2.0, 0, -0.8, -1.85, 2.6, 0.6]] };
  });
}

/** Киоск с вывеской. */
export function kiosk(text = 'ТАБАК', color = 'plasterBlue') {
  return cached(`kiosk:${text}:${color}`, () => {
    const b = new MeshBuilder();
    b.box(color, -1.3, 0, -1.0, 1.3, 2.5, 1.0);
    b.box('glassShop', -1.1, 0.95, 1.0, 1.1, 2.05, 1.03);
    for (const x of [-1.1, -0.37, 0.37, 1.1]) b.box('frameDark', x - 0.03, 0.95, 1.0, x + 0.03, 2.05, 1.05);
    b.box('frameDark', -1.15, 0.9, 1.0, 1.15, 0.97, 1.12);
    b.box('roofTar', -1.5, 2.5, -1.2, 1.5, 2.65, 1.35);
    b.box('frameDark', -1.3, 2.65, 0.95, 1.3, 3.05, 1.02);
    signQuad(b, text, 0, 2.85, 1.025, 0.32, 2.4);
    return { builder: b, collision: [[-1.3, 0, -1.0, 1.3, 2.65, 1.1]] };
  });
}

/** Афишная тумба: восьмигранная, с афишами. */
export function adColumn() {
  return cached('adColumn', () => {
    const b = new MeshBuilder();
    b.add('metalGreen', solid(at(cyl(0.62, 0.62, 2.8, 8), 0, 1.4, 0)));
    b.add('metalGreen', solid(at(cyl(0.72, 0.5, 0.3, 8), 0, 2.95, 0)));
    b.add('metalGreen', solid(at(cyl(0.2, 0.05, 0.4, 8), 0, 3.3, 0)));
    const posters = ['КИНО', 'ЦИРК', 'ТЕАТР', 'КОНЦЕРТ'];
    posters.forEach((text, k) => {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 8;
      const g = new MeshBuilder();
      signQuad(g, text, 0, 1.6, 0.6, 0.42, 0.44);
      g.box('signWhite', -0.24, 0.5, 0.585, 0.24, 2.4, 0.595);
      g.appendTo(b, new THREE.Matrix4().makeRotationY(a));
    });
    return { builder: b, collision: [[-0.62, 0, -0.62, 0.62, 3.1, 0.62]] };
  });
}

export function bollard() {
  return cached('bollard', () => {
    const b = new MeshBuilder();
    b.add('metalDark', solid(at(cyl(0.11, 0.09, 0.9, 8), 0, 0.45, 0), 40));
    b.add('metalDark', solid(at(new THREE.SphereGeometry(0.1, 8, 4), 0, 0.9, 0), 40));
    return { builder: b, collision: [[-0.11, 0, -0.11, 0.11, 0.95, 0.11]] };
  });
}

/** Бетонная клумба с кустом. */
export function planter() {
  return cached('planter', () => {
    const b = new MeshBuilder();
    b.box('concreteWall', -0.8, 0, -0.8, 0.8, 0.6, 0.8, 'y-');
    b.box('dirt', -0.7, 0.45, -0.7, 0.7, 0.58, 0.7, 'y-');
    b.add('hedge', solid(new THREE.IcosahedronGeometry(0.75, 0).scale(1, 0.7, 1).translate(0, 0.95, 0)));
    return { builder: b, collision: [[-0.8, 0, -0.8, 0.8, 0.6, 0.8]] };
  });
}

/** Секция металлического забора длиной length вдоль X. */
export function fence(length = 2.5, kind = 'metal') {
  return cached(`fence:${length}:${kind}`, () => {
    const b = new MeshBuilder();
    if (kind === 'concrete') {
      b.box('concreteWall', -length / 2, 0, -0.06, length / 2, 2.2, 0.06);
      for (let k = 0; k < 3; k++) b.box('concreteWall', -length / 2 + 0.15, 0.45 + k * 0.6, 0.06, length / 2 - 0.15, 0.75 + k * 0.6, 0.09);
      b.box('concreteDark', length / 2 - 0.12, 0, -0.12, length / 2 + 0.12, 2.35, 0.12);
      return { builder: b, collision: [[-length / 2, 0, -0.12, length / 2, 2.35, 0.12]] };
    }
    if (kind === 'brick') {
      b.box('brick', -length / 2, 0, -0.18, length / 2, 2.4, 0.18);
      b.box('concreteDark', -length / 2 - 0.02, 2.4, -0.22, length / 2 + 0.02, 2.5, 0.22);
      return { builder: b, collision: [[-length / 2, 0, -0.2, length / 2, 2.5, 0.2]] };
    }
    b.box('metalGreen', -length / 2, 0, -0.05, -length / 2 + 0.08, 1.7, 0.05);
    b.box('metalGreen', -length / 2, 0.15, -0.02, length / 2, 0.2, 0.02);
    b.box('metalGreen', -length / 2, 1.5, -0.02, length / 2, 1.55, 0.02);
    for (let x = -length / 2 + 0.16; x < length / 2 - 0.05; x += 0.14) b.box('metalGreen', x - 0.01, 0.2, -0.01, x + 0.01, 1.5, 0.01, 'y+y-');
    return { builder: b, collision: [[-length / 2, 0, -0.05, length / 2, 1.7, 0.05]] };
  });
}

/* ------------------------------------------------------------------ */
/* Деревья                                                             */
/* ------------------------------------------------------------------ */

/** Модель, которая на карте ставится копиями с общим мешем (как техника). */
function instanced(key, make) {
  if (!cache.has(key)) cache.set(key, { ...make(), instance: true, key });
  return cache.get(key);
}

/** «Облако» листвы: икосаэдр с неровной поверхностью и мягкими нормалями. */
function leafCluster(r, seed, flat = 0.8) {
  const g = new THREE.IcosahedronGeometry(r, r >= 1 ? 2 : 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const s1 = seed * 1.7;
  const s2 = seed * 2.3;
  const s3 = seed * 3.1;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + 0.16 * Math.sin(v.x * 3.1 / r + s1) * Math.cos(v.z * 2.7 / r + s2) + 0.1 * Math.sin(v.y * 4.3 / r + s3);
    v.multiplyScalar(k);
    v.y *= v.y < 0 ? flat * 0.75 : flat; // снизу крона площе
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return solid(g, 80);
}

/** Сук от a до c: брусок-«труба» с сужением. */
function bough(b, a, c, r0, r1) {
  const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), 6, 1);
  g.translate(0, d.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate(...a);
  b.add('bark', solid(g, 60));
}

/**
 * Лиственное дерево (липа, клён): изогнутый ствол, развилка, ветви с сучьями,
 * крона из нескольких облаков листвы. variant меняет форму, dead — сухое.
 */
export function tree(variant = 0, dead = false) {
  return instanced(`tree:${variant}:${dead}`, () => {
    const b = new MeshBuilder();
    const rnd = random(100 + variant);
    const h = 2.6 + rnd() * 1.1;
    const lean = [(rnd() - 0.5) * 0.35, (rnd() - 0.5) * 0.35];
    // ствол: три отрезка с лёгким изгибом и корневой «пяткой»
    const trunk = [[0, 0, 0], [lean[0] * 0.25, h * 0.45, lean[1] * 0.25], [lean[0] * 0.7, h * 0.8, lean[1] * 0.7], [lean[0], h, lean[1]]];
    const radii = [0.24, 0.19, 0.16, 0.14];
    for (let k = 0; k < 3; k++) bough(b, trunk[k], trunk[k + 1], radii[k], radii[k + 1]);
    b.add('bark', solid(new THREE.CylinderGeometry(0.2, 0.3, 0.25, 7).translate(0, 0.12, 0), 60));
    const fork = trunk[3];
    const clusters = [];
    const main = (dead ? 5 : 4) + Math.floor(rnd() * 2);
    for (let k = 0; k < main; k++) {
      const a = (k / main) * Math.PI * 2 + rnd() * 0.8;
      const len = 1.5 + rnd() * 1.1;
      const up = 0.75 + rnd() * 0.35;
      const mid = [fork[0] + Math.sin(a) * len * 0.45, fork[1] + len * up * 0.55, fork[2] + Math.cos(a) * len * 0.45];
      const end = [fork[0] + Math.sin(a) * len * 0.8, fork[1] + len * up, fork[2] + Math.cos(a) * len * 0.8];
      bough(b, fork, mid, 0.11, 0.08);
      bough(b, mid, end, 0.08, 0.04);
      // боковые сучья
      for (let j = 0; j < 2; j++) {
        const a2 = a + (j ? 0.9 : -0.9) + (rnd() - 0.5) * 0.4;
        const l2 = 0.6 + rnd() * 0.5;
        const tip = [mid[0] + Math.sin(a2) * l2, mid[1] + l2 * 0.6, mid[2] + Math.cos(a2) * l2];
        bough(b, mid, tip, 0.05, 0.02);
        if (!dead) clusters.push([tip, 0.75 + rnd() * 0.3]);
      }
      if (!dead) clusters.push([end, 1.0 + rnd() * 0.35]);
    }
    if (!dead) {
      // середина кроны, чтобы не просвечивала
      clusters.push([[fork[0], fork[1] + 1.6, fork[2]], 1.35]);
      clusters.push([[fork[0] + 0.3, fork[1] + 2.3, fork[2] - 0.2], 1.0]);
      const mats = ['leaves', 'leavesLight', variant % 3 === 2 ? 'leavesDry' : 'leaves', 'leavesDark'];
      clusters.forEach(([c, r], k) => {
        b.add(mats[k % mats.length], leafCluster(r, variant * 13 + k), new THREE.Matrix4().makeTranslation(c[0], c[1] + 0.15, c[2]));
      });
    }
    return { builder: b, collision: [[-0.22, 0, -0.22, 0.22, h, 0.22]] };
  });
}

export function bush(variant = 0) {
  return instanced(`bush:${variant}`, () => {
    const b = new MeshBuilder();
    const rnd = random(200 + variant);
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Matrix4().makeTranslation((rnd() - 0.5) * 1.0, 0.42 + rnd() * 0.15, (rnd() - 0.5) * 1.0);
      b.add(k % 2 ? 'hedge' : 'leaves', leafCluster(0.5 + rnd() * 0.25, 40 + variant * 7 + k, 0.75), m);
    }
    return { builder: b, collision: [] };
  });
}

/* ------------------------------------------------------------------ */
/* Мусор войны                                                         */
/* ------------------------------------------------------------------ */

/** Груда обломков радиусом radius и высотой height. */
export function rubble(seed = 1, radius = 1.6, height = 0.9, mats = ['concreteDark', 'brick', 'concreteWall', 'plasterGrey']) {
  return cached(`rubble:${seed}:${radius}:${height}:${mats.join()}`, () => {
    const b = new MeshBuilder();
    const rnd = random(seed);
    const piece = new THREE.BoxGeometry(1, 1, 1);
    const data = solid(piece);
    const n = Math.round(radius * radius * 14);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * radius;
      const hh = height * Math.max(0, 1 - d / radius) ** 1.2;
      const s = 0.18 + rnd() * 0.4;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * d, rnd() * hh + s * 0.2, Math.sin(a) * d),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)),
        new THREE.Vector3(s * (0.7 + rnd()), s * (0.5 + rnd() * 0.5), s * (0.7 + rnd())),
      );
      b.add(mats[Math.floor(rnd() * mats.length)], data, m);
    }
    return { builder: b, collision: [[-radius * 0.6, 0, -radius * 0.6, radius * 0.6, height * 0.7, radius * 0.6]] };
  });
}

/** Воронка: тёмное пятно и вывороченный асфальт по краю. */
export function crater(radius = 2, seed = 1) {
  return cached(`crater:${radius}:${seed}`, () => {
    const b = new MeshBuilder();
    const rnd = random(seed);
    b.add('scorch', solid(new THREE.CircleGeometry(radius, 14).rotateX(-Math.PI / 2).translate(0, 0.03, 0)));
    b.add('dirt', solid(new THREE.CircleGeometry(radius * 0.55, 10).rotateX(-Math.PI / 2).translate(0, 0.04, 0)));
    const piece = solid(new THREE.BoxGeometry(1, 1, 1));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + rnd() * 0.3;
      const d = radius * (0.6 + rnd() * 0.35);
      const s = 0.25 + rnd() * 0.35;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * d, 0.05, Math.sin(a) * d),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.8, -a, (rnd() - 0.5) * 0.8)),
        new THREE.Vector3(s * 1.4, 0.12, s),
      );
      b.add(rnd() < 0.5 ? 'asphaltPatch' : 'dirt', piece, m);
    }
    return { builder: b, collision: [] };
  });
}

export function crate(kind = 'wood') {
  return cached(`crate:${kind}`, () => {
    const b = new MeshBuilder();
    if (kind === 'ammo') {
      b.box('ammoBox', -0.45, 0, -0.22, 0.45, 0.32, 0.22);
      b.box('metalDark', -0.3, 0.32, -0.04, 0.3, 0.35, 0.04);
      return { builder: b, collision: [[-0.45, 0, -0.22, 0.45, 0.35, 0.22]] };
    }
    b.box('crate', -0.6, 0, -0.45, 0.6, 0.85, 0.45);
    b.box('frameBrown', -0.62, 0.05, -0.47, 0.62, 0.15, 0.47);
    b.box('frameBrown', -0.62, 0.7, -0.47, 0.62, 0.8, 0.47);
    return { builder: b, collision: [[-0.62, 0, -0.47, 0.62, 0.85, 0.47]] };
  });
}

export function barrel(color = 'barrelBlue') {
  return cached(`barrel:${color}`, () => {
    const b = new MeshBuilder();
    b.add(color, solid(at(cyl(0.29, 0.29, 0.88, 12), 0, 0.44, 0), 40));
    for (const yy of [0.29, 0.59]) b.add(color, solid(at(cyl(0.305, 0.305, 0.04, 12), 0, yy, 0), 40));
    return { builder: b, collision: [[-0.3, 0, -0.3, 0.3, 0.88, 0.3]] };
  });
}

export function tires() {
  return cached('tires', () => {
    const b = new MeshBuilder();
    for (let k = 0; k < 3; k++) b.add('tire', solid(new THREE.TorusGeometry(0.31, 0.12, 6, 12).rotateX(Math.PI / 2).translate(k === 2 ? 0.1 : 0, 0.12 + k * 0.23, 0), 50));
    return { builder: b, collision: [[-0.45, 0, -0.45, 0.45, 0.7, 0.45]] };
  });
}

export function pallet() {
  return cached('pallet', () => {
    const b = new MeshBuilder();
    for (const z of [-0.5, 0, 0.5]) b.box('crate', -0.6, 0, z - 0.05, 0.6, 0.1, z + 0.05);
    for (let k = 0; k < 5; k++) b.box('crate', -0.6 + k * 0.29, 0.1, -0.55, -0.6 + k * 0.29 + 0.11, 0.14, 0.55);
    return { builder: b, collision: [[-0.6, 0, -0.55, 0.6, 0.14, 0.55]] };
  });
}

/** Морской контейнер 20 футов, двери на +Z. */
export function container(color = 'containerBlue') {
  return cached(`container:${color}`, () => {
    const b = new MeshBuilder();
    b.box(color, -1.22, 0, -3.03, 1.22, 2.59, 3.03);
    b.box('metalDark', -1.22, 0.15, 3.03, 1.22, 2.45, 3.06);
    for (const x of [-0.6, -0.2, 0.2, 0.6]) b.box('metalGrey', x - 0.025, 0.2, 3.06, x + 0.025, 2.4, 3.1);
    return { builder: b, collision: [[-1.22, 0, -3.03, 1.22, 2.59, 3.1]] };
  });
}

/** Торговая палатка: каркас, навес, прилавок с ящиками. */
export function stall(awning = 'awningRed', seed = 1) {
  return cached(`stall:${awning}:${seed}`, () => {
    const b = new MeshBuilder();
    const rnd = random(seed);
    for (const x of [-1.4, 1.4]) for (const z of [-1.0, 1.0]) b.box('metalGrey', x - 0.03, 0, z - 0.03, x + 0.03, z > 0 ? 2.3 : 2.6, z + 0.03);
    b.quad(awning, [-1.6, 2.3, 1.25], [1.6, 2.3, 1.25], [1.6, 2.65, -1.2], [-1.6, 2.65, -1.2]);
    b.quad(awning, [1.6, 2.3, 1.25], [-1.6, 2.3, 1.25], [-1.6, 2.65, -1.2], [1.6, 2.65, -1.2]);
    b.box('bench', -1.4, 0.85, 0.5, 1.4, 0.92, 1.05);
    b.box('crate', -1.35, 0, 0.55, 1.35, 0.85, 1.0);
    const goods = ['signRed', 'signYellow', 'leavesLight', 'carOrange', 'signWhite'];
    for (let k = 0; k < 4; k++) {
      const x = -1.05 + k * 0.7;
      b.box('crate', x - 0.28, 0.92, 0.58, x + 0.28, 1.12, 0.98);
      b.box(goods[Math.floor(rnd() * goods.length)], x - 0.24, 1.05, 0.62, x + 0.24, 1.18, 0.94);
    }
    return { builder: b, collision: [[-1.45, 0, 0.5, 1.45, 1.2, 1.05]] };
  });
}

/* ------------------------------------------------------------------ */
/* Площадь                                                             */
/* ------------------------------------------------------------------ */

/** Памятник: гранитный ступенчатый постамент и обелиск с бронзовым венком. */
export function monument() {
  return cached('monument', () => {
    const b = new MeshBuilder();
    const steps = [[4.4, 0.3], [3.6, 0.3], [2.8, 0.3]];
    let yy = 0;
    for (const [s, h] of steps) {
      b.box('granite', -s / 2, yy, -s / 2, s / 2, yy + h, s / 2, 'y-');
      yy += h;
    }
    b.box('granite', -1.0, yy, -1.0, 1.0, yy + 2.2, 1.0, 'y-');
    b.box('granite', -1.15, yy + 2.2, -1.15, 1.15, yy + 2.45, 1.15);
    const ob = new THREE.CylinderGeometry(0.42, 0.72, 8, 4, 1).rotateY(Math.PI / 4).translate(0, yy + 2.45 + 4, 0);
    b.add('granite', solid(ob));
    b.add('granite', solid(new THREE.ConeGeometry(0.42, 0.9, 4).rotateY(Math.PI / 4).translate(0, yy + 2.45 + 8 + 0.45, 0)));
    b.add('bronze', solid(new THREE.TorusGeometry(0.55, 0.11, 6, 16).translate(0, yy + 1.2, 1.06), 40));
    b.box('bronze', -0.5, yy + 0.25, 1.0, 0.5, yy + 0.6, 1.04);
    return { builder: b, collision: [[-2.2, 0, -2.2, 2.2, 0.6, 2.2], [-1.0, 0, -1.0, 1.0, yy + 11, 1.0]] };
  });
}

/** Флагшток точки захвата (флаг — отдельно: его перекрашивает игра). */
export function flagpole(height = 11) {
  return cached(`flagpole:${height}`, () => {
    const b = new MeshBuilder();
    b.box('granite', -0.5, 0, -0.5, 0.5, 0.4, 0.5, 'y-');
    b.add('metalGrey', solid(at(cyl(0.09, 0.05, height, 8), 0, height / 2 + 0.4, 0), 40));
    b.add('chrome', solid(at(new THREE.SphereGeometry(0.12, 8, 6), 0, height + 0.45, 0), 40));
    return { builder: b, collision: [[-0.5, 0, -0.5, 0.5, 0.4, 0.5], [-0.1, 0, -0.1, 0.1, height, 0.1]] };
  });
}

/** Полотнище флага с волной: начало координат — у древка, полотно вдоль +X. */
export function flagCloth(width = 2.4, height = 1.5) {
  const b = new MeshBuilder();
  const n = 8;
  for (let k = 0; k < n; k++) {
    const x0 = (k / n) * width;
    const x1 = ((k + 1) / n) * width;
    const z0 = Math.sin((k / n) * Math.PI * 2) * 0.12 * (k / n);
    const z1 = Math.sin(((k + 1) / n) * Math.PI * 2) * 0.12 * ((k + 1) / n);
    b.quad('flagCloth', [x0, -height, z0], [x1, -height, z1], [x1, 0, z1], [x0, 0, z0]);
    b.quad('flagCloth', [x1, -height, z1], [x0, -height, z0], [x0, 0, z0], [x1, 0, z1]);
  }
  return b;
}

/** АЗС: навес на колоннах с вывеской и колонки. Навес вытянут вдоль X. */
export function gasCanopy() {
  return cached('gasCanopy', () => {
    const b = new MeshBuilder();
    for (const x of [-5, 5]) for (const z of [-3, 3]) b.box('signWhite', x - 0.25, 0, z - 0.25, x + 0.25, 5.0, z + 0.25);
    b.box('signWhite', -8, 5.0, -5, 8, 5.7, 5);
    b.box('signRed', -8.02, 5.15, -5.02, 8.02, 5.45, 5.02);
    for (const z of [-5.03, 5.03]) {
      const g = new MeshBuilder();
      signQuad(g, 'АЗС', 0, 5.35, 0.0, 0.42);
      g.appendTo(b, new THREE.Matrix4().makeRotationY(z > 0 ? 0 : Math.PI).setPosition(0, 0, z + Math.sign(z) * 0.005));
    }
    for (const x of [-5, 5]) {
      b.box('concreteWall', x - 0.6, 0, -1.8, x + 0.6, 0.25, 1.8);
      for (const z of [-0.9, 0.9]) {
        b.box('signWhite', x - 0.35, 0.25, z - 0.25, x + 0.35, 1.9, z + 0.25);
        b.box('signRed', x - 0.36, 1.5, z - 0.26, x + 0.36, 1.9, z + 0.26);
        b.box('glassShop', x - 0.2, 1.0, z + 0.25, x + 0.2, 1.35, z + 0.26);
      }
    }
    const collision = [];
    for (const x of [-5, 5]) {
      for (const z of [-3, 3]) collision.push([x - 0.25, 0, z - 0.25, x + 0.25, 5.0, z + 0.25]);
      collision.push([x - 0.6, 0, -1.8, x + 0.6, 1.9, 1.8]);
    }
    collision.push([-8, 5.0, -5, 8, 5.7, 5]);
    return { builder: b, collision };
  });
}
