import * as THREE from 'three';
import { LoftGeometry } from 'three/addons/geometries/LoftGeometry.js';
import { Parts, box, cylinder, sphere, rod, tube, loftPath, slab, beam, rounded, mirrorX, profile, DEG } from '../kit.js';
import { BONE_INDEX as B, chain } from './skeleton.js';

/*
 * Геометрия бойца в T-позе. Каждая деталь привязана к кости (жёстко или
 * с плавным переходом на сгибах). Координаты — мировые, метры.
 */

const SIDES = [
  ['Left', 1],
  ['Right', -1],
];

/**
 * Каска: купол-полуэллипсоид, ниже «экватора» — слегка расходящиеся борта.
 * Высота нижнего края задаётся отдельно для лба, висков и затылка — так
 * получаются и «высокий вырез» над ушами, и закрытая общевойсковая каска.
 * Оболочка имеет толщину: внутренняя поверхность + кромка + внешняя.
 */
function helmetShell({ rimFront, rimSide, rimBack, cy = 1.735, rx = 0.118, ry = 0.115, rz = 0.132, flare = 0.06, thickness = 0.008 }) {
  const segments = 24;
  const rings = 9;
  const rim = (phi) => {
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    return rimFront * Math.max(0, c) ** 2 + rimBack * Math.max(0, -c) ** 2 + rimSide * s * s;
  };
  const ring = (shrink, k) => {
    const points = [];
    for (let j = 0; j < segments; j++) {
      const phi = (j / segments) * Math.PI * 2;
      const th0 = Math.asin(THREE.MathUtils.clamp((rim(phi) - cy) / ry, -1, 1));
      const th = th0 + (84 * DEG - th0) * k;
      const r = th >= 0 ? Math.cos(th) : 1 + flare * -Math.sin(th);
      points.push(new THREE.Vector3((rx - shrink) * r * Math.sin(phi), cy + (ry - shrink) * Math.sin(th), (rz - shrink) * r * Math.cos(phi)));
    }
    return points;
  };
  const sections = [];
  for (let i = rings; i >= 0; i--) sections.push(ring(thickness, i / rings));
  for (let i = 0; i <= rings; i++) sections.push(ring(0, i / rings));
  return new LoftGeometry(sections, { closed: true, capStart: true, capEnd: true });
}

/** Дуга-полоса вокруг лица (очки, маска): углы from/to в градусах от +Z. */
function arcBand({ y, height, thickness, rx, rz, from, to, dz = 0, steps = 12 }) {
  const stations = [];
  for (let i = 0; i <= steps; i++) {
    const phi = (from + ((to - from) * i) / steps) * DEG;
    stations.push({ p: [rx * Math.sin(phi), y, rz * Math.cos(phi) + dz], a: height / 2, b: thickness / 2, power: 6 });
  }
  return loftPath(stations, { segments: 8, ref: [0, 1, 0] });
}

/* ------------------------------------------------------------------ */
/* Голова                                                              */
/* ------------------------------------------------------------------ */

// сечения головы снизу вверх: t — высота от подбородка, a/b — полуширина/полуглубина
const HEAD = {
  y0: 1.552,
  power: 2.6,
  stations: [
    { t: 0, a: 0.042, b: 0.03, dz: 0.058 },
    { t: 0.02, a: 0.06, b: 0.055, dz: 0.045 },
    { t: 0.05, a: 0.074, b: 0.084, dz: 0.018 },
    { t: 0.09, a: 0.079, b: 0.096, dz: 0.006 },
    { t: 0.13, a: 0.082, b: 0.1, dz: 0 },
    { t: 0.175, a: 0.081, b: 0.099, dz: -0.004 },
    { t: 0.215, a: 0.07, b: 0.088, dz: -0.008 },
    { t: 0.24, a: 0.046, b: 0.06, dz: -0.01 },
    { t: 0.252, a: 0.015, b: 0.02, dz: -0.01 },
  ],
};

