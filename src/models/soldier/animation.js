import * as THREE from 'three';
import { Rig, euler, localMatrix, THIGH, SHIN } from './rig.js';
import { RELOAD, reloadHand, reloadMagazine } from '../weapons/handling.js';
import { createAssaultRifle } from '../weapons/assaultRifle.js';
import { createPistol } from '../weapons/pistol.js';
import { createBandage } from '../items/bandage.js';

/*
 * Движения бойца.
 *
 * Корпус и ноги двигаются процедурно: стопы ставятся инверсной кинематикой
 * по шаговому циклу (в любом направлении), руки с оружием — тоже через IK:
 * правая кисть держит рукоять (grip_r), левая — цевьё (grip_l). Поэтому каждое
 * движение подходит к любому оружию. Для .glb движения «запекаются» в клипы.
 */

const ONE = new THREE.Vector3(1, 1, 1);
const RIGHT_EYE = new THREE.Vector3(-0.032, 0.092, 0.09); // в системе кости Head
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
const lerp = THREE.MathUtils.lerp;

/** Значение по ключам [[t, v], ...] с плавными переходами; v — число или массив чисел. */
function keys(t, list) {
  if (t <= list[0][0]) return list[0][1];
  for (let i = 0; i < list.length - 1; i++) {
    const [t0, v0] = list[i];
    const [t1, v1] = list[i + 1];
    if (t <= t1) {
      const k = smooth((t - t0) / (t1 - t0));
      return Array.isArray(v0) ? v0.map((a, j) => a + (v1[j] - a) * k) : v0 + (v1 - v0) * k;
    }
  }
  return list[list.length - 1][1];
}

function blendMatrices(a, b, k) {
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  a.decompose(pa, qa, new THREE.Vector3());
  b.decompose(pb, qb, new THREE.Vector3());
  return new THREE.Matrix4().compose(pa.lerp(pb, k), qa.slerp(qb, k), ONE);
}

/* ------------------------------------------------------------------ */
/* Ноги                                                                */
/* ------------------------------------------------------------------ */

/**
 * Поставить обе стопы. Если таз слишком высоко и нога не дотягивается до
 * опорной стопы, таз опускается — стопы всегда стоят на земле.
 */
function feet(rig, left, right, knees = [[0.12, 0, 1], [-0.12, 0, 1]]) {
  rig.root.updateMatrixWorld(true);
  let deficit = 0;
  for (const [side, foot] of [['Left', left], ['Right', right]]) {
    if ((foot.lift ?? 0) > 0.02) continue;
    const hip = rig.bones[`${side}UpLeg`].getWorldPosition(new THREE.Vector3());
    const ankle = rig.world(foot.x, 0.09 + (foot.lift ?? 0), foot.z);
    deficit = Math.max(deficit, hip.distanceTo(ankle) - (THIGH + SHIN - 0.012));
  }
  if (deficit > 0) {
    rig.bones.Hips.position.y -= deficit;
    rig.root.updateMatrixWorld(true);
  }
  rig.placeFoot('Left', left, knees[0]);
  rig.placeFoot('Right', right, knees[1]);
}

/**
 * Шаговый цикл на месте. stride — путь стопы за время опоры (м), period —
 * полный цикл из двух шагов (с), duty — доля опоры, lift — подъём стопы,
 * drop — насколько опущен таз, bob — покачивание таза, lean — наклон корпуса,
 * width — расстановка стоп, center — смещение опоры назад (бег), heel/toe —
 * перекат стопы, sway — раскачка в стороны, yaw — поворот таза, bounce — бег.
 * Скорость движения, при которой стопы не скользят: stride / (duty · period).
 */
export const GAITS = {
  walk: { period: 0.9, stride: 0.55, duty: 0.6, lift: 0.09, drop: 0.04, bob: 0.018, lean: 4, width: 0.11, center: 0, heel: 14, toe: 26, sway: 0.02, yaw: 6 },
  jog: { period: 0.72, stride: 0.8, duty: 0.42, lift: 0.17, drop: 0.07, bob: 0.03, lean: 9, width: 0.1, center: -0.08, heel: 8, toe: 34, sway: 0.015, yaw: 8, bounce: true },
  sprint: { period: 0.62, stride: 0.95, duty: 0.34, lift: 0.26, drop: 0.08, bob: 0.04, lean: 16, width: 0.09, center: -0.12, heel: 4, toe: 45, sway: 0.012, yaw: 10, bounce: true },
  crouch: { period: 1.1, stride: 0.5, duty: 0.65, lift: 0.1, drop: 0.36, bob: 0.015, lean: 18, width: 0.15, center: 0, heel: 8, toe: 20, sway: 0.03, yaw: 5 },
};

export const gaitSpeed = (g) => g.stride / (g.duty * g.period);

