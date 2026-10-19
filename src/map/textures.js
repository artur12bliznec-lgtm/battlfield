import { random, periodicNoise, blobs, registerPattern } from '../models/textures.js';

/*
 * Текстуры города. Все бесшовные, рисуются кодом при первой загрузке.
 * Цвет материала умножается на текстуру, поэтому штукатурка, бетон и
 * профнастил — почти белые: их красят материалы (одна картинка — много цветов).
 * tile — сколько метров занимает один повтор узора.
 */

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Пиксельный хэш: «зерно» без периодичности внутри картинки, но бесшовное по краям. */
function grain(seed) {
  return (x, y) => {
    let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2246822519, 3266489917) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
}

/** Холст size×size: draw(x, y) → [r, g, b]. */
function image(size, draw) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = draw(x, y);
      const i = (y * size + x) * 4;
      data[i] = clamp(Math.round(r));
      data[i + 1] = clamp(Math.round(g));
      data[i + 2] = clamp(Math.round(b));
      data[i + 3] = 255;
    }
  }
  return data;
}

const shade = ([r, g, b], k) => [r + k, g + k, b + k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ------------------------------------------------------------------ */
/* Дороги и тротуары                                                   */
/* ------------------------------------------------------------------ */

function asphalt(size) {
  const g = grain(3);
  const stains = blobs(4, 101, 0.1);
  const mid = periodicNoise(24, 7);
  const crackField = blobs(5, 211, 0.12);
  const crackZone = periodicNoise(3, 17);
  const base = hex('#56575a');
  return image(size, (x, y) => {
    const u = x / size;
    const v = y / size;
    let k = (g(x, y) - 0.5) * 22 + (mid(u, v) - 0.5) * 10 + (stains(u, v) - 0.5) * 30;
    if (g(x + 7, y + 3) > 0.975) k += 22; // светлый щебень
    const c = crackField(u, v);
    if (Math.abs(c - 0.5) < 0.0035 && crackZone(u, v) > 0.62) k -= 20; // трещины
    return shade(base, k);
  });
}

/** Тротуарная плитка 50×50 см. */
function pavers(size) {
  const g = grain(5);
  const stains = blobs(3, 41, 0.1);
  const cells = 4;
  const cell = size / cells;
  const r = random(9);
  const tone = Array.from({ length: cells * cells }, () => (r() - 0.5) * 14);
  const base = hex('#a19e96');
  const joint = hex('#7f7c76');
  return image(size, (x, y) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const fx = x - cx * cell;
    const fy = y - cy * cell;
    const edge = Math.min(fx, fy, cell - 1 - fx, cell - 1 - fy);
    if (edge < 1.5) return shade(joint, (g(x, y) - 0.5) * 10);
    const k = tone[cy * cells + cx] * 1.5 + (g(x, y) - 0.5) * 16 + (stains(x / size, y / size) - 0.5) * 34 - (edge < 3 ? 6 : 0);
    return shade(base, k);
  });
}

/** Брусчатка: ряды гранитных брусков со сдвигом на полкамня. */
function cobble(size) {
  const g = grain(11);
  const rows = 20;
  const perRow = 20;
  const rh = size / rows;
  const sw = size / perRow;
  const r = random(23);
  const palette = ['#7b776f', '#6c6a64', '#857c70', '#64625e', '#8d8a83', '#76706a'].map(hex);
  const stones = Array.from({ length: rows * perRow }, () => ({ c: palette[Math.floor(r() * palette.length)], k: (r() - 0.5) * 16, w: 0.8 + r() * 0.35 }));
  const stains = blobs(3, 71, 0.1);
  const joint = hex('#45423d');
  return image(size, (x, y) => {
    const row = Math.floor(y / rh);
    const shift = row % 2 ? sw / 2 : 0;
    const xs = (x + shift) % size;
    const col = Math.floor(xs / sw);
    const s = stones[row * perRow + col];
    const fx = xs - col * sw;
    const fy = y - row * rh;
    const dx = Math.min(fx, sw - 1 - fx);
    const dy = Math.min(fy, rh - 1 - fy);
    const corner = dx < 3 && dy < 3 ? 3 - Math.hypot(3 - dx, 3 - dy) : Math.min(dx, dy);
    if (corner < 1.2) return shade(joint, (g(x, y) - 0.5) * 12);
    const bevel = corner < 3.5 ? -12 * (1 - corner / 3.5) : 0;
    const light = fy < rh * 0.35 ? 5 : 0; // верхняя кромка камня чуть светлее
    return shade(s.c, s.k + bevel + light + (g(x, y) - 0.5) * 18 + (stains(x / size, y / size) - 0.5) * 16);
  });
}

