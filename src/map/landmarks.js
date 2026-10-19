import * as THREE from 'three';
import { MeshBuilder, solid } from './builder.js';
import { Facade } from './facade.js';
import { createBuilding } from './buildings.js';
import { signIndex, signRect } from './textures.js';
import { random } from '../models/textures.js';

/*
 * Ориентиры: ратуша с часовой башней (у точки захвата), церковь с колокольней,
 * завод с трубой, гаражи. Их видно издалека — по ним удобно ориентироваться.
 */

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Матрица: деталь, смотрящая вдоль +Z, повёрнута наружу из стены (normal) и поставлена в pos. */
function facing(pos, normal) {
  const yaw = Math.atan2(normal[0], normal[2]);
  return new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw), new THREE.Vector3(1, 1, 1));
}

/** Циферблат радиуса r в точке pos, лицом по normal. Стрелки показывают 10:10. */
function clockFace(b, pos, normal, r) {
  const m = facing(pos, normal);
  const disc = (radius, depth, z) => new THREE.CylinderGeometry(radius, radius, depth, 32).rotateX(Math.PI / 2).translate(0, 0, z);
  b.add('metalDark', solid(disc(r + 0.14, 0.14, 0.07), 30), m);
  b.add('signWhite', solid(disc(r, 0.06, 0.17), 30), m);
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    const long = h % 3 === 0;
    const g = new THREE.BoxGeometry(long ? 0.09 : 0.05, long ? 0.32 : 0.2, 0.03)
      .translate(0, r - (long ? 0.24 : 0.18), 0.215)
      .rotateZ(-a);
    b.add('metalDark', solid(g), m);
  }
  const hand = (len, width, angle) => new THREE.BoxGeometry(width, len, 0.03).translate(0, len / 2 - 0.12, 0.24).rotateZ(-angle);
  b.add('metalDark', solid(hand(r * 0.62, 0.11, (10 / 12) * Math.PI * 2 + (10 / 60) * (Math.PI / 6))), m);
  b.add('metalDark', solid(hand(r * 0.86, 0.07, (10 / 60) * Math.PI * 2)), m);
}

/** Купол-луковица/полусфера: профиль [радиус, высота] вращением. */
function dome(b, material, x, y, z, profile, segments = 16) {
  const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments).translate(x, y, z);
  b.add(material, solid(g, 50));
}

/** Шпиль-пирамида с квадратным основанием. */
function pyramid(b, material, x, y, z, half, height) {
  const top = [x, y + height, z];
  const c = [[x - half, y, z + half], [x + half, y, z + half], [x + half, y, z - half], [x - half, y, z - half]];
  for (let k = 0; k < 4; k++) b.triangle(material, c[k], c[(k + 1) % 4], top);
}

/** Шар с крестом или флюгером на вершине. */
function finial(b, x, y, z, cross) {
  b.add('chrome', solid(new THREE.SphereGeometry(0.28, 12, 8).translate(x, y + 0.25, z), 60));
  b.box('metalDark', x - 0.04, y + 0.5, z - 0.04, x + 0.04, y + (cross ? 2.1 : 1.6), z + 0.04);
  if (cross) b.box('metalDark', x - 0.45, y + 1.45, z - 0.04, x + 0.45, y + 1.55, z + 0.04);
}

/* ------------------------------------------------------------------ */
/* Ратуша                                                              */
/* ------------------------------------------------------------------ */

/**
 * Ратуша: главный корпус, выступающий центр (ризалит) с надписью и проездом
 * во двор, часовая башня над входом. Фасад смотрит на юг (+Z).
 * x0..x1 × z0..z1 — главный корпус, y — отметка земли.
 */