/** Точка на поверхности головы на высоте y под углом phi (от +Z к +X), отодвинутая на push. */
function headPoint(y, phi, push = 0) {
  const st = HEAD.stations;
  const t = y - HEAD.y0;
  let i = 0;
  while (i < st.length - 2 && t > st[i + 1].t) i++;
  const k = THREE.MathUtils.clamp((t - st[i].t) / (st[i + 1].t - st[i].t), 0, 1);
  const lerp = (key) => THREE.MathUtils.lerp(st[i][key] ?? 0, st[i + 1][key] ?? 0, k);
  const e = 2 / HEAD.power;
  const sx = Math.sin(phi);
  const cz = Math.cos(phi);
  return new THREE.Vector3((lerp('a') + push) * Math.sign(sx) * Math.abs(sx) ** e, y, lerp('dz') + (lerp('b') + push) * Math.sign(cz) * Math.abs(cz) ** e);
}

/** Короткая борода с усами: поверхность поверх нижней части лица. */
function beardGeometry() {
  const rows = [];
  const columns = 16;
  const levels = 6;
  const maxPhi = 108 * DEG;
  for (let k = 0; k <= levels; k++) {
    const row = [];
    for (let j = 0; j <= columns; j++) {
      const phi = -maxPhi + (2 * maxPhi * j) / columns;
      const side = Math.abs(phi) / maxPhi; // 0 — подбородок, 1 — бакенбарды
      const bottom = 1.553 + 0.05 * side * side;
      const top = 1.628 + 0.06 * side * side;
      const y = bottom + ((top - bottom) * k) / levels;
      row.push(headPoint(y, phi, 0.003 + 0.006 * Math.sin((Math.PI * k) / levels) * (1 - side * 0.5)));
    }
    rows.push(row);
  }
  return new LoftGeometry(rows, { closed: false });
}

function addHead(p, m, { face }) {
  const H = { skin: B.Head };
  p.add(tube('y', [0, HEAD.y0, 0], HEAD.stations, { segments: 16, power: HEAD.power }), m('head'), { ...H, crease: 60 });
  p.add(profile([[0.088, 1.684], [0.121, 1.648], [0.118, 1.634], [0.09, 1.632]], 0.026, { bevel: 0.006 }), m('head'), H); // нос
  p.add(cylinder(0.058, 0.054, 0.13, 14).translate(0, 1.535, -0.008), m('head'), { skin: B.Neck }); // шея
  if (face === 'beard') {
    for (const s of [1, -1]) p.add(box(0.018, 0.05, 0.032, 0.007).translate(s * 0.079, 1.668, -0.008), m('head'), H); // уши
    p.add(beardGeometry(), m('beard'), { ...H, crease: 70 });
    p.add(box(0.03, 0.004, 0.006, 0.001).translate(0, 1.606, 0.111), 'eyes', H); // рот
    for (const s of [1, -1]) p.add(box(0.032, 0.008, 0.012, 0.003).rotateZ(-s * 0.15).translate(s * 0.034, 1.716, 0.095), m('beard'), H); // брови
  }
}

/* ------------------------------------------------------------------ */
/* Тело                                                                */
/* ------------------------------------------------------------------ */

