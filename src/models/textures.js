import * as THREE from 'three';

/*
 * Процедурные текстуры-узоры: камуфляж и ткань шемага.
 * Все узоры бесшовные (тайлятся), поэтому их можно повторять по всей форме.
 * Размер — 512×512, цветов немного: в .glb они сохраняются компактным PNG.
 */

export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Периодический value-шум: при u, v ∈ [0, 1) стыкуется сам с собой. */
export function periodicNoise(freq, seed) {
  const r = random(seed);
  const grid = Float32Array.from({ length: freq * freq }, r);
  const at = (i, j) => grid[(((j % freq) + freq) % freq) * freq + (((i % freq) + freq) % freq)];
  return (u, v) => {
    const x = u * freq;
    const y = v * freq;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Фрактальный шум из нескольких октав с искажением координат — «пятна». */
export function blobs(freq, seed, warp = 0.06) {
  const octaves = [0, 1, 2].map((o) => periodicNoise(freq << o, seed + o * 977));
  const wu = periodicNoise(freq, seed + 31);
  const wv = periodicNoise(freq, seed + 57);
  return (u, v) => {
    const x = (u + warp * (wu(u, v) - 0.5) + 1) % 1;
    const y = (v + warp * (wv(u, v) - 0.5) + 1) % 1;
    return (octaves[0](x, y) * 4 + octaves[1](x, y) * 2 + octaves[2](x, y)) / 7;
  };
}

const rgb = (hex) => new THREE.Color(hex).getHex();

/** Рисует узор: слои пятен поверх базового цвета. pixel > 1 — «цифровой» камуфляж. */
function paint(size, base, layers, pixel = 1) {
  const data = new Uint8Array(size * size * 4);
  const noises = layers.map((l) => ({ ...l, field: blobs(l.freq, l.seed, l.warp) }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (Math.floor(x / pixel) * pixel) / size;
      const v = (Math.floor(y / pixel) * pixel) / size;
      let color = base;
      for (const l of noises) if (l.field(u, v) > l.threshold) color = l.color;
      const i = (y * size + x) * 4;
      data[i] = (color >> 16) & 255;
      data[i + 1] = (color >> 8) & 255;
      data[i + 2] = color & 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Ткань шемага: светлая основа, чёрная «сетка» с ромбами. */
function shemagh(size) {
  const data = new Uint8Array(size * size * 4);
  const light = rgb('#d9d5c7');
  const dark = rgb('#24231f');
  const cell = size / 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (x % cell) - cell / 2;
      const cy = (y % cell) - cell / 2;
      const line = Math.abs(cx) < 1.2 || Math.abs(cy) < 1.2;
      const diamond = Math.abs(cx) + Math.abs(cy) < cell * 0.22;
      const color = line || diamond ? dark : light;
      const i = (y * size + x) * 4;
      data[i] = (color >> 16) & 255;
      data[i + 1] = (color >> 8) & 255;
      data[i + 2] = color & 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

/*
 * tile — сколько метров занимает один повтор узора на модели.
 */
const PATTERNS = {
  woodland: {
    tile: 0.42,
    make: () => paint(512, rgb('#6c7451'), [
      { color: rgb('#8b8761'), freq: 5, seed: 11, threshold: 0.6, warp: 0.08 },
      { color: rgb('#46523a'), freq: 4, seed: 23, threshold: 0.53, warp: 0.1 },
      { color: rgb('#5b4732'), freq: 5, seed: 37, threshold: 0.57, warp: 0.1 },
      { color: rgb('#2b2c26'), freq: 6, seed: 41, threshold: 0.64, warp: 0.12 },
    ]),
  },
  desertDigital: {
    tile: 0.5,
    make: () => paint(512, rgb('#b19b70'), [
      { color: rgb('#cbbb93'), freq: 5, seed: 7, threshold: 0.56, warp: 0.06 },
      { color: rgb('#8c7653'), freq: 4, seed: 19, threshold: 0.56, warp: 0.08 },
      { color: rgb('#6e6b4c'), freq: 6, seed: 29, threshold: 0.63, warp: 0.08 },
    ], 8),
  },
  shemagh: { tile: 0.12, make: () => shemagh(128) },
};

/**
 * Добавить узор из другого модуля (например, текстуры карты).
 * pattern: { tile — метров на повтор, make() → RGBA-пиксели квадратной картинки }.
 */
export function registerPattern(name, pattern) {
  PATTERNS[name] ??= pattern;
}

const cache = new Map();

/** Текстура по имени узора (общая для всех моделей). */
export function patternTexture(name) {
  if (cache.has(name)) return cache.get(name);
  const pattern = PATTERNS[name];
  if (!pattern) throw new Error(`Неизвестный узор: ${name}`);
  const data = pattern.make();
  const size = Math.round(Math.sqrt(data.length / 4));
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.userData.tile = pattern.tile;
  cache.set(name, texture);
  return texture;
}
