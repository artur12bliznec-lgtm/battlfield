/*
 * Планировка карты «Город» для режима «Удержание»: защитники держат
 * точку на центральной площади, волны врагов идут с четырёх сторон.
 *
 * Оси: X — на восток, Z — на юг (север — это −Z, как «вперёд» в Godot).
 * Дороги на отметке 0, тротуары, кварталы и площадь подняты на 15 см.
 *
 *                       север (−Z): волна N по двум переулкам
 *            ┌──────────┬───────────────────────┬──────────┐
 *            │ квартал  │ ратуша, во дворе —    │  церковь │
 *   волна W  │ панелька │ защитники             │ старый   │  волна E
 *   ─ улица ─┤  дворы   ├─── ПЛОЩАДЬ, ТОЧКА ────┤  город   ├─ улица ─
 *            │ завод    │ руины │ проспект │ универмаг│ рынок│
 *            │ парк     │       │          │          │      │
 *            └──────────┴───────┴──────────┴──────────┴──────┘
 *                       юг (+Z): волна S по проспекту
 */

export const SIDEWALK = 0.15; // высота тротуаров и площади
export const BOUNDS = 95; // граница зоны боя: |x|, |z| ≤ 95 м
export const EXTENT = 150; // докуда построен город (дальше — фон)

/** Центральная площадь с точкой захвата. */
export const PLAZA = [-30, -24, 30, 24];

/**
 * Дороги: axis — вдоль какой оси идёт, c — координата оси дороги,
 * half — полуширина проезжей части, from..to — протяжённость, lanes — полос.
 */
export const ROADS = [
  { id: 'avenue', axis: 'z', c: 0, half: 7, from: 24, to: EXTENT, lanes: 4, walk: 4 },
  { id: 'streetW', axis: 'x', c: 0, half: 5, from: -EXTENT, to: -30, lanes: 2, walk: 3.5 },
  { id: 'streetE', axis: 'x', c: 0, half: 5, from: 30, to: EXTENT, lanes: 2, walk: 3.5 },
  { id: 'laneNW', axis: 'z', c: -27, half: 3, from: -EXTENT, to: -24, lanes: 1, walk: 2.5 },
  { id: 'laneNE', axis: 'z', c: 27, half: 3, from: -EXTENT, to: -24, lanes: 1, walk: 2.5 },
  { id: 'ringN', axis: 'x', c: -67, half: 3, from: -EXTENT, to: EXTENT, lanes: 2, walk: 2.5 },
  { id: 'ringS', axis: 'x', c: 65, half: 3, from: -EXTENT, to: EXTENT, lanes: 2, walk: 2.5 },
];

/** Кварталы — поднятые плиты тротуаров между дорогами: [x0, z0, x1, z1]. */
export const BLOCKS = [
  [-EXTENT, -64, -30, -5],
  [-24, -64, 24, -24],
  [30, -64, EXTENT, -5],
  [-EXTENT, -EXTENT, -30, -70],
  [-24, -EXTENT, 24, -70],
  [30, -EXTENT, EXTENT, -70],
  [-EXTENT, 5, -30, 62],
  [-30, 24, -7, 62],
  [30, 5, EXTENT, 62],
  [7, 24, 30, 62],
  [-EXTENT, 68, -7, EXTENT],
  [7, 68, EXTENT, EXTENT],
];

/** Газоны и площадки поверх тротуаров: [x0, z0, x1, z1, материал]. */
export const SURFACES = [
  [-52, 27, -31.5, 59, 'grass'], // парк
  [48, -52, 84, -25, 'grass'], // церковный двор
  [-86, -47, -48, -23, 'asphaltPatch'], // двор панельки
  [-20.5, -61, 20.5, -46, 'asphaltPatch'], // двор ратуши
  [-88, 23, -53, 58.5, 'asphaltPatch'], // заводской двор
  [34, 26, 86, 58, 'asphaltPatch'], // рынок
  [12, 72, 46, 93, 'asphaltPatch'], // заправка
];

/** Режим «Удержание»: точка захвата, возрождение защитников и волн врагов. */
export const MODE = {
  capture: { x: 0, z: 0, radius: 12 },
  defenders: [[-9, -52], [-4, -55], [0, -51], [4, -55], [9, -52], [0, -56.6]],
  attackers: {
    north: [[-27, -91], [-27, -86], [27, -91], [27, -86]],
    east: [[91, -2], [91, 2], [86, -2], [86, 2]],
    south: [[-3, 91], [3, 91], [-3, 86], [3, 86]],
    west: [[-91, -2], [-91, 2], [-86, -2], [-86, 2]],
  },
};

const S = (s = 'main', n = 'back', e = 'side', w = 'side') => ({ s, n, e, w });

/**
 * Дома зоны боя. Поля — как у createBuilding (buildings.js), плюс kind:
 * townhall, church, warehouse — особые здания.
 */
