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
  const segments = 22;
  const rings = 8;
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
/* Тело                                                                */
/* ------------------------------------------------------------------ */

function addHead(p, m, { ears = true } = {}) {
  const skin = { skin: B.Head };
  p.add(tube('y', [0, 1.552, 0], [
    { t: 0, a: 0.042, b: 0.03, dz: 0.058 },
    { t: 0.02, a: 0.06, b: 0.055, dz: 0.045 },
    { t: 0.05, a: 0.074, b: 0.084, dz: 0.018 },
    { t: 0.09, a: 0.079, b: 0.096, dz: 0.006 },
    { t: 0.13, a: 0.082, b: 0.1, dz: 0 },
    { t: 0.175, a: 0.081, b: 0.099, dz: -0.004 },
    { t: 0.215, a: 0.07, b: 0.088, dz: -0.008 },
    { t: 0.24, a: 0.046, b: 0.06, dz: -0.01 },
    { t: 0.252, a: 0.015, b: 0.02, dz: -0.01 },
  ], { segments: 14, power: 2.6 }), m('head'), { ...skin, crease: 60 });
  p.add(profile([[0.088, 1.684], [0.121, 1.648], [0.118, 1.634], [0.09, 1.632]], 0.026, { bevel: 0.006 }), m('head'), skin); // нос
  if (ears) for (const s of [1, -1]) p.add(box(0.018, 0.05, 0.032, 0.007).translate(s * 0.079, 1.668, -0.008), m('head'), skin);
  p.add(cylinder(0.058, 0.054, 0.13, 12).translate(0, 1.535, -0.008), m('head'), { skin: B.Neck }); // шея
}

function addTorso(p, m) {
  // торс: плавный переход таз → поясница → грудь
  p.add(tube('y', [0, 1.0, 0], [
    { t: 0, a: 0.152, b: 0.102 },
    { t: 0.06, a: 0.15, b: 0.1 },
    { t: 0.15, a: 0.158, b: 0.105, dz: 0.004 },
    { t: 0.26, a: 0.172, b: 0.112, dz: 0.01 },
    { t: 0.36, a: 0.182, b: 0.112, dz: 0.008 },
    { t: 0.43, a: 0.176, b: 0.1 },
    { t: 0.475, a: 0.14, b: 0.085, dz: -0.005 },
    { t: 0.505, a: 0.075, b: 0.065, dz: -0.008 },
  ], { segments: 16, power: 2.6 }), m('uniform'), { skin: chain('y', 1, ['Hips', [1.04, 0.02], 'Spine', [1.16, 0.05], 'Chest']) });
  // таз
  p.add(tube('y', [0, 0.84, 0], [
    { t: 0, a: 0.09, b: 0.055 },
    { t: 0.04, a: 0.15, b: 0.09 },
    { t: 0.1, a: 0.172, b: 0.106 },
    { t: 0.16, a: 0.162, b: 0.106 },
    { t: 0.21, a: 0.152, b: 0.102 },
  ], { segments: 16, power: 2.6 }), m('uniform'), { skin: B.Hips });
  // воротник
  p.add(tube('y', [0, 1.465, -0.008], [{ t: 0, a: 0.085, b: 0.077 }, { t: 0.045, a: 0.081, b: 0.073 }], { segments: 14, power: 2.2 }), m('uniformShade'), { skin: B.Chest });
  // ремень с пряжкой
  p.add(tube('y', [0, 1.0, 0], [{ t: 0, a: 0.165, b: 0.113 }, { t: 0.052, a: 0.162, b: 0.111 }], { segments: 16, power: 2.6 }), m('belt'), { skin: B.Hips });
  p.add(box(0.05, 0.034, 0.012, 0.003).translate(0, 1.026, 0.114), 'black', { skin: B.Hips });
}

