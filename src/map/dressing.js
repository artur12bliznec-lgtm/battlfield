import * as P from './props.js';
import { createGarages } from './landmarks.js';
import { MODE, ROADS, SIDEWALK, EXTENT, PLAZA, onRoad } from './layout.js';
import { CAR_PAINTS } from './materials.js';
import { random } from '../models/textures.js';

/*
 * Обстановка города: фонари, деревья, машины у тротуаров, остановки,
 * баррикады защитников вокруг точки, завалы и воронки на подходах,
 * дворы (гаражи, грузовики защитников, рынок, завод, парк, заправка).
 */

const DEG = Math.PI / 180;
const rnd = random(4242);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const spawnPoints = [...MODE.defenders, ...Object.values(MODE.attackers).flat()];
const nearSpawn = (x, z, r = 4) => spawnPoints.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < r);
const inPlaza = (x, z) => x > PLAZA[0] && x < PLAZA[2] && z > PLAZA[1] && z < PLAZA[3];

/** Случайная машина: седан, хэтчбек или «буханка»; burnt — доля сгоревших. */
function randomCar(burnt = 0.3) {
  const b = rnd() < burnt;
  const t = rnd();
  if (t < 0.15) return P.van(pick(['carGreen', 'carBeige', 'carWhite']), b);
  return P.car(t < 0.6 ? 'sedan' : 'hatch', pick(CAR_PAINTS), b);
}

/** Пересекает ли точка (вдоль дороги r, координата a) другую дорогу — с запасом m. */
function nearCrossing(r, a, m) {
  return ROADS.some((o) => o !== r && o.axis !== r.axis && Math.abs(a - o.c) < o.half + m && r.c >= o.from && r.c <= o.to);
}

/* ------------------------------------------------------------------ */

function plaza(w) {
  const { x, z } = MODE.capture;
  w.place(P.monument(), x, z, 0);
  w.place(P.flagpole(11), x, z - 6.5, 0);
  for (const sx of [-1, 1]) {
    for (const [px, pz] of [[11, -10], [11, 10], [24, -18], [24, 17]]) w.place(P.plazaLamp(), sx * px, pz, 0);
    w.place(P.tree(sx < 0 ? 1 : 4), sx * 19, 19, rnd() * 6);
    w.place(P.tree(sx < 0 ? 5 : 2), sx * 19, -18.5, rnd() * 6);
    w.place(P.bench(), sx * 7, 13, Math.PI);
    w.place(P.bin(), sx * 9, 13.4, 0);
    w.place(P.bench(), sx * 15, -12, 0);
  }
  w.place(P.kiosk('ТАБАК', 'plasterBlue'), -23, 20, 90 * DEG);
  w.place(P.kiosk('ЦВЕТЫ', 'plasterRose'), 23, 20.5, -90 * DEG);
  w.place(P.adColumn(), -15, 20.5, 0);

  // кольцо мешков с песком вокруг памятника: четыре дуги по диагоналям
  for (let k = 0; k < 4; k++) {
    const centre = (45 + k * 90) * DEG;
    for (const off of [-19, 0, 19]) {
      const t = centre + off * DEG;
      w.place(P.sandbags(2.4, 6, k * 3 + off), x + Math.cos(t) * 8, z + Math.sin(t) * 8, -t - Math.PI / 2);
    }
  }
  // припасы защитников у флага
  w.place(P.crate('ammo'), 2.6, -4.2, 0.2);
  w.place(P.crate('ammo'), 2.7, -3.6, -0.1, { y: SIDEWALK + 0.35 });
  w.place(P.crate(), -3.2, -4.4, 0.1);
  w.place(P.barrel('barrelBlue'), 4.4, -3.1);
  // следы боя на площади
  w.place(P.crater(2.1, 3), 13, -8, 0, { solid: false });
  w.place(P.crater(1.6, 4), -14, 11, 0, { solid: false });
  w.place(P.car('sedan', 'carWhite', true), 17, 10, 28 * DEG);
  w.place(P.car('hatch', 'carRed', true), -17.5, -10.5, 118 * DEG);
  w.place(P.rubble(11, 1.6, 0.8), -22, -21, 0);
  w.place(P.rubble(12, 1.4, 0.7), 24, -22, 0);
}