export function createTownHall({ x0, z0, x1, z1, y = 0.15 }) {
  const b = new MeshBuilder();
  const cx = (x0 + x1) / 2;
  const common = {
    style: 'classic', floors: 3, groundH: 5.0, floorH: 4.4, win: [1.5, 2.6], sill: 1.0, y,
    wall: 'plasterCream', trim: 'trimWhite', plinth: 'granite', roofMat: 'roofGreen', pitch: 26,
    balconies: 0, damage: 0.04, ac: 0, ground: 'plain', bay: 3.8, attic: 1.2, noDoorTrim: true,
  };
  const arch = { at: cx, width: 4.6, height: 4.6 };
  const main = createBuilding({ ...common, x0, z0, x1, z1, sides: { s: 'main', n: 'back', e: 'side', w: 'side' }, arches: [{ ...arch, sides: ['s', 'n'] }], seed: 11, chimneys: 2 }, b);
  const rz1 = z1 + 1.4;
  const ris = createBuilding(
    {
      ...common, x0: cx - 7.6, x1: cx + 7.6, z0: z1, z1: rz1, attic: 2.6, roof: 'flat', parapet: 0.9, noRoofStuff: true,
      sides: { s: 'main', n: 'blank', e: 'side', w: 'side' }, arches: [{ ...arch, sides: ['s', 'n'] }], seed: 12, noCollision: true,
    },
    b,
  );
  // надпись на аттике ризалита
  const F = new Facade(b, 's', cx - 7.6, z1, cx + 7.6, rz1, y);
  const r = signRect(signIndex('РАТУША'));
  const sh = 1.05;
  const sw = sh * r.aspect;
  const sv = ris.H - 2.05;
  F.box('trimWhite', 7.6 - sw / 2 - 0.15, 7.6 + sw / 2 + 0.15, sv - 0.15, sv + sh + 0.15, 0, 0.06, 'b');
  F.rect('signs', 7.6 - sw / 2, sv, 7.6 + sw / 2, sv + sh, 0.062, [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]]);
  // балюстрада парапета ризалита
  const pv = ris.H;
  for (let u = 0.3; u < 15.2 - 0.2; u += 0.32) F.box('trimWhite', u - 0.07, u + 0.07, pv + 0.97, pv + 1.55, -0.12, 0.02, 'td');
  F.box('trimWhite', -0.05, 15.25, pv + 1.55, pv + 1.68, -0.2, 0.08, '');

  // часовая башня: ствол, ярус с часами, бельведер, купол со шпилем
  const tz = z1 - 6.5;
  const base = y + main.H;
  const tw = 3.5;
  const shaft = createBuilding(
    {
      style: 'classic', x0: cx - tw, x1: cx + tw, z0: tz - tw, z1: tz + tw, y: base - 0.6, floors: 2, groundH: 3.9, floorH: 3.4, attic: 0.9,
      win: [1.2, 2.0], sill: 0.8, wall: 'plasterCream', trim: 'trimWhite', sides: { n: 'side', e: 'side', s: 'side', w: 'side' },
      groundSide: 'none', roof: 'flat', parapet: 0, noRoofStuff: true, balconies: 0, ac: 0, damage: 0, plinthH: 0, seed: 13, pediment: false,
    },
    b,
  );
  const ct = base - 0.6 + shaft.H; // верх ствола
  const cw = 2.9; // ярус с часами
  b.box('plasterCream', cx - cw, ct, tz - cw, cx + cw, ct + 3.6, tz + cw, 'y-');
  b.box('trimWhite', cx - cw - 0.25, ct + 3.6, tz - cw - 0.25, cx + cw + 0.25, ct + 3.85, tz + cw + 0.25);
  for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    clockFace(b, [cx + nx * cw, ct + 1.8, tz + nz * cw], [nx, 0, nz], 1.25);
    // угловые пилястры
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box('trimWhite', cx + sx * cw - 0.3, ct, tz + sz * cw - 0.3, cx + sx * cw + 0.3, ct + 3.6, tz + sz * cw + 0.3, 'y-');
  // бельведер с арками
  const bt = ct + 3.85;
  const bw = 2.1;
  b.box('plasterCream', cx - bw, bt, tz - bw, cx + bw, bt + 3.2, tz + bw, 'y-');
  for (const side of ['n', 'e', 's', 'w']) {
    const G = new Facade(b, side, cx - bw, tz - bw, cx + bw, tz + bw, bt);
    G.rect('interiorDark', 1.1, 0.5, G.L - 1.1, 2.6, 0.01);
    G.box('trimWhite', 0.95, 1.1, 0.4, 2.7, 0, 0.08, 'b');
    G.box('trimWhite', G.L - 1.1, G.L - 0.95, 0.4, 2.7, 0, 0.08, 'b');
    G.box('trimWhite', 0.95, G.L - 0.95, 2.6, 2.75, 0, 0.1, 'b');
    G.box('metalDark', 1.1, G.L - 1.1, 0.5, 0.56, 0, 0.12, 'b');
  }
  b.box('trimWhite', cx - bw - 0.2, bt + 3.2, tz - bw - 0.2, cx + bw + 0.2, bt + 3.4, tz + bw + 0.2);
  // купол, фонарик, шпиль
  const dt = bt + 3.4;
  dome(b, 'patina', cx, dt, tz, [[0, 0], [2.3, 0], [2.25, 0.5], [2.0, 1.2], [1.5, 1.9], [0.8, 2.4], [0.45, 2.55], [0, 2.6]]);
  b.add('patina', solid(new THREE.CylinderGeometry(0.45, 0.5, 1.4, 8).translate(cx, dt + 3.1, tz)));
  b.add('patina', solid(new THREE.ConeGeometry(0.5, 2.6, 8).translate(cx, dt + 5.1, tz)));
  finial(b, cx, dt + 6.4, tz, false);

  const collision = [...main.collision, [cx - 7.6, y, z1, cx - arch.width / 2, y + ris.H + 0.9, rz1], [cx + arch.width / 2, y, z1, cx + 7.6, y + ris.H + 0.9, rz1], [cx - arch.width / 2, y + arch.height, z1, cx + arch.width / 2, y + ris.H + 0.9, rz1]];
  collision.push([cx - tw, base - 0.6, tz - tw, cx + tw, ct + 3.85, tz + tw]);
  return { builder: b, collision, top: dt + 8, H: main.H, levels: main.levels };
}