/* ------------------------------------------------------------------ */
/* Стены                                                               */
/* ------------------------------------------------------------------ */

/** Штукатурка: почти белая, с разводами и «зерном». Цвет даёт материал. */
function plaster(size) {
  const g = grain(13);
  const stains = blobs(3, 301, 0.12);
  const fine = periodicNoise(32, 5);
  const streaks = periodicNoise(10, 19);
  const base = hex('#eeeae2');
  return image(size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const streak = Math.max(0, streaks(u, v * 0.15) - 0.62) * 50; // вертикальные потёки
    return shade(base, (g(x, y) - 0.5) * 10 + (fine(u, v) - 0.5) * 8 + (stains(u, v) - 0.5) * 26 - streak);
  });
}

/** Кирпичная кладка: 8 кирпичей в ряду, 32 ряда, ложковая перевязка. */
function brick(size) {
  const g = grain(17);
  const rows = 32;
  const perRow = 8;
  const rh = size / rows;
  const bw = size / perRow;
  const r = random(29);
  const palette = ['#9c4a33', '#8a3f2c', '#a85a3c', '#7e3a2a', '#b0644a', '#934534'].map(hex);
  const bricks = Array.from({ length: rows * perRow }, () => ({ c: palette[Math.floor(r() * palette.length)], k: (r() - 0.5) * 18 }));
  const soot = blobs(3, 91, 0.1);
  const mortar = hex('#b7ada0');
  return image(size, (x, y) => {
    const row = Math.floor(y / rh);
    const shift = row % 2 ? bw / 2 : 0;
    const xs = (x + shift) % size;
    const col = Math.floor(xs / bw);
    const fx = xs - col * bw;
    const fy = y - row * rh;
    if (fy < 2 || fx < 2) return shade(mortar, (g(x, y) - 0.5) * 16);
    const b = bricks[row * perRow + col];
    const edge = fy < 3 || fx < 3 ? -8 : 0;
    return shade(b.c, b.k + edge + (g(x, y) - 0.5) * 20 + (soot(x / size, y / size) - 0.5) * 24);
  });
}

/** Бетон: серый, с пятнами и раковинами. Цвет даёт материал. */
function concrete(size) {
  const g = grain(19);
  const stains = blobs(4, 401, 0.1);
  const fine = periodicNoise(20, 9);
  const base = hex('#e2e0da');
  return image(size, (x, y) => {
    let k = (g(x, y) - 0.5) * 16 + (fine(x / size, y / size) - 0.5) * 10 + (stains(x / size, y / size) - 0.5) * 30;
    if (g(x + 13, y + 29) > 0.985) k -= 40; // раковины
    return shade(base, k);
  });
}

/* ------------------------------------------------------------------ */
/* Крыши и металл                                                      */
/* ------------------------------------------------------------------ */

/**
 * Черепица: v растёт вверх по скату, поэтому тень от нахлёста — в начале
 * каждого ряда (нижний край плитки), к верху ряда плитка светлеет.
 */
