import * as THREE from 'three';
import './materials.js';
import { MeshBuilder } from './builder.js';
import { createBuilding } from './buildings.js';
import { createTownHall, createChurch, createWarehouse, createChimney } from './landmarks.js';
import * as P from './props.js';
import { BLOCKS, BOUNDS, BUILDINGS, EXTENT, MODE, PLAZA, ROADS, SIDEWALK, SURFACES, groundAt } from './layout.js';
import { dressCity } from './dressing.js';
import { random } from '../models/textures.js';

/*
 * Сборка карты «Город».
 *
 * Каждый дом — отдельный меш (Godot отсекает невидимые дома целиком), земля,
 * разметка и мелкие предметы собраны в меши по участкам 50×50 м. Координаты
 * меша считаются от его центра: так точнее сжатие вершин в движке.
 *
 * Для физики рядом лежат невидимые меши с суффиксом «-colonly»: импортёр
 * Godot превращает их в StaticBody3D с формой столкновений, а сам меш не
 * показывает. Граница зоны боя — такие же невидимые стены (bounds-colonly).
 */

export const CELL = 50;
const CELLS = Math.ceil((2 * EXTENT) / CELL);

/** Меш из строителя с началом координат в центре основания (или null). */
export function centeredMesh(builder, name) {
  const mesh = builder.build(name);
  if (!mesh) return null;
  const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
  center.y = mesh.geometry.boundingBox.min.y;
  mesh.geometry.translate(-center.x, -center.y, -center.z);
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  mesh.position.copy(center);
  return mesh;
}

const overlaps = (a, b, m = 0) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;

/** Город по участкам: видимая геометрия и коробки для физики в каждом. */
export class World {
  constructor() {
    this.visualCells = new Map();
    this.collisionCells = new Map();
    this.footprints = [];
  }

  key(x, z) {
    const i = Math.min(CELLS - 1, Math.max(0, Math.floor((x + EXTENT) / CELL)));
    const j = Math.min(CELLS - 1, Math.max(0, Math.floor((z + EXTENT) / CELL)));
    return `${i}_${j}`;
  }

  visual(x, z) {
    const k = this.key(x, z);
    if (!this.visualCells.has(k)) this.visualCells.set(k, new MeshBuilder());
    return this.visualCells.get(k);
  }

  collision(x, z) {
    const k = this.key(x, z);
    if (!this.collisionCells.has(k)) this.collisionCells.set(k, new MeshBuilder());
    return this.collisionCells.get(k);
  }

  /** Поставить предмет. y по умолчанию — земля в этой точке (дорога или тротуар). */
  place(prop, x, z, yaw = 0, { y = groundAt(x, z), scale = 1, solid = true } = {}) {
    P.placeProp(this.visual(x, z), solid ? this.collision(x, z) : null, prop, x, y, z, yaw, scale);
  }

  solidBox([x0, y0, z0, x1, y1, z1]) {
    this.collision((x0 + x1) / 2, (z0 + z1) / 2).box('collision', x0, y0, z0, x1, y1, z1);
  }

  /** Свободно ли место (нет дома) — для деревьев, машин и мусора. */
  free(x, z, r = 1) {
    const rect = [x - r, z - r, x + r, z + r];
    return !this.footprints.some((f) => overlaps(f, rect));
  }
}

/* ------------------------------------------------------------------ */
/* Земля: асфальт, тротуары с бордюром, брусчатка площади, газоны      */
/* ------------------------------------------------------------------ */

