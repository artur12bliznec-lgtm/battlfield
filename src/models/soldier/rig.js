import * as THREE from 'three';
import { DEG } from '../kit.js';

/*
 * Скелет бойца как «кукла» для поз: прямая кинематика (повороты костей)
 * и двухзвенная инверсная кинематика для рук и ног.
 *
 * «Система корня» — локальные координаты бойца: подошвы на y = 0,
 * лицо смотрит в +Z, левый бок — +X.
 */

export const UPPER_ARM = 0.285;
export const FOREARM = 0.255;
export const THIGH = 0.42;
export const SHIN = 0.42;

const ANKLE = 0.09;
const BALL = new THREE.Vector3(0, -ANKLE, 0.125); // подушечка стопы относительно лодыжки
const HEEL = new THREE.Vector3(0, -ANKLE, -0.062);
const ONE = new THREE.Vector3(1, 1, 1);
const basis = new THREE.Matrix4();

export const localMatrix = (node) => new THREE.Matrix4().compose(node.position, node.quaternion, node.scale);

export function euler(x = 0, y = 0, z = 0, order = 'YXZ') {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, order));
}

/** Поворот руки: ось кости (±X в T-позе) — вдоль dir, ось Y кости — к нормали плоскости сгиба. */
function armBasis(dir, normal, sign) {
  const x = dir.clone().normalize().multiplyScalar(sign);
  const y = normal.clone().multiplyScalar(sign);
  y.addScaledVector(x, -y.dot(x)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(x, y, x.clone().cross(y)));
}

