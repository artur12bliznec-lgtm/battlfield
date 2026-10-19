import * as THREE from 'three';
import './materials.js';
import { MeshBuilder } from './builder.js';
import { createBuilding } from './buildings.js';
import { createTownHall, createChurch, createWarehouse, createChimney, createGarages } from './landmarks.js';
import * as P from './props.js';
import { centeredMesh } from './city.js';

/* Тестовая площадка для разработки: по дому каждого стиля и все предметы в ряд. */

/** Тестовый квартал: по дому каждого стиля. */
export function createBuildingTest() {
  const root = new THREE.Group();
  root.name = 'building_test';
  const ground = new MeshBuilder();
  ground.box('asphalt', -60, -1, -30, 90, 0, 70, 'y-');
  ground.box('pavers', -55, 0, -22, 55, 0.15, 6, 'y-');
  root.add(centeredMesh(ground, 'ground'));
  const specs = [
    { style: 'classic', x0: -54, x1: -32, wall: 'plasterOchre', floors: 4, sides: { s: 'main', n: 'back', e: 'side', w: 'side' }, balconies: 0.3 },
    { style: 'stalin', x0: -30, x1: -6, wall: 'plasterCream', floors: 5, sides: { s: 'main', n: 'back', e: 'side', w: 'side' }, balconies: 0.35, arches: [{ sides: ['s', 'n'], at: -18, width: 4, height: 4.6 }] },
    { style: 'brick', x0: -4, x1: 16, floors: 4, sides: { s: 'main', n: 'back', e: 'side', w: 'side' }, ground: 'entrances', damage: 0.3, boarded: 0.3 },
    { style: 'panel', x0: 18, x1: 54, floors: 5, sides: { s: 'main', n: 'back', e: 'side', w: 'side' }, balconyStacks: [1, 4, 7, 10], ground: 'entrances' },
  ];
  specs.forEach((spec, i) => {
    const r = createBuilding({ z0: -18, z1: -6, seed: 7 + i, ...spec });
    root.add(centeredMesh(r.builder, `${spec.style}_${i}`));
  });
  const store = createBuilding({ style: 'store', x0: -20, x1: 10, z0: -60, z1: -40, floors: 3, sides: { s: 'main', n: 'back', e: 'side', w: 'side' }, signs: ['УНИВЕРМАГ'], seed: 3 });
  root.add(centeredMesh(store.builder, 'store'));
  const ruin = createBuilding({ style: 'classic', x0: 20, x1: 40, z0: -60, z1: -42, floors: 4, wall: 'plasterSalmon', sides: { s: 'main', n: 'back', e: 'side', w: 'side' }, ruin: { x: 40, z: -42, r0: 2.5, r1: 10, seed: 4 }, seed: 9 });
  root.add(centeredMesh(ruin.builder, 'ruin'));
  root.add(centeredMesh(createTownHall({ x0: -95, x1: -61, z0: -64, z1: -46 }).builder, 'townhall'));
  root.add(centeredMesh(createChurch({ cx: 70, z0: -70 }).builder, 'church'));
  const wb = new MeshBuilder();
  createWarehouse({ x0: 60, x1: 96, z0: 14, z1: 34, sides: { n: 'main', s: 'side', e: 'side', w: 'side' }, gates: [{ side: 'n', at: [9, 27], width: 4.4, height: 4.8 }], seed: 5 }, wb);
  createChimney(wb, 100, 40, 0.15);
  createGarages(wb, { x0: 60, z0: 40, n: 8, facing: 'n' });
  root.add(centeredMesh(wb, 'factory'));
  // ряд предметов вдоль тротуара
  const pb = new MeshBuilder();
  const row = [
    [P.car('sedan', 'carRed'), 0], [P.car('hatch', 'carBlue'), 0], [P.car('sedan', 'carWhite', true), 0.3], [P.van('carGreen'), 0], [P.van('carBeige', true), -0.2],
    [P.bus('carYellow'), 0], [P.bus('carYellow', true), 0], [P.truck(), 0], [P.truck(true), 0.2],
  ];
  let x = -50;
  for (const [prop, yaw] of row) {
    P.placeProp(pb, null, prop, x, 0, 12, Math.PI / 2 + yaw);
    x += prop === row[5][0] || prop === row[6][0] ? 13 : 7;
  }
  const small = [P.sandbags(3, 4), P.jersey(), P.hedgehog(), P.block(), P.streetLamp(), P.plazaLamp(), P.trafficLight(), P.roadSign('crossing'), P.roadSign('noEntry'), P.bench(), P.bin(), P.dumpster(), P.busStop(), P.kiosk('ТАБАК'), P.adColumn(), P.bollard(), P.planter(), P.fence(2.5), P.fence(2.5, 'concrete'), P.tree(0), P.tree(1), P.tree(2), P.tree(3, true), P.bush(0), P.rubble(3), P.crater(2), P.crate(), P.crate('ammo'), P.barrel(), P.tires(), P.pallet(), P.container(), P.stall(), P.monument(), P.flagpole()];
  x = -56;
  for (const prop of small) {
    P.placeProp(pb, null, prop, x, 0.15, 2.5, 0);
    x += 3.3;
  }
  P.placeProp(pb, null, P.gasCanopy(), 70, 0, 60, 0);
  root.add(centeredMesh(pb, 'props'));
  root.userData = { kind: 'map' };
  return root;
}