/** Положение одной стопы в шаговом цикле (ph — фаза 0..1 этой стопы). */
function gaitFoot(ph, g) {
  if (ph < g.duty) {
    const s = ph / g.duty;
    const roll = s < 0.15 ? -1 + s / 0.15 : s > 0.65 ? (s - 0.65) / 0.35 : 0;
    return { along: g.center + g.stride * (0.5 - s), lift: 0, roll };
  }
  const s = (ph - g.duty) / (1 - g.duty);
  return { along: g.center + g.stride * (smooth(s) - 0.5), lift: g.lift * Math.sin(Math.PI * s), roll: lerp(0.8, -0.6, smooth(s)) };
}

/** Корпус и ноги при движении в направлении dir = [x, z] (система корня). */
function gaitBody(rig, phase, g, dir) {
  const [dx, dz] = dir;
  const p = phase * TAU;
  const fwd = Math.abs(dz) > 0.5 ? Math.sign(dz) : 0;
  const bobPhase = g.bounce ? p * 2 - g.duty * TAU : p * 2;
  const bob = -g.bob * (1 + Math.cos(bobPhase)) * 0.5;
  rig.body({
    hips: [g.sway * Math.sin(p), -g.drop + bob, 0],
    hipsRot: [g.lean * 0.4, g.yaw * Math.sin(p) * (fwd || 0.4), -3 * Math.sin(p)],
    spine: [g.lean * 0.4, -g.yaw * 0.5 * Math.sin(p) * (fwd || 0.4), 0],
    chest: [g.lean * 0.3 + 1.5 * Math.cos(2 * p), -g.yaw * 0.4 * Math.sin(p) * (fwd || 0.4), 0],
  });
  // боком шаг короче и стопы шире, чтобы ноги не перекрещивались
  const lateral = Math.abs(dx);
  const width = g.width + 0.06 * lateral;
  const reach = 1 - 0.45 * lateral;
  const place = (ph, side) => {
    const f = gaitFoot(ph % 1, g);
    const roll = f.roll * (fwd || 0.35);
    return {
      x: side * width + dx * f.along * reach,
      z: dz * f.along,
      lift: f.lift,
      pitch: roll > 0 ? roll * g.toe : roll * g.heel,
      yaw: side * 6,
    };
  };
  feet(rig, place(phase, 1), place(phase + 0.5, -1));
}

/** Стойка с дыханием. stagger — левая нога впереди. */
function standBody(rig, t, { stagger = 0.05 } = {}) {
  const breath = Math.sin((t / 3) * TAU);
  rig.body({ hips: [0, -0.025, 0], spine: [2 + breath * 0.6, 0, 0], chest: [1 + breath * 0.9, 0, 0] });
  feet(rig, { x: 0.11, z: stagger, yaw: 8 }, { x: -0.11, z: -stagger, yaw: -12 });
}

/** Стойка стрелка: корпус развёрнут, левая нога впереди, правое плечо под прикладом. */
function aimBody(rig, t) {
  const sway = Math.sin((t / 3) * TAU);
  rig.body({ hips: [0, -0.045, 0], hipsRot: [0, -28, 0], spine: [8, -8 + sway * 0.6, 0], chest: [7 + sway * 0.5, -6, 0] });
  rig.rotate('RightShoulder', 0, 12, -10);
  rig.rotate('LeftShoulder', 0, -8, 0);
  feet(rig, { x: 0.12, z: 0.15, yaw: -12 }, { x: -0.14, z: -0.15, yaw: -42 });
}

/** Присед стрелка: колени вперёд, левая нога чуть впереди, правая — на носке. */
function crouchBody(rig, t) {
  const breath = Math.sin((t / 3) * TAU);
  rig.body({ hips: [0, -0.37, -0.04], hipsRot: [12, -14, 0], spine: [14 + breath * 0.5, -6, 0], chest: [8 + breath * 0.6, -4, 0] });
  rig.rotate('RightShoulder', 0, 10, -8);
  feet(rig, { x: 0.13, z: 0.14, yaw: -6 }, { x: -0.13, z: -0.12, pitch: 25, yaw: -20 }, [[0.15, 0.1, 1], [-0.25, -0.1, 1]]);
}

/** Лёжа: корпус вытянут вперёд, грудь приподнята на локтях. crawl — фаза переползания. */
function proneBody(rig, t, crawl = null) {
  const breath = Math.sin((t / 3) * TAU);
  const p = crawl === null ? 0 : crawl * TAU;
  const amount = crawl === null ? 0 : 1;
  rig.body({
    hips: [0.03 * Math.sin(p) * amount, 0.17 - 0.98, -0.15 + 0.04 * Math.sin(2 * p) * amount],
    hipsRot: [82, 6 * Math.sin(p) * amount, 8 * Math.sin(p) * amount],
    spine: [-14 + breath * 0.4, -4 * Math.sin(p) * amount, 0],
    chest: [-16, -3 * Math.sin(p) * amount, 0],
  });
  // при переползании колени по очереди подтягиваются в сторону
  const leg = (side, ph) => {
    const pull = amount * Math.max(0, Math.sin(ph));
    return { x: side * (0.17 + 0.2 * pull), z: -1.2 + 0.5 * pull, pitch: 75 - 20 * pull, yaw: side * (8 + 25 * pull) };
  };
  rig.root.updateMatrixWorld(true);
  rig.placeFoot('Left', leg(1, p), [0.4, -1, 0]);
  rig.placeFoot('Right', leg(-1, p + Math.PI), [-0.4, -1, 0]);
}