/** Кусок поднятой плиты rect внутри участка cell: верх, бордюр по краям, торцы. */
function slabPart(world, rect, cell, top, curb, h = SIDEWALK, base = 0, edge = 0.3) {
  const x0 = Math.max(rect[0], cell[0]);
  const z0 = Math.max(rect[1], cell[1]);
  const x1 = Math.min(rect[2], cell[2]);
  const z1 = Math.min(rect[3], cell[3]);
  if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
  const b = world.visual((x0 + x1) / 2, (z0 + z1) / 2);
  const W = x0 === rect[0] && rect[0] > -EXTENT;
  const E = x1 === rect[2] && rect[2] < EXTENT;
  const N = z0 === rect[1] && rect[1] > -EXTENT;
  const S = z1 === rect[3] && rect[3] < EXTENT;
  const c = edge;
  const ix0 = W ? x0 + c : x0;
  const ix1 = E ? x1 - c : x1;
  const iz0 = N ? z0 + c : z0;
  const iz1 = S ? z1 - c : z1;
  b.quad(top, [ix0, h, iz1], [ix1, h, iz1], [ix1, h, iz0], [ix0, h, iz0]);
  if (c > 0) {
    if (N) b.quad(curb, [x0, h, z0 + c], [x1, h, z0 + c], [x1, h, z0], [x0, h, z0]);
    if (S) b.quad(curb, [x0, h, z1], [x1, h, z1], [x1, h, z1 - c], [x0, h, z1 - c]);
    if (W) b.quad(curb, [x0, h, iz1], [x0 + c, h, iz1], [x0 + c, h, iz0], [x0, h, iz0]);
    if (E) b.quad(curb, [x1 - c, h, iz1], [x1, h, iz1], [x1, h, iz0], [x1 - c, h, iz0]);
  }
  if (N) b.quad(curb, [x1, base, z0], [x0, base, z0], [x0, h, z0], [x1, h, z0]);
  if (S) b.quad(curb, [x0, base, z1], [x1, base, z1], [x1, h, z1], [x0, h, z1]);
  if (W) b.quad(curb, [x0, base, z0], [x0, base, z1], [x0, h, z1], [x0, h, z0]);
  if (E) b.quad(curb, [x1, base, z1], [x1, base, z0], [x1, h, z0], [x1, h, z1]);
  if (base === 0) world.collision((x0 + x1) / 2, (z0 + z1) / 2).box('collision', x0, 0, z0, x1, h, z1);
}

function buildGround(world) {
  for (let i = 0; i < CELLS; i++) {
    for (let j = 0; j < CELLS; j++) {
      const cell = [-EXTENT + i * CELL, -EXTENT + j * CELL, -EXTENT + (i + 1) * CELL, -EXTENT + (j + 1) * CELL];
      const [x0, z0, x1, z1] = cell;
      world.visual(x0 + 1, z0 + 1).quad('asphalt', [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]);
      world.collision(x0 + 1, z0 + 1).box('collision', x0, -1, z0, x1, 0, z1);
      for (const rect of BLOCKS) slabPart(world, rect, cell, 'pavers', 'curb');
      slabPart(world, PLAZA, cell, 'cobble', 'granite', SIDEWALK, 0, 0.45);
      for (const [a, b, c, d, mat] of SURFACES) slabPart(world, [a, b, c, d], cell, mat, 'curb', SIDEWALK + 0.03, SIDEWALK, mat === 'grass' ? 0.25 : 0);
    }
  }
}

/** Земля за пределами города: до горизонта, под туманом. */
function farGround() {
  const b = new MeshBuilder();
  const R = 900;
  const E = EXTENT;
  const quad = (x0, z0, x1, z1) => b.quad('asphaltPatch', [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]);
  quad(-R, -R, R, -E);
  quad(-R, E, R, R);
  quad(-R, -E, -E, E);
  quad(E, -E, R, E);
  return b;
}

/* ------------------------------------------------------------------ */
/* Разметка                                                            */
/* ------------------------------------------------------------------ */

/** Где дорогу r пересекают другие дороги: интервалы вдоль её оси. */
function crossings(r) {
  const out = [];
  for (const o of ROADS) {
    if (o === r || o.axis === r.axis) continue;
    if (o.c > r.from && o.c < r.to && r.c >= o.from && r.c <= o.to) out.push([o.c - o.half, o.c + o.half]);
  }
  return out;
}

