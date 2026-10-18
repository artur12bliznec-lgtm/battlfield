import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterial } from './materials.js';

/**
 * Набор инструментов для процедурного моделирования.
 *
 * Соглашения для всех моделей проекта (совпадают с glTF):
 *   - единицы — метры;
 *   - ось Y смотрит вверх, Z — вперёд (ствол оружия, лицо бойца), X — влево;
 *   - каждая модель собирается из деталей, а затем детали одного материала
 *     сливаются в один меш — это дёшево для движка (мало draw call'ов).
 */

export const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Примитивы                                                           */
/* ------------------------------------------------------------------ */

/** Поворачивает геометрию так, чтобы её ось +Y смотрела вдоль axis ('x' | 'y' | 'z'). */
function alignY(geometry, axis) {
  if (axis === 'x') geometry.rotateZ(-Math.PI / 2);
  else if (axis === 'z') geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Коробка w×h×d (по X, Y, Z) с центром в нуле; r — радиус скругления рёбер. */
export function box(w, h, d, r = 0) {
  if (r <= 0) return new THREE.BoxGeometry(w, h, d);
  const radius = Math.min(r, Math.min(w, h, d) / 2 - 1e-5);
  return new RoundedBoxGeometry(w, h, d, 1, radius); // один сегмент — аккуратная фаска
}

/** Цилиндр/конус вдоль оси axis: rA — радиус у отрицательного конца, rB — у положительного. */
export function cylinder(rA, rB, length, segments = 12, axis = 'y') {
  return alignY(new THREE.CylinderGeometry(rB, rA, length, segments), axis);
}

/** Стержень от точки a до точки b ([x, y, z]); rA и rB — радиусы на концах. */
export function rod(a, b, rA, rB = rA, segments = 8) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const dir = end.clone().sub(start);
  const geometry = new THREE.CylinderGeometry(rB, rA, dir.length(), segments);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  return geometry;
}

export function sphere(r, widthSegments = 12, heightSegments = 8) {
  return new THREE.SphereGeometry(r, widthSegments, heightSegments);
}

/** Тело вращения: points — [[радиус, высота], ...] от низа к верху, ось вращения axis. */
export function lathe(points, segments = 16, axis = 'y') {
  const geometry = new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), segments);
  return alignY(geometry, axis);
}

/**
 * 2D-контур из списка команд:
 *   [x, y]                           — отрезок до точки (первая точка — начало контура);
 *   ['q', cx, cy, x, y]              — квадратичная кривая через контрольную точку;
 *   ['c', c1x, c1y, c2x, c2y, x, y]  — кубическая кривая.
 */
export function shape(path, ShapeClass = THREE.Shape) {
  const s = new ShapeClass();
  path.forEach((p, i) => {
    if (p[0] === 'q') s.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    else if (p[0] === 'c') s.bezierCurveTo(p[1], p[2], p[3], p[4], p[5], p[6]);
    else if (i === 0) s.moveTo(p[0], p[1]);
    else s.lineTo(p[0], p[1]);
  });
  return s;
}

/**
 * Многоугольник со скруглёнными углами в формате команд для shape().
 * points — [[x, y], ...] или [[x, y, r], ...] с индивидуальным радиусом угла.
 */
export function rounded(points, radius = 0) {
  const path = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x, y, own] = points[i];
    const r = own ?? radius;
    if (!r) {
      path.push([x, y]);
      continue;
    }
    const [px, py] = points[(i + n - 1) % n];
    const [nx, ny] = points[(i + 1) % n];
    const d1 = Math.hypot(px - x, py - y);
    const d2 = Math.hypot(nx - x, ny - y);
    const r1 = Math.min(r, d1 / 2);
    const r2 = Math.min(r, d2 / 2);
    path.push([x + ((px - x) / d1) * r1, y + ((py - y) / d1) * r1]);
    path.push(['q', x, y, x + ((nx - x) / d2) * r2, y + ((ny - y) / d2) * r2]);
  }
  return path;
}

function extrude(path, thickness, { bevel = 0.002, bevelSegments = 1, curveSegments = 6, holes = [] } = {}) {
  const s = shape(path);
  for (const hole of holes) s.holes.push(shape(hole, THREE.Path));
  const b = Math.min(bevel, thickness * 0.3);
  const depth = Math.max(thickness - 2 * b, 1e-4);
  const geometry = new THREE.ExtrudeGeometry(s, {
    depth,
    curveSegments,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b, // фаска «съедает» край внутрь, внешний контур остаётся точным
    bevelSegments,
  });
  return { geometry, depth };
}