function addTorso(p, m) {
  // торс: плавный переход таз → поясница → грудь
  p.add(tube('y', [0, 1.0, 0], [
    { t: 0, a: 0.152, b: 0.102 },
    { t: 0.06, a: 0.15, b: 0.1 },
    { t: 0.15, a: 0.158, b: 0.105, dz: 0.004 },
    { t: 0.26, a: 0.172, b: 0.112, dz: 0.01 },
    { t: 0.36, a: 0.184, b: 0.113, dz: 0.008 },
    { t: 0.43, a: 0.18, b: 0.102 },
    { t: 0.475, a: 0.142, b: 0.086, dz: -0.005 },
    { t: 0.505, a: 0.075, b: 0.065, dz: -0.008 },
  ], { segments: 20, power: 2.6 }), m('uniform'), { skin: chain('y', 1, ['Hips', [1.04, 0.02], 'Spine', [1.16, 0.05], 'Chest']) });
  // таз
  p.add(tube('y', [0, 0.84, 0], [
    { t: 0, a: 0.09, b: 0.055 },
    { t: 0.04, a: 0.15, b: 0.09 },
    { t: 0.1, a: 0.172, b: 0.106 },
    { t: 0.16, a: 0.162, b: 0.106 },
    { t: 0.21, a: 0.152, b: 0.102 },
  ], { segments: 20, power: 2.6 }), m('uniform'), { skin: B.Hips });
  // воротник
  p.add(tube('y', [0, 1.465, -0.008], [{ t: 0, a: 0.085, b: 0.077 }, { t: 0.045, a: 0.081, b: 0.073 }], { segments: 16, power: 2.2 }), m('uniformShade'), { skin: B.Chest });
  // ремень с пряжкой
  p.add(tube('y', [0, 1.0, 0], [{ t: 0, a: 0.165, b: 0.113 }, { t: 0.052, a: 0.162, b: 0.111 }], { segments: 20, power: 2.6 }), m('belt'), { skin: B.Hips });
  p.add(box(0.05, 0.034, 0.012, 0.003).translate(0, 1.026, 0.114), 'black', { skin: B.Hips });
}

// сечения рукава от плеча к запястью (t — расстояние от x = 0.165)
const SLEEVE = [
  { t: 0, a: 0.06, b: 0.062 },
  { t: 0.06, a: 0.06, b: 0.061 },
  { t: 0.15, a: 0.054, b: 0.056 },
  { t: 0.25, a: 0.048, b: 0.05 },
  { t: 0.31, a: 0.045, b: 0.047 },
  { t: 0.37, a: 0.046, b: 0.048 },
  { t: 0.47, a: 0.041, b: 0.043 },
  { t: 0.56, a: 0.037, b: 0.039 },
];

function addArms(p, m, { rolledSleeves = false } = {}) {
  for (const [side, s] of SIDES) {
    const axis = s > 0 ? 'x' : '-x';
    const arm = `${side}Arm`;
    const fore = `${side}ForeArm`;
    const bend = { skin: chain('x', s, [arm, [s * 0.475, 0.035], fore]) };
    const start = [s * 0.165, 1.44, -0.02];
    if (rolledSleeves) {
      // рукав закатан выше локтя, предплечье открыто
      p.add(tube(axis, start, SLEEVE.filter((st) => st.t <= 0.25).concat([{ t: 0.27, a: 0.047, b: 0.049 }]), { segments: 14, power: 2.2 }), m('uniform'), bend);
      p.add(tube(axis, [s * 0.398, 1.44, -0.02], [
        { t: 0, a: 0.05, b: 0.052 },
        { t: 0.02, a: 0.056, b: 0.058 },
        { t: 0.05, a: 0.055, b: 0.057 },
        { t: 0.065, a: 0.048, b: 0.05 },
      ], { segments: 14, power: 2.2 }), m('uniformShade'), bend);
      p.add(tube(axis, start, SLEEVE.filter((st) => st.t >= 0.25).map((st) => ({ ...st, a: st.a - 0.005, b: st.b - 0.005 })), { segments: 14, power: 2.2 }), m('skin'), bend);
    } else {
      p.add(tube(axis, start, SLEEVE, { segments: 14, power: 2.2 }), m('uniform'), bend);
      p.add(tube(axis, [s * 0.7, 1.44, -0.02], [{ t: 0, a: 0.04, b: 0.042 }, { t: 0.028, a: 0.039, b: 0.041 }], { segments: 14, power: 2.2 }), m('uniformShade'), { skin: B[fore] }); // манжета
      // карман на плече с шевроном команды
      p.add(box(0.05, 0.012, 0.066, 0.004).translate(s * 0.232, 1.505, -0.02), m('uniformShade'), { skin: B[arm] });
      p.add(box(0.034, 0.004, 0.044, 0.001).translate(s * 0.232, 1.513, -0.02), m('team'), { skin: B[arm] });
    }
    p.add(sphere(0.066, 16, 10).scale(1, 0.95, 1).translate(s * 0.19, 1.44, -0.02), m('uniform'), { skin: B[arm] }); // дельта
    p.add(tube(axis, [s * 0.26, 1.44, -0.02], [{ t: 0, a: 0.062, b: 0.064 }, { t: 0.045, a: 0.06, b: 0.062 }], { segments: 14, power: 2.2 }), m('team'), { skin: B[arm] }); // повязка
  }
  if (rolledSleeves) {
    // часы на левой руке
    const W = { skin: B.LeftForeArm };
    p.add(tube('x', [0.688, 1.44, -0.02], [{ t: 0, a: 0.036, b: 0.038 }, { t: 0.014, a: 0.036, b: 0.038 }], { segments: 14, power: 2.2 }), 'black', W);
    p.add(box(0.022, 0.007, 0.022, 0.003).translate(0.695, 1.478, -0.02), 'black', W);
    p.add(box(0.016, 0.002, 0.016).translate(0.695, 1.482, -0.02), 'lensDark', W);
  }
}