function buildMarkings(world) {
  const Y = 0.012;
  const paint = (x0, z0, x1, z1, mat = 'roadPaint') => {
    world.visual((x0 + x1) / 2, (z0 + z1) / 2).quad(mat, [x0, Y, z1], [x1, Y, z1], [x1, Y, z0], [x0, Y, z0]);
  };
  for (const r of ROADS) {
    // a — вдоль дороги, s — поперёк (от оси дороги)
    const rect = (a0, a1, s0, s1) => (r.axis === 'z' ? paint(r.c + s0, a0, r.c + s1, a1) : paint(a0, r.c + s0, a1, r.c + s1));
    const gaps = crossings(r);
    const free = (a0, a1) => !gaps.some(([g0, g1]) => a1 > g0 - 1 && a0 < g1 + 1);
    const line = (s, w, dash = 0, gap = 0) => {
      const step = dash ? dash + gap : 4;
      for (let a = r.from + 1; a < r.to - 1; a += step) {
        const a1 = Math.min(a + (dash || step), r.to - 1);
        if (free(a, a1)) rect(a, a1, s - w / 2, s + w / 2);
      }
    };
    if (r.lanes === 4) {
      line(-0.15, 0.12);
      line(0.15, 0.12);
      line(-r.half / 2, 0.12, 3, 6);
      line(r.half / 2, 0.12, 3, 6);
    } else if (r.lanes === 2) {
      line(0, 0.12, 3, 5);
    }
    line(-r.half + 0.35, 0.12);
    line(r.half - 0.35, 0.12);
    // пешеходные переходы: у площади и перед перекрёстками
    const zebra = (a0, a1) => {
      for (let s = -r.half + 0.6; s < r.half - 0.6; s += 1.0) rect(a0, a1, s, s + 0.5);
    };
    for (const [g0, g1] of gaps) {
      zebra(g0 - 4.5, g0 - 1.2);
      zebra(g1 + 1.2, g1 + 4.5);
    }
    const plazaEnd = r.axis === 'z' ? (r.from === PLAZA[3] ? 'from' : r.to === PLAZA[1] ? 'to' : null) : r.to === PLAZA[0] ? 'to' : r.from === PLAZA[2] ? 'from' : null;
    if (plazaEnd === 'from') zebra(r.from + 1.5, r.from + 5);
    if (plazaEnd === 'to') zebra(r.to - 5, r.to - 1.5);
  }
}

/* ------------------------------------------------------------------ */
/* Дома                                                                */
/* ------------------------------------------------------------------ */

const hashName = (name) => [...name].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);

function buildBuildings(root, world) {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  for (const spec of BUILDINGS) {
    const seed = hashName(spec.name);
    let r;
    let footprint = [spec.x0, spec.z0, spec.x1, spec.z1];
    if (spec.kind === 'townhall') {
      r = createTownHall({ ...spec, y: SIDEWALK });
      footprint = [spec.x0, spec.z0, spec.x1, spec.z1 + 1.4];
    } else if (spec.kind === 'church') {
      r = createChurch({ ...spec, y: SIDEWALK });
      footprint = [spec.cx - 7, spec.z0 - 6.8, spec.cx + 7, spec.z0 + 24 + 5.6];
    } else if (spec.kind === 'warehouse') {
      r = createWarehouse({ seed, y: SIDEWALK, ...spec }, new MeshBuilder());
    } else {
      r = createBuilding({ seed, y: SIDEWALK, ...spec });
    }
    root.add(centeredMesh(r.builder, `b_${spec.name}`));
    for (const box of r.collision) world.solidBox(box);
    for (const m of r.ramps ?? []) world.collision(m.elements[12], m.elements[14]).add('collision', unit, m);
    world.footprints.push(footprint);
  }
  // заводская труба
  const chimney = new MeshBuilder();
  world.solidBox(createChimney(chimney, -55, 51, SIDEWALK, 36));
  world.footprints.push([-57.5, 48.5, -52.5, 53.5]);
  root.add(centeredMesh(chimney, 'b_chimney'));
}

/* ------------------------------------------------------------------ */
/* Фон: дома за границей зоны боя и далёкие высотки                    */
/* ------------------------------------------------------------------ */