/* ------------------------------------------------------------------ */
/* Церковь                                                             */
/* ------------------------------------------------------------------ */

/**
 * Церковь: неф с высокими стрельчатыми окнами, колокольня со шпилем у входа
 * (с севера, −Z), полукруглая апсида с юга. cx — ось, z0 — передний край нефа.
 */
export function createChurch({ cx, z0, y = 0.15, length = 24, width = 14 }) {
  const b = new MeshBuilder();
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const z1 = z0 + length;
  const nave = createBuilding(
    {
      style: 'classic', x0, x1, z0, z1, y, floors: 1, groundH: 10.5, attic: 0.9, win: [1.7, 5.6], groundSill: 2.8, bay: 4.6, margin: 1.6,
      wall: 'plasterWhite', trim: 'trimCream', plinth: 'granite', plinthH: 0.9, roof: 'gable', roofMat: 'roofGrey', pitch: 38,
      sides: { n: 'blank', s: 'blank', e: 'side', w: 'side' }, groundSide: 'plain', arched: true, balconies: 0, ac: 0, damage: 0.08,
      corners: 'pilasters', chimneys: 0, seed: 21, lintel: 'none', surround: true,
    },
    b,
  );
  // колокольня
  const tw = 3.4;
  const tz = z0 - tw;
  const tower = createBuilding(
    {
      style: 'classic', x0: cx - tw, x1: cx + tw, z0: tz - tw, z1: z0, y, floors: 4, groundH: 6.5, floorH: 4.6, attic: 1.0,
      win: [1.3, 2.6], sill: 1.0, wall: 'plasterWhite', trim: 'trimCream', plinth: 'granite', plinthH: 0.9, roof: 'flat', parapet: 0,
      noRoofStuff: true, sides: { n: 'main', e: 'side', w: 'side', s: 'blank' }, ground: 'none', groundSide: 'none', arched: true,
      balconies: 0, ac: 0, damage: 0.05, corners: 'pilasters', seed: 22, lintel: 'none', pediment: false,
    },
    b,
  );
  // портал входа
  const F = new Facade(b, 'n', cx - tw, tz - tw, cx + tw, z0, y);
  const u = F.L / 2;
  F.rect('doorWood', u - 1.2, 0, u + 1.2, 3.8, 0.012);
  F.box('frameBrown', u - 0.03, u + 0.03, 0, 3.8, 0.012, 0.05, 'bd');
  F.box('frameBrown', u - 1.2, u + 1.2, 3.8, 3.95, 0, 0.06, 'b');
  F.box('stone', u - 1.7, u - 1.2, 0, 4.4, 0, 0.3, 'b');
  F.box('stone', u + 1.2, u + 1.7, 0, 4.4, 0, 0.3, 'b');
  F.prism('stone', [[u - 1.9, 4.4], [u + 1.9, 4.4], [u, 5.6]], 0, 0.3);
  F.box('stone', u - 1.9, u + 1.9, 4.2, 4.45, 0, 0.35, 'b');
  F.box('granite', u - 2.2, u + 2.2, 0, 0.18, 0, 1.2, 'bd');
  F.box('granite', u - 1.9, u + 1.9, 0.18, 0.32, 0, 0.6, 'bd');
  // жалюзи звонницы на верхнем ярусе
  const top = y + tower.H;
  for (const side of ['n', 'e', 's', 'w']) {
    const G = new Facade(b, side, cx - tw, tz - tw, cx + tw, z0, top);
    G.box('trimCream', -0.3, G.L + 0.3, 0, 0.35, 0, 0.3, 'b');
  }
  const bt = top + 0.35;
  const bw = tw - 0.5;
  b.box('plasterWhite', cx - bw, bt, tz - bw + (z0 - tz - tw) / 2, cx + bw, bt + 4.2, tz + bw + (z0 - tz - tw) / 2, 'y-');
  const bcz = tz + (z0 - tz - tw) / 2;
  for (const side of ['n', 'e', 's', 'w']) {
    const G = new Facade(b, side, cx - bw, bcz - bw, cx + bw, bcz + bw, bt);
    G.rect('interiorDark', 0.8, 0.6, G.L - 0.8, 3.4, 0.01);
    for (let v = 0.8; v < 3.3; v += 0.32) G.box('frameBrown', 0.8, G.L - 0.8, v, v + 0.08, 0, 0.1, 'b');
    G.box('trimCream', 0.6, G.L - 0.6, 3.4, 3.6, 0, 0.12, 'b');
  }
  b.box('trimCream', cx - bw - 0.3, bt + 4.2, bcz - bw - 0.3, cx + bw + 0.3, bt + 4.5, bcz + bw + 0.3);
  pyramid(b, 'patina', cx, bt + 4.5, bcz, bw + 0.1, 9.5);
  finial(b, cx, bt + 13.9, bcz, true);

  // апсида
  const ar = width / 2 - 1.2;
  const ah = nave.levels[1] - 1.5;
  const apse = new THREE.CylinderGeometry(ar, ar, ah, 16, 1, true, -Math.PI / 2, Math.PI).translate(cx, y + ah / 2, z1);
  b.add('plasterWhite', solid(apse, 30));
  dome(b, 'roofGrey', cx, y + ah, z1, [[ar + 0.4, 0], [ar * 0.7, ar * 0.45], [0, ar * 0.6]], 16);
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (Math.PI * (k + 1)) / 4;
    const px = cx + Math.cos(a - Math.PI / 2) * (ar + 0.02);
    const pz = z1 + Math.sin(a - Math.PI / 2) * (ar + 0.02);
    b.add('glass', solid(new THREE.BoxGeometry(1.0, 3.2, 0.06).rotateY(Math.atan2(px - cx, pz - z1)).translate(px, y + 3.8, pz)));
  }
  const collision = [...nave.collision, [cx - tw, y, tz - tw, cx + tw, bt + 4.5, z0], [cx - ar, y, z1, cx + ar, y + ah, z1 + ar]];
  return { builder: b, collision, top: bt + 16 };
}

