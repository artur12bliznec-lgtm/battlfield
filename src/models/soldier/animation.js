import * as THREE from 'three';
import { DEG } from '../kit.js';
import { createAssaultRifle } from '../weapons/assaultRifle.js';
import { createPistol } from '../weapons/pistol.js';

/*
 * Позы и анимации бойца.
 *
 * Ноги и корпус двигаются процедурно (синусоиды шага), руки с оружием —
 * через двухзвенную инверсную кинематику: правая кисть держит рукоять
 * (grip_r), левая — цевьё (grip_l). Поэтому одна и та же анимация подходит
 * к любому оружию. Для .glb анимации «запекаются» в ключевые кадры.
 */

const UPPER_ARM = 0.285;
const FOREARM = 0.255;
const ANKLE_HEIGHT = 0.09;
const RIGHT_EYE = new THREE.Vector3(-0.032, 0.092, 0.09); // в системе кости Head
const ONE = new THREE.Vector3(1, 1, 1);

const tmpM = new THREE.Matrix4();

function localMatrix(node) {
  return new THREE.Matrix4().compose(node.position, node.quaternion, ONE);
}

/** Поворот, переводящий ось кости (±X в T-позе) в направление dir; ось Y кости — к нормали плоскости сгиба. */
function limbBasis(dir, normal, sign) {
  const x = dir.clone().normalize().multiplyScalar(sign);
  const y = normal.clone().multiplyScalar(sign);
  y.addScaledVector(x, -y.dot(x)).normalize();
  const z = x.clone().cross(y);
  return new THREE.Quaternion().setFromRotationMatrix(tmpM.makeBasis(x, y, z));
}

export class Rig {
  constructor(root) {
    this.root = root;
    this.bones = {};
    root.traverse((node) => {
      if (node.isBone) this.bones[node.name] = node;
    });
    this.rest = Object.fromEntries(Object.entries(this.bones).map(([name, bone]) => [name, bone.position.clone()]));
    this.socketR = root.getObjectByName('socket_weapon_r');
    this.socketL = root.getObjectByName('socket_weapon_l');
    this.weapon = null;
  }

  /** Вернуть T-позу. */
  reset() {
    for (const [name, bone] of Object.entries(this.bones)) {
      bone.position.copy(this.rest[name]);
      bone.quaternion.identity();
    }
    this.root.updateMatrixWorld(true);
  }