/** Кисть в перчатке, сжатая для хвата (строится левая, правая — её зеркало). */
function addHands(p, m, { knuckles }) {
  const [wx, wy, wz] = [0.73, 1.44, -0.02];
  const parts = [
    box(0.082, 0.03, 0.082, 0.012).translate(wx + 0.047, wy + 0.002, wz), // ладонь
    box(0.056, 0.022, 0.022, 0.009).rotateY(-0.35).translate(wx + 0.05, wy - 0.018, wz + 0.047), // большой палец
    box(0.026, 0.02, 0.02, 0.008).translate(wx + 0.078, wy - 0.027, wz + 0.04),
    cylinder(0.04, 0.042, 0.03, 14, 'x').translate(wx + 0.012, wy, wz), // край перчатки
  ];
  // четыре согнутых пальца: от мизинца (−Z) к указательному (+Z)
  [0.04, 0.046, 0.047, 0.043].forEach((length, i) => {
    const z = wz - 0.03 + i * 0.02;
    parts.push(box(0.026, length, 0.0175, 0.006).rotateZ(0.2).translate(wx + 0.096, wy - length / 2 + 0.002, z));
    parts.push(box(0.03, 0.017, 0.017, 0.006).rotateZ(-0.3).translate(wx + 0.08, wy - length - 0.006, z));
  });
  if (knuckles) parts.push(box(0.022, 0.012, 0.074, 0.004).translate(wx + 0.078, wy + 0.017, wz)); // защита костяшек
  for (const g of parts) {
    p.add(g, m('gloves'), { skin: B.LeftHand });
    p.add(mirrorX(g), m('gloves'), { skin: B.RightHand });
  }
}