/* ------------------------------------------------------------------ */
/* Завод, труба, гаражи                                                */
/* ------------------------------------------------------------------ */

/** Кирпичный цех: высокие окна с частым переплётом, двускатная крыша, ворота. */
export function createWarehouse(spec, builder) {
  return createBuilding(
    {
      style: 'brick', floors: 1, groundH: 7.5, attic: 1.1, win: [2.4, 3.6], sill: 2.2, bay: 4.6, margin: 1.4, gridWindows: true,
      frame: 'frameDark', roof: 'gable', roofMat: 'roofRust', pitch: 16, parapet: 0, ground: 'plain', groundSide: 'plain', groundBack: 'plain',
      corners: 'none', balconies: 0, ac: 0, chimneys: 0, damage: 0.35, ridgeMat: 'zinc', ...spec,
    },
    builder,
  );
}

/** Кирпичная заводская труба. */
export function createChimney(b, x, z, y, height = 34) {
  b.box('brickDark', x - 2.2, y, z - 2.2, x + 2.2, y + 4, z + 2.2, 'y-');
  const shaft = new THREE.CylinderGeometry(1.0, 1.75, height, 14, 1, true).translate(x, y + 4 + height / 2, z);
  b.add('brick', solid(shaft, 40));
  for (const t of [0.25, 0.55, 0.85]) {
    const r = 1.75 - 0.75 * t + 0.08;
    b.add('brickDark', solid(new THREE.CylinderGeometry(r, r, 0.5, 14, 1, true).translate(x, y + 4 + height * t, z), 40));
  }
  b.add('concreteDark', solid(new THREE.CylinderGeometry(1.2, 1.1, 0.8, 14).translate(x, y + 4 + height + 0.4, z), 40));
  b.add('interiorDark', solid(new THREE.CylinderGeometry(0.8, 0.8, 0.05, 14).translate(x, y + 4 + height + 0.81, z)));
  return [x - 2.2, y, z - 2.2, x + 2.2, y + 4 + height, z + 2.2];
}

