// Синтез звуков боя: выстрелы каждого оружия, перезарядка, разрывы рядом и
// вдали, далёкая стрельба, треск и рикошет пуль, свист снаряда, сирена,
// огонь и фоновый гул. Ничего не записано с микрофона — всё считается кодом
// (шум, фильтры, огибающие, реверберация улицы) и пишется в
// godot/assets/sounds/*.wav: 16 бит, моно, 22 050 Гц.
// Петли (огонь, фон) несут метку smpl — Godot сам включает повтор.
// Запуск: npm run sounds
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RATE = 22050;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Основа: случайные числа, буферы, фильтры                            */
/* ------------------------------------------------------------------ */

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

const samples = (seconds) => new Float32Array(Math.ceil(seconds * RATE));

function noise(n, rnd) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rnd() * 2 - 1;
  return out;
}

/** Биквадратный фильтр (формулы RBJ): lowpass, highpass, bandpass, peak. */
function biquad(x, type, f0, q = 0.707, gainDb = 0) {
  const w = (TAU * f0) / RATE;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const A = 10 ** (gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') [b0, b1, b2, a0, a1, a2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
  else if (type === 'highpass') [b0, b1, b2, a0, a1, a2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
  else if (type === 'bandpass') [b0, b1, b2, a0, a1, a2] = [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha];
  else [b0, b1, b2, a0, a1, a2] = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

const lowpass = (x, f, q) => biquad(x, 'lowpass', f, q);
const highpass = (x, f, q) => biquad(x, 'highpass', f, q);
const bandpass = (x, f, q) => biquad(x, 'bandpass', f, q);

/** Огибающая: быстрая атака, экспоненциальный спад с постоянной tau (с). */
function shape(x, { attack = 0.001, tau = 0.1, hold = 0 } = {}) {
  const a = attack * RATE;
  const h = hold * RATE;
  for (let i = 0; i < x.length; i++) {
    const k = i < a ? i / a : i < a + h ? 1 : Math.exp(-(i - a - h) / (tau * RATE));
    x[i] *= k;
  }
  return x;
}

/** Добавить src в dst с задержкой at (с) и громкостью gain. */
function mixIn(dst, src, at = 0, gain = 1) {
  const o = Math.round(at * RATE);
  for (let i = 0; i < src.length && i + o < dst.length; i++) if (i + o >= 0) dst[i + o] += src[i] * gain;
  return dst;
}

const scale = (x, k) => x.map((v) => v * k);

function softclip(x, drive = 1) {
  const n = Math.tanh(drive);
  return x.map((v) => Math.tanh(v * drive) / n);
}

function normalize(x, peak = 0.95) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return m > 0 ? scale(x, peak / m) : x;
}

/** Тон со скользящей частотой f(t) и огибающей amp(t). */
function tone(seconds, f, amp, harmonics = [1]) {
  const out = samples(seconds);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    phase += (TAU * f(t)) / RATE;
    let v = 0;
    harmonics.forEach((h, k) => (v += Math.sin(phase * (k + 1)) * h));
    out[i] = v * amp(t);
  }
  return out;
}

/**
 * Реверберация улицы (Шрёдер–Мурер): гребенчатые фильтры с затуханием в петле
 * и два всепропускающих. early — ранние отражения от стен: [[задержка, громкость]].
 */
function reverb(x, { rt60 = 1.2, wet = 0.35, damp = 2500, pre = 0.015, early = [], tail = 0 } = {}) {
  const n = x.length + Math.round(tail * RATE);
  const src = new Float32Array(n);
  src.set(x);
  const sum = new Float32Array(n);
  const preN = Math.round(pre * RATE);
  const a = 1 - Math.exp((-TAU * damp) / RATE);
  for (const d of [0.0297, 0.0371, 0.0411, 0.0437, 0.0503, 0.0571]) {
    const D = Math.round(d * RATE);
    const g = 10 ** ((-3 * d) / rt60);
    const buf = new Float32Array(D);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const input = i >= preN ? src[i - preN] : 0;
      const y = buf[idx];
      lp += a * (y - lp);
      buf[idx] = input + lp * g;
      idx = (idx + 1) % D;
      sum[i] += y / 6;
    }
  }
  let y = sum;
  for (const [d, g] of [[0.005, 0.7], [0.0017, 0.7]]) {
    const D = Math.round(d * RATE);
    const buf = new Float32Array(D);
    const o = new Float32Array(n);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const delayed = buf[idx];
      const w = y[i] + g * delayed;
      buf[idx] = w;
      o[i] = delayed - g * w;
      idx = (idx + 1) % D;
    }
    y = o;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = src[i] + y[i] * wet;
  const reflections = lowpass(src, 3500);
  for (const [d, g] of early) mixIn(out, reflections, d, g);
  return out;
}