function addArms(p, m, { elbowPads = false } = {}) {
  for (const [side, s] of SIDES) {
    const axis = s > 0 ? 'x' : '-x';
    const arm = `${side}Arm`;
    const fore = `${side}ForeArm`;
    // рукав: плечо и предплечье одной поверхностью, сгиб в локте
    p.add(tube(axis, [s * 0.165, 1.44, -0.02], [
      { t: 0, a: 0.06, b: 0.062 },
      { t: 0.06, a: 0.06, b: 0.061 },
      { t: 0.15, a: 0.054, b: 0.056 },
      { t: 0.25, a: 0.048, b: 0.05 },
      { t: 0.31, a: 0.045, b: 0.047 },
      { t: 0.37, a: 0.046, b: 0.048 },
      { t: 0.47, a: 0.041, b: 0.043 },
      { t: 0.56, a: 0.037, b: 0.039 },
    ], { segments: 12, power: 2.2 }), m('uniform'), { skin: chain('x', s, [arm, [s * 0.475, 0.035], fore]) });
    p.add(sphere(0.066, 14, 10).scale(1, 0.95, 1).translate(s * 0.19, 1.44, -0.02), m('uniform'), { skin: B[arm] }); // дельта
    p.add(tube(axis, [s * 0.26, 1.44, -0.02], [{ t: 0, a: 0.062, b: 0.064 }, { t: 0.045, a: 0.06, b: 0.062 }], { segments: 12, power: 2.2 }), m('team'), { skin: B[arm] }); // повязка
    p.add(tube(axis, [s * 0.7, 1.44, -0.02], [{ t: 0, a: 0.04, b: 0.042 }, { t: 0.028, a: 0.039, b: 0.041 }], { segments: 12, power: 2.2 }), m('uniformShade'), { skin: B[fore] }); // манжета
    if (elbowPads) p.add(box(0.068, 0.066, 0.03, 0.012).translate(s * 0.475, 1.44, -0.064), m('kneePads'), { skin: B[fore] });
  }

  // кисти в перчатках, сжатые для хвата (левая строится, правая — зеркало)
  const w = [0.73, 1.44, -0.02];
  const hand = [
    box(0.088, 0.032, 0.084, 0.013).translate(w[0] + 0.05, w[1] + 0.002, w[2]), // ладонь
    box(0.034, 0.068, 0.08, 0.013).translate(w[0] + 0.094, w[1] - 0.026, w[2]), // согнутые пальцы
    box(0.05, 0.024, 0.076, 0.01).translate(w[0] + 0.07, w[1] - 0.062, w[2]), // кончики пальцев
    box(0.056, 0.026, 0.026, 0.01).rotateY(-0.25).translate(w[0] + 0.052, w[1] - 0.022, w[2] + 0.046), // большой палец
    cylinder(0.04, 0.042, 0.03, 12, 'x').translate(w[0] + 0.012, w[1], w[2]), // край перчатки
  ];
  for (const g of hand) {
    p.add(g, m('gloves'), { skin: B.LeftHand });
    p.add(mirrorX(g), m('gloves'), { skin: B.RightHand });
  }
}

function addLegs(p, m, { pockets = [1, -1] } = {}) {
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
    ], { segments: 12, power: 2.2 }), m('uniform'), { skin: chain('y', -1, ['Hips', [0.955, 0.025], up, [0.51, 0.035], leg]) });
    if (pockets.includes(s)) p.add(box(0.024, 0.13, 0.11, 0.008).translate(s * 0.17, 0.715, 0.008), m('uniformShade'), { skin: B[up] });
    p.add(box(0.094, 0.1, 0.034, 0.014).translate(x, 0.505, 0.073), m('kneePads'), { skin: B[leg] }); // наколенник

    // ботинок: голенище следует за голенью, стопа — за костью стопы
    p.add(tube('y', [x, 0.055, 0], [{ t: 0, a: 0.053, b: 0.06 }, { t: 0.19, a: 0.051, b: 0.057, dz: -0.002 }], { segments: 12, power: 2.4 }), m('boots'), { skin: B[leg] });
    p.add(tube('z', [x, 0, -0.072], [
      { t: 0, a: 0.042, b: 0.04, dy: 0.055 },
      { t: 0.03, a: 0.05, b: 0.052, dy: 0.06 },
      { t: 0.12, a: 0.052, b: 0.045, dy: 0.05 },
      { t: 0.2, a: 0.05, b: 0.034, dy: 0.038 },
      { t: 0.25, a: 0.043, b: 0.027, dy: 0.032 },
      { t: 0.267, a: 0.03, b: 0.018, dy: 0.03 },
    ], { segments: 12, power: 2.6 }), m('boots'), { skin: B[foot] });
    p.add(box(0.106, 0.016, 0.28, 0.006).translate(x, 0.008, 0.062), 'black', { skin: B[foot] }); // подошва
  }
}

/* ------------------------------------------------------------------ */
/* Снаряжение Альянса                                                  */
/* ------------------------------------------------------------------ */