const FAR_STYLES = [
  { style: 'panel', walls: ['concreteWall', 'concreteBeige'], floors: [5, 9] },
  { style: 'brick', walls: ['brick', 'brickDark'], floors: [3, 6] },
  { style: 'classic', walls: ['plasterCream', 'plasterGrey', 'plasterOchre', 'plasterSalmon', 'plasterBlue'], floors: [3, 5] },
];

function farBuilding(builder, rect, facing, rnd, { tall = false, y = SIDEWALK } = {}) {
  const kind = tall ? FAR_STYLES[0] : FAR_STYLES[Math.floor(rnd() * FAR_STYLES.length)];
  const [lo, hi] = tall ? [9, 16] : kind.floors;
  const floors = lo + Math.floor(rnd() * (hi - lo + 1));
  const sides = { n: 'back', e: 'back', s: 'back', w: 'back', [facing]: 'main' };
  createBuilding(
    {
      style: kind.style, lod: 'far', x0: rect[0], z0: rect[1], x1: rect[2], z1: rect[3], y, floors,
      wall: kind.walls[Math.floor(rnd() * kind.walls.length)], sides, ground: 'plain', damage: 0.1 + rnd() * 0.25,
      seed: Math.floor(rnd() * 1e6), noRoofStuff: true, chimneys: 0,
    },
    builder,
  );
}