export const BUILDINGS = [
  // --- северо-запад: панелька, кирпичный дом, двор с гаражами ---
  { name: 'nw_corner', style: 'classic', x0: -45, z0: -24, x1: -33.5, z1: -8.5, floors: 4, wall: 'plasterOchre', sides: S('main', 'side', 'main', 'blank'), balconies: 0.25, damage: 0.15 },
  { name: 'nw_panel', style: 'panel', x0: -88, z0: -20.5, x1: -45, z1: -8.5, floors: 5, sides: S('main', 'back', 'blank', 'side'), groundBack: 'entrances', balconyStacks: [1, 4, 7, 10, 13], damage: 0.2 },
  { name: 'nw_brick', style: 'brick', x0: -46, z0: -59, x1: -32.5, z1: -30, floors: 4, sides: S('side', 'side', 'main', 'back'), ground: 'entrances', damage: 0.3, boarded: 0.15 },
  { name: 'nw_ring', style: 'classic', x0: -84, z0: -61.5, x1: -50, z1: -49.5, floors: 3, wall: 'plasterGreen', sides: S('back', 'main', 'side', 'side'), damage: 0.12 },
  { name: 'nw_west', style: 'brick', x0: -112, z0: -59, x1: -90, z1: -24, floors: 5, wall: 'brickDark', trim: 'concreteDark', sides: S('side', 'side', 'main', 'blank'), ground: 'entrances', damage: 0.2 },

  // --- ратуша на северной стороне площади ---
  { name: 'townhall', kind: 'townhall', x0: -17, z0: -45, x1: 17, z1: -27.5 },

  // --- северо-восток: старый город и церковь ---
  { name: 'ne_corner', style: 'classic', x0: 33.5, z0: -24, x1: 48, z1: -8.5, floors: 4, wall: 'plasterBlue', sides: S('main', 'side', 'blank', 'main'), balconies: 0.25, signs: ['АПТЕКА', 'КАФЕ', 'ЧАСЫ'] },
  { name: 'ne_2', style: 'classic', x0: 48, z0: -21, x1: 66, z1: -8.5, floors: 3, wall: 'plasterRose', sides: S('main', 'back', 'blank', 'blank'), roofMat: 'roofGrey', signs: ['ХЛЕБ', 'ОБУВЬ'] },
  { name: 'ne_3', style: 'stalin', x0: 66, z0: -22, x1: 90, z1: -8.5, floors: 5, wall: 'plasterCream', sides: S('main', 'back', 'side', 'blank'), signs: ['ГОСТИНИЦА', 'БАР', 'КНИГИ'], damage: 0.1 },
  { name: 'ne_lane', style: 'classic', x0: 32.5, z0: -59, x1: 45, z1: -30, floors: 4, wall: 'plasterLilac', sides: S('side', 'side', 'back', 'main'), ground: 'entrances', groundSide: 'plain', damage: 0.15 },
  { name: 'church', kind: 'church', cx: 67, z0: -54.5 },
  { name: 'ne_east', style: 'brick', x0: 86, z0: -59, x1: 110, z1: -26, floors: 4, sides: S('side', 'side', 'blank', 'main'), ground: 'entrances', damage: 0.15 },
  { name: 'ne_ring', style: 'brick', x0: 47.5, z0: -61.5, x1: 57.5, z1: -54, floors: 2, sides: S('back', 'main', 'side', 'side'), ground: 'shops', signs: ['ЦВЕТЫ'], parapet: 0.5 },

  // --- юго-запад: руины на углу площади, завод, парк ---
  { name: 'sw_corner', style: 'classic', x0: -52, z0: 8.5, x1: -33.5, z1: 22, floors: 3, wall: 'plasterMustard', sides: S('back', 'main', 'main', 'blank'), signs: ['ПОЧТА', 'ПРОДУКТЫ', 'ОПТИКА'], damage: 0.2 },
  { name: 'sw_office', style: 'brick', x0: -88, z0: 8.5, x1: -52, z1: 20, floors: 4, sides: S('back', 'main', 'blank', 'side'), ground: 'entrances', damage: 0.25, boarded: 0.1 },
  { name: 'sw_ruin', style: 'classic', x0: -28.5, z0: 27.5, x1: -11, z1: 45.5, floors: 4, wall: 'plasterSalmon', sides: S('side', 'main', 'main', 'side'), ruin: { x: -11, z: 27.5, r0: 2.6, r1: 10.5, seed: 4, ramp: 6.5 } },
  { name: 'sw_small', style: 'classic', x0: -28.5, z0: 48, x1: -11, z1: 59.5, floors: 2, wall: 'plasterGreen', sides: S('main', 'side', 'main', 'side'), signs: ['СТОЛОВАЯ', 'МЯСО'], roofMat: 'roofGrey', damage: 0.2 },
  { name: 'factory', kind: 'warehouse', x0: -88, z0: 31, x1: -60, z1: 55, sides: S('side', 'main', 'side', 'side'), gates: [{ side: 'n', at: [7, 21], width: 4.6, height: 5 }] },
  { name: 'sw_west', style: 'brick', x0: -114, z0: 23, x1: -92, z1: 59.5, floors: 4, wall: 'brickDark', trim: 'concreteDark', sides: S('side', 'side', 'main', 'blank'), damage: 0.2 },

  // --- юго-восток: универмаг и рынок ---
  { name: 'se_store', style: 'store', x0: 11, z0: 27.5, x1: 28.5, z1: 54, floors: 3, sides: S('back', 'main', 'side', 'main'), signs: ['УНИВЕРМАГ'], damage: 0.3, noEntrance: true },
  { name: 'se_corner', style: 'classic', x0: 33.5, z0: 8.5, x1: 50, z1: 22, floors: 4, wall: 'plasterTerracotta', sides: S('back', 'main', 'blank', 'main'), signs: ['БАНК', 'ТАБАК', 'ЦВЕТЫ'], balconies: 0.2 },
  { name: 'se_2', style: 'brick', x0: 50, z0: 8.5, x1: 68, z1: 20, floors: 3, sides: S('back', 'main', 'blank', 'blank'), ground: 'shops', signs: ['ХОЗТОВАРЫ', 'РЕМОНТ'], damage: 0.3 },
  { name: 'se_panel', style: 'panel', x0: 68, z0: 8.5, x1: 92, z1: 20.5, floors: 5, sides: S('back', 'main', 'side', 'blank'), groundBack: 'entrances', balconyStacks: [1, 3, 5, 7], damage: 0.25 },
  { name: 'se_east', style: 'classic', x0: 92, z0: 23, x1: 116, z1: 59.5, floors: 4, wall: 'plasterGrey', sides: S('side', 'side', 'blank', 'main'), ground: 'plain', damage: 0.2 },

  // --- юг за кольцевой: заправка и дома ---
  { name: 's_1', style: 'classic', x0: -60, z0: 70.5, x1: -33, z1: 86, floors: 4, wall: 'plasterCream', sides: S('blank', 'main', 'side', 'side'), signs: ['ПАРИКМАХЕРСКАЯ', 'КАФЕ'] },
  { name: 's_2', style: 'stalin', x0: -30, z0: 70.5, x1: -11, z1: 96, floors: 5, wall: 'plasterOchre', sides: S('blank', 'main', 'main', 'side'), signs: ['БАНК', 'ПРОДУКТЫ'] },
  { name: 'gas_shop', style: 'store', x0: 34, z0: 74, x1: 46, z1: 84, floors: 1, sides: S('back', 'side', 'side', 'main'), signs: ['ПРОДУКТЫ'], parapet: 0.6, noRoofStuff: true },
  { name: 's_3', style: 'panel', x0: 50, z0: 70.5, x1: 86, z1: 83, floors: 5, sides: S('blank', 'main', 'side', 'side'), balconyStacks: [2, 5, 8, 10], damage: 0.15 },
  { name: 's_4', style: 'brick', x0: -92, z0: 70.5, x1: -64, z1: 88, floors: 3, sides: S('blank', 'main', 'side', 'side'), ground: 'shops', signs: ['АВТОСЕРВИС'] },

  // --- север за кольцевой ---
  { name: 'n_center', style: 'stalin', x0: -21.5, z0: -94, x1: 21.5, z1: -72.5, floors: 6, wall: 'plasterGrey', sides: S('main', 'blank', 'side', 'side'), signs: ['ПОЧТА', 'КАФЕ', 'БАНК'] },
  { name: 'n_w1', style: 'brick', x0: -60, z0: -92, x1: -32.5, z1: -72.5, floors: 4, sides: S('main', 'blank', 'main', 'blank'), ground: 'shops', signs: ['МЯСО', 'ХЛЕБ'], damage: 0.2 },
  { name: 'n_w2', style: 'classic', x0: -94, z0: -90, x1: -62, z1: -72.5, floors: 3, wall: 'plasterRose', sides: S('main', 'blank', 'blank', 'side') },
  { name: 'n_e1', style: 'classic', x0: 32.5, z0: -92, x1: 58, z1: -72.5, floors: 4, wall: 'plasterMint', sides: S('main', 'blank', 'blank', 'main'), signs: ['ОПТИКА', 'ЧАСЫ'] },
  { name: 'n_e2', style: 'panel', x0: 60, z0: -88, x1: 94, z1: -72.5, floors: 5, sides: S('main', 'blank', 'side', 'blank'), balconyStacks: [1, 4, 7, 10], damage: 0.15 },
];

const inside = (x, z, [x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1;

/** Прямоугольник проезжей части дороги: [x0, z0, x1, z1]. */
export const roadRect = (r) => (r.axis === 'z' ? [r.c - r.half, r.from, r.c + r.half, r.to] : [r.from, r.c - r.half, r.to, r.c + r.half]);

/** Точка на проезжей части (а не на тротуаре или площади)? */
export function onRoad(x, z) {
  if (inside(x, z, PLAZA)) return false;
  return ROADS.some((r) => inside(x, z, roadRect(r)));
}

/** Высота земли в точке: 0 — дорога, SIDEWALK — тротуар, двор, площадь. */
export const groundAt = (x, z) => (onRoad(x, z) ? 0 : SIDEWALK);