/* ------------------------------------------------------------------ */
/* Оружие в руках                                                      */
/* ------------------------------------------------------------------ */

/** Мировая матрица оружия, при которой его узел sight совпадает с правым глазом. */
function aimMatrix(rig, pitch = 0, yaw = 0) {
  const eye = rig.bones.Head.localToWorld(RIGHT_EYE.clone());
  const q = rig.rootQuaternion().multiply(euler(pitch, yaw, 0));
  const sight = rig.weapon.getObjectByName('sight').position.clone().applyQuaternion(q);
  return new THREE.Matrix4().compose(eye.sub(sight), q, ONE);
}

/** Повернуть позу оружия вокруг мировой точки pivot (углы — в осях оружия). */
function rotateAbout(matrix, pivot, rotation) {
  const axes = new THREE.Quaternion().setFromRotationMatrix(matrix);
  const r = axes.clone().multiply(euler(...rotation)).multiply(axes.clone().invert());
  const toPivot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
  const fromPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  return toPivot.multiply(new THREE.Matrix4().makeRotationFromQuaternion(r)).multiply(fromPivot).multiply(matrix);
}

/** Поза оружия по положению правого хвата: grip — в системе Chest, поворот — относительно корня. */
function gripMatrix(rig, grip, rotation) {
  const gripLocal = localMatrix(rig.weapon.getObjectByName('grip_r')).invert();
  return rig.chestFrame(grip, rotation).multiply(gripLocal);
}

/** Опущенное к полу оружие («низкая готовность»): поворот вокруг упора приклада. */
function readyMatrix(rig, t, pitch = 32, yaw = 14) {
  const aim = aimMatrix(rig);
  const pivot = new THREE.Vector3().setFromMatrixPosition(rig.weaponPoint(aim, 'stock'));
  return rotateAbout(aim, pivot, [pitch + Math.sin(t * 2.1) * 1.2, yaw, 0]);
}

/** Отдача: оружие уходит назад и задирает ствол. */
function recoil(matrix, amount, back, flip) {
  return matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.1 * back * amount, -back * amount)).multiply(new THREE.Matrix4().makeRotationX(-flip * amount * (Math.PI / 180)));
}

/** Направления локтей (подсказки IK) в системе грудной клетки. */
function poles(rig, right, left) {
  const chestQ = rig.bones.Chest.getWorldQuaternion(new THREE.Quaternion());
  const at = (side, v) => rig.bones[`${side}Arm`].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(...v).applyQuaternion(chestQ));
  return [at('Right', right), at('Left', left)];
}

const LONG_POLES = [[-0.6, -0.42, -0.2], [0.12, -0.7, 0.05]];
const PISTOL_POLES = [[-0.35, -0.55, -0.1], [0.35, -0.55, -0.1]];
const PRONE_POLES = [[-0.4, -0.8, 0.1], [0.4, -0.8, 0.1]];

/* ------------------------------------------------------------------ */
/* Движения                                                            */
/* ------------------------------------------------------------------ */

/**
 * Каждое движение: duration (с), loop — зациклено ли, body(ctx) — корпус и
 * ноги, hold(ctx) — оружие (матрица оружия и подсказки локтей), look —
 * наклон/крен/поворот головы, free(ctx) — руки, если оружия нет.
 */
const gait = (name, dir, hold) => ({
  duration: GAITS[name].period,
  loop: true,
  body: ({ rig, phase }) => gaitBody(rig, phase, GAITS[name], dir),
  hold,
  look: () => [name === 'crouch' ? 6 : 3, 0],
  free: ({ rig, phase }) => {
    const swing = (name === 'sprint' ? 45 : name === 'jog' ? 32 : 16) * Math.sin(phase * TAU) * Math.abs(dir[1] || 0.5);
    const bend = name === 'sprint' || name === 'jog' ? 75 : 18;
    rig.freeArm('Left', { swing: -swing, bend });
    rig.freeArm('Right', { swing, bend });
  },
});

const aimHold = ({ rig, kind }) => ({ matrix: aimMatrix(rig), poles: kind === 'pistol' ? PISTOL_POLES : LONG_POLES });
const readyHold = ({ rig, t, kind }) =>
  kind === 'pistol'
    ? { matrix: gripMatrix(rig, [-0.03, -0.12, 0.34], [28 + Math.sin(t * 2.1) * 1.5, 6, 0]), poles: PISTOL_POLES }
    : { matrix: readyMatrix(rig, t), poles: LONG_POLES };