  /** Локальный поворот кости в градусах относительно T-позы. */
  rotate(name, x = 0, y = 0, z = 0, order = 'XYZ') {
    this.bones[name].quaternion.setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, order));
  }

  setWorldQuaternion(bone, q) {
    bone.parent.updateWorldMatrix(true, false);
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(q));
    bone.updateMatrixWorld(true);
  }

  /**
   * Двухзвенная IK: запястье — в точку wrist (мир), локоть — в сторону pole,
   * затем кисть поворачивается в мировой поворот handQ.
   */
  solveArm(side, wrist, pole, handQ) {
    const sign = side === 'Left' ? 1 : -1;
    const arm = this.bones[`${side}Arm`];
    const fore = this.bones[`${side}ForeArm`];
    arm.updateWorldMatrix(true, false);
    const S = arm.getWorldPosition(new THREE.Vector3());
    const toWrist = wrist.clone().sub(S);
    const d = THREE.MathUtils.clamp(toWrist.length(), 0.06, UPPER_ARM + FOREARM - 1e-4);
    const u = toWrist.normalize();
    const pv = pole.clone().sub(S);
    pv.addScaledVector(u, -pv.dot(u)).normalize();
    const cosA = THREE.MathUtils.clamp((UPPER_ARM ** 2 + d * d - FOREARM ** 2) / (2 * UPPER_ARM * d), -1, 1);
    const elbow = S.clone().addScaledVector(u, UPPER_ARM * cosA).addScaledVector(pv, UPPER_ARM * Math.sqrt(1 - cosA * cosA));
    const end = S.clone().addScaledVector(u, d);
    const normal = u.clone().cross(pv).normalize();
    this.setWorldQuaternion(arm, limbBasis(elbow.clone().sub(S), normal, sign));
    this.setWorldQuaternion(fore, limbBasis(end.sub(elbow), normal, sign));
    if (handQ) this.setWorldQuaternion(this.bones[`${side}Hand`], handQ);
  }

  /** Вложить оружие в правую руку: узел grip_r оружия совпадает с socket_weapon_r. */
  attach(weapon) {
    if (this.weapon) this.socketR.remove(this.weapon);
    this.weapon = weapon;
    if (!weapon) return;
    localMatrix(weapon.getObjectByName('grip_r')).invert().decompose(weapon.position, weapon.quaternion, weapon.scale);
    this.socketR.add(weapon);
  }

  /** Мировая матрица точки крепления оружия, если корень оружия стоит в weaponMatrix. */
  weaponPoint(weaponMatrix, name) {
    return weaponMatrix.clone().multiply(localMatrix(this.weapon.getObjectByName(name)));
  }

  /** Руки берут оружие так, чтобы оно оказалось в мировой позе weaponMatrix. */
  holdAt(weaponMatrix, poleR, poleL) {
    const hand = this.weaponPoint(weaponMatrix, 'grip_r').multiply(localMatrix(this.socketR).invert());
    this.solveArm('Right', new THREE.Vector3().setFromMatrixPosition(hand), poleR, new THREE.Quaternion().setFromRotationMatrix(hand));
    this.root.updateMatrixWorld(true);
    const gripL = this.weapon.getObjectByName('grip_l');
    if (!gripL) return;
    const left = gripL.matrixWorld.clone().multiply(localMatrix(this.socketL).invert());
    this.solveArm('Left', new THREE.Vector3().setFromMatrixPosition(left), poleL, new THREE.Quaternion().setFromRotationMatrix(left));
  }

  /** Поставить ступни на землю: сдвинуть таз так, чтобы нижняя точка стоп была на y = 0. */
  groundFeet() {
    this.root.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const side of ['Left', 'Right']) {
      const foot = this.bones[`${side}Foot`];
      for (const p of [[0, -ANKLE_HEIGHT, -0.07], [0, -ANKLE_HEIGHT + 0.005, 0.19]]) {
        lowest = Math.min(lowest, foot.localToWorld(new THREE.Vector3(...p)).y);
      }
    }
    const rootY = this.root.getWorldPosition(new THREE.Vector3()).y;
    this.bones.Hips.position.y -= lowest - rootY;
    this.root.updateMatrixWorld(true);
  }

  /** Повернуть голову так, чтобы взгляд был направлен вдоль +Z корня (с наклоном pitch и креном roll). */
  lookForward(pitch = 0, roll = 0, neckShare = 0.4) {
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const target = rootQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * DEG, 0, roll * DEG, 'YXZ')));
    const neck = this.bones.Neck;
    const chestQ = neck.parent.getWorldQuaternion(new THREE.Quaternion());
    neck.quaternion.identity().slerp(chestQ.clone().invert().multiply(target), neckShare);
    neck.updateMatrixWorld(true);
    this.setWorldQuaternion(this.bones.Head, target);
  }
}

/* ------------------------------------------------------------------ */
/* Корпус и ноги                                                       */
/* ------------------------------------------------------------------ */

function legs(rig, l, r) {
  for (const [side, leg] of [['Left', l], ['Right', r]]) {
    rig.rotate(`${side}UpLeg`, leg.thigh, leg.twist ?? 0, leg.spread ?? 0);
    rig.rotate(`${side}Leg`, leg.knee, 0, 0);
    rig.rotate(`${side}Foot`, -(leg.thigh + leg.knee) + (leg.foot ?? 0), 0, -(leg.spread ?? 0));
  }
}