function roofTiles(size) {
  const g = grain(23);
  const rows = 8;
  const perRow = 8;
  const rh = size / rows;
  const tw = size / perRow;
  const r = random(31);
  const palette = ['#a4533a', '#98492f', '#b2603f', '#8c4530', '#a85e45'].map(hex);
  const tiles = Array.from({ length: rows * perRow }, () => ({ c: palette[Math.floor(r() * palette.length)], k: (r() - 0.5) * 14 }));
  const moss = blobs(3, 501, 0.12);
  return image(size, (x, y) => {
    const row = Math.floor(y / rh);
    const shift = row % 2 ? tw / 2 : 0;
    const xs = (x + shift) % size;
    const col = Math.floor(xs / tw);
    const fx = xs - col * tw;
    const fy = y - row * rh;
    const t = tiles[row * perRow + col];
    let k = t.k + (g(x, y) - 0.5) * 14 + (fy / rh) * 16 - 8;
    if (fy < rh * 0.12) k -= 40; // тень от нахлёста
    if (fx < 1.5) k -= 22; // шов между плитками
    const round = Math.sin((fx / tw) * Math.PI); // плитка выпуклая
    let color = shade(t.c, k + round * 8);
    const m = moss(x / size, y / size);
    if (m > 0.6) color = mix(color, hex('#5d5f3f'), Math.min(1, (m - 0.6) * 3));
    return color;
  });
}

/** Профнастил / фальцевая кровля: светлые полосы вдоль v. Цвет даёт материал. */
function corrugated(size) {
  const g = grain(29);
  const ribs = 10;
  const rust = blobs(3, 601, 0.12);
  const base = hex('#d8d8d6');
  return image(size, (x, y) => {
    const phase = ((x / size) * ribs) % 1;
    const k = Math.sin(phase * Math.PI * 2) * 22 + (g(x, y) - 0.5) * 10;
    let color = shade(base, k);
    const rr = rust(x / size, y / size);
    if (rr > 0.62) color = mix(color, hex('#8a5a3c'), Math.min(0.8, (rr - 0.62) * 4));
    return color;
  });
}

/** Доски: горизонтальные, с волокнами. */
function planks(size) {
  const g = grain(31);
  const boards = 8;
  const bh = size / boards;
  const r = random(37);
  const tone = Array.from({ length: boards }, () => (r() - 0.5) * 24);
  const fibers = periodicNoise(64, 3);
  const base = hex('#8c6b4a');
  return image(size, (x, y) => {
    const b = Math.floor(y / bh);
    const fy = y - b * bh;
    if (fy < 2) return hex('#3b2c1f');
    const f = fibers((x / size) * 0.25 + b * 0.37, (y / size) * 4) - 0.5;
    return shade(base, tone[b] + f * 30 + (g(x, y) - 0.5) * 12);
  });
}

/* ------------------------------------------------------------------ */
/* Земля                                                               */
/* ------------------------------------------------------------------ */

function grass(size) {
  const g = grain(37);
  const patches = blobs(4, 701, 0.12);
  const dry = blobs(3, 709, 0.1);
  const base = hex('#5f6d3b');
  return image(size, (x, y) => {
    const u = x / size;
    const v = y / size;
    let color = shade(base, (g(x, y) - 0.5) * 30 + (patches(u, v) - 0.5) * 34);
    const d = dry(u, v);
    if (d > 0.58) color = mix(color, hex('#857a52'), Math.min(0.85, (d - 0.58) * 3.5));
    return color;
  });
}

function dirt(size) {
  const g = grain(41);
  const patches = blobs(4, 801, 0.12);
  const base = hex('#756a59');
  return image(size, (x, y) => {
    let k = (g(x, y) - 0.5) * 26 + (patches(x / size, y / size) - 0.5) * 36;
    if (g(x + 3, y + 11) > 0.96) k += 30; // камешки
    return shade(base, k);
  });
}

/* ------------------------------------------------------------------ */
/* Вывески: пиксельный шрифт 5×7                                       */
/* ------------------------------------------------------------------ */