/**
 * Ряд гаражей: n боксов вдоль X, ворота смотрят на facing ('s' или 'n').
 * Возвращает коробку для столкновений.
 */
export function createGarages(b, { x0, z0, n, facing = 's', y = 0.15, seed = 5 }) {
  const rnd = random(seed);
  const w = 3.3;
  const d = 6;
  const h = 2.6;
  const x1 = x0 + n * w;
  const z1 = z0 + d;
  const doors = ['corrugatedGreen', 'corrugatedRust', 'corrugatedBlue', 'corrugatedGrey', 'rust'];
  b.box('concreteWall', x0, y, z0, x1, y + h, z1, 'y-');
  b.box('roofTar', x0 - 0.15, y + h, z0 - 0.3, x1 + 0.15, y + h + 0.18, z1 + 0.3);
  const F = new Facade(b, facing, x0, z0, x1, z1, y);
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) * w;
    F.box('concreteDark', u - w / 2, u - w / 2 + 0.18, 0, h, 0, 0.05, 'b');
    const open = rnd() < 0.12;
    F.rect(open ? 'interiorDark' : doors[Math.floor(rnd() * doors.length)], u - 1.35, 0.05, u + 1.35, 2.25, 0.02);
    if (!open) F.box('metalDark', u - 0.05, u + 0.05, 0.9, 1.3, 0.02, 0.06, 'b');
  }
  return [x0, y, z0, x1, y + h + 0.18, z1];
}