/** Баррикады на въездах на площадь и линии укрытий на подступах. */
function barricades(w) {
  // юг: проспект
  w.place(P.bus('carYellow', true), -1, 33, 72 * DEG);
  w.place(P.jersey(), 5.2, 27.5, 8 * DEG);
  w.place(P.jersey(), -4.6, 26.4, -6 * DEG);
  w.place(P.hedgehog(), 3, 39, 20 * DEG);
  w.place(P.hedgehog(), 6, 42, 60 * DEG);
  w.place(P.hedgehog(), -5, 40.5, 10 * DEG);
  // запад: улица Садовая
  w.place(P.block(), -32, -3.3, 5 * DEG);
  w.place(P.block(), -32.4, 0.2, -8 * DEG);
  w.place(P.block(), -33.6, 3.6, 12 * DEG);
  w.place(P.hedgehog(), -38.5, -2, 0);
  w.place(P.hedgehog(), -40.5, 2.6, 40 * DEG);
  w.place(P.car('sedan', 'carBlue', true), -45, 0.6, 115 * DEG);
  // восток: улица Рыночная
  w.place(P.jersey(), 33, -2.6, 90 * DEG);
  w.place(P.jersey(), 34.6, 2.6, 102 * DEG);
  w.place(P.sandbags(3, 6, 21), 31.3, 0.2, 90 * DEG);
  w.place(P.hedgehog(), 40, 3, 30 * DEG);
  w.place(P.van('carBeige', true), 44, -2.2, 80 * DEG);
  // север: переулки у ратуши
  w.place(P.hedgehog(), -27, -29, 15 * DEG);
  w.place(P.hedgehog(), 27, -30, -20 * DEG);
  w.place(P.van('carGreen', true), -26.4, -37, 12 * DEG);
  w.place(P.sandbags(3, 6, 31), -22.6, -23.4, 0);
  w.place(P.sandbags(3, 6, 32), 22.6, -23.4, 0);

  // вторая линия: укрытия посреди улиц
  w.place(P.jersey(), -4.6, 57, 0);
  w.place(P.jersey(), -0.4, 60, 6 * DEG);
  w.place(P.jersey(), 4.4, 57.6, -8 * DEG);
  w.place(P.hedgehog(), -64, -3, 0);
  w.place(P.hedgehog(), -66.5, 0.6, 35 * DEG);
  w.place(P.hedgehog(), -63, 3.6, 70 * DEG);
  w.place(P.block(), 64, -3, 0);
  w.place(P.block(), 66.5, 0, 20 * DEG);
  w.place(P.block(), 63, 3.2, -15 * DEG);
  w.place(P.car('sedan', 'carGrey', true), -27, -58, 12 * DEG);
  w.place(P.hedgehog(), 27, -56, 0);
  w.place(P.block(), 26, -60.5, 10 * DEG);
  w.place(P.bus('carYellow', true), 72, 64.6, 94 * DEG);
  w.place(P.truck(true), -48, -67.5, 86 * DEG);

  // у мест появления врагов — подбитая техника
  w.place(P.truck(true), -25.8, -80, 8 * DEG);
  w.place(P.truck(true), 28.4, -78, -10 * DEG);
  w.place(P.truck(true), 4.6, 79, 18 * DEG);
  w.place(P.truck(true), 79, 2.4, 96 * DEG);
  w.place(P.van('carGreen', true), -79, -2.6, -80 * DEG);
}