function addAllianceGear(p, m) {
  const C = { skin: B.Chest };
  const H = { skin: B.Head };

  // плитник: передняя и задняя плиты, камербанд, плечевые лямки
  const plate = rounded([[-0.15, 1.1], [0.15, 1.1], [0.15, 1.35, 0.03], [0.1, 1.425, 0.02], [-0.1, 1.425, 0.02], [-0.15, 1.35, 0.03]], 0.015);
  p.add(slab(plate, 0.05, { bevel: 0.008, bevelSegments: 2 }).translate(0, 0, 0.145), m('gear'), C);
  p.add(slab(plate, 0.045, { bevel: 0.008, bevelSegments: 2 }).translate(0, 0, -0.132), m('gear'), C);
  p.add(tube('y', [0, 1.1, 0.006], [{ t: 0, a: 0.18, b: 0.13 }, { t: 0.17, a: 0.188, b: 0.133 }], { segments: 16, power: 2.8 }), m('gear'), C);
  for (const s of [1, -1]) {
    p.add(beam([s * 0.1, 1.405, 0.14], [s * 0.112, 1.49, 0.01], 0.055, 0.02), m('gearDark'), C);
    p.add(beam([s * 0.112, 1.49, 0.01], [s * 0.1, 1.405, -0.125], 0.055, 0.02), m('gearDark'), C);
  }
  // подсумки под магазины и административный подсумок с шевроном команды
  for (const i of [-1, 0, 1]) {
    p.add(box(0.078, 0.115, 0.036, 0.008).translate(i * 0.085, 1.172, 0.19), m('gear'), C);
    p.add(box(0.082, 0.03, 0.04, 0.006).translate(i * 0.085, 1.232, 0.19), m('gearDark'), C);
  }
  p.add(box(0.15, 0.075, 0.028, 0.008).translate(0, 1.33, 0.184), m('gearDark'), C);
  p.add(box(0.05, 0.03, 0.006, 0.002).translate(0.035, 1.335, 0.2), m('team'), C);
  // рация с антенной и гидратор на спине
  p.add(box(0.065, 0.13, 0.045, 0.008).translate(0.1, 1.31, -0.18), 'radio', C);
  p.add(rod([0.115, 1.37, -0.185], [0.15, 1.68, -0.205], 0.0035, 0.0025, 6), 'black', C);
  p.add(box(0.2, 0.3, 0.06, 0.02).translate(-0.03, 1.27, -0.188), m('gear'), C);

  // подсумки на поясе и набедренная кобура справа
  for (const s of [1, -1]) p.add(box(0.06, 0.07, 0.035, 0.008).rotateY(s * 0.5).translate(s * 0.135, 1.0, 0.075), m('gear'), { skin: B.Hips });
  const R = { skin: B.RightUpLeg };
  p.add(box(0.045, 0.15, 0.09, 0.01).translate(-0.19, 0.8, 0.005), m('gearDark'), R);
  p.add(box(0.028, 0.05, 0.034, 0.006).rotateX(-0.35).translate(-0.19, 0.89, -0.012), 'polymer', R);
  p.add(tube('y', [-0.095, 0.735, 0], [{ t: 0, a: 0.075, b: 0.081, dz: 0.006 }, { t: 0.03, a: 0.074, b: 0.08, dz: 0.006 }], { segments: 12, power: 2.2 }), m('belt'), R);

  // шлем с высоким вырезом: крепление ПНВ, боковые планки, шеврон команды
  p.add(helmetShell({ rimFront: 1.733, rimSide: 1.705, rimBack: 1.69 }), m('helmet'), H);
  p.add(box(0.05, 0.034, 0.018, 0.004).rotateX(-20 * DEG).translate(0, 1.775, 0.13), 'black', H);
  for (const s of [1, -1]) p.add(box(0.012, 0.022, 0.13, 0.003).translate(s * 0.118, 1.738, -0.004), 'black', H);
  p.add(box(0.06, 0.04, 0.008, 0.002).rotateX(28 * DEG).translate(0, 1.79, -0.121), m('team'), H);
  // активные наушники с микрофоном и тактические очки
  for (const s of [1, -1]) p.add(cylinder(0.04, 0.04, 0.034, 14, 'x').translate(s * 0.088, 1.675, -0.004), m('headset'), H);
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

  // нагрудная разгрузка: 4 подсумка под магазины, гранатные по бокам
  p.add(box(0.33, 0.16, 0.045, 0.012).translate(0, 1.2, 0.13), m('gear'), C);
  for (let i = 0; i < 4; i++) {
    const x = -0.12 + i * 0.08;
    p.add(box(0.07, 0.15, 0.04, 0.008).translate(x, 1.195, 0.168), m('gear'), C);
    p.add(box(0.074, 0.03, 0.044, 0.006).translate(x, 1.265, 0.168), m('gearDark'), C);
  }
  for (const s of [1, -1]) {
    p.add(box(0.06, 0.08, 0.065, 0.014).translate(s * 0.19, 1.185, 0.085), m('gear'), C);
    // лямки: через плечо и крестом по спине
    p.add(beam([s * 0.13, 1.27, 0.14], [s * 0.112, 1.49, 0.0], 0.04, 0.016), m('gearDark'), C);
    p.add(beam([s * 0.112, 1.49, 0.0], [s * 0.09, 1.4, -0.115], 0.04, 0.016), m('gearDark'), C);
    p.add(beam([s * 0.09, 1.4, -0.115], [-s * 0.07, 1.16, -0.125], 0.04, 0.016), m('gearDark'), C);
  }
  p.add(tube('y', [0, 1.12, 0.006], [{ t: 0, a: 0.172, b: 0.123 }, { t: 0.055, a: 0.174, b: 0.125 }], { segments: 16, power: 2.8 }), m('gearDark'), C);

  // рюкзак со скаткой
  p.add(box(0.27, 0.34, 0.13, 0.03).translate(0, 1.235, -0.19), m('gear'), C);
  p.add(box(0.272, 0.07, 0.136, 0.02).translate(0, 1.385, -0.19), m('gearDark'), C);
  for (const s of [1, -1]) {
    p.add(box(0.04, 0.16, 0.09, 0.012).translate(s * 0.155, 1.19, -0.19), m('gear'), C);
    p.add(beam([s * 0.1, 1.4, -0.13], [s * 0.112, 1.497, -0.02], 0.045, 0.014), m('gearDark'), C);
    p.add(cylinder(0.051, 0.051, 0.012, 14, 'x').translate(s * 0.09, 1.47, -0.2), 'black', C);
  }
  p.add(cylinder(0.048, 0.048, 0.33, 14, 'x').translate(0, 1.47, -0.2), m('uniformShade'), C);

  // шарф-шемаг на шее
  p.add(tube('y', [0, 1.455, 0.004], [
    { t: 0, a: 0.1, b: 0.094 },
    { t: 0.035, a: 0.108, b: 0.104, dz: 0.006 },
    { t: 0.075, a: 0.086, b: 0.083, dz: 0.004 },
  ], { segments: 14, power: 2.2 }), m('scarf'), C);
  p.add(slab(rounded([[-0.065, 1.47], [0.065, 1.47], [0.0, 1.37]], 0.012), 0.025).translate(0, 0, 0.112), m('scarf'), C);

  // закрытая каска в чехле, очки-маска с янтарными стёклами
  p.add(helmetShell({ rimFront: 1.735, rimSide: 1.652, rimBack: 1.665, flare: 0.09 }), m('helmet'), H);
  p.add(tube('y', [0, 1.748, 0], [{ t: 0, a: 0.12, b: 0.134 }, { t: 0.016, a: 0.118, b: 0.132 }], { segments: 22, power: 2.05 }), 'black', H);
  p.add(box(0.06, 0.04, 0.008, 0.002).rotateX(28 * DEG).translate(0, 1.79, -0.122), m('team'), H);
  p.add(arcBand({ y: 1.692, height: 0.048, thickness: 0.018, rx: 0.09, rz: 0.11, from: -78, to: 78 }), 'black', H);
  p.add(arcBand({ y: 1.693, height: 0.036, thickness: 0.008, rx: 0.098, rz: 0.118, from: -52, to: 52 }), m('goggleLens'), H);
}

/** Собирает все детали бойца выбранной фракции. */
export function buildBody(faction) {
  const p = new Parts();
  const m = (key) => `${faction.id}_${key}`;
  const coalition = faction.id === 'coalition';

  addHead(p, m, { ears: !coalition });
  addTorso(p, m);
  addArms(p, m, { elbowPads: coalition });
  addLegs(p, m, { pockets: coalition ? [1, -1] : [1] });
  if (coalition) addCoalitionGear(p, m);
  else addAllianceGear(p, m);
  return p;
}