/** Стойка с дыханием. */
function standBody(rig, t) {
  const breath = Math.sin((t / 3) * Math.PI * 2);
  rig.rotate('Hips', 0, 0, 0);
  rig.rotate('Spine', 2 + breath * 0.6, 0, 0);
  rig.rotate('Chest', 1 + breath * 0.9, 0, 0);
  legs(rig, { thigh: -2, knee: 5, spread: 4 }, { thigh: 1, knee: 4, spread: -4, twist: -6 });
}

/** Стойка для стрельбы из винтовки: корпус развёрнут, левая нога впереди. */
function aimBody(rig, t) {
  const sway = Math.sin((t / 3) * Math.PI * 2);
  rig.rotate('Hips', 0, -28, 0, 'YXZ');
  rig.rotate('Spine', 8, -8 + sway * 0.6, 0, 'YXZ');
  rig.rotate('Chest', 7 + sway * 0.5, -6, 0, 'YXZ');
  rig.rotate('RightShoulder', 0, 12, -10); // плечо поднято и выведено вперёд под приклад
  rig.rotate('LeftShoulder', 0, -8, 0);
  legs(rig, { thigh: -16, knee: 14, spread: 6, twist: 18 }, { thigh: 9, knee: 10, spread: -9, twist: 8 });
}

/** Стойка «равнобедренный треугольник» для пистолета. */
function pistolAimBody(rig, t) {
  const sway = Math.sin((t / 3) * Math.PI * 2);
  rig.rotate('Hips', 0, -6, 0, 'YXZ');
  rig.rotate('Spine', 6, 2 + sway * 0.5, 0, 'YXZ');
  rig.rotate('Chest', 5, 3, 0, 'YXZ');
  legs(rig, { thigh: -10, knee: 12, spread: 7, twist: 6 }, { thigh: 6, knee: 10, spread: -7, twist: -4 });
}

/** Цикл шага: phase — 0..1, g — параметры походки. */
function gaitBody(rig, phase, g) {
  const p = phase * Math.PI * 2;
  rig.rotate('Hips', g.lean * 0.3, -g.hipYaw * Math.sin(p), g.hipRoll * Math.cos(p), 'YXZ');
  rig.rotate('Spine', g.lean * 0.5, g.hipYaw * 0.5 * Math.sin(p), 0, 'YXZ');
  rig.rotate('Chest', g.lean * 0.5 + g.bounce * Math.cos(2 * p), g.hipYaw * 0.6 * Math.sin(p), 0, 'YXZ');
  const leg = (ph) => {
    const swing = Math.max(0, Math.cos(ph));
    return {
      thigh: -g.thigh * Math.sin(ph) - g.lean * 0.3,
      knee: g.kneeBase + g.knee * swing ** 1.5,
      foot: g.toe * Math.max(0, -Math.sin(ph)) * Math.max(0, -Math.cos(ph)) - 8 * swing,
      spread: 2,
    };
  };
  const left = leg(p);
  const right = leg(p + Math.PI);
  right.spread = -2;
  legs(rig, left, right);
}

const WALK = { thigh: 24, knee: 48, kneeBase: 6, toe: 30, lean: 3, hipYaw: 6, hipRoll: 3, bounce: 1, armSwing: 18 };
const RUN = { thigh: 42, knee: 95, kneeBase: 14, toe: 45, lean: 12, hipYaw: 9, hipRoll: 4, bounce: 2, armSwing: 38 };

/** Руки без оружия: висят вдоль тела и качаются при ходьбе. */
function freeArms(rig, swing = 0, bend = 15) {
  rig.rotate('LeftShoulder', 0, 0, 0);
  rig.rotate('RightShoulder', 0, 0, 0);
  rig.rotate('LeftArm', swing, 0, -76);
  rig.rotate('RightArm', -swing, 0, 76);
  rig.rotate('LeftForeArm', 0, -bend - Math.max(0, -swing) * 0.8, 0);
  rig.rotate('RightForeArm', 0, bend + Math.max(0, swing) * 0.8, 0);
  rig.rotate('LeftHand', 0, 0, 0);
  rig.rotate('RightHand', 0, 0, 0);
}