const jogHold = ({ rig, t, kind }) =>
  kind === 'pistol'
    ? { matrix: gripMatrix(rig, [-0.05, -0.05, 0.24], [14, 4, 0]), poles: PISTOL_POLES }
    : { matrix: readyMatrix(rig, t, 16, 8), poles: LONG_POLES };
const sprintHold = ({ rig, kind }) =>
  kind === 'pistol'
    ? { matrix: gripMatrix(rig, [-0.06, -0.06, 0.2], [20, 10, 0]), poles: PISTOL_POLES }
    : { matrix: gripMatrix(rig, [-0.12, -0.13, 0.22], [22, 42, -24]), poles: [[-0.5, -0.5, -0.3], [0.2, -0.7, 0.1]] };
const aimOffset = (pitch) => ({ rig, kind }) => ({ matrix: aimMatrix(rig, pitch), poles: kind === 'pistol' ? PISTOL_POLES : LONG_POLES });

/** Кривая отдачи: резкий толчок и плавный возврат. */
function kick(t, duration) {
  return t < 0.02 ? t / 0.02 : Math.max(0, 1 - (t - 0.02) / (duration - 0.02));
}

/** Падение: dir = −1 на спину, +1 лицом вниз. Ноги и руки — прямая кинематика. */
function death(rig, t, dir) {
  const back = dir < 0;
  const times = back ? [0, 0.25, 0.75, 1.15, 1.4] : [0, 0.2, 0.65, 1.05, 1.3];
  const k = (values, tt = t) => keys(tt, times.map((time, i) => [time, values[i]]));
  rig.body({
    hips: [0, k([-0.02, -0.06, -0.46, -0.83, -0.84]), k(back ? [0, -0.05, -0.2, -0.42, -0.44] : [0, 0.03, 0.18, 0.4, 0.42])],
    hipsRot: [k(back ? [0, -4, -22, -86, -88] : [0, 6, 30, 84, 86]), k([0, 4, 8, 12, 12]), k([0, 2, 6, 10, 10])],
    spine: [k(back ? [0, -12, -6, 4, 2] : [0, 10, 8, -4, -6]), 0, 0],
    chest: [k(back ? [0, -10, -6, 4, 2] : [0, 8, 6, -6, -8]), 0, 0],
  });
  for (const [side, delay] of [['Left', 0], ['Right', 0.06]]) {
    const tt = Math.max(0, t - delay);
    const s = side === 'Left' ? 1 : -1;
    rig.rotate(`${side}UpLeg`, back ? k([0, -10, -55, -25, -8], tt) : k([0, -20, -80, -12, 4], tt), 0, s * k([2, 4, 8, 10, 12], tt));
    rig.rotate(`${side}Leg`, back ? k([0, 20, 95, 40, 12], tt) : k([0, 35, 110, 30, 8], tt), 0, 0);
    rig.rotate(`${side}Foot`, back ? k([0, 10, -10, 20, 30], tt) : k([0, 20, 40, 60, 70], tt), 0, 0);
    rig.freeArm(side, {
      swing: back ? k([0, -10, -30, -60, -70], tt) : k([0, -30, -70, -90, -95], tt),
      spread: back ? k([76, 60, 45, 25, 18], tt) : k([76, 70, 40, 30, 28], tt),
      bend: k([15, 25, 30, 15, 10], tt),
    });
  }
  rig.rotate('Neck', back ? k([0, -15, -10, 5, 8]) : k([0, 10, 5, -15, -20]), 0, 0, 'YXZ');
  rig.rotate('Head', back ? k([0, -18, -6, 10, 14]) : k([0, 6, 0, -20, -30]), 0, k([0, 0, 10, 35, 40]), 'YXZ');
}

