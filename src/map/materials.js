import { defineMaterial } from '../models/materials.js';
import './textures.js';

/*
 * Материалы города. Имена сохраняются в .glb — в Godot их легко заменить
 * своими. Цвет умножается на текстуру, поэтому штукатурка разных домов —
 * одна картинка с разными оттенками.
 */

const CITY = {
  // --- Земля ---
  asphalt: { color: '#ffffff', roughness: 0.93, texture: 'asphalt' },
  asphaltPatch: { color: '#b9b9b9', roughness: 0.93, texture: 'asphalt' }, // заплатки, дворы
  pavers: { color: '#ffffff', roughness: 0.9, texture: 'pavers' },
  curb: { color: '#cfccc4', roughness: 0.85, texture: 'concrete' },
  cobble: { color: '#ffffff', roughness: 0.82, texture: 'cobble' },
  grass: { color: '#ffffff', roughness: 0.97, texture: 'grass' },
  dirt: { color: '#ffffff', roughness: 0.98, texture: 'dirt' },
  roadPaint: { color: '#e4e2d8', roughness: 0.7 },
  roadPaintYellow: { color: '#dcb03c', roughness: 0.7 },
  scorch: { color: '#2b2824', roughness: 1 }, // воронки, следы гари

  // --- Стены: штукатурка разных цветов ---
  plasterCream: { color: '#e9dcb8', roughness: 0.92, texture: 'plaster' },
  plasterOchre: { color: '#dcae6e', roughness: 0.92, texture: 'plaster' },
  plasterSalmon: { color: '#dca28c', roughness: 0.92, texture: 'plaster' },
  plasterRose: { color: '#cf948f', roughness: 0.92, texture: 'plaster' },
  plasterGreen: { color: '#b4c29f', roughness: 0.92, texture: 'plaster' },
  plasterBlue: { color: '#a6bac6', roughness: 0.92, texture: 'plaster' },
  plasterGrey: { color: '#c9c6bd', roughness: 0.92, texture: 'plaster' },
  plasterMustard: { color: '#d8b35e', roughness: 0.92, texture: 'plaster' },
  plasterWhite: { color: '#efeadf', roughness: 0.92, texture: 'plaster' },
  plasterTerracotta: { color: '#c47e63', roughness: 0.92, texture: 'plaster' },
  plasterLilac: { color: '#bba9c0', roughness: 0.92, texture: 'plaster' },
  plasterMint: { color: '#a8cab6', roughness: 0.92, texture: 'plaster' },
  trimWhite: { color: '#f4f0e7', roughness: 0.85, texture: 'plaster' },
  trimCream: { color: '#e6dcc2', roughness: 0.85, texture: 'plaster' },
  trimGrey: { color: '#bcb8ad', roughness: 0.85, texture: 'plaster' },
  brick: { color: '#ffffff', roughness: 0.9, texture: 'brick' },
  brickDark: { color: '#9a8c88', roughness: 0.9, texture: 'brick' },
  concreteWall: { color: '#c9c7c1', roughness: 0.9, texture: 'concrete' },
  concreteBeige: { color: '#ddd2bf', roughness: 0.9, texture: 'concrete' },
  concreteDark: { color: '#8f8d87', roughness: 0.92, texture: 'concrete' },
  stone: { color: '#bdb6a6', roughness: 0.85, texture: 'concrete' },
  granite: { color: '#77736d', roughness: 0.55, texture: 'concrete' },
  interior: { color: '#9c948a', roughness: 0.95, texture: 'plaster' }, // стены внутри руин
  seam: { color: '#5c5a55', roughness: 0.95 }, // швы панелей

  // --- Крыши ---
  roofTiles: { color: '#ffffff', roughness: 0.8, texture: 'roofTiles' },
  roofGreen: { color: '#6c8a72', metalness: 0.3, roughness: 0.6, texture: 'corrugated' },
  roofGrey: { color: '#8f9395', metalness: 0.35, roughness: 0.55, texture: 'corrugated' },
  roofRust: { color: '#9c6d50', metalness: 0.2, roughness: 0.75, texture: 'corrugated' },
  roofTar: { color: '#5b5a57', roughness: 0.95, texture: 'concrete' },
  patina: { color: '#5f9c88', metalness: 0.3, roughness: 0.55 }, // медь: купола, шпили
  zinc: { color: '#9aa0a4', metalness: 0.7, roughness: 0.4 }, // водостоки, отливы

  // --- Окна и двери ---
  glass: { color: '#2a3740', metalness: 0.05, roughness: 0.2 },
  glassShop: { color: '#34444d', metalness: 0.05, roughness: 0.15 },
  glassLight: { color: '#9fb3bd', metalness: 0.1, roughness: 0.1 }, // остановка, киоск
  interiorDark: { color: '#151413', roughness: 1 }, // выбитые окна
  frameWhite: { color: '#eeeeea', roughness: 0.5 },
  frameBrown: { color: '#5b3d29', roughness: 0.6 },
  frameDark: { color: '#2d2f31', metalness: 0.5, roughness: 0.45 },
  doorWood: { color: '#a8805e', roughness: 0.7, texture: 'planks' },
  doorMetal: { color: '#41504a', metalness: 0.4, roughness: 0.55 },
  shutter: { color: '#b9bdbf', metalness: 0.5, roughness: 0.5, texture: 'corrugated' },
  awningRed: { color: '#a63a32', roughness: 0.9 },
  awningGreen: { color: '#2f6b4a', roughness: 0.9 },
  awningBlue: { color: '#2d5a8c', roughness: 0.9 },
  awningYellow: { color: '#c9962e', roughness: 0.9 },
  signs: { color: '#ffffff', roughness: 0.6, texture: 'signs' },
  boards: { color: '#c6a985', roughness: 0.9, texture: 'planks' }, // заколоченные окна, заборы

  // --- Металл ---
  metalDark: { color: '#2f3133', metalness: 0.6, roughness: 0.5 },
  metalGrey: { color: '#7d8186', metalness: 0.7, roughness: 0.4 },
  metalGreen: { color: '#3e5a48', metalness: 0.3, roughness: 0.6 },
  rust: { color: '#d6ccc4', metalness: 0.3, roughness: 0.85, texture: 'rust' },
  chrome: { color: '#c9ccd0', metalness: 1, roughness: 0.2 },
  corrugatedGreen: { color: '#7f9a83', metalness: 0.3, roughness: 0.6, texture: 'corrugated' },
  corrugatedBlue: { color: '#7c97b3', metalness: 0.3, roughness: 0.6, texture: 'corrugated' },
  corrugatedRust: { color: '#a77756', metalness: 0.2, roughness: 0.8, texture: 'corrugated' },
  corrugatedGrey: { color: '#a9adb0', metalness: 0.4, roughness: 0.55, texture: 'corrugated' },
  containerRed: { color: '#a24a3a', metalness: 0.3, roughness: 0.6, texture: 'corrugated' },
  containerBlue: { color: '#3e6a9a', metalness: 0.3, roughness: 0.6, texture: 'corrugated' },
  containerGreen: { color: '#4d7a5a', metalness: 0.3, roughness: 0.6, texture: 'corrugated' },

  // --- Машины: краска с лёгкой дорожной грязью ---
  carRed: { color: '#8e2a26', metalness: 0.45, roughness: 0.38, texture: 'grime' },
  carBlue: { color: '#2d4f7a', metalness: 0.45, roughness: 0.38, texture: 'grime' },
  carWhite: { color: '#d8d8d2', metalness: 0.35, roughness: 0.4, texture: 'grime' },
  carGreen: { color: '#3f5e45', metalness: 0.45, roughness: 0.4, texture: 'grime' },
  carBeige: { color: '#c9b48a', metalness: 0.35, roughness: 0.44, texture: 'grime' },
  carGrey: { color: '#6b6f73', metalness: 0.5, roughness: 0.38, texture: 'grime' },
  carYellow: { color: '#d0a131', metalness: 0.35, roughness: 0.4, texture: 'grime' },
  carOrange: { color: '#c0612b', metalness: 0.35, roughness: 0.44, texture: 'grime' },
  busCream: { color: '#e4dcc4', metalness: 0.3, roughness: 0.45, texture: 'grime' }, // верх автобуса
  carGlass: { color: '#1b252c', metalness: 0.3, roughness: 0.06, opacity: 0.74 }, // тонированное стекло
  carInterior: { color: '#2b2a28', roughness: 0.9 }, // сиденья, панель
  seatRed: { color: '#6b2a24', roughness: 0.8 }, // сиденья автобуса
  burntInterior: { color: '#221e1b', roughness: 1 }, // выгоревший салон
  plasticBlack: { color: '#1d1e20', roughness: 0.6 }, // бамперы, молдинги, зеркала
  plate: { color: '#e9e8e0', roughness: 0.5 }, // номера
  turnSignal: { color: '#d98c2b', roughness: 0.3 },
  tire: { color: '#1c1c1c', roughness: 0.95 },
  headlight: { color: '#e8e6dc', roughness: 0.2 },
  taillight: { color: '#8f1d1d', roughness: 0.3 },
  burnt: { color: '#ffffff', metalness: 0.25, roughness: 0.9, texture: 'burnt' }, // обгоревший кузов: гарь, ржавчина, пепел
  canvas: { color: '#6e6a4f', roughness: 0.95, texture: 'grime' }, // тент грузовика
  armyGreen: { color: '#56603f', metalness: 0.25, roughness: 0.7, texture: 'grime' }, // армейская техника
  armyCamo: { color: '#ffffff', metalness: 0.25, roughness: 0.75, texture: 'armyCamo' }, // броня в камуфляже
  glassDark: { color: '#10171b', metalness: 0.3, roughness: 0.12 }, // смотровые блоки, прожектор
  rubberSkirt: { color: '#27292a', roughness: 0.9 }, // резиновые экраны танка
  armyDark: { color: '#3c4330', metalness: 0.3, roughness: 0.7, texture: 'grime' },
  track: { color: '#3a3733', metalness: 0.6, roughness: 0.7, texture: 'rust' }, // гусеницы, катки

  // --- Природа ---
  leaves: { color: '#5d7a3e', roughness: 0.9, texture: 'foliage' },
  leavesLight: { color: '#748f4a', roughness: 0.9, texture: 'foliage' },
  leavesDark: { color: '#4a6533', roughness: 0.9, texture: 'foliage' },
  leavesDry: { color: '#8f8248', roughness: 0.9, texture: 'foliage' },
  bark: { color: '#ffffff', roughness: 0.95, texture: 'bark' },
  hedge: { color: '#46612f', roughness: 0.95, texture: 'foliage' },

  // --- Баррикады и мелочи ---
  sandbag: { color: '#d8c79c', roughness: 1, texture: 'dirt' },
  sandbagDark: { color: '#c2b087', roughness: 1, texture: 'dirt' },
  crate: { color: '#d8bf98', roughness: 0.9, texture: 'planks' },
  ammoBox: { color: '#55603f', roughness: 0.75 },
  barrelBlue: { color: '#2f5a7c', metalness: 0.4, roughness: 0.55 },
  barrelRust: { color: '#7d4d33', metalness: 0.3, roughness: 0.85 },
  bronze: { color: '#5e6b4f', metalness: 0.75, roughness: 0.45 },
  flagCloth: { color: '#e9e6dc', roughness: 0.9 },
  bench: { color: '#c9a57c', roughness: 0.8, texture: 'planks' },
  signRed: { color: '#c0392b', roughness: 0.5 },
  signBlue: { color: '#2a5aa8', roughness: 0.5 },
  signWhite: { color: '#f2f2ee', roughness: 0.5 },
  signYellow: { color: '#e2b52a', roughness: 0.5 },
  lampGlass: { color: '#f2eedc', roughness: 0.25 },
  lightRed: { color: '#b02020', roughness: 0.3, emissive: '#2a0606' },
  lightAmber: { color: '#c08a1a', roughness: 0.3, emissive: '#2a1c04' },
  lightGreen: { color: '#1f8a3a', roughness: 0.3, emissive: '#06280f' },

  // --- Служебные ---
  collision: { color: '#ff00ff', roughness: 1 },
};

for (const [name, spec] of Object.entries(CITY)) defineMaterial(name, spec);

// коллизии видны только движку: в просмотрщике их не рисуем
defineMaterial('collision').visible = false;

/** Оттенки штукатурки для разнообразия фасадов. */
export const PLASTERS = [
  'plasterCream',
  'plasterOchre',
  'plasterSalmon',
  'plasterRose',
  'plasterGreen',
  'plasterBlue',
  'plasterGrey',
  'plasterMustard',
  'plasterWhite',
  'plasterTerracotta',
  'plasterLilac',
  'plasterMint',
];

export const CAR_PAINTS = ['carRed', 'carBlue', 'carWhite', 'carGreen', 'carBeige', 'carGrey', 'carYellow', 'carOrange'];
