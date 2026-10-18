import * as THREE from 'three';
import { defineMaterial } from '../materials.js';
import { anchor } from '../kit.js';
import { FACTIONS } from './factions.js';
import { BONES, createBones } from './skeleton.js';
import { buildBody } from './body.js';
import { bakeClips } from './animation.js';

/** Узел-гнездо с поворотом, заданным осями базиса (в системе кости). */
function socket(name, position, xAxis, yAxis, zAxis) {
  const node = anchor(name, position);
  node.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...xAxis),
    new THREE.Vector3(...yAxis),
    new THREE.Vector3(...zAxis),
  ));
  return node;
}

/**
 * Боец выбранной фракции: один SkinnedMesh на скелете из 21 кости.
 *
 * Гнёзда (пустые узлы на костях):
 *   socket_weapon_r — в правой кисти; совместите с ним узел grip_r оружия;
 *   socket_weapon_l — в левой кисти; для подгонки под grip_l (IK);
 *   eyes            — точка между глаз, для камеры от первого лица.
 */
export function createSoldier(factionId) {
  const faction = FACTIONS[factionId];
  for (const [key, spec] of Object.entries(faction.colors)) defineMaterial(`${faction.id}_${key}`, spec);

  const { geometry, materials } = buildBody(faction).buildGeometry();
  const root = new THREE.Group();
  root.name = `soldier_${faction.id}`;

  const bones = createBones();
  root.add(bones.Hips);
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.name = `soldier_${faction.id}_body`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // габариты меняются при анимации
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONES.map(([name]) => bones[name])));

  bones.RightHand.add(socket('socket_weapon_r', [-0.06, -0.032, 0], [0, -1, 0], [0, 0, 1], [-1, 0, 0]));
  bones.LeftHand.add(socket('socket_weapon_l', [0.06, -0.032, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1]));
  bones.Head.add(anchor('eyes', [0, 0.092, 0.09]));

  root.userData = { kind: 'soldier', faction: faction.id, factionName: faction.name, team: faction.team, bones: BONES.length };
  root.animations = bakeClips(root);
  return root;
}