export const MOTIONS = {
  idle: { label: 'Стойка', duration: 3, loop: true, body: ({ rig, t }) => standBody(rig, t), hold: readyHold },
  aim: {
    label: 'Прицеливание',
    duration: 3,
    loop: true,
    body: ({ rig, t, kind }) => (kind === 'pistol' ? standBody(rig, t, { stagger: 0.08 }) : aimBody(rig, t)),
    hold: aimHold,
    look: ({ kind }) => (kind === 'pistol' ? [0, 0] : [9, 10]),
  },
  aim_up: {
    label: 'Прицел вверх',
    duration: 1,
    loop: true,
    body: ({ rig, t, kind }) => {
      if (kind === 'pistol') standBody(rig, t);
      else aimBody(rig, t);
      rig.rotate('Spine', -6, -8, 0, 'YXZ');
      rig.rotate('Chest', -14, -6, 0, 'YXZ');
    },
    hold: aimOffset(-55),
    look: () => [-55, 6],
  },
  aim_down: {
    label: 'Прицел вниз',
    duration: 1,
    loop: true,
    body: ({ rig, t, kind }) => {
      if (kind === 'pistol') standBody(rig, t);
      else aimBody(rig, t);
      rig.rotate('Spine', 18, -8, 0, 'YXZ');
      rig.rotate('Chest', 16, -6, 0, 'YXZ');
    },
    hold: aimOffset(55),
    look: () => [55, 8],
  },
  walk_forward: { label: 'Шаг вперёд с прицелом', ...gait('walk', [0, 1], aimHold) },
  walk_backward: { label: 'Шаг назад', ...gait('walk', [0, -1], aimHold) },
  walk_left: { label: 'Шаг влево', ...gait('walk', [1, 0], aimHold) },
  walk_right: { label: 'Шаг вправо', ...gait('walk', [-1, 0], aimHold) },
  jog_forward: { label: 'Бег вперёд', ...gait('jog', [0, 1], jogHold) },
  jog_backward: { label: 'Бег назад', ...gait('jog', [0, -1], jogHold) },
  jog_left: { label: 'Бег влево', ...gait('jog', [1, 0], jogHold) },
  jog_right: { label: 'Бег вправо', ...gait('jog', [-1, 0], jogHold) },
  sprint: { label: 'Спринт', ...gait('sprint', [0, 1], sprintHold) },
  crouch_idle: { label: 'Присед', duration: 3, loop: true, body: ({ rig, t }) => crouchBody(rig, t), hold: aimHold, look: () => [2, 4] },
  crouch_forward: { label: 'Гусиный шаг вперёд', ...gait('crouch', [0, 1], aimHold) },
  crouch_backward: { label: 'Гусиный шаг назад', ...gait('crouch', [0, -1], aimHold) },
  crouch_left: { label: 'Гусиный шаг влево', ...gait('crouch', [1, 0], aimHold) },
  crouch_right: { label: 'Гусиный шаг вправо', ...gait('crouch', [-1, 0], aimHold) },
  prone_idle: {
    label: 'Лёжа',
    duration: 3,
    loop: true,
    body: ({ rig, t }) => proneBody(rig, t),
    hold: ({ rig, kind }) => ({ matrix: aimMatrix(rig), poles: kind === 'pistol' ? PISTOL_POLES : PRONE_POLES }),
    free: ({ rig }) => ['Left', 'Right'].forEach((side) => rig.freeArm(side, { swing: -70, spread: 30, bend: 60 })),
  },
  prone_crawl: {
    label: 'Ползком',
    duration: 1.6,
    loop: true,
    body: ({ rig, t, phase }) => proneBody(rig, t, phase),
    hold: ({ rig, phase, kind }) => ({ matrix: aimMatrix(rig, 8 + 3 * Math.sin(phase * TAU * 2)), poles: kind === 'pistol' ? PISTOL_POLES : PRONE_POLES }),
    free: ({ rig, phase }) => {
      rig.freeArm('Left', { swing: -70 + 20 * Math.sin(phase * TAU), spread: 30, bend: 60 });
      rig.freeArm('Right', { swing: -70 - 20 * Math.sin(phase * TAU), spread: 30, bend: 60 });
    },
  },
  jump_start: {
    label: 'Прыжок: толчок',
    duration: 0.3,
    loop: false,
    body: ({ rig, t }) => {
      rig.body({ hips: [0, keys(t, [[0, -0.03], [0.12, -0.15], [0.3, 0.06]]), 0], spine: [keys(t, [[0, 4], [0.12, 16], [0.3, 6]]), 0, 0], chest: [4, 0, 0] });
      const lift = keys(t, [[0, 0], [0.22, 0], [0.3, 0.07]]);
      const pitch = keys(t, [[0, 0], [0.15, 0], [0.3, 40]]);
      feet(rig, { x: 0.11, z: 0.04, lift, pitch, yaw: 8 }, { x: -0.11, z: -0.04, lift, pitch, yaw: -10 });
    },
    hold: readyHold,
  },
  jump_fall: {
    label: 'Прыжок: полёт',
    duration: 0.6,
    loop: true,
    body: ({ rig, phase }) => {
      rig.body({ hips: [0, -0.02 + 0.01 * Math.sin(phase * TAU), 0], spine: [6, 0, 0], chest: [3, 0, 0] });
      rig.placeFoot('Left', { x: 0.11, z: 0.14, lift: 0.3, pitch: 12, yaw: 8 });
      rig.placeFoot('Right', { x: -0.11, z: -0.16, lift: 0.22, pitch: 35, yaw: -8 });
    },
    hold: readyHold,
  },
  jump_land: {
    label: 'Прыжок: приземление',
    duration: 0.35,
    loop: false,
    body: ({ rig, t }) => {
      rig.body({
        hips: [0, keys(t, [[0, -0.02], [0.08, -0.18], [0.35, -0.03]]), 0],
        spine: [keys(t, [[0, 6], [0.08, 18], [0.35, 3]]), 0, 0],
        chest: [keys(t, [[0, 3], [0.08, 8], [0.35, 1]]), 0, 0],
      });
      feet(rig, { x: 0.12, z: 0.06, yaw: 8 }, { x: -0.12, z: -0.06, yaw: -12 });
    },
    hold: readyHold,
  },
  fire: {
    label: 'Выстрел',
    duration: 0.1,
    loop: true,
    durationFor: (kind) => (kind === 'pistol' ? 0.25 : 0.1),
    body: ({ rig, t, kind, duration }) => {
      if (kind === 'pistol') standBody(rig, t, { stagger: 0.08 });
      else aimBody(rig, t);
      rig.rotate('Chest', 7 - 1.5 * kick(t, duration), -6, 0, 'YXZ');
    },
    hold: ({ rig, t, kind, duration }) => {
      const k = kick(t, duration);
      return kind === 'pistol'
        ? { matrix: recoil(aimMatrix(rig), k, 0.025, 9), poles: PISTOL_POLES }
        : { matrix: recoil(aimMatrix(rig), k, 0.03, 3), poles: LONG_POLES };
    },
    look: ({ kind }) => (kind === 'pistol' ? [0, 0] : [9, 10]),
  },
  reload: {
    label: 'Перезарядка',
    duration: RELOAD.long.duration,
    loop: false,
    durationFor: (kind) => RELOAD[kind === 'pistol' ? 'pistol' : 'long'].duration,
    body: ({ rig, t }) => {
      standBody(rig, t);
      rig.rotate('Chest', 6, 0, 0, 'YXZ');
    },
    hold: ({ rig, t, kind, duration }) => {
      const type = kind === 'pistol' ? 'pistol' : 'long';
      const w = smooth(t / 0.22) * (1 - smooth((t - (duration - 0.25)) / 0.25));
      const base = kind === 'pistol' ? gripMatrix(rig, [-0.03, -0.1, 0.32], [20, 6, 0]) : readyMatrix(rig, t, 20, 10);
      const tilted = kind === 'pistol' ? gripMatrix(rig, [-0.02, -0.05, 0.28], [-8, 4, -22]) : gripMatrix(rig, [-0.1, -0.08, 0.3], [-10, 14, 26]);
      return { matrix: blendMatrices(base, tilted, w), poles: kind === 'pistol' ? PISTOL_POLES : LONG_POLES, left: reloadHand(type, t) };
    },
    look: ({ t, duration }) => [keys(t, [[0, 0], [0.25, 22], [duration - 0.3, 22], [duration, 4]]), 0],
  },
  bandage: {
    label: 'Перевязка',
    duration: 3,
    loop: false,
    item: 'bandage',
    body: ({ rig, t }) => {
      standBody(rig, t);
      rig.rotate('Chest', 8, 6, 0, 'YXZ');
    },
    hold: ({ rig, t, kind }) => {
      const w = smooth(t / 0.35) * (1 - smooth((t - 2.6) / 0.4));
      const ready = kind === 'pistol' ? gripMatrix(rig, [-0.03, -0.12, 0.34], [28, 6, 0]) : readyMatrix(rig, t);
      const hang = kind === 'pistol' ? gripMatrix(rig, [-0.16, -0.3, 0.18], [55, 10, 0]) : gripMatrix(rig, [-0.18, -0.36, 0.2], [58, 20, 0]);
      return { matrix: blendMatrices(ready, hang, w), poles: kind === 'pistol' ? PISTOL_POLES : LONG_POLES, wrap: true };
    },
    look: ({ t }) => [keys(t, [[0, 0], [0.4, 26], [2.6, 26], [3, 2]]), 0, keys(t, [[0, 0], [0.4, -22], [2.6, -22], [3, 0]])],
  },
  hit: {
    label: 'Попадание',
    duration: 0.35,
    loop: false,
    body: ({ rig, t, kind }) => {
      if (kind === 'pistol') standBody(rig, t);
      else aimBody(rig, t);
      rig.bones.Hips.position.z += keys(t, [[0, 0], [0.06, -0.035], [0.35, 0]]);
      rig.rotate('Chest', keys(t, [[0, 7], [0.06, -6], [0.35, 7]]), keys(t, [[0, -6], [0.06, 6], [0.35, -6]]), 0, 'YXZ');
    },
    hold: aimHold,
    look: ({ t }) => [keys(t, [[0, 6], [0.06, -12], [0.35, 6]]), 0],
  },
  death_back: { label: 'Смерть (на спину)', duration: 1.4, loop: false, body: ({ rig, t }) => death(rig, t, -1), lifeless: true },
  death_forward: { label: 'Смерть (лицом вниз)', duration: 1.3, loop: false, body: ({ rig, t }) => death(rig, t, 1), lifeless: true },
};