/**
 * Боковой профиль: контур в координатах (z — вперёд, y — вверх), выдавленный
 * по X на толщину thickness и отцентрованный по X. Главный инструмент для
 * оружия: ложа, рукоять, магазин, спусковая скоба...
 */
export function profile(path, thickness, options) {
  const { geometry, depth } = extrude(path, thickness, options);
  geometry.rotateY(-Math.PI / 2); // (u, v, w) → (−w, v, u)
  geometry.translate(depth / 2, 0, 0);
  return geometry;
}

/** Вид спереди: контур в координатах (x, y), выдавленный по Z на thickness (центр по Z). */
export function slab(path, thickness, options) {
  const { geometry, depth } = extrude(path, thickness, options);
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/**
 * Брусок от точки a до точки b: ширина w вдоль side (проекция на плоскость
 * сечения), толщина t — поперёк. Удобно для ремней, лямок, планок.
 */
export function beam(a, b, w, t, side = [1, 0, 0]) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const zAxis = B.clone().sub(A);
  const length = zAxis.length();
  zAxis.normalize();
  const S = new THREE.Vector3(...side);
  const xAxis = S.sub(zAxis.clone().multiplyScalar(S.dot(zAxis))).normalize();
  const yAxis = zAxis.clone().cross(xAxis);
  const geometry = new THREE.BoxGeometry(w, t, length);
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(A.add(B).multiplyScalar(0.5)));
  return geometry;
}

/** Вид сверху: контур в координатах (x, z), выдавленный вверх по Y на thickness (центр по Y). */
export function plate(path, thickness, options) {
  const { geometry, depth } = extrude(path, thickness, options);
  geometry.rotateX(Math.PI / 2); // (u, v, w) → (u, −w, v)
  geometry.translate(0, depth / 2, 0);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Лофт: поверхность через последовательность сечений                  */
/* ------------------------------------------------------------------ */

function superellipse(theta, power) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / power;
  return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e];
}

/**
 * Лофт вдоль ломаной. stations — [{ p: [x, y, z], a, b }]: центр сечения и
 * полуразмеры сечения. Сечение — суперэллипс (power = 2 — эллипс, больше —
 * ближе к прямоугольнику). Ось «a» сечения направлена вдоль ref
 * (спроецированного на плоскость сечения), ось «b» — перпендикулярно.
 */
export function loftPath(stations, { segments = 12, power = 2, ref = [1, 0, 0], caps = true } = {}) {
  const centers = stations.map((s) => new THREE.Vector3(...s.p));
  const R = new THREE.Vector3(...ref);
  const sections = stations.map((st, i) => {
    const prev = centers[Math.max(i - 1, 0)];
    const next = centers[Math.min(i + 1, centers.length - 1)];
    const T = next.clone().sub(prev).normalize();
    const u = R.clone().sub(T.clone().multiplyScalar(R.dot(T))).normalize();
    const v = T.clone().cross(u); // u × v = T — нормали смотрят наружу
    const points = [];
    for (let k = 0; k < segments; k++) {
      const theta = (k / segments) * Math.PI * 2 + (st.phase ?? Math.PI / segments);
      const [cu, cv] = superellipse(theta, st.power ?? power);
      points.push(centers[i].clone().addScaledVector(u, cu * st.a).addScaledVector(v, cv * st.b));
    }
    return points;
  });
  return new LoftGeometry(sections, { closed: true, capStart: caps, capEnd: caps });
}

const AXES = {
  x: { dir: [1, 0, 0], ref: [0, 1, 0] },
  '-x': { dir: [-1, 0, 0], ref: [0, 1, 0] },
  y: { dir: [0, 1, 0], ref: [1, 0, 0] },
  '-y': { dir: [0, -1, 0], ref: [1, 0, 0] },
  z: { dir: [0, 0, 1], ref: [1, 0, 0] },
  '-z': { dir: [0, 0, -1], ref: [1, 0, 0] },
};

/**
 * Лофт вдоль оси. stations — [{ t, a, b, dx, dy, dz }]: t — расстояние вдоль
 * оси от start, a и b — полуразмеры сечения (для оси Y: a — по X, b — по Z;
 * для X: a — по Y, b — по Z; для Z: a — по X, b — по Y), dx/dy/dz — сдвиг.
 */