/* ------------------------------------------------------------------ */
/* Положение оружия                                                    */
/* ------------------------------------------------------------------ */

/** Мировая матрица оружия, при которой его узел sight совпадает с правым глазом. */
function aimMatrix(rig, pitch = 0) {
  const eye = rig.bones.Head.localToWorld(RIGHT_EYE.clone());
  const q = rig.root.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * DEG, 0, 0)));
  const sight = rig.weapon.getObjectByName('sight').position.clone().applyQuaternion(q);
  return new THREE.Matrix4().compose(eye.sub(sight), q, ONE);
}

/** Повернуть позу оружия вокруг мировой точки pivot. */
function rotateAbout(matrix, pivot, euler) {
  const axisQ = new THREE.Quaternion().setFromRotationMatrix(matrix);
  const local = new THREE.Quaternion().setFromEuler(euler);
  const r = axisQ.clone().multiply(local).multiply(axisQ.clone().invert()); // поворот в осях оружия
  const t1 = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
  const t0 = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  return t1.multiply(new THREE.Matrix4().makeRotationFromQuaternion(r)).multiply(t0).multiply(matrix);
}

/** Поза оружия в системе кости Chest: точка grip_r в pos, ствол развёрнут на yaw/pitch/roll. */
function chestMatrix(rig, pos, yaw, pitch, roll) {
  const chest = rig.bones.Chest;
  const rootQ = rig.root.getWorldQuaternion(new THREE.Quaternion());
  const q = rootQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * DEG, yaw * DEG, roll * DEG, 'YXZ')));
  const grip = chest.localToWorld(new THREE.Vector3(...pos));
  const gripLocal = localMatrix(rig.weapon.getObjectByName('grip_r'));
  return new THREE.Matrix4().compose(grip, q, ONE).multiply(gripLocal.invert());
}

function holdWeapon(rig, mode, kind, t) {
  const chest = rig.bones.Chest;
  const pole = (side, x, y, z) => rig.bones[`${side}Arm`].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(x, y, z).applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion())));
  let matrix;
  if (kind === 'pistol') {
    if (mode === 'aim') matrix = aimMatrix(rig, 0);
    else matrix = chestMatrix(rig, [-0.03, -0.1, 0.34], 6, 28 + Math.sin(t * 2.1) * 1.5, 0);
    rig.holdAt(matrix, pole('Right', -0.35, -0.55, -0.1), pole('Left', 0.35, -0.55, -0.1));
    return;
  }
  if (mode === 'aim') {
    matrix = aimMatrix(rig, 0);
  } else if (mode === 'ready') {
    const aim = aimMatrix(rig, 0);
    const stock = rig.weaponPoint(aim, 'stock');
    const pivot = new THREE.Vector3().setFromMatrixPosition(stock);
    matrix = rotateAbout(aim, pivot, new THREE.Euler((32 + Math.sin(t * 2.1) * 1.2) * DEG, 14 * DEG, 0, 'YXZ'));
  } else {
    matrix = chestMatrix(rig, [-0.12, -0.13, 0.22], 42, 22, -24);
  }
  rig.holdAt(matrix, pole('Right', -0.6, -0.42, -0.2), pole('Left', 0.12, -0.7, 0.05));
}

/* ------------------------------------------------------------------ */
/* Клипы                                                               */
/* ------------------------------------------------------------------ */

export const MOTIONS = {
  idle: { label: 'Стойка', duration: 3 },
  aim: { label: 'Прицеливание', duration: 3 },
  walk: { label: 'Ходьба', duration: 1.1 },
  run: { label: 'Бег', duration: 0.7 },
};

/**
 * Поставить позу: motion — 'idle' | 'aim' | 'walk' | 'run',
 * kind — 'none' | 'rifle' | 'pistol' (что в руках), t — время в секундах.
 */
