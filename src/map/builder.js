import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterial } from '../models/materials.js';

/*
 * Быстрая сборка больших мешей для карты.
 *
 * Город состоит из десятков тысяч коробок (простенки, рамы, подоконники,
 * бордюры...). Создавать на каждую BufferGeometry слишком медленно, поэтому
 * MeshBuilder сразу пишет вершины в массивы — отдельно для каждого материала,
 * а build() собирает один меш с группами по материалам.
 *
 * Текстурные координаты — кубическая проекция в метрах: узор материала
 * повторяется каждые tile метров и не тянется на деталях разного размера.
 */

const tileOf = (material) => getMaterial(material).userData.tile ?? 0;

/** Текстурные координаты точки p для грани с нормалью n (проекция на главную плоскость). */
function project(p, n, scale, out) {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) {
    out[0] = (n[0] > 0 ? -p[2] : p[2]) * scale;
    out[1] = p[1] * scale;
  } else if (ay >= az) {
    out[0] = p[0] * scale;
    out[1] = p[2] * scale;
  } else {
    out[0] = (n[2] > 0 ? p[0] : -p[0]) * scale;
    out[1] = p[1] * scale;
  }
  return out;
}

function normalOf(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/**
 * Грани коробки: нормаль и четыре угла (против часовой стрелки, если смотреть
 * снаружи). Углы заданы индексами: 0 — минимум по оси, 1 — максимум.
 */
const BOX_FACES = {
  'x+': { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  'x-': { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  'y+': { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  'y-': { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  'z+': { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  'z-': { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
};
export const FACE_NAMES = Object.keys(BOX_FACES);

/**
 * Подготовленная геометрия: треугольники без индексов, плоские (crease = 0)
 * или сглаженные до угла crease (в градусах) нормали. keepUV — оставить свои
 * текстурные координаты геометрии (в повторах узора), иначе будет проекция.
 */
export function solid(geometry, crease = 0, keepUV = false) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (!keepUV) g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  if (crease > 0) g = toCreasedNormals(g, (crease * Math.PI) / 180);
  else g.computeVertexNormals();
  return { position: g.attributes.position.array, normal: g.attributes.normal.array, uv: g.attributes.uv?.array ?? null };
}

export class MeshBuilder {
  constructor() {
    this.buckets = new Map();
  }

  bucket(material) {
    let b = this.buckets.get(material);
    if (!b) {
      b = { position: [], normal: [], uv: [], index: [], scale: tileOf(material) ? 1 / tileOf(material) : 0 };
      this.buckets.set(material, b);
    }
    return b;
  }

  get empty() {
    for (const b of this.buckets.values()) if (b.index.length) return false;
    return true;
  }

  /**
   * Четырёхугольник a-b-c-d (вершины против часовой стрелки, если смотреть
   * с лицевой стороны). uv — свои координаты [[u, v] × 4] в повторах узора.
   */
  quad(material, a, b, c, d, uv = null) {
    const bk = this.bucket(material);
    const n = normalOf(a, b, c);
    const base = bk.position.length / 3;
    const t = [0, 0];
    [a, b, c, d].forEach((p, i) => {
      bk.position.push(p[0], p[1], p[2]);
      bk.normal.push(n[0], n[1], n[2]);
      if (uv) bk.uv.push(uv[i][0], uv[i][1]);
      else bk.uv.push(...project(p, n, bk.scale, t));
    });
    bk.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  triangle(material, a, b, c, uv = null) {
    const bk = this.bucket(material);
    const n = normalOf(a, b, c);
    const base = bk.position.length / 3;
    const t = [0, 0];
    [a, b, c].forEach((p, i) => {
      bk.position.push(p[0], p[1], p[2]);
      bk.normal.push(n[0], n[1], n[2]);
      if (uv) bk.uv.push(uv[i][0], uv[i][1]);
      else bk.uv.push(...project(p, n, bk.scale, t));
    });
    bk.index.push(base, base + 1, base + 2);
  }

  /** Коробка по двум углам. skip — грани, которые не нужны: например 'y-z-' (низ и зад). */
  box(material, x0, y0, z0, x1, y1, z1, skip = '') {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    if (x1 - x0 < 1e-5 || y1 - y0 < 1e-5 || z1 - z0 < 1e-5) return;
    const X = [x0, x1];
    const Y = [y0, y1];
    const Z = [z0, z1];
    for (const name of FACE_NAMES) {
      if (skip.includes(name)) continue;
      const [a, b, c, d] = BOX_FACES[name].c.map(([i, j, k]) => [X[i], Y[j], Z[k]]);
      this.quad(material, a, b, c, d);
    }
  }

  /** Коробка по центру и размерам. */
  cube(material, [cx, cy, cz], [w, h, d], skip = '') {
    this.box(material, cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, skip);
  }

  /**
   * Произвольная геометрия (подготовленная solid() или обычная BufferGeometry),
   * matrix — где её поставить. Текстурные координаты — проекция в координатах
   * этого строителя, если у геометрии нет своих.
   */
  add(material, source, matrix = null) {
    const data = source.position ? source : solid(source);
    const bk = this.bucket(material);
    const base = bk.position.length / 3;
    const count = data.position.length / 3;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const normalMatrix = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
    const tri = [[], [], []];
    const triN = [[], [], []];
    const t = [0, 0];
    for (let i = 0; i < count; i++) {
      p.fromArray(data.position, i * 3);
      n.fromArray(data.normal, i * 3);
      if (matrix) {
        p.applyMatrix4(matrix);
        n.applyMatrix3(normalMatrix).normalize();
      }
      bk.position.push(p.x, p.y, p.z);
      bk.normal.push(n.x, n.y, n.z);
      tri[i % 3] = [p.x, p.y, p.z];
      triN[i % 3] = [n.x, n.y, n.z];
      if (data.uv) {
        bk.uv.push(data.uv[i * 2], data.uv[i * 2 + 1]);
      } else if (i % 3 === 2) {
        // проекция по нормали треугольника — без швов внутри грани
        const fn = normalOf(tri[0], tri[1], tri[2]);
        for (let k = 0; k < 3; k++) bk.uv.push(...project(tri[k], fn, bk.scale, t));
      }
      bk.index.push(base + i);
    }
  }

  /**
   * Перенести всё, что собрано, в другой строитель с преобразованием matrix.
   * remap — подмена материалов { было: стало } (машины разного цвета).
   */
  appendTo(target, matrix = null, remap = null) {
    for (const [material, bk] of this.buckets) {
      if (!bk.index.length) continue;
      const out = target.bucket(remap?.[material] ?? material);
      const base = out.position.length / 3;
      const p = new THREE.Vector3();
      const n = new THREE.Vector3();
      const normalMatrix = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
      for (let i = 0; i < bk.position.length; i += 3) {
        p.set(bk.position[i], bk.position[i + 1], bk.position[i + 2]);
        n.set(bk.normal[i], bk.normal[i + 1], bk.normal[i + 2]);
        if (matrix) {
          p.applyMatrix4(matrix);
          n.applyMatrix3(normalMatrix).normalize();
        }
        out.position.push(p.x, p.y, p.z);
        out.normal.push(n.x, n.y, n.z);
      }
      // текстурные координаты остаются «родными» — узор едет вместе с деталью
      for (const v of bk.uv) out.uv.push(v);
      for (const i of bk.index) out.index.push(base + i);
    }
  }

  triangles() {
    let n = 0;
    for (const b of this.buckets.values()) n += b.index.length / 3;
    return n;
  }

  /**
   * Склеить одинаковые вершины (позиция, нормаль, текстурные координаты) и
   * выбросить вырожденные треугольники. Соседние грани одной плоскости —
   * куски стены, плиты — начинают делить вершины: файл заметно легче.
   */
  compact() {
    for (const bk of this.buckets.values()) {
      if (!bk.index.length) continue;
      const map = new Map();
      const position = [];
      const normal = [];
      const uv = [];
      const index = [];
      const P = bk.position;
      const N = bk.normal;
      const U = bk.uv;
      const r = (v, k) => Math.round(v * k);
      for (let t = 0; t < bk.index.length; t += 3) {
        const [a, b, c] = [bk.index[t], bk.index[t + 1], bk.index[t + 2]];
        const ux = P[b * 3] - P[a * 3];
        const uy = P[b * 3 + 1] - P[a * 3 + 1];
        const uz = P[b * 3 + 2] - P[a * 3 + 2];
        const vx = P[c * 3] - P[a * 3];
        const vy = P[c * 3 + 1] - P[a * 3 + 1];
        const vz = P[c * 3 + 2] - P[a * 3 + 2];
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        if (cx * cx + cy * cy + cz * cz < 1e-14) continue;
        for (const i of [a, b, c]) {
          const key = `${r(P[i * 3], 1e4)},${r(P[i * 3 + 1], 1e4)},${r(P[i * 3 + 2], 1e4)},${r(N[i * 3], 1e3)},${r(N[i * 3 + 1], 1e3)},${r(N[i * 3 + 2], 1e3)},${r(U[i * 2], 1e4)},${r(U[i * 2 + 1], 1e4)}`;
          let k = map.get(key);
          if (k === undefined) {
            k = position.length / 3;
            map.set(key, k);
            position.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
            normal.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
            uv.push(U[i * 2], U[i * 2 + 1]);
          }
          index.push(k);
        }
      }
      Object.assign(bk, { position, normal, uv, index });
    }
    return this;
  }

  /** Один меш с группами по материалам (или null, если ничего не собрано). */
  build(name) {
    this.compact();
    const used = [...this.buckets].filter(([, b]) => b.index.length);
    if (!used.length) return null;
    let vertices = 0;
    let indices = 0;
    for (const [, b] of used) {
      vertices += b.position.length / 3;
      indices += b.index.length;
    }
    const position = new Float32Array(vertices * 3);
    const normal = new Float32Array(vertices * 3);
    const uv = new Float32Array(vertices * 2);
    const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    const geometry = new THREE.BufferGeometry();
    let v = 0;
    let i = 0;
    used.forEach(([, b], m) => {
      position.set(b.position, v * 3);
      normal.set(b.normal, v * 3);
      uv.set(b.uv, v * 2);
      for (let k = 0; k < b.index.length; k++) index[i + k] = b.index[k] + v;
      geometry.addGroup(i, b.index.length, m);
      v += b.position.length / 3;
      i += b.index.length;
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const materials = used.map(([name]) => getMaterial(name));
    const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
