import * as THREE from 'three';
import { anchor } from '../kit.js';
import { LONG_GUN, PISTOL, weaponClips } from './handling.js';

/**
 * Собирает оружие из деталей и расставляет точки крепления.
 *
 * Детали моделируются в удобных «чертёжных» координатах (ось канала ствола
 * на y = 0), а здесь всё сдвигается так, чтобы начало координат оказалось
 * в точке хвата правой рукой — так оружие проще всего вложить в руку бойца.
 *
 * Точки крепления (пустые узлы, сохраняются в .glb):
 *   grip_r — хват правой рукой (ось +Y узла идёт вдоль рукояти);
 *   grip_l — хват левой рукой (цевьё, сошки, рукоять);
 *   sight  — положение глаза при прицеливании;
 *   muzzle — дульный срез (вспышка, вылет пули);
 *   stock  — точка упора приклада в плечо;
 *   eject  — окно выброса гильз.
 *
 * @param {object} spec
 * @param {string} spec.id          — идентификатор (имя корневого узла)
 * @param {'long'|'pistol'} spec.hold — тип хвата: угол рукояти и grip_l берутся из handling.js
 * @param {Parts}  spec.body        — неподвижные детали
 * @param {object} [spec.movable]   — подвижные детали: { имя: { parts, pivot } },
 *                                    pivot — точка вращения/крепления детали
 * @param {number[]} spec.grip      — точка хвата правой рукой [x, y, z]
 * @param {object} spec.points      — остальные точки: { имя: [x, y, z, rx?, ry?, rz?] }
 * @param {object} [spec.info]      — характеристики (попадают в userData / extras glTF)
 * @param {boolean} [spec.bipodFoldsForward] — сошки сложены вперёд (иначе назад)
 */
export function assembleWeapon({ id, hold, body, movable = {}, grip, points, info = {}, bipodFoldsForward = true }) {
  const [gx, gy, gz] = grip;
  const standard = hold === 'pistol' ? PISTOL : LONG_GUN;
  const root = new THREE.Group();
  root.name = id;

  body.translate(-gx, -gy, -gz);
  root.add(body.build(`${id}_body`));

  for (const [name, { parts, pivot }] of Object.entries(movable)) {
    parts.translate(-pivot[0], -pivot[1], -pivot[2]);
    const mesh = parts.build(name);
    mesh.position.set(pivot[0] - gx, pivot[1] - gy, pivot[2] - gz);
    root.add(mesh);
  }

  root.add(anchor('grip_r', [0, 0, 0], [standard.gripAngle, 0, 0]));
  root.add(anchor('grip_l', standard.support));
  for (const [name, [x, y, z, rx = 0, ry = 0, rz = 0]] of Object.entries(points)) {
    root.add(anchor(name, [x - gx, y - gy, z - gz], [rx, ry, rz]));
  }

  root.userData = { kind: 'weapon', id, hold, ...info };
  root.animations = weaponClips(root, { hold, foldedForward: bipodFoldsForward });
  return root;
}
