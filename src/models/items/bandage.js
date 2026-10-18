import * as THREE from 'three';
import { Parts, lathe, ribbon, anchor } from '../kit.js';

/**
 * Бинт: скатанный рулон марли с размотанным «хвостом».
 * Ось рулона — X, хвост тянется вперёд (+Z) по земле.
 * Начало координат — на земле под рулоном (удобно для подбираемого предмета).
 */
export function createBandage() {
  const p = new Parts();
  const R = 0.032; // радиус рулона
  const W = 0.075; // ширина бинта
  const T = 0.0016; // толщина слоя марли
  const cy = R + T; // ось рулона: рулон лежит на собственном хвосте

  // рулон — тело вращения со скруглёнными краями и маленьким отверстием в центре
  p.add(lathe([
    [0.008, -W / 2], [R - 0.004, -W / 2], [R - 0.001, -W / 2 + 0.0015], [R, -W / 2 + 0.004],
    [R, W / 2 - 0.004], [R - 0.001, W / 2 - 0.0015], [R - 0.004, W / 2], [0.008, W / 2], [0.008, -W / 2 + 0.0001],
  ], 28, 'x').translate(0, cy, 0), 'gauze', { crease: 60 });

  // витки на торцах — тонкая спираль
  for (const side of [-1, 1]) {
    const points = [];
    const turns = 4.5;
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const angle = t * turns * Math.PI * 2 * side;
      const r = 0.0105 + (R - 0.0065 - 0.0105) * t;
      points.push([side * (W / 2), cy + Math.sin(angle) * r, Math.cos(angle) * r]);
    }
    p.add(ribbon(points, 0.0014, 0.0011), 'gauzeShade', { crease: 60 });
  }

  // хвост: огибает рулон снизу и ложится на землю небольшой волной
  const tail = [];
  const rr = R + T / 2;
  for (let a = -70; a <= 0; a += 10) {
    const phi = THREE.MathUtils.degToRad(a);
    tail.push([0, cy - rr * Math.cos(phi), rr * Math.sin(phi)]);
  }
  const ground = [[0.012, 0], [0.03, 0], [0.05, 0.0004], [0.068, 0.0035], [0.084, 0.0062], [0.1, 0.0045], [0.116, 0.001], [0.135, 0], [0.155, 0], [0.17, 0.0002]];
  for (const [z, lift] of ground) tail.push([0, T / 2 + lift, z]);
  // хвост — отдельный узел: когда бинт в руке, его можно скрыть
  const tailParts = new Parts();
  tailParts.add(ribbon(tail, W - 0.004, T), 'gauze', { crease: 50 });

  const root = new THREE.Group();
  root.name = 'bandage';
  root.add(p.build('bandage_body'));
  root.add(tailParts.build('tail'));
  root.add(anchor('grip_r', [0, cy, 0]));
  root.userData = { kind: 'item', id: 'bandage', heal: 25 };
  return root;
}
