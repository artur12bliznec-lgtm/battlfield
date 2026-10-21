// Текстуры частиц для эффектов боя: клубы дыма и языки пламени — по четыре
// варианта в атласе 2×2. Рисуются кодом (шум, градиенты) и пишутся в
// godot/assets/fx/*.png с прозрачностью. Запуск: npm run fx
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** RGBA-картинка → PNG. */
function png(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size * 4; x++) raw[y * (size * 4 + 1) + 1 + x] = rgba[y * size * 4 + x];
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Плавный шум на сетке freq×freq (не обязательно бесшовный). */
function valueNoise(freq, seed) {
  const r = random(seed);
  const g = Float32Array.from({ length: (freq + 1) * (freq + 1) }, r);
  const at = (i, j) => g[j * (freq + 1) + i];
  return (u, v) => {
    const x = Math.min(freq - 1e-6, Math.max(0, u * freq));
    const y = Math.min(freq - 1e-6, Math.max(0, v * freq));
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i, j + 1);
    const d = at(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fractal(seed, base = 3, octaves = 4) {
  const layers = Array.from({ length: octaves }, (_, k) => valueNoise(base << k, seed + k * 101));
  return (u, v) => {
    let s = 0;
    let w = 0;
    layers.forEach((f, k) => {
      const a = 1 / (1 << k);
      s += f(u, v) * a;
      w += a;
    });
    return s / w;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Атлас 2×2: draw(cell, u, v) → [r, g, b, a] (0..1), u, v ∈ [−1, 1]. */
function atlas(size, draw) {
  const cell = size / 2;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = Math.floor(y / cell) * 2 + Math.floor(x / cell);
      const u = ((x % cell) + 0.5) / cell * 2 - 1;
      const v = ((y % cell) + 0.5) / cell * 2 - 1;
      const [r, g, b, a] = draw(c, u, v);
      const i = (y * size + x) * 4;
      out[i] = Math.round(clamp01(r) * 255);
      out[i + 1] = Math.round(clamp01(g) * 255);
      out[i + 2] = Math.round(clamp01(b) * 255);
      out[i + 3] = Math.round(clamp01(a) * 255);
    }
  }
  return out;
}

/** Клуб дыма: «барашки» по краю, тени в складках, свет сверху-слева. Цвет даёт частица. */
function smoke() {
  const noises = [0, 1, 2, 3].map((k) => fractal(10 + k * 17, 3, 3));
  const reliefs = [0, 1, 2, 3].map((k) => fractal(60 + k * 13, 2, 2));
  const e = 0.06;
  return atlas(512, (c, u, v) => {
    const n = noises[c]((u + 1) / 2, (v + 1) / 2);
    const at = (a, b) => reliefs[c]((a + 1) / 2, (b + 1) / 2);
    const r = Math.hypot(u, v * 1.05);
    const edge = 1 - smooth(0.2, 0.95, r + (n - 0.5) * 1.0);
    const density = clamp01(edge * (0.25 + n ** 1.4 * 1.6) - 0.05);
    const alpha = smooth(0.0, 0.7, density);
    // рельеф: наклон «поверхности» шума даёт свет и тень
    const gx = (at(u + e, v) - at(u - e, v)) / (2 * e);
    const gy = (at(u, v + e) - at(u, v - e)) / (2 * e);
    const shade = 0.5 - (gx * 0.55 + gy * 0.75) * 0.6;
    const light = clamp01(0.55 + shade * 0.45 + (-u * 0.3 - v * 0.45) * 0.25 + density * 0.12);
    return [light, light, light * 0.98, alpha];
  });
}

/** Язык пламени: раскалённая сердцевина внизу, оранжевые рваные края и верхушка. */
function fire() {
  const noises = [0, 1, 2, 3].map((k) => fractal(200 + k * 23, 4, 5));
  return atlas(512, (c, u, v) => {
    const t = (1 - v) / 2; // 0 — низ, 1 — верх
    const n = noises[c]((u + 1) / 2, (v + 1) / 2);
    const sway = (n - 0.5) * 0.9 * t;
    const width = 0.5 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08)) ** 0.8 * (1 - t * 0.55);
    const d = Math.abs(u + sway) / Math.max(width, 1e-3);
    const body = (1 - smooth(0.3, 1.0, d + (n - 0.5) * 0.8)) * smooth(0.0, 0.15, t) * (1 - smooth(0.55, 0.95, t + (n - 0.5) * 0.45));
    const heat = clamp01(body * (1.15 - t * 0.9) * (0.6 + n * 0.6) - d * 0.25);
    const r = 0.8 + heat * 0.2;
    const g = 0.12 + heat * 0.7;
    const b = 0.02 + heat ** 3 * 0.45;
    return [r, g, b, clamp01(body * 1.1)];
  });
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'godot', 'assets', 'fx');
mkdirSync(dir, { recursive: true });
for (const [name, make] of Object.entries({ smoke, fire })) {
  const file = png(make(), 512);
  writeFileSync(path.join(dir, `${name}.png`), file);
  console.log(`${name}.png  ${(file.length / 1024).toFixed(0)} КБ`);
}
