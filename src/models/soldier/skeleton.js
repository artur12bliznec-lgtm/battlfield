import * as THREE from 'three';

/**
 * Скелет бойца в T-позе (руки в стороны, ладони вниз, лицо смотрит в +Z).
 *
 * Имена костей — как у Mixamo (без префикса «mixamorig:»): их узнают
 * авто-маппинг Humanoid в Unity и ретаргетинг в Godot / Unreal / Blender.
 * Позиции — мировые координаты в позе привязки, метры; рост бойца ~1,8 м.
 */
export const BONES = [
  ['Hips', null, [0, 0.98, 0]],
  ['Spine', 'Hips', [0, 1.08, 0]],
  ['Chest', 'Spine', [0, 1.26, 0]],
  ['Neck', 'Chest', [0, 1.5, -0.01]],
  ['Head', 'Neck', [0, 1.6, 0]],

  ['LeftShoulder', 'Chest', [0.05, 1.45, -0.015]],
  ['LeftArm', 'LeftShoulder', [0.19, 1.44, -0.02]],
  ['LeftForeArm', 'LeftArm', [0.475, 1.44, -0.02]],
  ['LeftHand', 'LeftForeArm', [0.73, 1.44, -0.02]],

  ['RightShoulder', 'Chest', [-0.05, 1.45, -0.015]],
  ['RightArm', 'RightShoulder', [-0.19, 1.44, -0.02]],
  ['RightForeArm', 'RightArm', [-0.475, 1.44, -0.02]],
  ['RightHand', 'RightForeArm', [-0.73, 1.44, -0.02]],

  ['LeftUpLeg', 'Hips', [0.095, 0.93, 0]],
  ['LeftLeg', 'LeftUpLeg', [0.095, 0.51, 0]],
  ['LeftFoot', 'LeftLeg', [0.095, 0.09, 0]],
  ['LeftToeBase', 'LeftFoot', [0.095, 0.025, 0.13]],

  ['RightUpLeg', 'Hips', [-0.095, 0.93, 0]],
  ['RightLeg', 'RightUpLeg', [-0.095, 0.51, 0]],
  ['RightFoot', 'RightLeg', [-0.095, 0.09, 0]],
  ['RightToeBase', 'RightFoot', [-0.095, 0.025, 0.13]],
];

export const BONE_INDEX = Object.fromEntries(BONES.map(([name], i) => [name, i]));

/** Мировая позиция кости в позе привязки. */
export function bindPosition(name) {
  return new THREE.Vector3(...BONES[BONE_INDEX[name]][2]);
}

/** Создаёт кости (без поворотов — T-поза) и возвращает { имя: Bone }. */
export function createBones() {
  const bones = {};
  for (const [name, parent, position] of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(position);
    if (parent) {
      bone.position.sub(bindPosition(parent));
      bones[parent].add(bone);
    }
    bones[name] = bone;
  }
  return bones;
}

/**
 * Веса для детали, которая тянется через несколько суставов (рука, нога,
 * торс). links — [кость, [координата сустава, полуширина перехода], кость, ...]
 * вдоль оси axis; dir = 1, если координата растёт от первой кости к последней.
 */
export function chain(axis, dir, links) {
  const k = { x: 0, y: 1, z: 2 }[axis];
  const bones = links.filter((_, i) => i % 2 === 0).map((name) => BONE_INDEX[name]);
  const joints = links.filter((_, i) => i % 2 === 1);
  return (x, y, z) => {
    const v = dir * [x, y, z][k];
    for (let j = 0; j < joints.length; j++) {
      const [at, width] = joints[j];
      const c = dir * at;
      if (v < c + width) {
        const t = THREE.MathUtils.smoothstep(v, c - width, c + width);
        return t <= 0 ? [[bones[j], 1]] : [[bones[j], 1 - t], [bones[j + 1], t]];
      }
    }
    return [[bones[bones.length - 1], 1]];
  };
}