/** Фонари, деревья, припаркованные машины, остановки, светофоры и знаки вдоль дорог. */
function streets(w) {
  for (const r of ROADS) {
    const along = r.axis === 'z';
    const point = (a, s) => (along ? [r.c + s, a] : [a, r.c + s]); // a — вдоль дороги, s — поперёк
    const yawTo = (side) => (along ? (side < 0 ? 90 : -90) : side < 0 ? 0 : 180) * DEG; // лицом к дороге
    const yawAlong = () => (along ? (rnd() < 0.5 ? 0 : 180) : rnd() < 0.5 ? 90 : -90) * DEG;
    const start = Math.max(r.from, -EXTENT) + 6;
    const end = Math.min(r.to, EXTENT) - 6;

    // фонари: в шахматном порядке, консолью к дороге
    let k = 0;
    for (let a = start; a < end; a += 13, k++) {
      const side = k % 2 ? 1 : -1;
      if (nearCrossing(r, a, 4)) continue;
      const [x, z] = point(a, side * (r.half + 0.6));
      if (inPlaza(x, z) || !w.free(x, z, 0.4)) continue;
      w.place(P.streetLamp(), x, z, yawTo(side));
    }

    // деревья вдоль проспекта
    if (r.id === 'avenue') {
      for (let a = 30; a < end; a += 10) {
        for (const side of [-1, 1]) {
          const [x, z] = point(a + 5, side * (r.half + 1.4));
          if (!w.free(x, z, 0.5) || (side < 0 && Math.abs(z - 50) < 4) || (side > 0 && Math.abs(z - 74) < 4)) continue;
          w.place(P.tree(Math.floor(rnd() * 6)), x, z, rnd() * 6, { scale: 0.72 + rnd() * 0.15 });
          w.visual(x, z).box('dirt', x - 0.6, SIDEWALK, z - 0.6, x + 0.6, SIDEWALK + 0.012, z + 0.6, 'y-');
        }
      }
    }

    // машины у бордюров
    if (r.lanes >= 2) {
      for (const side of [-1, 1]) {
        for (let a = start + 4; a < end - 4; a += 6.4) {
          if (rnd() > 0.42 || nearCrossing(r, a, 9)) continue;
          const [x, z] = point(a, side * (r.half - 1.15));
          if (nearSpawn(x, z, 5) || inPlaza(x, z)) continue;
          w.place(randomCar(0.3), x, z, yawAlong() + (rnd() - 0.5) * 0.08);
        }
      }
      // брошенные посреди дороги
      for (let n = 0; n < 2; n++) {
        const a = start + 15 + rnd() * (end - start - 30);
        const [x, z] = point(a, (rnd() - 0.5) * r.half);
        if (nearCrossing(r, a, 9) || nearSpawn(x, z, 6) || inPlaza(x, z)) continue;
        w.place(randomCar(0.6), x, z, rnd() * Math.PI * 2);
      }
    }
  }

  // остановки
  w.place(P.busStop(), -9.2, 50, 90 * DEG);
  w.place(P.busStop(), 9.2, 74, -90 * DEG);
  w.place(P.busStop(), 62, -6.9, 0);
  w.place(P.busStop(), -70, 6.9, Math.PI);
  // светофоры у площади и на перекрёстках
  for (const [x, z, yaw] of [[-7.6, 25.2, 0], [7.6, 25.2, 0], [-31, -5.6, -90], [-31, 5.6, -90], [31, -5.6, 90], [31, 5.6, 90], [-7.6, 61.4, 0], [7.6, 68.6, 180], [-30.6, -63.4, 0], [30.6, -63.4, 0], [-23.4, -70.6, 180], [23.4, -70.6, 180]]) {
    w.place(P.trafficLight(), x, z, yaw * DEG);
  }
  // знаки
  for (const [x, z, yaw, kind] of [[-7.6, 31, 90, 'crossing'], [7.6, 33, -90, 'crossing'], [-36, -5.5, 0, 'crossing'], [36, 5.5, 180, 'crossing'], [-30.6, -26, 90, 'noEntry'], [23.4, -26, -90, 'noEntry'], [-7.6, 60, 90, 'main'], [-23.5, 1, 0, 'stop']]) {
    if (onRoad(x, z)) continue;
    w.place(P.roadSign(kind), x, z, yaw * DEG);
  }
  // урны и скамейки на широких тротуарах
  for (let a = 34; a < 92; a += 19) {
    w.place(P.bin(), -10.3, a, 0);
    w.place(P.bin(), 10.3, a + 9, 0);
  }
}