export function tube(axis, start, stations, options = {}) {
  const { dir, ref } = AXES[axis];
  const pts = stations.map((s) => ({
    p: [
      start[0] + dir[0] * s.t + (s.dx ?? 0),
      start[1] + dir[1] * s.t + (s.dy ?? 0),
      start[2] + dir[2] * s.t + (s.dz ?? 0),
    ],
    a: s.a,
    b: s.b,
    power: s.power,
  }));
  return loftPath(pts, { ref, ...options });
}

/** Лента (бинт, ремень): points — путь [x, y, z], ширина по X, толщина поперёк. */
export function ribbon(points, width, thickness) {
  return loftPath(
    points.map((p) => ({ p, a: width / 2, b: thickness / 2, power: 40 })),
    { segments: 4, ref: [1, 0, 0], caps: true },
  );
}

/* ------------------------------------------------------------------ */
/* Операции над геометрией                                             */
/* ------------------------------------------------------------------ */

/** Зеркальная копия по оси X (с исправлением порядка обхода треугольников). */
export function mirrorX(geometry) {
  const g = geometry.clone();
  g.scale(-1, 1, 1);
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.index.needsUpdate = true;
  } else {
    for (const attr of Object.values(g.attributes)) {
      const n = attr.itemSize;
      const a = attr.array;
      for (let v = 0; v < attr.count; v += 3) {
        for (let k = 0; k < n; k++) {
          const i1 = (v + 1) * n + k;
          const i2 = (v + 2) * n + k;
          [a[i1], a[i2]] = [a[i2], a[i1]];
        }
      }
    }
  }
  return g;
}

/**
 * Веса скиннинга: skin — индекс кости (деталь жёстко следует за костью)
 * или функция (x, y, z) → [[кость, вес], ...] для плавных сгибов.
 */
function applySkin(geometry, skin) {
  const pos = geometry.attributes.position;
  const indices = new Uint16Array(pos.count * 4);
  const weights = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const pairs = typeof skin === 'number' ? [[skin, 1]] : skin(pos.getX(i), pos.getY(i), pos.getZ(i));
    pairs.forEach(([bone, weight], k) => {
      indices[i * 4 + k] = bone;
      weights[i * 4 + k] = weight;
    });
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
}

/** Убирает треугольники нулевой площади (бывают у полюсов тел вращения). */
function dropDegenerate(geometry) {
  const pos = geometry.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const keep = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16) keep.push(i);
  }
  if (keep.length * 3 === pos.count) return geometry;
  const result = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const n = attr.itemSize;
    const array = new attr.array.constructor(keep.length * 3 * n);
    keep.forEach((start, t) => array.set(attr.array.subarray(start * n, (start + 3) * n), t * 3 * n));
    result.setAttribute(name, new THREE.BufferAttribute(array, n, attr.normalized));
  }
  return result;
}

/** Подготовка детали к слиянию: нормали с порогом сглаживания crease (в градусах). */
function prepare(geometry, crease) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = dropDegenerate(g);
  g = toCreasedNormals(g, crease * DEG);
  g.normalizeNormals();
  return mergeVertices(g);
}

/** Пустой узел-«точка крепления» (дуло, рукоять, прицел...). */
export function anchor(name, position, rotation = [0, 0, 0]) {
  const node = new THREE.Object3D();
  node.name = name;
  node.position.set(...position);
  node.rotation.set(...rotation);
  return node;
}

/**
 * Список деталей модели. Детали добавляются с именем материала из палитры,
 * а build() сливает их в одну геометрию с группами по материалам.
 */
export class Parts {
  constructor() {
    this.items = [];
  }

  /**
   * crease — угол (в градусах), меньше которого грани сглаживаются:
   * 0 — полностью гранёная деталь, 90 — гладкая.
   */
  add(geometry, material, { crease = 40, skin } = {}) {
    if (skin !== undefined) applySkin(geometry, skin);
    this.items.push({ geometry, material, crease });
  }

  /** Сдвинуть все уже добавленные детали. */
  translate(x, y, z) {
    for (const item of this.items) item.geometry.translate(x, y, z);
  }

  buildGeometry() {
    const byMaterial = new Map();
    for (const item of this.items) {
      if (!byMaterial.has(item.material)) byMaterial.set(item.material, []);
      byMaterial.get(item.material).push(prepare(item.geometry, item.crease));
    }
    const names = [...byMaterial.keys()];
    const geometry = mergeGeometries(
      names.map((name) => mergeGeometries(byMaterial.get(name), false)),
      true,
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, materials: names.map(getMaterial) };
  }

  build(name) {
    const { geometry, materials } = this.buildGeometry();
    const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