function addLegs(p, m, { pockets = [1, -1], bloused = false } = {}) {
  for (const [side, s] of SIDES) {
    const x = s * 0.095;
    const up = `${side}UpLeg`;
    const leg = `${side}Leg`;
    const foot = `${side}Foot`;
    // штанина: бедро и голень одной поверхностью
    p.add(tube('-y', [x, 0.99, 0], [
      { t: 0, a: 0.088, b: 0.106 },
      { t: 0.07, a: 0.088, b: 0.1 },
      { t: 0.22, a: 0.076, b: 0.082, dz: 0.005 },
      { t: 0.37, a: 0.064, b: 0.068, dz: 0.008 },
      { t: 0.47, a: 0.058, b: 0.06, dz: 0.01 },
      { t: 0.54, a: 0.058, b: 0.064, dz: -0.004 },
      { t: 0.66, a: 0.054, b: 0.06, dz: -0.008 },
      { t: 0.78, a: 0.046, b: 0.05, dz: -0.002 },
      { t: 0.87, a: 0.045, b: 0.049 },
    ], { segments: 14, power: 2.2 }), m('uniform'), { skin: chain('y', -1, ['Hips', [0.955, 0.025], up, [0.51, 0.035], leg]) });
    if (pockets.includes(s)) {
      p.add(box(0.024, 0.13, 0.11, 0.008).translate(s * 0.17, 0.715, 0.008), m('uniformShade'), { skin: B[up] });
      p.add(box(0.028, 0.03, 0.114, 0.006).translate(s * 0.172, 0.775, 0.008), m('uniformShade'), { skin: B[up] }); // клапан
    }
    p.add(box(0.094, 0.1, 0.034, 0.014).translate(x, 0.505, 0.073), m('kneePads'), { skin: B[leg] }); // наколенник
    if (bloused) {
      // штанина заправлена в ботинок и нависает над голенищем
      p.add(tube('y', [x, 0.226, 0], [{ t: 0, a: 0.054, b: 0.06 }, { t: 0.02, a: 0.061, b: 0.067 }, { t: 0.042, a: 0.052, b: 0.058 }], { segments: 14, power: 2.2 }), m('uniform'), { skin: B[leg] });
    }

    // ботинок: голенище следует за голенью, стопа — за костью стопы
    p.add(tube('y', [x, 0.055, 0], [{ t: 0, a: 0.053, b: 0.06 }, { t: 0.19, a: 0.051, b: 0.057, dz: -0.002 }], { segments: 14, power: 2.4 }), m('boots'), { skin: B[leg] });
    p.add(box(0.042, 0.13, 0.012, 0.004).translate(x, 0.165, 0.054), m('laces'), { skin: B[leg] }); // шнуровка
    p.add(tube('z', [x, 0, -0.072], [
      { t: 0, a: 0.042, b: 0.04, dy: 0.055 },
      { t: 0.03, a: 0.05, b: 0.052, dy: 0.06 },
      { t: 0.12, a: 0.052, b: 0.045, dy: 0.05 },
      { t: 0.2, a: 0.05, b: 0.034, dy: 0.038 },
      { t: 0.25, a: 0.043, b: 0.027, dy: 0.032 },
      { t: 0.267, a: 0.03, b: 0.018, dy: 0.03 },
    ], { segments: 14, power: 2.6 }), m('boots'), { skin: B[foot] });
    p.add(box(0.036, 0.008, 0.09, 0.003).rotateX(0.28).translate(x, 0.09, 0.075), m('laces'), { skin: B[foot] }); // шнуровка на подъёме
    p.add(box(0.106, 0.018, 0.28, 0.006).translate(x, 0.009, 0.062), 'black', { skin: B[foot] }); // подошва
    p.add(box(0.1, 0.012, 0.07, 0.004).translate(x, 0.004, -0.04), 'rubber', { skin: B[foot] }); // каблук
  }
}

/* ------------------------------------------------------------------ */
/* Снаряжение Альянса                                                  */
/* ------------------------------------------------------------------ */