export function pose(rig, motion, kind, t) {
  rig.reset();
  const { duration } = MOTIONS[motion];
  const phase = (t % duration) / duration;
  const armed = kind !== 'none' && rig.weapon;
  const gait = motion === 'walk' ? WALK : motion === 'run' ? RUN : null;

  if (gait) gaitBody(rig, phase, gait);
  else if (motion === 'aim' && armed) (kind === 'pistol' ? pistolAimBody : aimBody)(rig, t);
  else standBody(rig, t);

  if (!armed) {
    freeArms(rig, gait ? gait.armSwing * Math.sin(phase * Math.PI * 2) : 0, gait === RUN ? 70 : 15);
  }
  rig.groundFeet();
  const cheekWeld = motion === 'aim' && kind === 'rifle';
  rig.lookForward(gait ? 4 : cheekWeld ? 9 : 0, cheekWeld ? 10 : 0);
  if (armed) {
    const mode = motion === 'aim' ? 'aim' : motion === 'run' && kind === 'rifle' ? 'carry' : 'ready';
    holdWeapon(rig, mode, kind, t);
  }
  rig.root.updateMatrixWorld(true);
}

/** Какой «класс» хвата у оружия. */
export function weaponKind(weapon) {
  if (!weapon) return 'none';
  return weapon.userData.id === 'pistol' ? 'pistol' : 'rifle';
}

/** Запечь анимации в ключевые кадры (30 к/с) для экспорта в .glb. */
export function bakeClips(root) {
  const rig = new Rig(root);
  const fps = 30;
  const plan = [
    ['Idle', 'idle', null],
    ['Walk', 'walk', null],
    ['Run', 'run', null],
    ['Rifle_Idle', 'idle', createAssaultRifle],
    ['Rifle_Aim', 'aim', createAssaultRifle],
    ['Rifle_Walk', 'walk', createAssaultRifle],
    ['Rifle_Run', 'run', createAssaultRifle],
    ['Pistol_Idle', 'idle', createPistol],
    ['Pistol_Aim', 'aim', createPistol],
    ['Pistol_Walk', 'walk', createPistol],
  ];
  const names = Object.keys(rig.bones);
  const weapons = new Map(); // одно оружие на все клипы с ним
  const clips = plan.map(([clipName, motion, createWeapon]) => {
    if (createWeapon && !weapons.has(createWeapon)) weapons.set(createWeapon, createWeapon());
    rig.attach(createWeapon ? weapons.get(createWeapon) : null);
    const kind = weaponKind(rig.weapon);
    const { duration } = MOTIONS[motion];
    const frames = Math.round(duration * fps);
    const times = new Float32Array(frames + 1);
    const quats = Object.fromEntries(names.map((n) => [n, new Float32Array((frames + 1) * 4)]));
    const hips = new Float32Array((frames + 1) * 3);
    for (let f = 0; f <= frames; f++) {
      const t = (f / frames) * duration;
      times[f] = t;
      pose(rig, motion, kind, t);
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

/**
 * Управление позой бойца в просмотрщике: выбор оружия и движения,
 * поза пересчитывается каждый кадр (IK подстраивается под любое оружие).
 */
export function createSoldierController(root, weapons) {
  const rig = new Rig(root);
  const state = { motion: 'idle', time: 0, weaponId: 'none' };
  return {
    rig,
    get time() {
      return state.time;
    },
    set time(value) {
      state.time = value;
    },
    setWeapon(id) {
      state.weaponId = id;
      rig.attach(id === 'none' ? null : weapons[id]());
      this.update(0);
    },
    setMotion(motion) {
      state.motion = motion;
      this.update(0);
    },
    update(dt) {
      state.time += dt;
      if (rig.weapon) rig.weapon.visible = state.motion !== 'tpose';
      if (state.motion === 'tpose') rig.reset();
      else pose(rig, state.motion, weaponKind(rig.weapon), state.time);
    },
  };
}