/** Дворы и площадки. */
function yards(w) {
  // двор ратуши — здесь появляются защитники
  w.place(P.truck(), -13, -53.5, 3 * DEG);
  w.place(P.truck(), 13.5, -54, -5 * DEG);
  w.place(P.container('containerGreen'), 0, -59, 90 * DEG);
  for (const [x, z, yaw] of [[-5, -47.6, 0], [5.4, -47.8, 10], [-17.5, -48, 80], [17.8, -48.5, 95]]) {
    w.place(P.crate(), x, z, yaw * DEG);
    w.place(P.crate('ammo'), x + 0.9, z + 0.9, (yaw + 30) * DEG);
  }
  for (const x of [-18.5, -17.7, 18, 18.8]) w.place(P.barrel(x < 0 ? 'barrelBlue' : 'barrelRust'), x, -59.5);
  // кирпичная ограда двора и запертые ворота
  for (let z = -60.25; z < -28; z += 2.5) {
    w.place(P.fence(2.5, 'brick'), -21.3, z, 90 * DEG);
    w.place(P.fence(2.5, 'brick'), 21.3, z, 90 * DEG);
  }
  for (let x = -20.25; x < 20.5; x += 2.5) {
    if (Math.abs(x) < 2) w.place(P.fence(2.5), x, -61.3, 0);
    else w.place(P.fence(2.5, 'brick'), x, -61.3, 0);
  }
  w.place(P.fence(2.5, 'brick'), -19.25, -27.8, 0);
  w.place(P.fence(2.5, 'brick'), 19.25, -27.8, 0);
  w.place(P.fence(1.8, 'brick'), -17.9, -27.8, 0);
  w.place(P.fence(1.8, 'brick'), 17.9, -27.8, 0);

  // двор панельки: гаражи, деревья, контейнеры
  const garages = createGarages(w.visual(-72, -44), { x0: -84, z0: -46.5, n: 7, facing: 's', y: SIDEWALK, seed: 3 });
  w.solidBox(garages);
  for (const [x, z] of [[-78, -30], [-66, -26], [-58, -36], [-72, -36], [-52, -45], [-84, -26]]) w.place(P.tree(Math.floor(rnd() * 6)), x, z, rnd() * 6, { scale: 0.85 + rnd() * 0.2 });
  w.place(P.dumpster('containerGreen'), -50, -24.4, 0);
  w.place(P.dumpster('containerBlue'), -52.3, -24.4, 0);
  w.place(P.bench(), -70, -30, 0);
  w.place(P.bench(), -62, -30, 0);
  w.place(P.car('sedan', 'carBeige'), -80, -36, 90 * DEG);
  w.place(P.car('hatch', 'carGreen', true), -60, -40, 70 * DEG);
  w.place(P.tires(), -48.5, -40);

  // церковный двор
  for (const [x, z] of [[52, -48], [52, -38], [52, -28], [80, -48], [80, -38], [80, -28], [58, -27], [76, -27]]) w.place(P.tree(Math.floor(rnd() * 6)), x, z, rnd() * 6, { scale: 0.9 + rnd() * 0.2 });
  for (const [x, z, yaw] of [[56, -44, 90], [56, -34, 90], [77.5, -44, -90], [77.5, -34, -90]]) w.place(P.bench(), x, z, yaw * DEG);

  // парк
  const placed = [];
  for (let n = 0; n < 60 && placed.length < 17; n++) {
    const x = -50 + rnd() * 17;
    const z = 29 + rnd() * 28;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 4.5)) continue;
    placed.push([x, z]);
    w.place(P.tree(Math.floor(rnd() * 6), rnd() < 0.15), x, z, rnd() * 6, { scale: 0.9 + rnd() * 0.3 });
  }
  for (const [x, z] of [[-45, 40], [-38, 50], [-48, 32]]) w.place(P.bush(Math.floor(rnd() * 3)), x, z, rnd() * 6, { solid: false });
  for (const [x, z, yaw] of [[-41.5, 33, 0], [-41.5, 45, 0], [-41.5, 55, 180]]) w.place(P.bench(), x, z, yaw * DEG);
  for (let x = -51.25; x < -32; x += 2.5) if (Math.abs(x + 41.5) > 2) w.place(P.fence(2.5), x, 27.2, 0);
  for (let z = 28.25; z < 59; z += 2.5) if (Math.abs(z - 43) > 2) w.place(P.fence(2.5), -31.7, z, 90 * DEG);

  // заводской двор: контейнеры, поддоны, бочки, грузовик
  for (const [x, z, yaw, color] of [[-81, 26.5, 90, 'containerBlue'], [-74, 26.5, 90, 'containerRed'], [-56.5, 34, 0, 'containerGreen'], [-56.5, 41.5, 0, 'containerBlue']]) w.place(P.container(color), x, z, yaw * DEG);
  w.place(P.truck(), -66, 26.8, 92 * DEG);
  for (const [x, z] of [[-60, 29], [-61.3, 30.4], [-86, 57], [-84.5, 57.2]]) w.place(P.pallet(), x, z, rnd() * 3);
  for (const [x, z] of [[-87, 24.2], [-86.3, 24.8], [-58, 56.8]]) w.place(P.barrel('barrelRust'), x, z);
  for (let x = -88.75; x < -53; x += 2.5) if (Math.abs(x + 70) > 3) w.place(P.fence(2.5, 'concrete'), x, 59.2, 0);
  for (let z = 24.25; z < 59; z += 2.5) if (Math.abs(z - 40) > 2.5) w.place(P.fence(2.5, 'concrete'), -53.2, z, 90 * DEG);

  // рынок: ряды палаток, контейнеры
  const awnings = ['awningRed', 'awningGreen', 'awningBlue', 'awningYellow'];
  for (const [z, yaw] of [[31.5, 0], [40, 180], [44.5, 0], [53, 180]]) {
    for (let x = 38; x < 84; x += 4.2) {
      if (rnd() < 0.18) continue;
      w.place(P.stall(pick(awnings), Math.floor(rnd() * 5)), x, z, yaw * DEG);
    }
  }
  for (const [x, color] of [[40, 'containerRed'], [72, 'containerBlue'], [80, 'containerGreen']]) w.place(P.container(color), x, 57.6, 90 * DEG);
  w.place(P.kiosk('РЫНОК', 'plasterMustard'), 34.5, 36, 90 * DEG);
  w.place(P.van('carWhite', true), 60, 36, 10 * DEG);

  // заправка
  w.place(P.gasCanopy(), 24, 82.5, 0, { y: SIDEWALK });
  w.place(P.car('sedan', 'carYellow', true), 19.2, 82.5, 4 * DEG);
  w.place(P.car('hatch', 'carBlue'), 29, 84.5, 182 * DEG);
  w.place(P.tires(), 47.5, 86);
}