const GLYPHS = {
  А: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  Б: ['#####', '#....', '#....', '####.', '#...#', '#...#', '####.'],
  В: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  Г: ['#####', '#....', '#....', '#....', '#....', '#....', '#....'],
  Д: ['..##.', '.#.#.', '.#.#.', '.#.#.', '.#.#.', '#####', '#...#'],
  Е: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  Ж: ['#.#.#', '#.#.#', '.###.', '..#..', '.###.', '#.#.#', '#.#.#'],
  З: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  И: ['#...#', '#...#', '#..##', '#.#.#', '##..#', '#...#', '#...#'],
  Й: ['.#.#.', '..#..', '#...#', '#..##', '#.#.#', '##..#', '#...#'],
  К: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  Л: ['..###', '.#..#', '.#..#', '.#..#', '.#..#', '.#..#', '#...#'],
  М: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  Н: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  О: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  П: ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#'],
  Р: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  С: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  Т: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  У: ['#...#', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
  Ф: ['..#..', '.###.', '#.#.#', '#.#.#', '#.#.#', '.###.', '..#..'],
  Х: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Ц: ['#..#.', '#..#.', '#..#.', '#..#.', '#..#.', '#####', '....#'],
  Ч: ['#...#', '#...#', '#...#', '.####', '....#', '....#', '....#'],
  Ш: ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'],
  Щ: ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####', '....#'],
  Ъ: ['##...', '.#...', '.#...', '.###.', '.#..#', '.#..#', '.###.'],
  Ы: ['#...#', '#...#', '#...#', '###.#', '#..##', '#..##', '###.#'],
  Ь: ['#....', '#....', '#....', '####.', '#...#', '#...#', '####.'],
  Э: ['.###.', '#...#', '....#', '..###', '....#', '#...#', '.###.'],
  Ю: ['#..#.', '#.#.#', '#.#.#', '###.#', '#.#.#', '#.#.#', '#..#.'],
  Я: ['.####', '#...#', '#...#', '.####', '..#.#', '.#..#', '#...#'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

/**
 * Вывески: [текст, фон, буквы]. Порядок важен — по индексу вывеска
 * находит свою ячейку в атласе.
 */
export const SIGNS = [
  ['АПТЕКА', '#23774a', '#f4f1e6'],
  ['ПРОДУКТЫ', '#203d5c', '#f2c94c'],
  ['ХЛЕБ', '#6b4423', '#f3e2c0'],
  ['КАФЕ', '#7a2626', '#f6efe4'],
  ['ПОЧТА', '#1f4e8c', '#f4f1e6'],
  ['БАНК', '#1d2a24', '#d8b65a'],
  ['ОБУВЬ', '#5a2236', '#f4f1e6'],
  ['ЦВЕТЫ', '#b0476a', '#fff6f0'],
  ['КНИГИ', '#1f4f50', '#f4f1e6'],
  ['УНИВЕРМАГ', '#a3262a', '#ffffff'],
  ['РАТУША', '#d9d2c0', '#2f2a22'],
  ['ГОСТИНИЦА', '#2b2b30', '#e9d38a'],
  ['ОПТИКА', '#2c5d8a', '#ffffff'],
  ['РЕМОНТ', '#3d3d3d', '#f2c94c'],
  ['ТАБАК', '#4b3621', '#f0dfc0'],
  ['ЧАСЫ', '#253041', '#e7e2d4'],
  ['МЯСО', '#8c2b22', '#f8efe2'],
  ['АВТОСЕРВИС', '#1f3a6b', '#ffffff'],
  ['БАР', '#141414', '#e94e3c'],
  ['ПАРИКМАХЕРСКАЯ', '#6a4c93', '#ffffff'],
  ['СТОЛОВАЯ', '#365e2c', '#f4f1e6'],
  ['ХОЗТОВАРЫ', '#c46a1b', '#ffffff'],
  ['АЗС', '#c62d2d', '#ffffff'],
  ['ОСТАНОВКА', '#2a5aa8', '#ffffff'],
  ['КИНО', '#151a3a', '#f2c94c'],
  ['ЦИРК', '#c0392b', '#f9e79f'],
  ['ТЕАТР', '#4a235a', '#f5eef8'],
  ['КОНЦЕРТ', '#0e6655', '#fdfefe'],
  ['ШКОЛА 5', '#d9d2c0', '#2f2a22'],
  ['ЦЕРКОВЬ', '#d9d2c0', '#2f2a22'],
  ['+', '#23774a', '#f4f1e6'],
  ['РЫНОК', '#7d5a2b', '#fff3d6'],
];

const ATLAS = 1024;
const CELL_W = 512;
const CELL_H = 64;
const SCALE = 6; // пикселей атласа на пиксель шрифта

function textWidth(text) {
  return text.length * 6 * SCALE - SCALE;
}

/** Где вывеска лежит в атласе: { u0, v0, u1, v1, aspect }. Ширина — по тексту. */
export function signRect(index) {
  const [text] = SIGNS[index];
  const col = index % 2;
  const row = Math.floor(index / 2);
  const width = Math.min(CELL_W, textWidth(text) + 4 * SCALE);
  const x0 = col * CELL_W + (CELL_W - width) / 2;
  const y0 = row * CELL_H;
  return { u0: x0 / ATLAS, u1: (x0 + width) / ATLAS, v0: y0 / ATLAS, v1: (y0 + CELL_H) / ATLAS, aspect: width / CELL_H };
}

export const signIndex = (text) => SIGNS.findIndex(([t]) => t === text);

function signAtlas() {
  const data = new Uint8Array(ATLAS * ATLAS * 4).fill(255);
  const put = (x, y, rgb) => {
    const i = (y * ATLAS + x) * 4;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  };
  SIGNS.forEach(([text, bg, fg], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x0 = col * CELL_W;
    const y0 = row * CELL_H;
    const back = hex(bg);
    const ink = hex(fg);
    for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) put(x0 + x, y0 + y, back);
    // тонкая рамка по краю текста
    const r = signRect(index);
    const fx0 = Math.round(r.u0 * ATLAS);
    const fx1 = Math.round(r.u1 * ATLAS) - 1;
    for (let x = fx0; x <= fx1; x++) {
      put(x, y0 + 3, shade(back, -30).map(clamp));
      put(x, y0 + CELL_H - 4, shade(back, -30).map(clamp));
    }
    for (let y = y0 + 3; y < y0 + CELL_H - 3; y++) {
      put(fx0 + 3, y, shade(back, -30).map(clamp));
      put(fx1 - 3, y, shade(back, -30).map(clamp));
    }
    const left = x0 + (CELL_W - textWidth(text)) / 2;
    const top = y0 + (CELL_H - 7 * SCALE) / 2;
    [...text].forEach((ch, k) => {
      const glyph = GLYPHS[ch] ?? GLYPHS[' '];
      glyph.forEach((line, gy) => {
        [...line].forEach((cell, gx) => {
          if (cell !== '#') return;
          for (let py = 0; py < SCALE; py++) {
            for (let px = 0; px < SCALE; px++) put(Math.round(left + k * 6 * SCALE + gx * SCALE + px), Math.round(top + gy * SCALE + py), ink);
          }
        });
      });
    });
  });
  return data;
}

/* ------------------------------------------------------------------ */

const CITY_PATTERNS = {
  asphalt: { tile: 8, make: () => asphalt(512) },
  pavers: { tile: 2, make: () => pavers(256) },
  cobble: { tile: 2.4, make: () => cobble(512) },
  plaster: { tile: 4, make: () => plaster(256) },
  brick: { tile: 2.4, make: () => brick(512) },
  concrete: { tile: 4, make: () => concrete(256) },
  roofTiles: { tile: 2, make: () => roofTiles(256) },
  corrugated: { tile: 1.2, make: () => corrugated(128) },
  planks: { tile: 1.6, make: () => planks(256) },
  grass: { tile: 4, make: () => grass(256) },
  dirt: { tile: 4, make: () => dirt(256) },
  signs: { tile: 1, make: signAtlas },
};

for (const [name, pattern] of Object.entries(CITY_PATTERNS)) registerPattern(name, pattern);