function addAllianceGear(p, m) {
  const C = { skin: B.Chest };
  const H = { skin: B.Head };

  // плитник: передняя и задняя плиты, камербанд со стропами MOLLE, плечевые лямки
  const plate = rounded([[-0.15, 1.1], [0.15, 1.1], [0.15, 1.35, 0.03], [0.1, 1.425, 0.02], [-0.1, 1.425, 0.02], [-0.15, 1.35, 0.03]], 0.015);
  p.add(slab(plate, 0.05, { bevel: 0.008, bevelSegments: 2 }).translate(0, 0, 0.145), m('gear'), C);
  p.add(slab(plate, 0.045, { bevel: 0.008, bevelSegments: 2 }).translate(0, 0, -0.132), m('gear'), C);
  p.add(tube('y', [0, 1.1, 0.006], [{ t: 0, a: 0.18, b: 0.13 }, { t: 0.17, a: 0.188, b: 0.133 }], { segments: 20, power: 2.8 }), m('gear'), C);
  for (const y of [1.135, 1.175, 1.215]) {
    const k = (y - 1.1) / 0.17;
    const ring = { a: 0.1825 + 0.008 * k, b: 0.1325 + 0.003 * k };
    p.add(tube('y', [0, y, 0.006], [{ t: 0, ...ring }, { t: 0.009, ...ring }], { segments: 20, power: 2.8 }), m('gearDark'), C);
  }
  for (const s of [1, -1]) {
    p.add(beam([s * 0.1, 1.405, 0.14], [s * 0.112, 1.49, 0.01], 0.055, 0.02), m('gearDark'), C);
    p.add(beam([s * 0.112, 1.49, 0.01], [s * 0.1, 1.405, -0.125], 0.055, 0.02), m('gearDark'), C);
  }
  // подсумки под магазины, административный подсумок с шевроном
  for (const i of [-1, 0, 1]) {
    p.add(box(0.078, 0.115, 0.036, 0.008).translate(i * 0.085, 1.172, 0.19), m('gear'), C);
    p.add(box(0.082, 0.03, 0.04, 0.006).translate(i * 0.085, 1.232, 0.19), m('gearDark'), C);
  }
  p.add(box(0.15, 0.075, 0.028, 0.008).translate(0, 1.33, 0.184), m('gearDark'), C);
  p.add(box(0.05, 0.03, 0.006, 0.002).translate(0.035, 1.335, 0.2), m('team'), C);
  // аптечка с красным крестом слева, граната справа, жгут на лямке, трубка гидратора
  p.add(box(0.05, 0.1, 0.12, 0.012).translate(0.198, 1.175, -0.02), m('gear'), C);
  p.add(box(0.002, 0.034, 0.011).translate(0.2235, 1.19, -0.02), 'medRed', C);
  p.add(box(0.002, 0.011, 0.034).translate(0.2235, 1.19, -0.02), 'medRed', C);
  p.add(cylinder(0.028, 0.028, 0.075, 12).translate(-0.205, 1.165, 0.04), m('gear'), C);
  p.add(cylinder(0.031, 0.031, 0.014, 12).translate(-0.205, 1.205, 0.04), m('gearDark'), C);
  p.add(box(0.032, 0.06, 0.02, 0.006).rotateX(-0.99).translate(0.106, 1.452, 0.09), 'black', C);
  const tubePath = [[-0.06, 1.42, -0.17], [-0.095, 1.505, -0.06], [-0.105, 1.5, 0.06], [-0.095, 1.42, 0.15]];
  for (let i = 1; i < tubePath.length; i++) p.add(rod(tubePath[i - 1], tubePath[i], 0.0055, 0.0055, 6), 'black', C);
  p.add(box(0.014, 0.022, 0.014, 0.004).translate(-0.095, 1.405, 0.155), 'black', C);

  // штурмовой рюкзак с рацией
  p.add(box(0.24, 0.31, 0.11, 0.03).translate(0, 1.255, -0.21), m('gear'), C);
  p.add(box(0.18, 0.13, 0.035, 0.02).translate(0, 1.18, -0.275), m('gearDark'), C);
  for (const y of [1.3, 1.34]) p.add(box(0.2, 0.008, 0.004).translate(0, y, -0.2665), m('gearDark'), C);
  p.add(box(0.06, 0.12, 0.045, 0.008).translate(0.15, 1.3, -0.2), 'radio', C);
  p.add(rod([0.16, 1.36, -0.2], [0.19, 1.66, -0.23], 0.0035, 0.0025, 6), 'black', C);

  // пояс: подсумки, сброс; на правом бедре — кобура
  for (const s of [1, -1]) p.add(box(0.06, 0.07, 0.035, 0.008).rotateY(s * 0.5).translate(s * 0.135, 1.0, 0.075), m('gear'), { skin: B.Hips });
  p.add(box(0.1, 0.1, 0.05, 0.015).rotateY(-0.3).translate(0.1, 0.965, -0.125), m('gearDark'), { skin: B.Hips });
  const R = { skin: B.RightUpLeg };
  p.add(box(0.045, 0.15, 0.09, 0.01).translate(-0.19, 0.8, 0.005), m('gearDark'), R);
  p.add(box(0.028, 0.05, 0.034, 0.006).rotateX(-0.35).translate(-0.19, 0.89, -0.012), 'polymer', R);
  p.add(tube('y', [-0.095, 0.735, 0], [{ t: 0, a: 0.075, b: 0.081, dz: 0.006 }, { t: 0.03, a: 0.074, b: 0.08, dz: 0.006 }], { segments: 14, power: 2.2 }), m('belt'), R);

  // шлем в камуфляжном чехле: крепление ПНВ, планки, противовес, стробоскоп команды
  p.add(helmetShell({ rimFront: 1.733, rimSide: 1.705, rimBack: 1.69 }), m('helmet'), H);
  p.add(box(0.05, 0.034, 0.018, 0.004).rotateX(-20 * DEG).translate(0, 1.775, 0.13), 'black', H);
  for (const s of [1, -1]) p.add(box(0.012, 0.022, 0.13, 0.003).translate(s * 0.118, 1.738, -0.004), 'black', H);
  p.add(box(0.075, 0.048, 0.03, 0.01).rotateX(0.15).translate(0, 1.735, -0.14), m('gear'), H);
  p.add(box(0.024, 0.016, 0.034, 0.004).translate(0, 1.846, -0.045), m('team'), H);
  // активные наушники с микрофоном и тактические очки
  for (const s of [1, -1]) p.add(cylinder(0.04, 0.04, 0.034, 16, 'x').translate(s * 0.088, 1.675, -0.004), m('headset'), H);
  p.add(rod([0.092, 1.655, 0.03], [0.04, 1.615, 0.098], 0.0035), m('headset'), H);
  p.add(sphere(0.009, 8, 6).translate(0.035, 1.612, 0.102), m('headset'), H);
  p.add(arcBand({ y: 1.693, height: 0.03, thickness: 0.009, rx: 0.084, rz: 0.105, from: -72, to: 72 }), 'lensDark', H);
}