function fadeOut(x, seconds) {
  const n = Math.round(seconds * RATE);
  for (let i = 0; i < n && i < x.length; i++) x[x.length - 1 - i] *= i / n;
  return x;
}

/** Бесшовная петля: конец плавно перетекает в начало. */
function loop(x, overlap) {
  const o = Math.round(overlap * RATE);
  const n = x.length - o;
  const out = x.slice(0, n);
  for (let i = 0; i < o; i++) {
    const t = i / o;
    out[i] = x[i] * Math.sqrt(t) + x[n + i] * Math.sqrt(1 - t);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Выстрелы                                                            */
/* ------------------------------------------------------------------ */

/** Отражения на улице: стены домов по обе стороны и дальние фасады. */
const STREET = [[0.045, 0.32], [0.083, 0.26], [0.131, 0.2], [0.187, 0.14], [0.26, 0.1], [0.36, 0.07]];

/**
 * Выстрел: щелчок сверхзвуковой пули, «тело» дульной волны, низкий удар и
 * отзвук улицы. body — частота среза дульной волны, bass — частота удара,
 * crack — громкость щелчка, tail — длина отзвука (rt60), punch — «жёсткость».
 */
function gunshot({ seed, body = 2600, bass = 110, crack = 0.6, tail = 1.3, punch = 3, mech = 0.15, length = 1.5 }) {
  const rnd = random(seed);
  const n = Math.round(0.4 * RATE);
  const dry = new Float32Array(n);
  // щелчок пули: широкополосный, 2–3 мс
  mixIn(dry, shape(highpass(noise(Math.round(0.004 * RATE), rnd), 1800), { attack: 0.0002, tau: 0.0012 }), 0, crack);
  // дульная волна: шум с быстрым спадом
  const blast = shape(lowpass(noise(n, rnd), body, 0.8), { attack: 0.0006, tau: 0.028 });
  mixIn(dry, blast, 0.0005, 1.0);
  const low = shape(lowpass(noise(n, rnd), body * 0.3), { attack: 0.001, tau: 0.06 });
  mixIn(dry, low, 0.001, 0.9);
  // удар: низкий тон с падающей высотой
  mixIn(dry, tone(0.25, (t) => bass * (1 + 1.6 * Math.exp(-t / 0.012)), (t) => Math.exp(-t / 0.045)), 0, 0.9);
  // механика затвора
  if (mech) mixIn(dry, shape(bandpass(noise(Math.round(0.03 * RATE), rnd), 3800, 3), { attack: 0.0005, tau: 0.006 }), 0.035, mech);
  const shot = softclip(normalize(dry, 1), punch);
  const wet = reverb(shot, { rt60: tail, wet: 1.3, damp: 2200, early: STREET, tail: length });
  return fadeOut(normalize(wet.slice(0, Math.round(length * RATE)), 0.95), 0.25);
}

/* ------------------------------------------------------------------ */
/* Механика: щелчки, перезарядка, гильзы                               */
/* ------------------------------------------------------------------ */

/** Металлический щелчок: удар шума и звон резонансов. */
function clack(rnd, { freq = 2600, ring = [1800, 3400, 5200], tau = 0.008, ringTau = 0.03, gain = 1 } = {}) {
  const n = Math.round(0.12 * RATE);
  const out = shape(bandpass(noise(n, rnd), freq, 1.5), { attack: 0.0003, tau });
  ring.forEach((f, k) => mixIn(out, tone(0.12, () => f * (1 + (rnd() - 0.5) * 0.04), (t) => Math.exp(-t / (ringTau / (k + 1)))), 0, 0.25 / (k + 1)));
  return scale(out, gain);
}

/** Шорох трения: скольжение магазина, затвора, ткани. */
function slide(rnd, seconds, freq = 3000, gain = 0.4) {
  const out = bandpass(noise(Math.round(seconds * RATE), rnd), freq, 0.9);
  for (let i = 0; i < out.length; i++) out[i] *= Math.sin((Math.PI * i) / out.length) * gain;
  return out;
}

function reloadRifle() {
  const rnd = random(31);
  const out = samples(2.4);
  mixIn(out, clack(rnd, { freq: 3200, gain: 0.5 }), 0.22); // кнопка защёлки
  mixIn(out, slide(rnd, 0.14, 2400, 0.35), 0.28); // магазин выходит
  mixIn(out, clack(rnd, { freq: 1600, ring: [900, 1900], gain: 0.6 }), 0.43);
  mixIn(out, slide(rnd, 0.1, 2600, 0.4), 1.02); // новый магазин
  mixIn(out, clack(rnd, { freq: 1900, ring: [1200, 2600, 4100], tau: 0.01, gain: 1 }), 1.13);
  mixIn(out, slide(rnd, 0.12, 3500, 0.45), 1.68); // затвор на себя
  mixIn(out, clack(rnd, { freq: 3000, gain: 0.55 }), 1.8);
  mixIn(out, clack(rnd, { freq: 2200, ring: [1500, 3100, 4800], tau: 0.012, gain: 1.1 }), 1.97); // затвор вперёд
  return normalize(reverb(out, { rt60: 0.35, wet: 0.2, damp: 4000 }).slice(0, out.length), 0.8);
}

function reloadPistol() {
  const rnd = random(37);
  const out = samples(1.8);
  mixIn(out, clack(rnd, { freq: 3600, gain: 0.5 }), 0.18);
  mixIn(out, slide(rnd, 0.08, 3000, 0.3), 0.24);
  mixIn(out, clack(rnd, { freq: 2000, ring: [1300, 2800], gain: 0.5 }), 0.32);
  mixIn(out, slide(rnd, 0.07, 3200, 0.35), 0.82);
  mixIn(out, clack(rnd, { freq: 2300, ring: [1600, 3300, 5000], gain: 0.9 }), 0.9);
  mixIn(out, clack(rnd, { freq: 2600, ring: [1700, 3600, 5600], tau: 0.012, gain: 1.1 }), 1.35); // затворная задержка
  return normalize(reverb(out, { rt60: 0.3, wet: 0.2, damp: 4000 }).slice(0, out.length), 0.75);
}

function dryFire() {
  const rnd = random(41);
  const out = samples(0.25);
  mixIn(out, clack(rnd, { freq: 4200, ring: [2600, 5400], tau: 0.004, gain: 1 }), 0.005);
  return normalize(out, 0.6);
}

function casings() {
  const rnd = random(43);
  const out = samples(1.0);
  for (let k = 0; k < 7; k++) {
    const t = 0.15 + rnd() * 0.6;
    const f = 4200 + rnd() * 3200;
    mixIn(out, tone(0.08, () => f, (u) => Math.exp(-u / 0.012)), t, 0.4 * (1 - t * 0.6));
    mixIn(out, tone(0.08, () => f * 1.47, (u) => Math.exp(-u / 0.008)), t, 0.2);
  }
  return normalize(out, 0.45);
}

function bandage() {
  const rnd = random(47);
  const out = samples(2.8);
  for (let k = 0; k < 14; k++) mixIn(out, slide(rnd, 0.08 + rnd() * 0.18, 2200 + rnd() * 2500, 0.3 + rnd() * 0.3), 0.1 + k * 0.18 + rnd() * 0.05);
  return normalize(out, 0.4);
}

/* ------------------------------------------------------------------ */
/* Пули: треск, рикошет, попадание                                     */
/* ------------------------------------------------------------------ */

function crack() {
  const rnd = random(53);
  const out = samples(0.5);
  // N-волна: резкий скачок давления и спад за ~0.7 мс
  const w = Math.round(0.0007 * RATE);
  for (let i = 0; i < w * 2; i++) out[i + 10] += i < w ? 1 - (2 * i) / w : -1 + (i - w) / w;
  // свист следом: полоса шума с падающей частотой
  const whiz = new Float32Array(Math.round(0.12 * RATE));
  const src = noise(whiz.length, rnd);
  let lo = 0, hi = 0;
  for (let i = 0; i < whiz.length; i++) {
    const f = 3200 * Math.exp(-i / (0.05 * RATE)) + 900;
    const a = 1 - Math.exp((-TAU * f) / RATE);
    lo += a * (src[i] - lo);
    hi += 0.2 * (lo - hi);
    whiz[i] = (lo - hi) * Math.exp(-i / (0.035 * RATE));
  }
  mixIn(out, whiz, 0.002, 0.7);
  return normalize(reverb(out, { rt60: 0.6, wet: 0.35, early: STREET.slice(0, 3) }).slice(0, out.length), 0.9);
}

function ricochet(seed) {
  const rnd = random(seed);
  const out = samples(0.7);
  mixIn(out, shape(highpass(noise(Math.round(0.01 * RATE), rnd), 2000), { tau: 0.002 }), 0, 0.8);
  const f0 = 2600 + rnd() * 1400;
  mixIn(out, tone(0.6, (t) => f0 * Math.exp(-t * 1.6) + 600, (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.22), [1, 0.3, 0.1]), 0.005, 0.5);
  return normalize(reverb(out, { rt60: 0.8, wet: 0.3, early: STREET.slice(0, 4) }).slice(0, out.length), 0.7);
}

function impact(seed) {
  const rnd = random(seed);
  const out = samples(0.45);
  mixIn(out, shape(lowpass(noise(Math.round(0.05 * RATE), rnd), 700), { attack: 0.0005, tau: 0.012 }), 0, 1);
  mixIn(out, shape(bandpass(noise(Math.round(0.02 * RATE), rnd), 3000, 1.2), { tau: 0.003 }), 0, 0.6);
  for (let k = 0; k < 9; k++) mixIn(out, shape(bandpass(noise(Math.round(0.01 * RATE), rnd), 2500 + rnd() * 2500, 2), { tau: 0.002 }), 0.03 + rnd() * 0.25, 0.12 * rnd());
  return normalize(reverb(out, { rt60: 0.5, wet: 0.25 }).slice(0, out.length), 0.7);
}

/** Отметка попадания: сухой короткий «тик» (игрок попал по врагу). */
function hitmarker() {
  const rnd = random(61);
  const out = samples(0.12);
  mixIn(out, shape(bandpass(noise(Math.round(0.01 * RATE), rnd), 4800, 2.5), { attack: 0.0002, tau: 0.0018 }), 0, 1);
  mixIn(out, tone(0.1, () => 2950, (t) => Math.exp(-t / 0.014), [1, 0.35]), 0.0005, 0.55);
  return normalize(out, 0.8);
}

/** Пуля попала в бойца игрока: глухой удар в бронежилет. */
function hurt() {
  const rnd = random(63);
  const out = samples(0.35);
  mixIn(out, shape(lowpass(noise(Math.round(0.08 * RATE), rnd), 500), { attack: 0.0005, tau: 0.025 }), 0, 1);
  mixIn(out, tone(0.3, (t) => 95 * Math.exp(-t * 3) + 45, (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.06)), 0, 0.9);
  mixIn(out, shape(bandpass(noise(Math.round(0.03 * RATE), rnd), 1800, 1.2), { tau: 0.006 }), 0.002, 0.25);
  return normalize(out, 0.85);
}

/* ------------------------------------------------------------------ */
/* Разрывы, стрельба вдали, свист снаряда, сирена                      */
/* ------------------------------------------------------------------ */

function explosion(seed, { far = false, length = 4.5 } = {}) {
  const rnd = random(seed);
  const n = Math.round(length * RATE);
  const dry = new Float32Array(n);
  // ударная волна: шум с быстрой атакой и низкий удар с падающим тоном
  mixIn(dry, shape(lowpass(noise(Math.round(1.2 * RATE), rnd), 1100, 0.7), { attack: 0.002, tau: 0.13 }), 0, 1);
  mixIn(dry, shape(lowpass(noise(Math.round(2 * RATE), rnd), 220), { attack: 0.004, tau: 0.35 }), 0, 1.4);
  mixIn(dry, tone(1.6, (t) => 55 * (1 + Math.exp(-t / 0.05)) - 20 * t, (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.4)), 0, 1.2);
  // осколки и падающий щебень
  for (let k = 0; k < 140; k++) {
    const t = 0.08 + rnd() ** 1.6 * 1.8;
    const grain = shape(bandpass(noise(Math.round((0.004 + rnd() * 0.02) * RATE), rnd), 800 + rnd() * 3500, 1.5), { tau: 0.004 + rnd() * 0.01 });
    mixIn(dry, grain, t, 0.25 * (1 - t / 2.2) * rnd());
  }
  // раскатистый гул
  mixIn(dry, shape(lowpass(noise(n, rnd), 140), { attack: 0.05, tau: 1.1 }), 0.05, 0.9);
  let out = softclip(normalize(dry, 1), far ? 1.5 : 2.5);
  if (far) out = lowpass(lowpass(out, 520), 900);
  out = reverb(out, { rt60: far ? 3.2 : 2.4, wet: far ? 0.8 : 0.5, damp: far ? 900 : 1800, pre: far ? 0.05 : 0.02, early: far ? [[0.31, 0.4], [0.62, 0.3], [1.1, 0.2]] : STREET });
  return fadeOut(normalize(out.slice(0, n), far ? 0.8 : 0.98), 0.8);
}

/** Стрельба вдали: очереди и одиночные, глухие, с эхом. */
function farGunfire(seed, { pattern = 'rifle', length = 5 } = {}) {
  const rnd = random(seed);
  const n = Math.round(length * RATE);
  const dry = new Float32Array(n);
  const pop = (gain, body) => {
    const p = shape(lowpass(noise(Math.round(0.12 * RATE), rnd), body), { attack: 0.0008, tau: 0.03 });
    mixIn(p, tone(0.15, () => 140 + rnd() * 30, (t) => Math.exp(-t / 0.03)), 0, 0.6);
    return scale(p, gain);
  };
  let t = 0.1;
  while (t < length - 0.8) {
    if (pattern === 'mg') {
      const shots = 8 + Math.floor(rnd() * 12);
      for (let k = 0; k < shots; k++) mixIn(dry, pop(0.7 + rnd() * 0.3, 900), t + k * 0.085);
      t += shots * 0.085 + 0.6 + rnd() * 1.2;
    } else {
      const shots = rnd() < 0.4 ? 1 : 2 + Math.floor(rnd() * 4);
      const gain = 0.4 + rnd() * 0.6;
      const body = 700 + rnd() * 900;
      for (let k = 0; k < shots; k++) mixIn(dry, pop(gain * (0.8 + rnd() * 0.2), body), t + k * (0.08 + rnd() * 0.02));
      t += shots * 0.09 + 0.15 + rnd() * 0.9;
    }
  }
  const out = reverb(dry, { rt60: 2.4, wet: 0.9, damp: 1100, pre: 0.03, early: [[0.21, 0.35], [0.47, 0.25], [0.83, 0.15]] });
  return fadeOut(normalize(lowpass(out.slice(0, n), 1400), 0.75), 0.6);
}

/** Свист подлетающего снаряда: тон падает, громкость нарастает. */
function whistle() {
  const rnd = random(61);
  const len = 1.7;
  const out = tone(len, (t) => 1500 * Math.exp(-t * 0.75) + 280, (t) => (0.15 + (t / len) ** 2) * (t > len - 0.03 ? (len - t) / 0.03 : 1), [1, 0.15]);
  const hiss = shape(bandpass(noise(out.length, rnd), 2400, 0.7), { attack: len * 0.8, tau: 1 });
  mixIn(out, hiss, 0, 0.12);
  return normalize(reverb(out, { rt60: 1.2, wet: 0.25 }).slice(0, out.length), 0.55);
}

/** Воздушная тревога вдали: вой сирены, вверх и вниз. */
function siren() {
  const len = 14;
  const f = (t) => {
    const cycle = t % 7;
    const up = Math.min(1, cycle / 2.6);
    const down = cycle > 4.4 ? Math.max(0, 1 - (cycle - 4.4) / 2.6) : 1;
    return 180 + 420 * Math.min(up, down);
  };
  let out = tone(len, f, (t) => Math.min(1, t / 1.5) * Math.min(1, (len - t) / 2), [1, 0.5, 0.25, 0.12]);
  out = lowpass(out, 1500);
  out = reverb(out, { rt60: 3.5, wet: 1.0, damp: 1200, pre: 0.08, early: [[0.4, 0.4], [0.9, 0.25]] });
  return normalize(out.slice(0, Math.round(len * RATE)), 0.45);
}

/* ------------------------------------------------------------------ */
/* Петли: огонь и фон                                                  */
/* ------------------------------------------------------------------ */

function fireLoop() {
  const rnd = random(71);
  const len = 6.5;
  const n = Math.round(len * RATE);
  const out = new Float32Array(n);
  // гул пламени с медленной пульсацией
  const roar = lowpass(noise(n, rnd), 320);
  const flutter = bandpass(noise(n, rnd), 700, 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    out[i] += roar[i] * (0.7 + 0.3 * Math.sin(t * 2.1) * Math.sin(t * 0.7 + 1)) * 1.4;
    out[i] += flutter[i] * (0.4 + 0.4 * Math.max(0, Math.sin(t * 9.3 + Math.sin(t * 3.1) * 2))) * 0.6;
  }
  // треск: короткие щелчки, иногда громкие
  for (let k = 0; k < len * 9; k++) {
    const pop = shape(highpass(noise(Math.round((0.002 + rnd() * 0.006) * RATE), rnd), 900 + rnd() * 2000), { attack: 0.0002, tau: 0.002 + rnd() * 0.004 });
    mixIn(out, pop, rnd() * (len - 0.05), rnd() < 0.1 ? 1.4 : 0.2 + rnd() * 0.5);
  }
  return normalize(loop(out, 0.6), 0.7);
}

function ambienceLoop() {
  const rnd = random(81);
  const len = 26;
  const n = Math.round(len * RATE);
  const out = new Float32Array(n);
  // ветер: полоса шума с плавающей частотой
  const src = noise(n, rnd);
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 380 + 220 * Math.sin(t * 0.21) + 90 * Math.sin(t * 0.73 + 2);
    const a = 1 - Math.exp((-TAU * f) / RATE);
    lo += a * (src[i] - lo);
    hi += 0.03 * (lo - hi);
    out[i] = (lo - hi) * (0.55 + 0.35 * Math.sin(t * 0.17 + 1) + 0.15 * Math.sin(t * 0.61));
  }
  out.set(lowpass(out, 900));
  // низкий гул далёкого боя
  const rumble = lowpass(lowpass(noise(n, rnd), 70), 90);
  for (let i = 0; i < n; i++) out[i] += rumble[i] * (2.2 + 1.2 * Math.sin((i / RATE) * 0.13));
  // редкие глухие разрывы и перестрелки очень далеко
  for (let k = 0; k < 5; k++) mixIn(out, lowpass(explosion(900 + k, { far: true, length: 4 }), 300), 1 + k * 4.8 + rnd() * 2, 0.35 + rnd() * 0.2);
  for (let k = 0; k < 4; k++) mixIn(out, lowpass(farGunfire(950 + k, { pattern: k % 2 ? 'mg' : 'rifle', length: 4 }), 700), 2.5 + k * 5.6 + rnd() * 2, 0.12 + rnd() * 0.1);
  return normalize(loop(out, 1.5), 0.5);
}

/* ------------------------------------------------------------------ */
/* Запись WAV                                                          */
/* ------------------------------------------------------------------ */

function wav(data, { looped = false } = {}) {
  const pcm = Buffer.alloc(data.length * 2);
  for (let i = 0; i < data.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), i * 2);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(1, 10); // моно
  fmt.writeUInt32LE(RATE, 12);
  fmt.writeUInt32LE(RATE * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const head = Buffer.alloc(8);
  head.write('data', 0);
  head.writeUInt32LE(pcm.length, 4);
  const chunks = [fmt, head, pcm];
  if (looped) {
    // smpl: 9 полей заголовка и одна петля «вперёд» на весь звук
    const smpl = Buffer.alloc(8 + 36 + 24);
    smpl.write('smpl', 0);
    smpl.writeUInt32LE(36 + 24, 4);
    smpl.writeUInt32LE(Math.round(1e9 / RATE), 16);
    smpl.writeUInt32LE(60, 20);
    smpl.writeUInt32LE(1, 36);
    smpl.writeUInt32LE(0, 44 + 4); // тип петли: вперёд
    smpl.writeUInt32LE(0, 44 + 8); // начало
    smpl.writeUInt32LE(data.length - 1, 44 + 12); // конец
    chunks.push(smpl);
  }
  const body = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0);
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WAVE', 8);
  return Buffer.concat([riff, body]);
}