/** Воронки, завалы и мусор на подходах. */
function debris(w) {
  const craters = [[2, 66, 2.4], [-4, 84, 1.8], [-60, 1.2, 2.2], [-82, -2.4, 1.6], [58, -1.2, 2.3], [84, 2.6, 1.8], [-27, -50, 1.5], [27, -64, 2], [40, 65.4, 2], [-50, 66, 1.8], [-62, -67, 2], [56, -66, 2.2], [0, 46, 1.5]];
  craters.forEach(([x, z, r], i) => w.place(P.crater(r, i + 10), x, z, rnd() * 6, { solid: false }));
  const piles = [[-41, -7.6], [-62, -21.5], [51, -7.4], [-58, 7.6], [72, 7.4], [-10, 62.5], [12, 61.4], [-34.4, -40], [34.2, -45], [47, -23], [-86, -21.5], [88, 21.5]];
  piles.forEach(([x, z], i) => {
    if (w.free(x, z, 0.6)) w.place(P.rubble(30 + i, 1.2 + rnd() * 0.8, 0.6 + rnd() * 0.5), x, z, rnd() * 6);
  });
  for (const [x, z] of [[-12, 63], [14, 66.6], [-33, 7.4], [33.2, -7.2], [-24, -63.4]]) w.place(P.tires(), x, z, rnd() * 6);
}

export function dressCity(w) {
  plaza(w);
  barricades(w);
  streets(w);
  yards(w);
  debris(w);
}