/* ------------------------------------------------------------------ */
/* Снаряжение Коалиции                                                 */
/* ------------------------------------------------------------------ */

function addCoalitionGear(p, m) {
  const C = { skin: B.Chest };
  const H = { skin: B.Head };

  // нагрудные карманы куртки
  for (const s of [1, -1]) {
    p.add(box(0.07, 0.08, 0.014, 0.005).translate(s * 0.095, 1.37, 0.113), m('uniformShade'), C);
    p.add(box(0.074, 0.022, 0.018, 0.005).translate(s * 0.095, 1.405, 0.115), m('uniformShade'), C);
  }

  // нагрудная разгрузка: 4 подсумка под магазины (у двух видны магазины), гранатные по бокам
  p.add(box(0.33, 0.16, 0.045, 0.012).translate(0, 1.2, 0.13), m('gear'), C);
  for (let i = 0; i < 4; i++) {
    const x = -0.12 + i * 0.08;
    p.add(box(0.07, 0.15, 0.04, 0.008).translate(x, 1.195, 0.168), m('gear'), C);
    if (i === 1 || i === 2) p.add(box(0.074, 0.03, 0.044, 0.006).translate(x, 1.265, 0.168), m('gearDark'), C);
    else p.add(box(0.058, 0.034, 0.026, 0.004).rotateX(0.25).translate(x, 1.276, 0.172), 'bakelite', C);
  }
  for (const s of [1, -1]) {
    p.add(box(0.06, 0.08, 0.065, 0.014).translate(s * 0.19, 1.185, 0.085), m('gear'), C);
    // лямки: через плечо и крестом по спине
    p.add(beam([s * 0.13, 1.27, 0.14], [s * 0.112, 1.49, 0.0], 0.04, 0.016), m('gearDark'), C);
    p.add(beam([s * 0.112, 1.49, 0.0], [s * 0.09, 1.4, -0.115], 0.04, 0.016), m('gearDark'), C);
    p.add(beam([s * 0.09, 1.4, -0.115], [-s * 0.07, 1.16, -0.125], 0.04, 0.016), m('gearDark'), C);
  }
  p.add(tube('y', [0, 1.12, 0.006], [{ t: 0, a: 0.172, b: 0.123 }, { t: 0.055, a: 0.174, b: 0.125 }], { segments: 20, power: 2.8 }), m('gearDark'), C);
  // рация на левой лямке
  p.add(box(0.05, 0.1, 0.034, 0.008).translate(0.128, 1.33, 0.132), 'radio', C);
  p.add(rod([0.138, 1.38, 0.13], [0.148, 1.5, 0.118], 0.004, 0.003, 6), 'black', C);

  // рюкзак со скаткой и пехотной лопаткой
  p.add(box(0.27, 0.34, 0.13, 0.03).translate(0, 1.235, -0.19), m('gear'), C);
  p.add(box(0.272, 0.07, 0.136, 0.02).translate(0, 1.385, -0.19), m('gearDark'), C);
  p.add(box(0.04, 0.16, 0.09, 0.012).translate(-0.155, 1.19, -0.19), m('gear'), C);
  for (const s of [1, -1]) {
    p.add(beam([s * 0.1, 1.4, -0.13], [s * 0.112, 1.497, -0.02], 0.045, 0.014), m('gearDark'), C);
    p.add(cylinder(0.051, 0.051, 0.012, 14, 'x').translate(s * 0.09, 1.47, -0.2), 'black', C);
  }
  p.add(cylinder(0.048, 0.048, 0.33, 16, 'x').translate(0, 1.47, -0.2), m('uniformShade'), C);
  p.add(box(0.014, 0.19, 0.15, 0.01).translate(0.142, 1.2, -0.19), m('gearDark'), C); // чехол лопатки
  p.add(rod([0.142, 1.29, -0.19], [0.142, 1.53, -0.19], 0.012, 0.011, 10), 'wood', C); // черенок

  // фляга на поясе сзади справа
  p.add(cylinder(0.042, 0.042, 0.16, 14).scale(1, 1, 0.65).translate(-0.12, 0.96, -0.135), m('gear'), { skin: B.Hips });
  p.add(cylinder(0.014, 0.014, 0.022, 10).translate(-0.12, 1.05, -0.135), 'black', { skin: B.Hips });

  // клетчатый шемаг на шее
  p.add(tube('y', [0, 1.455, 0.004], [
    { t: 0, a: 0.1, b: 0.094 },
    { t: 0.035, a: 0.108, b: 0.104, dz: 0.006 },
    { t: 0.075, a: 0.086, b: 0.083, dz: 0.004 },
  ], { segments: 16, power: 2.2 }), m('scarf'), C);
  p.add(slab(rounded([[-0.065, 1.47], [0.065, 1.47], [0.0, 1.37]], 0.012), 0.025).translate(0, 0, 0.112), m('scarf'), C);

  // закрытая каска в чехле, очки-маска с янтарными стёклами
  p.add(helmetShell({ rimFront: 1.735, rimSide: 1.652, rimBack: 1.665, flare: 0.09 }), m('helmet'), H);
  p.add(tube('y', [0, 1.748, 0], [{ t: 0, a: 0.12, b: 0.134 }, { t: 0.016, a: 0.118, b: 0.132 }], { segments: 24, power: 2.05 }), 'black', H);
  p.add(box(0.06, 0.04, 0.008, 0.002).rotateX(28 * DEG).translate(0, 1.79, -0.122), m('team'), H);
  p.add(arcBand({ y: 1.692, height: 0.048, thickness: 0.018, rx: 0.09, rz: 0.11, from: -78, to: 78 }), 'black', H);
  p.add(arcBand({ y: 1.693, height: 0.036, thickness: 0.008, rx: 0.098, rz: 0.118, from: -52, to: 52 }), m('goggleLens'), H);
}

/** Собирает все детали бойца выбранной фракции. */
export function buildBody(faction) {
  const p = new Parts();
  const m = (key) => `${faction.id}_${key}`;
  const coalition = faction.id === 'coalition';

  addHead(p, m, { face: coalition ? 'balaclava' : 'beard' });
  addTorso(p, m);
  addArms(p, m, { rolledSleeves: coalition });
  addHands(p, m, { knuckles: !coalition });
  addLegs(p, m, { pockets: coalition ? [1, -1] : [1], bloused: coalition });
  if (coalition) addCoalitionGear(p, m);
  else addAllianceGear(p, m);
  return p;
}