/* ------------------------------------------------------------------ */
/* Поза в момент t                                                     */
/* ------------------------------------------------------------------ */

/** Какой хват у оружия в руке: 'long', 'pistol' или 'none'. */
export function weaponKind(weapon) {
  if (!weapon) return 'none';
  return weapon.userData.hold === 'pistol' ? 'pistol' : 'long';
}

/** Длительность движения для данного оружия. */
export function motionDuration(id, kind) {
  const m = MOTIONS[id];
  return m.durationFor ? m.durationFor(kind) : m.duration;
}

/** Перевязка: кулак левой руки ходит кругами вокруг правого предплечья. */
function wrapFist(rig, t) {
  const elbow = rig.bones.RightForeArm.getWorldPosition(new THREE.Vector3());
  const wrist = rig.bones.RightHand.getWorldPosition(new THREE.Vector3());
  const axis = wrist.clone().sub(elbow).normalize();
  const progress = clamp01((t - 0.45) / 2.0);
  const center = elbow.clone().lerp(wrist, 0.35 + 0.35 * progress);
  const e1 = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
  const e2 = axis.clone().cross(e1);
  const angle = progress * 3 * TAU;
  const offset = e1.multiplyScalar(Math.cos(angle) * 0.085).addScaledVector(e2, Math.sin(angle) * 0.085);
  const palm = offset.clone().negate().normalize(); // ладонь к предплечью
  const thumb = axis.clone().addScaledVector(palm, -axis.dot(palm)).normalize();
  return new THREE.Matrix4().makeBasis(palm.clone().cross(thumb), palm, thumb).setPosition(center.add(offset));
}

