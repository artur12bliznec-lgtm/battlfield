import * as THREE from 'three';
import { patternTexture } from './textures.js';

/**
 * Палитра материалов.
 *
 * Все модели собираются только из этих материалов, поэтому стиль получается
 * единым, а в игровом движке их легко заменить на свои (имена материалов
 * сохраняются в .glb). Цвета задаются в sRGB, как в любом графическом редакторе.
 */
export const PALETTE = {
  // --- Оружие ---
  gunmetal: { color: '#404143', metalness: 0.6, roughness: 0.45 }, // воронёная сталь
  steel: { color: '#7a7f85', metalness: 0.85, roughness: 0.3 }, // светлая сталь (затвор, мушка)
  darkSteel: { color: '#141517', metalness: 0.5, roughness: 0.6 }, // окна, прорези, канал ствола
  polymer: { color: '#1e1f21', metalness: 0.0, roughness: 0.72 }, // чёрный пластик
  rubber: { color: '#111213', metalness: 0.0, roughness: 0.95 }, // затыльники, наглазники
  wood: { color: '#7c4423', metalness: 0.0, roughness: 0.5 }, // лакированное дерево (АК)
  bakelite: { color: '#6b2f1c', metalness: 0.0, roughness: 0.45 }, // рыжий магазин АК
  greenPolymer: { color: '#4f5a36', metalness: 0.0, roughness: 0.7 }, // зелёная ложа снайперки
  anodized: { color: '#26282b', metalness: 0.35, roughness: 0.5 }, // анодированный алюминий (M4)
  tanPolymer: { color: '#9a8261', metalness: 0.0, roughness: 0.7 }, // пластик цвета «койот» (M4)
  olivePaint: { color: '#4a5135', metalness: 0.25, roughness: 0.6 }, // крашеный металл (короб пулемёта)
  brass: { color: '#c9a043', metalness: 0.9, roughness: 0.28 }, // гильзы
  copper: { color: '#b46a3c', metalness: 0.9, roughness: 0.3 }, // пули
  lens: { color: '#1b3550', metalness: 0.3, roughness: 0.05, emissive: '#0a1622' }, // стекло прицела
  sightDot: { color: '#f2f0e6', metalness: 0.0, roughness: 0.4, emissive: '#3a3a30' }, // точки на прицелах

  // --- Медицина ---
  gauze: { color: '#f1efe6', metalness: 0.0, roughness: 0.95 }, // марля
  gauzeShade: { color: '#d9d4c3', metalness: 0.0, roughness: 0.95 }, // витки марли
  medRed: { color: '#c3282d', metalness: 0.0, roughness: 0.6 }, // красный крест

  // --- Общие для бойцов ---
  skin: { color: '#c58f6b', metalness: 0.0, roughness: 0.7 },
  skinShade: { color: '#a8714f', metalness: 0.0, roughness: 0.75 }, // нос, уши
  eyes: { color: '#1a1714', metalness: 0.0, roughness: 0.3 },
  black: { color: '#1b1c1e', metalness: 0.0, roughness: 0.8 }, // ремни, подошвы
  lensDark: { color: '#0f1418', metalness: 0.4, roughness: 0.08 }, // тактические очки
  radio: { color: '#2a2c2b', metalness: 0.2, roughness: 0.6 },
};

const cache = new Map();

/**
 * spec: { color, metalness, roughness, emissive, texture }.
 * texture — имя узора из textures.js (камуфляж); color тогда служит оттенком.
 */
function createMaterial(name, spec) {
  const material = new THREE.MeshStandardMaterial({
    name,
    color: new THREE.Color(spec.color ?? '#ffffff'),
    metalness: spec.metalness ?? 0,
    roughness: spec.roughness ?? 0.8,
  });
  if (spec.emissive) material.emissive = new THREE.Color(spec.emissive);
  if (spec.texture) {
    material.map = patternTexture(spec.texture);
    material.userData.tile = material.map.userData.tile; // метров на один повтор узора
  }
  return material;
}

/**
 * Регистрирует дополнительный материал (например, цвета формы фракции).
 * Повторная регистрация с тем же именем ничего не меняет.
 */
export function defineMaterial(name, spec) {
  if (!cache.has(name)) cache.set(name, createMaterial(name, spec));
  return cache.get(name);
}

/** Материал по имени из палитры (или ранее зарегистрированный). */
export function getMaterial(name) {
  if (cache.has(name)) return cache.get(name);
  const spec = PALETTE[name];
  if (!spec) throw new Error(`Неизвестный материал: ${name}`);
  return defineMaterial(name, spec);
}