function buildBackground(root, world) {
  const rnd = random(77);
  const groups = new Map();
  const group = (x, z) => {
    const k = `${Math.floor(x / 100)}_${Math.floor(z / 100)}`;
    if (!groups.has(k)) groups.set(k, new MeshBuilder());
    return groups.get(k);
  };
  const playable = [-BOUNDS, -BOUNDS, BOUNDS, BOUNDS];
  const taken = [...world.footprints];
  const tryPlace = (rect, facing) => {
    if (rect[2] - rect[0] < 6 || rect[3] - rect[1] < 6) return;
    if (overlaps(rect, playable, 0.5) || taken.some((t) => overlaps(t, rect, 1))) return;
    taken.push(rect);
    farBuilding(group((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2), rect, facing, rnd);
  };
  // по периметру каждого квартала — ряды домов вдоль улиц (два кольца: внешнее и внутреннее)
  const row = (a0, a1, make) => {
    for (let a = a0; a < a1 - 6; ) {
      const w = Math.min(a1 - a, 14 + rnd() * 16);
      make(a, a + w);
      a += w;
    }
  };
  for (const [bx0, bz0, bx1, bz1] of BLOCKS) {
    const d = 13;
    for (const sb of [3, 3 + d + 9]) {
      const x0 = bx0 + sb;
      const x1 = bx1 - sb;
      const z0 = bz0 + sb;
      const z1 = bz1 - sb;
      if (x1 - x0 < 2 * d || z1 - z0 < 2 * d) continue;
      row(x0, x1, (a, b) => tryPlace([a, z0, b, z0 + d], 'n'));
      row(x0, x1, (a, b) => tryPlace([a, z1 - d, b, z1], 's'));
      row(z0 + d, z1 - d, (a, b) => tryPlace([x0, a, x0 + d, b], 'w'));
      row(z0 + d, z1 - d, (a, b) => tryPlace([x1 - d, a, x1, b], 'e'));
    }
  }
  // концы улиц у края города упираются в дома
  for (const r of ROADS) {
    const span = r.half + r.walk + 6;
    for (const end of [r.from, r.to]) {
      if (Math.abs(end) < EXTENT) continue;
      const a0 = end > 0 ? end : end - 16;
      const rect = r.axis === 'z' ? [r.c - span, a0, r.c + span, a0 + 16] : [a0, r.c - span, a0 + 16, r.c + span];
      const facing = r.axis === 'z' ? (end > 0 ? 'n' : 's') : end > 0 ? 'w' : 'e';
      farBuilding(group((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2), rect, facing, rnd, { y: 0 });
    }
  }
  // высотки на горизонте
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + rnd() * 0.25;
    const dist = 200 + rnd() * 120;
    const cx = Math.cos(a) * dist;
    const cz = Math.sin(a) * dist;
    const long = rnd() < 0.5;
    const [w, d] = long ? [36 + rnd() * 20, 14] : [18, 18];
    const alongX = Math.abs(Math.cos(a)) < 0.7;
    const [hw, hd] = alongX ? [w / 2, d / 2] : [d / 2, w / 2];
    const facing = Math.abs(cx) > Math.abs(cz) ? (cx > 0 ? 'w' : 'e') : cz > 0 ? 'n' : 's';
    farBuilding(group(cx, cz), [cx - hw, cz - hd, cx + hw, cz + hd], facing, rnd, { tall: true, y: 0 });
  }
  let n = 0;
  for (const b of groups.values()) {
    const mesh = centeredMesh(b, `far_${n++}`);
    if (mesh) {
      mesh.castShadow = false;
      root.add(mesh);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Обзорные пометки режима (только в просмотрщике)                    */
/* ------------------------------------------------------------------ */

function zonesOverlay() {
  const g = new THREE.Group();
  g.name = 'zones';
  const flat = (geometry, color, opacity, y = SIDEWALK + 0.06) => {
    const m = new THREE.Mesh(geometry.rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.position.y = y;
    m.renderOrder = 5;
    return m;
  };
  const { x, z, radius } = MODE.capture;
  const ring = flat(new THREE.RingGeometry(radius - 0.5, radius, 64), '#f2c94c', 0.95);
  ring.position.set(x, SIDEWALK + 0.07, z);
  const fill = flat(new THREE.CircleGeometry(radius, 64), '#f2c94c', 0.18);
  fill.position.set(x, SIDEWALK + 0.06, z);
  g.add(ring, fill);
  const post = (px, pz, color) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.4, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
    m.position.set(px, groundAt(px, pz) + 1.2, pz);
    return m;
  };
  for (const [px, pz] of MODE.defenders) g.add(post(px, pz, '#3d7be0'));
  for (const list of Object.values(MODE.attackers)) for (const [px, pz] of list) g.add(post(px, pz, '#e0503d'));
  const B = BOUNDS;
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([[-B, -B], [B, -B], [B, B], [-B, B]].map(([a, b]) => new THREE.Vector3(a, 0.5, b))),
    new THREE.LineBasicMaterial({ color: '#e0503d' }),
  );
  g.add(line);
  return g;
}

/* ------------------------------------------------------------------ */

/**
 * Карта целиком. preview — для просмотрщика: добавить пометки режима
 * (точка захвата, места возрождения, граница).
 */
export function createCity(preview = false) {
  const root = new THREE.Group();
  root.name = 'city';
  const world = new World();
  buildGround(world);
  buildMarkings(world);
  buildBuildings(root, world);
  dressCity(world);
  buildBackground(root, world);

  // флаг точки захвата — отдельный узел: игра будет перекрашивать его в цвет владельца
  const flag = P.flagCloth(2.6, 1.6).build('capture_flag');
  flag.position.set(MODE.capture.x + 0.1, SIDEWALK + 11.2, MODE.capture.z - 6.5);
  root.add(flag);

  for (const [key, b] of world.visualCells) {
    const mesh = centeredMesh(b, `ground_${key}`);
    if (mesh) root.add(mesh);
  }
  const far = centeredMesh(farGround(), 'far_ground');
  far.castShadow = false;
  root.add(far);
  for (const [key, b] of world.collisionCells) {
    const mesh = centeredMesh(b, `collision_${key}-colonly`);
    if (mesh) root.add(mesh);
  }
  const bounds = new MeshBuilder();
  const B = BOUNDS;
  const t = 1;
  const top = 45;
  bounds.box('collision', -B - t, -2, -B - t, B + t, top, -B);
  bounds.box('collision', -B - t, -2, B, B + t, top, B + t);
  bounds.box('collision', -B - t, -2, -B, -B, top, B);
  bounds.box('collision', B, -2, -B, B + t, top, B);
  root.add(bounds.build('bounds-colonly'));

  if (preview) root.add(zonesOverlay());
  root.userData = { kind: 'map', extent: [2 * EXTENT, 2 * EXTENT], playable: [2 * BOUNDS, 2 * BOUNDS], buildings: BUILDINGS.length, mode: MODE };
  return root;
}