/**
 * Поставить позу: движение id в момент t (секунды). kind — хват оружия;
 * по умолчанию определяется по оружию в руке.
 */
export function pose(rig, id, t, kind = weaponKind(rig.weapon)) {
  const motion = MOTIONS[id];
  const duration = motionDuration(id, kind);
  const time = motion.loop ? ((t % duration) + duration) % duration : Math.min(t, duration);
  const ctx = { rig, t: time, phase: time / duration, kind, duration };
  rig.reset();
  motion.body(ctx);
  rig.root.updateMatrixWorld(true);
  if (motion.lifeless) return;

  const [pitch, roll, yaw = 0] = motion.look ? motion.look(ctx) : [0, 0];
  rig.lookForward(pitch, roll, yaw);

  if (kind === 'none' || !rig.weapon) {
    if (motion.free) motion.free(ctx);
    else ['Left', 'Right'].forEach((side) => rig.freeArm(side));
    rig.root.updateMatrixWorld(true);
    return;
  }
  const hold = motion.hold(ctx);
  const [poleR, poleL] = poles(rig, ...hold.poles);
  if (hold.wrap) {
    rig.holdAt(hold.matrix, poleR, poleL, 'free');
    rig.root.updateMatrixWorld(true);
    const grip = rig.weapon.getObjectByName('grip_l').matrixWorld.clone();
    const reach = rig.chestFrame([0.04, -0.12, 0.26], [-70, 30, 0]);
    const fist = time < 0.45
      ? blendMatrices(grip, reach, smooth(time / 0.45))
      : time < 2.45
        ? blendMatrices(reach, wrapFist(rig, time), smooth((time - 0.45) / 0.2))
        : blendMatrices(wrapFist(rig, time), grip, smooth((time - 2.45) / 0.5));
    rig.leftHandAt(fist, poleL);
  } else {
    rig.holdAt(hold.matrix, poleR, poleL, hold.left);
  }
  rig.root.updateMatrixWorld(true);
}

/** Магазин оружия во время перезарядки (для просмотрщика). */
export function updateWeaponParts(rig, id, t) {
  const magazine = rig.weapon?.getObjectByName('magazine');
  if (!magazine) return;
  magazine.userData.rest ??= localMatrix(magazine);
  const type = weaponKind(rig.weapon) === 'pistol' ? 'pistol' : 'long';
  const m = id === 'reload' ? reloadMagazine(type, Math.min(t, RELOAD[type].duration), magazine.userData.rest) : magazine.userData.rest;
  m.decompose(magazine.position, magazine.quaternion, magazine.scale);
}

/* ------------------------------------------------------------------ */
/* Запекание клипов для .glb                                           */
/* ------------------------------------------------------------------ */

/**
 * Клипы в файле бойца: [имя, движение, хват]. Клипы Rifle_* подходят к любому
 * длинноствольному оружию: у всех одинаковая геометрия хвата (handling.js).
 */
