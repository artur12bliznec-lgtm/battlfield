import * as THREE from 'three';
import { createSoldier } from './soldier/soldier.js';
import { Rig } from './soldier/rig.js';
import { pose } from './soldier/animation.js';
import { createAssaultRifle } from './weapons/assaultRifle.js';
import { createRifle } from './weapons/rifle.js';
import { createSniperRifle } from './weapons/sniperRifle.js';
import { createMachineGun } from './weapons/machineGun.js';
import { createPistol } from './weapons/pistol.js';
import { createBandage } from './items/bandage.js';

const animators = new WeakMap();

/**
 * Обзорная сцена: бойцы обеих сторон с оружием в руках, между ними —
 * стойка со всем оружием, у ног — бинт. Только для просмотра, в .glb не выгружается.
 */
export function createLineup() {
  const scene = new THREE.Group();
  scene.name = 'lineup';

  const soldiers = [
    { faction: 'alliance', x: -1.05, turn: -0.45, weapon: createAssaultRifle, motion: 'aim', t: 0.6 },
    { faction: 'coalition', x: 1.05, turn: 0.55, weapon: createMachineGun, motion: 'aim', t: 1.7 },
  ].map((spec) => {
    const soldier = createSoldier(spec.faction, { animations: false });
    soldier.position.x = spec.x;
    soldier.rotation.y = spec.turn;
    scene.add(soldier);
    const rig = new Rig(soldier);
    rig.attach(spec.weapon());
    return { ...spec, rig };
  });

  // стойка с оружием: стволом вправо, видна правая сторона
  const rack = [
    [createSniperRifle, 1.62],
    [createMachineGun, 1.3],
    [createRifle, 1.0],
    [createAssaultRifle, 0.72],
    [createPistol, 0.46],
  ];
  for (const [create, y] of rack) {
    const weapon = create();
    weapon.rotation.y = Math.PI / 2;
    weapon.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(weapon).getCenter(new THREE.Vector3());
    weapon.position.set(-center.x, y - center.y, -0.15 - center.z);
    scene.add(weapon);
  }

  const bandage = createBandage();
  bandage.position.set(0.05, 0, 0.45);
  bandage.rotation.y = -0.6;
  scene.add(bandage);

  scene.userData = { kind: 'scene', models: 8 };
  scene.updateMatrixWorld(true);
  const update = (time) => {
    for (const s of soldiers) pose(s.rig, s.motion, s.t + time);
  };
  update(0);
  animators.set(scene, update);
  return scene;
}

/** Бойцы в обзорной сцене дышат и чуть покачивают оружием. */
export function createLineupController(scene) {
  const update = animators.get(scene);
  return {
    time: 0,
    update(dt) {
      this.time += dt;
      update(this.time);
    },
  };
}