/* ------------------------------------------------------------------ */

const SOUNDS = {
  // выстрелы оружия игрока и союзников
  shot_assault_rifle: () => gunshot({ seed: 1, body: 2300, bass: 105, crack: 0.55, tail: 1.3, punch: 3.2 }),
  shot_rifle: () => gunshot({ seed: 2, body: 3000, bass: 120, crack: 0.7, tail: 1.2, punch: 2.8 }),
  shot_machine_gun: () => gunshot({ seed: 3, body: 1900, bass: 90, crack: 0.6, tail: 1.5, punch: 3.6, mech: 0.1 }),
  shot_sniper_rifle: () => gunshot({ seed: 4, body: 1700, bass: 75, crack: 1.0, tail: 2.2, punch: 4, length: 2.6 }),
  shot_pistol: () => gunshot({ seed: 5, body: 3400, bass: 150, crack: 0.35, tail: 0.9, punch: 2.4, mech: 0.25, length: 1.1 }),
  // механика
  reload_rifle: reloadRifle,
  reload_pistol: reloadPistol,
  dry_fire: dryFire,
  casings,
  bandage,
  // пули
  bullet_crack: crack,
  ricochet_1: () => ricochet(55),
  ricochet_2: () => ricochet(56),
  impact_1: () => impact(57),
  impact_2: () => impact(58),
  hitmarker,
  hurt,
  // разрывы и бой вдали
  explosion_near_1: () => explosion(101),
  explosion_near_2: () => explosion(102),
  explosion_far_1: () => explosion(111, { far: true, length: 5.5 }),
  explosion_far_2: () => explosion(112, { far: true, length: 5.5 }),
  gunfire_far_1: () => farGunfire(121, { pattern: 'rifle' }),
  gunfire_far_2: () => farGunfire(122, { pattern: 'mg' }),
  gunfire_far_3: () => farGunfire(123, { pattern: 'rifle', length: 6 }),
  shell_whistle: whistle,
  siren,
  // петли
  fire_loop: () => ({ data: fireLoop(), looped: true }),
  ambience_loop: () => ({ data: ambienceLoop(), looped: true }),
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'godot', 'assets', 'sounds');
mkdirSync(dir, { recursive: true });
let total = 0;
for (const [name, make] of Object.entries(SOUNDS)) {
  const result = make();
  const { data: raw, looped } = result instanceof Float32Array ? { data: result, looped: false } : result;
  const peak = raw.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const data = normalize(highpass(raw, 25), peak); // без постоянной составляющей — без щелчков
  const file = wav(data, { looped });
  writeFileSync(path.join(dir, `${name}.wav`), file);
  total += file.length;
  console.log(`${name.padEnd(20)} ${(data.length / RATE).toFixed(2)} с  ${(file.length / 1024).toFixed(0).padStart(5)} КБ${looped ? '  петля' : ''}`);
}
console.log(`Всего: ${(total / 1024 / 1024).toFixed(2)} МБ → godot/assets/sounds/`);