/** Поворот ноги: кость смотрит вниз (−Y) вдоль dir, перёд (+Z) — к колену. */
function legBasis(dir, front) {
  const y = dir.clone().normalize().negate();
  const z = front.clone().addScaledVector(y, -front.dot(y)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(y.clone().cross(z), y, z));
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
    this.item = null; // предмет в левой руке (бинт)
  }

  /** Вернуть T-позу. */
  reset() {
    for (const [name, bone] of Object.entries(this.bones)) {
      bone.position.copy(this.rest[name]);
      bone.quaternion.identity();
    }
    this.root.updateMatrixWorld(true);
  }

  rootQuaternion() {
    return this.root.getWorldQuaternion(new THREE.Quaternion());
  }

  /** Точка из системы корня в мировую. */
  world(x, y, z) {
    return this.root.localToWorld(new THREE.Vector3(x, y, z));
  }

  /** Локальный поворот кости в градусах относительно T-позы. */
  rotate(name, x = 0, y = 0, z = 0, order = 'XYZ') {
    this.bones[name].quaternion.copy(euler(x, y, z, order));
  }

  setWorldQuaternion(bone, q) {
    bone.parent.updateWorldMatrix(true, false);
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(q));
    bone.updateMatrixWorld(true);
  }

  /** Таз: сдвиг от позы покоя (система корня) и наклоны корпуса в градусах. */
  body({ hips = [0, 0, 0], hipsRot = [0, 0, 0], spine = [0, 0, 0], chest = [0, 0, 0] }) {
    this.bones.Hips.position.copy(this.rest.Hips).add(new THREE.Vector3(...hips));
    this.rotate('Hips', ...hipsRot, 'YXZ');
    this.rotate('Spine', ...spine, 'YXZ');
    this.rotate('Chest', ...chest, 'YXZ');
    this.root.updateMatrixWorld(true);
  }

  /**
   * Двухзвенная IK руки: запястье — в точку wrist (мир), локоть — в сторону pole,
   * кисть — в мировой поворот handQ.
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
    this.setWorldQuaternion(arm, armBasis(elbow.clone().sub(S), normal, sign));
    this.setWorldQuaternion(fore, armBasis(end.sub(elbow), normal, sign));
    if (handQ) this.setWorldQuaternion(this.bones[`${side}Hand`], handQ);
  }

  /** Двухзвенная IK ноги: лодыжка — в ankle (мир), колено смотрит в kneeDir, стопа — в footQ. */
  solveLeg(side, ankle, kneeDir, footQ) {
    const up = this.bones[`${side}UpLeg`];
    const leg = this.bones[`${side}Leg`];
    up.updateWorldMatrix(true, false);
    const H = up.getWorldPosition(new THREE.Vector3());
    const toAnkle = ankle.clone().sub(H);
    const d = THREE.MathUtils.clamp(toAnkle.length(), 0.1, THIGH + SHIN - 1e-4);
    const u = toAnkle.normalize();
    const pv = kneeDir.clone().addScaledVector(u, -kneeDir.dot(u)).normalize();
    const cosA = THREE.MathUtils.clamp((THIGH ** 2 + d * d - SHIN ** 2) / (2 * THIGH * d), -1, 1);
    const knee = H.clone().addScaledVector(u, THIGH * cosA).addScaledVector(pv, THIGH * Math.sqrt(1 - cosA * cosA));
    const end = H.clone().addScaledVector(u, d);
    this.setWorldQuaternion(up, legBasis(knee.clone().sub(H), pv));
    this.setWorldQuaternion(leg, legBasis(end.sub(knee), pv));
    if (footQ) this.setWorldQuaternion(this.bones[`${side}Foot`], footQ);
  }

  /**
   * Поставить стопу (система корня): x, z — проекция лодыжки на землю, lift —
   * подъём над землёй, pitch > 0 — пятка оторвана (стопа катится через носок),
   * pitch < 0 — носок поднят (опора на пятку), yaw/roll — разворот и крен стопы.
   * knee — направление колена в системе корня.
   */
  placeFoot(side, { x, z, lift = 0, pitch = 0, yaw = 0, roll = 0 }, knee = [0, 0, 1]) {
    const rootQ = this.rootQuaternion();
    const footQ = rootQ.clone().multiply(euler(pitch, yaw, roll));
    const pivot = (pitch >= 0 ? BALL : HEEL).clone();
    const flat = pivot.clone().applyQuaternion(euler(0, yaw, 0));
    const ground = this.world(x + flat.x, lift, z + flat.z);
    const ankle = ground.sub(pivot.applyQuaternion(footQ));
    this.solveLeg(side, ankle, new THREE.Vector3(...knee).normalize().applyQuaternion(rootQ), footQ);
  }

  /** Рука без оружия (прямая кинематика): swing — мах вперёд/назад, bend — сгиб локтя. */
  freeArm(side, { swing = 0, spread = 76, bend = 15, twist = 0 } = {}) {
    const s = side === 'Left' ? 1 : -1;
    this.rotate(`${side}Arm`, s * swing, twist, -s * spread);
    this.rotate(`${side}ForeArm`, 0, -s * bend, 0);
    this.rotate(`${side}Hand`, 0, 0, 0);
  }

  /** Вложить оружие в правую руку: узел grip_r оружия совпадает с socket_weapon_r. */
  attach(weapon) {
    if (this.weapon) this.socketR.remove(this.weapon);
    this.weapon = weapon;
    if (!weapon) return;
    localMatrix(weapon.getObjectByName('grip_r')).invert().decompose(weapon.position, weapon.quaternion, weapon.scale);
    this.socketR.add(weapon);
  }

  /** Предмет в левую руку (бинт): его узел grip_r — в socket_weapon_l. */
  attachLeft(item) {
    if (this.item) this.socketL.remove(this.item);
    this.item = item;
    if (!item) return;
    localMatrix(item.getObjectByName('grip_r')).invert().decompose(item.position, item.quaternion, item.scale);
    this.socketL.add(item);
  }

  /** Мировая матрица точки крепления оружия, если корень оружия стоит в weaponMatrix. */
  weaponPoint(weaponMatrix, name) {
    return weaponMatrix.clone().multiply(localMatrix(this.weapon.getObjectByName(name)));
  }

  /**
   * Руки берут оружие так, чтобы оно оказалось в мировой позе weaponMatrix.
   * left: не задано — левая рука на grip_l; Matrix4 — где должен быть её
   * кулак (в системе оружия); 'free' — левая рука опущена.
   */
  holdAt(weaponMatrix, poleR, poleL, left) {
    const hand = this.weaponPoint(weaponMatrix, 'grip_r').multiply(localMatrix(this.socketR).invert());
    this.solveArm('Right', new THREE.Vector3().setFromMatrixPosition(hand), poleR, new THREE.Quaternion().setFromRotationMatrix(hand));
    this.root.updateMatrixWorld(true);
    if (left === 'free') {
      this.freeArm('Left');
      return;
    }
    const fist = left
      ? this.weapon.matrixWorld.clone().multiply(left)
      : this.weapon.getObjectByName('grip_l').matrixWorld.clone();
    this.leftHandAt(fist, poleL);
  }

  /** Левая рука: кулак (гнездо socket_weapon_l) — в мировую матрицу fist. */
  leftHandAt(fist, pole) {
    const hand = fist.clone().multiply(localMatrix(this.socketL).invert());
    this.solveArm('Left', new THREE.Vector3().setFromMatrixPosition(hand), pole, new THREE.Quaternion().setFromRotationMatrix(hand));
  }

  /** Поставить стопы на землю: сдвинуть таз так, чтобы нижняя точка стоп была на y = 0. */
  groundFeet() {
    this.root.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const side of ['Left', 'Right']) {
      const foot = this.bones[`${side}Foot`];
      for (const p of [HEEL, BALL]) lowest = Math.min(lowest, foot.localToWorld(p.clone()).y);
    }
    const rootY = this.root.getWorldPosition(new THREE.Vector3()).y;
    this.bones.Hips.position.y -= lowest - rootY;
    this.root.updateMatrixWorld(true);
  }

  /** Направить взгляд вдоль +Z корня (наклон pitch, поворот yaw, крен roll). Шея берёт часть поворота. */
  lookForward(pitch = 0, roll = 0, yaw = 0, neckShare = 0.4) {
    const target = this.rootQuaternion().multiply(euler(pitch, yaw, roll));
    const neck = this.bones.Neck;
    const chestQ = neck.parent.getWorldQuaternion(new THREE.Quaternion());
    neck.quaternion.identity().slerp(chestQ.invert().multiply(target), neckShare);
    neck.updateMatrixWorld(true);
    this.setWorldQuaternion(this.bones.Head, target);
  }

  /** Мировая точка из системы кости. */
  boneWorld(name, x, y, z) {
    return this.bones[name].localToWorld(new THREE.Vector3(x, y, z));
  }

  /** Мировая матрица: позиция в системе кости Chest + поворот (градусы) относительно корня. */
  chestFrame(position, rotation) {
    return new THREE.Matrix4().compose(this.boneWorld('Chest', ...position), this.rootQuaternion().multiply(euler(...rotation)), ONE);
  }
}