export const CLIPS = [
  ['Idle', 'idle', 'none'],
  ['Rifle_Idle', 'idle', 'long'],
  ['Rifle_Aim', 'aim', 'long'],
  ['Rifle_Aim_Up', 'aim_up', 'long'],
  ['Rifle_Aim_Down', 'aim_down', 'long'],
  ['Rifle_Walk_Forward', 'walk_forward', 'long'],
  ['Rifle_Walk_Backward', 'walk_backward', 'long'],
  ['Rifle_Walk_Left', 'walk_left', 'long'],
  ['Rifle_Walk_Right', 'walk_right', 'long'],
  ['Rifle_Jog_Forward', 'jog_forward', 'long'],
  ['Rifle_Jog_Backward', 'jog_backward', 'long'],
  ['Rifle_Jog_Left', 'jog_left', 'long'],
  ['Rifle_Jog_Right', 'jog_right', 'long'],
  ['Rifle_Sprint', 'sprint', 'long'],
  ['Rifle_Crouch_Idle', 'crouch_idle', 'long'],
  ['Rifle_Crouch_Walk_Forward', 'crouch_forward', 'long'],
  ['Rifle_Crouch_Walk_Backward', 'crouch_backward', 'long'],
  ['Rifle_Crouch_Walk_Left', 'crouch_left', 'long'],
  ['Rifle_Crouch_Walk_Right', 'crouch_right', 'long'],
  ['Rifle_Prone_Idle', 'prone_idle', 'long'],
  ['Rifle_Prone_Crawl', 'prone_crawl', 'long'],
  ['Rifle_Jump_Start', 'jump_start', 'long'],
  ['Rifle_Jump_Fall', 'jump_fall', 'long'],
  ['Rifle_Jump_Land', 'jump_land', 'long'],
  ['Rifle_Fire', 'fire', 'long'],
  ['Rifle_Reload', 'reload', 'long'],
  ['Bandage', 'bandage', 'long'],
  ['Hit', 'hit', 'long'],
  ['Death_Back', 'death_back', 'long'],
  ['Death_Forward', 'death_forward', 'long'],
  ['Pistol_Idle', 'idle', 'pistol'],
  ['Pistol_Aim', 'aim', 'pistol'],
  ['Pistol_Walk_Forward', 'walk_forward', 'pistol'],
  ['Pistol_Jog_Forward', 'jog_forward', 'pistol'],
  ['Pistol_Crouch_Idle', 'crouch_idle', 'pistol'],
  ['Pistol_Fire', 'fire', 'pistol'],
  ['Pistol_Reload', 'reload', 'pistol'],
];

/** Какие клипы зациклены — пригодится движку (в glTF такого флага нет). */
export const LOOPING_CLIPS = CLIPS.filter(([, motion]) => MOTIONS[motion].loop).map(([name]) => name);

/** Запечь клипы в ключевые кадры (30 к/с). Опорное оружие — автомат и пистолет. */
export function bakeClips(root, fps = 30) {
  const rig = new Rig(root);
  const weapons = { long: createAssaultRifle(), pistol: createPistol() };
  const names = Object.keys(rig.bones);
  const clips = CLIPS.map(([clipName, motion, kind]) => {
    rig.attach(weapons[kind] ?? null);
    const duration = motionDuration(motion, kind);
    const frames = Math.max(2, Math.round(duration * fps));
    const times = new Float32Array(frames + 1);
    const quats = Object.fromEntries(names.map((n) => [n, new Float32Array((frames + 1) * 4)]));
    const hips = new Float32Array((frames + 1) * 3);
    for (let f = 0; f <= frames; f++) {
      const t = (f / frames) * duration;
      times[f] = t;
      // последний кадр зацикленного клипа совпадает с первым
      pose(rig, motion, MOTIONS[motion].loop && f === frames ? 0 : t, kind);
      for (const n of names) rig.bones[n].quaternion.toArray(quats[n], f * 4);
      rig.bones.Hips.position.toArray(hips, f * 3);
    }
    const tracks = names.map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, quats[n]));
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hips));
    return new THREE.AnimationClip(clipName, duration, tracks);
  });
  rig.attach(null);
  rig.reset();
  return clips;
}

/* ------------------------------------------------------------------ */
/* Управление в просмотрщике                                           */
/* ------------------------------------------------------------------ */

/**
 * Выбор оружия и движения; поза пересчитывается каждый кадр, поэтому
 * руки подстраиваются под любое оружие, а при перезарядке двигается магазин.
 */
export function createSoldierController(root, weapons) {
  const rig = new Rig(root);
  const state = { motion: 'idle', time: 0 };
  let bandage = null;
  return {
    rig,
    get time() {
      return state.time;
    },
    set time(value) {
      state.time = value;
    },
    setWeapon(id) {
      rig.attach(id === 'none' ? null : weapons[id]());
      this.update(0);
    },
    setMotion(motion) {
      state.motion = motion;
      state.time = 0;
      this.update(0);
    },
    update(dt) {
      state.time += dt;
      const tpose = state.motion === 'tpose';
      if (rig.weapon) rig.weapon.visible = !tpose;
      const wantsBandage = !tpose && MOTIONS[state.motion]?.item === 'bandage';
      if (wantsBandage && !bandage) {
        bandage = createBandage();
        bandage.getObjectByName('tail').visible = false;
        rig.attachLeft(bandage);
      } else if (!wantsBandage && bandage) {
        rig.attachLeft(null);
        bandage = null;
      }
      if (tpose) {
        rig.reset();
        return;
      }
      const kind = weaponKind(rig.weapon);
      const motion = MOTIONS[state.motion];
      const duration = motionDuration(state.motion, kind);
      // одноразовые движения повторяем с паузой, чтобы их было видно
      const t = motion.loop ? state.time : state.time % (duration + 0.8);
      pose(rig, state.motion, t, kind);
      updateWeaponParts(rig, state.motion, t);
    },
  };
}
