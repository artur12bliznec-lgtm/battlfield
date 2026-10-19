import * as THREE from 'three';
import { MeshBuilder } from './builder.js';
import { Facade, cutBand, pieceSkip } from './facade.js';
import { SIGNS, signIndex, signRect } from './textures.js';
import { random } from '../models/textures.js';

/*
 * Генератор домов. Дом — прямоугольное «пятно» x0..x1 × z0..z1 с этажами,
 * у каждой из четырёх сторон свой фасад:
 *   main  — уличный: витрины или подъезды, наличники, балконы;
 *   side  — боковой: окна и часть декора;
 *   back  — дворовый: простые окна;
 *   blank — глухой брандмауэр (к нему примыкает соседний дом).
 * Стиль задаёт пропорции и декор: classic (старый город), stalin
 * («сталинка»), brick (кирпичный), panel (панельная пятиэтажка), store (универмаг).
 *
 * Вся геометрия строится сразу в мировых координатах; заодно собираются
 * коробки для столкновений (collision) — упрощённая форма дома для физики.
 */

export const STYLES = {
  classic: {
    bay: 3.4, margin: 1.25, groundH: 4.3, floorH: 3.6, win: [1.3, 2.0], sill: 0.9, T: 0.35, attic: 0.8,
    frame: 'frameWhite', trim: 'trimWhite', plinth: 'stone', plinthH: 0.6, sillMat: 'zinc',
    surround: true, lintel: 'cornice', pediment: true, course: true, corners: 'quoins', cornice: 'big',
    roof: 'hip', roofMat: 'roofTiles', pitch: 30, parapet: 0, balcony: 'iron', ground: 'shops',
  },
  stalin: {
    bay: 3.6, margin: 1.6, groundH: 4.6, floorH: 3.7, win: [1.45, 2.15], sill: 0.85, T: 0.4, attic: 0.9,
    frame: 'frameWhite', trim: 'trimCream', plinth: 'granite', plinthH: 0.8, sillMat: 'zinc',
    surround: true, lintel: 'cornice', pediment: false, course: true, corners: 'pilasters', cornice: 'big',
    roof: 'hip', roofMat: 'roofGreen', pitch: 22, parapet: 0, balcony: 'balustrade', ground: 'shops', rustication: true,
  },
  brick: {
    bay: 3.2, margin: 1.0, groundH: 4.0, floorH: 3.3, win: [1.3, 1.8], sill: 0.9, T: 0.38, attic: 0.65,
    wall: 'brick', frame: 'frameBrown', trim: 'brickDark', plinth: 'concreteDark', plinthH: 0.6, sillMat: 'stone',
    surround: false, lintel: 'brick', pediment: false, course: true, corners: 'none', cornice: 'corbel',
    roof: 'flat', roofMat: 'roofTar', pitch: 25, parapet: 0.7, balcony: 'iron', ground: 'plain',
  },
  panel: {
    bay: 3.0, margin: 0.75, groundH: 2.9, floorH: 2.8, win: [1.5, 1.45], sill: 0.85, T: 0.3, attic: 0.25,
    wall: 'concreteWall', frame: 'frameWhite', trim: 'concreteWall', plinth: 'concreteDark', plinthH: 0.9, sillMat: 'zinc',
    surround: false, lintel: 'none', pediment: false, course: false, seams: true, corners: 'none', cornice: 'none',
    roof: 'flat', roofMat: 'roofTar', pitch: 0, parapet: 0.5, balcony: 'panel', ground: 'plain',
  },
  store: {
    bay: 6, margin: 1.2, groundH: 4.8, floorH: 4.2, win: [5.2, 2.2], sill: 1.0, T: 0.35, attic: 0.6,
    wall: 'concreteBeige', frame: 'frameDark', trim: 'trimGrey', plinth: 'granite', plinthH: 0.4, sillMat: 'zinc',
    surround: false, lintel: 'none', pediment: false, course: true, corners: 'none', cornice: 'slab',
    roof: 'flat', roofMat: 'roofTar', pitch: 0, parapet: 0.9, balcony: 'none', ground: 'shops', ribbon: true,
  },
};

const ADJACENT = { s: ['w', 'e'], n: ['e', 'w'], e: ['s', 'n'], w: ['n', 's'] };
const SHOP_SIGNS = ['АПТЕКА', 'ПРОДУКТЫ', 'ХЛЕБ', 'КАФЕ', 'ПОЧТА', 'БАНК', 'ОБУВЬ', 'ЦВЕТЫ', 'КНИГИ', 'ОПТИКА', 'РЕМОНТ', 'ТАБАК', 'ЧАСЫ', 'МЯСО', 'БАР', 'ПАРИКМАХЕРСКАЯ', 'СТОЛОВАЯ', 'ХОЗТОВАРЫ'];
const AWNINGS = ['awningRed', 'awningGreen', 'awningBlue', 'awningYellow'];

/* ------------------------------------------------------------------ */
/* Разметка фасада: проёмы                                             */
/* ------------------------------------------------------------------ */

function bays(s, L) {
  const usable = L - 2 * s.margin;
  const n = Math.max(1, Math.round(usable / s.bay));
  const width = Math.max(usable, 1.6) / n;
  const start = (L - width * n) / 2;
  return { width, centers: Array.from({ length: n }, (_, i) => start + (i + 0.5) * width) };
}

/** Арка-проезд на этом фасаде: убирает мешающие проёмы первого этажа. */
function archesFor(s, side, F, out) {
  for (const arch of s.arches ?? []) {
    if (!arch.sides.includes(side)) continue;
    const uc = (arch.at - F.O[0]) * F.U[0] + (arch.at - F.O[2]) * F.U[2];
    const a0 = uc - arch.width / 2;
    const a1 = uc + arch.width / 2;
    for (let k = out.length - 1; k >= 0; k--) {
      const o = out[k];
      if (o.floor === 0 && o.u1 > a0 - 0.3 && o.u0 < a1 + 0.3) out.splice(k, 1);
    }
    out.push({ type: 'arch', u0: a0, u1: a1, v0: 0, v1: arch.height, floor: 0, uc });
  }
  return out;
}

/** Проёмы одного фасада: окна, витрины, двери, балконные двери, арка. */
function layoutOpenings(s, side, F, rnd) {
  const kind = s.sides[side] ?? 'side';
  const out = [];
  if (kind === 'blank' || F.L < 2.4) return archesFor(s, side, F, out);
  const { width: bay, centers } = bays(s, F.L);
  const ww = Math.min(s.win[0], bay - 0.6);
  const wh = s.win[1];
  const lv = s.levels;
  const broken = () => rnd() < s.damage;
  const ground = kind === 'main' ? s.ground : kind === 'side' ? (s.groundSide ?? 'plain') : (s.groundBack ?? 'plain');

  // --- первый этаж ---
  const gh = s.groundH;
  if (ground === 'shops') {
    const entrance = centers.length >= 3 && !s.noEntrance ? 1 + Math.floor(rnd() * (centers.length - 2)) : -1;
    for (let i = 0; i < centers.length; i++) {
      if (i === entrance) {
        out.push({ type: 'door', u0: centers[i] - 0.75, u1: centers[i] + 0.75, v0: 0, v1: Math.min(3.0, gh - 0.9), floor: 0, uc: centers[i] });
        continue;
      }
      const span = i + 1 < centers.length && i + 1 !== entrance && rnd() < 0.35 ? 2 : 1;
      const u0 = centers[i] - bay / 2 + 0.38;
      const u1 = centers[i + span - 1] + bay / 2 - 0.38;
      const sign = s.signs?.length ? s.signs[(s.signCursor = (s.signCursor ?? -1) + 1) % s.signs.length] : SHOP_SIGNS[Math.floor(rnd() * SHOP_SIGNS.length)];
      out.push({
        type: 'shop', u0, u1, v0: 0, v1: gh - 1.05, floor: 0, uc: (u0 + u1) / 2,
        door: rnd() < 0.5 ? 'left' : 'right',
        sign: rnd() < (s.signChance ?? 0.85) ? sign : null,
        awning: !s.ruin && rnd() < 0.45 ? AWNINGS[Math.floor(rnd() * AWNINGS.length)] : null,
        closed: !s.ruin && rnd() < 0.15 + s.damage * 0.4,
        broken: s.ruin ? true : broken(),
      });
      i += span - 1;
    }
  } else if (ground === 'entrances' || ground === 'plain') {
    const doors = new Set();
    if (ground === 'entrances') {
      if (centers.length <= 3) doors.add(Math.floor(centers.length / 2));
      else for (let i = 1; i < centers.length - 1; i += 4) doors.add(i);
    }
    centers.forEach((uc, i) => {
      if (doors.has(i)) {
        out.push({ type: 'door', u0: uc - 0.75, u1: uc + 0.75, v0: 0, v1: Math.min(3.0, gh - 0.6), floor: 0, uc, canopy: true });
      } else {
        const sill = s.groundSill ?? Math.max(s.plinthH + 0.35, Math.min(1.2, gh - wh - 0.5));
        const h = Math.min(wh, gh - sill - 0.45);
        out.push({ type: 'window', u0: uc - ww / 2, u1: uc + ww / 2, v0: sill, v1: sill + h, floor: 0, uc, broken: broken(), boarded: rnd() < s.boarded });
      }
    });
  }

  archesFor(s, side, F, out);
  for (const gate of s.gates ?? []) {
    if (gate.side !== side) continue;
    for (const uc of gate.at) {
      for (let k = out.length - 1; k >= 0; k--) {
        const o = out[k];
        if (o.floor === 0 && o.u1 > uc - gate.width / 2 - 0.3 && o.u0 < uc + gate.width / 2 + 0.3) out.splice(k, 1);
      }
      out.push({ type: 'gate', u0: uc - gate.width / 2, u1: uc + gate.width / 2, v0: 0, v1: gate.height, floor: 0, uc });
    }
  }

  // --- верхние этажи ---
  const ribbon = s.ribbon && kind !== 'back';
  for (let f = 1; f < s.floors; f++) {
    if (ribbon) {
      const u0 = s.margin;
      const u1 = F.L - s.margin;
      out.push({ type: 'ribbon', u0, u1, v0: lv[f] + s.sill, v1: lv[f] + s.sill + wh, floor: f, uc: (u0 + u1) / 2, broken: broken() });
      continue;
    }
    centers.forEach((uc, i) => {
      const stack = s.balconyStacks?.includes(i);
      const balcony =
        s.balcony !== 'none' &&
        kind !== 'back' &&
        f >= (s.balcony === 'panel' ? 1 : 2) &&
        (stack ? kind === 'main' : rnd() < (kind === 'main' ? s.balconies : s.balconies * 0.4));
      if (balcony) {
        out.push({ type: 'balconyDoor', u0: uc - ww / 2, u1: uc + ww / 2, v0: lv[f] + 0.05, v1: lv[f] + s.sill + wh, floor: f, uc, broken: broken() });
      } else {
        out.push({ type: 'window', u0: uc - ww / 2, u1: uc + ww / 2, v0: lv[f] + s.sill, v1: lv[f] + s.sill + wh, floor: f, uc, broken: broken(), boarded: f === 1 && rnd() < s.boarded * 0.5 });
      }
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Заполнение проёмов                                                  */
/* ------------------------------------------------------------------ */

function frame(F, mat, u0, u1, v0, v1, d, fw = 0.06) {
  const w0 = -d - 0.03;
  const w1 = -d + 0.045;
  F.box(mat, u0, u0 + fw, v0, v1, w0, w1, 'bl');
  F.box(mat, u1 - fw, u1, v0, v1, w0, w1, 'br');
  F.box(mat, u0 + fw, u1 - fw, v0, v0 + fw, w0, w1, 'bdlr');
  F.box(mat, u0 + fw, u1 - fw, v1 - fw, v1, w0, w1, 'btlr');
}

function emitWindow(F, s, o, rnd, simple) {
  const d = 0.15;
  const { u0, u1, v0, v1 } = o;
  const uc = (u0 + u1) / 2;
  if (o.boarded) {
    F.rect('interiorDark', u0, v0, u1, v1, -s.T + 0.02);
    const n = 3 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const vb = v0 + 0.1 + ((v1 - v0 - 0.35) * (k + rnd() * 0.3)) / n;
      F.box('boards', u0 - 0.08, u1 + 0.08, vb, vb + 0.2, 0, 0.03, 'b');
    }
  } else if (o.broken) {
    if (!s.openWindows) F.rect('interiorDark', u0, v0, u1, v1, -s.T + 0.02);
    if (rnd() < 0.5) frame(F, s.frame, u0, u1, v0, v1, d);
  } else {
    F.rect(s.glassMat, u0, v0, u1, v1, -d);
    frame(F, s.frame, u0, u1, v0, v1, d);
    if (s.gridWindows) {
      // промышленное окно: частый переплёт
      const nu = Math.max(2, Math.round((u1 - u0) / 0.55));
      const nv = Math.max(2, Math.round((v1 - v0) / 0.5));
      for (let k = 1; k < nu; k++) {
        const u = u0 + ((u1 - u0) * k) / nu;
        F.box(s.frame, u - 0.02, u + 0.02, v0 + 0.06, v1 - 0.06, -d - 0.02, -d + 0.03, 'btd');
      }
      for (let k = 1; k < nv; k++) {
        const v = v0 + ((v1 - v0) * k) / nv;
        F.box(s.frame, u0 + 0.06, u1 - 0.06, v - 0.02, v + 0.02, -d - 0.02, -d + 0.03, 'blr');
      }
    } else {
      const vt = v1 - Math.min(0.5, (v1 - v0) * 0.28); // фрамуга
      if (v1 - v0 > 1.3) F.box(s.frame, u0 + 0.06, u1 - 0.06, vt - 0.03, vt + 0.03, -d - 0.02, -d + 0.035, 'blr');
      if (u1 - u0 > 0.9) F.box(s.frame, uc - 0.03, uc + 0.03, v0 + 0.06, (v1 - v0 > 1.3 ? vt : v1) - 0.03, -d - 0.02, -d + 0.035, 'btd');
    }
  }
  if (s.arched) {
    // стрельчатый верх: углы проёма закрыты стеной
    const h = Math.min((u1 - u0) * 0.75, (v1 - v0) * 0.3);
    F.b.triangle(s.wall, F.p(u0, v1 - h, -0.02), F.p(uc, v1, -0.02), F.p(u0, v1, -0.02));
    F.b.triangle(s.wall, F.p(u1, v1 - h, -0.02), F.p(u1, v1, -0.02), F.p(uc, v1, -0.02));
  }
  if (o.type === 'balconyDoor') return;
  F.box(s.sillMat, u0 - 0.05, u1 + 0.05, v0 - 0.05, v0, -0.1, 0.07, 'b');
  if (simple) return;

  // наличники и сандрики
  const t = s.trim;
  if (s.surround) {
    F.box(t, u0 - 0.13, u0, v0 - 0.05, v1, 0, 0.04, 'bd');
    F.box(t, u1, u1 + 0.13, v0 - 0.05, v1, 0, 0.04, 'bd');
    F.box(t, u0 - 0.13, u1 + 0.13, v1, v1 + 0.13, 0, 0.04, 'b');
  }
  const top = v1 + (s.surround ? 0.13 : 0);
  if (s.lintel === 'cornice') {
    F.box(t, u0 - 0.2, u1 + 0.2, top, top + 0.1, 0, 0.09, 'b');
    F.box(t, u0 - 0.25, u1 + 0.25, top + 0.1, top + 0.15, 0, 0.13, 'b');
    if (s.pediment && o.floor === 1 && !o.noPediment) {
      F.prism(t, [[u0 - 0.22, top + 0.15], [u1 + 0.22, top + 0.15], [uc, top + 0.15 + 0.3]], 0, 0.1);
    } else {
      F.box(t, uc - 0.09, uc + 0.09, v1 - 0.12, top + 0.06, 0.04, 0.1, 'b'); // замковый камень
    }
  } else if (s.lintel === 'brick') {
    F.box(s.trim, u0 - 0.1, u1 + 0.1, v1, v1 + 0.27, 0, 0.025, 'b');
  }
}

function emitRibbon(F, s, o) {
  const d = 0.14;
  F.rect(o.broken ? 'interiorDark' : s.glassMat, o.u0, o.v0, o.u1, o.v1, o.broken ? -s.T + 0.02 : -d);
  frame(F, s.frame, o.u0, o.u1, o.v0, o.v1, d, 0.08);
  const n = Math.max(1, Math.round((o.u1 - o.u0) / 1.5));
  for (let k = 1; k < n; k++) {
    const u = o.u0 + ((o.u1 - o.u0) * k) / n;
    F.box(s.frame, u - 0.04, u + 0.04, o.v0 + 0.08, o.v1 - 0.08, -d - 0.03, -d + 0.05, 'btd');
  }
  F.box(s.sillMat, o.u0 - 0.05, o.u1 + 0.05, o.v0 - 0.05, o.v0, -0.1, 0.08, 'b');
}

/** Вывеска над витриной: доска с текстом из атласа. */
function emitSign(F, text, uc, v0, maxW, maxH, depth = 0.08) {
  const index = signIndex(text);
  if (index < 0) return;
  const r = signRect(index);
  let h = maxH;
  let w = h * r.aspect;
  if (w > maxW) {
    w = maxW;
    h = w / r.aspect;
  }
  F.box('frameDark', uc - w / 2 - 0.03, uc + w / 2 + 0.03, v0 - 0.03, v0 + h + 0.03, 0, depth, 'b');
  F.rect('signs', uc - w / 2, v0, uc + w / 2, v0 + h, depth + 0.002, [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]]);
}

function emitShop(F, s, o, rnd) {
  const d = 0.12;
  const { u0, u1, v1 } = o;
  const kick = 0.45;
  const doorW = 1.0;
  const du0 = o.door === 'left' ? u0 + 0.1 : u1 - 0.1 - doorW;
  const du1 = du0 + doorW;
  if (o.closed) {
    F.rect('shutter', u0, 0, u1, v1, -0.07);
    F.box('frameDark', u0 - 0.02, u1 + 0.02, v1 - 0.32, v1, -0.1, 0.1, 'b');
  } else {
    if (!(o.broken && s.openWindows)) F.rect(o.broken ? 'interiorDark' : 'glassShop', u0, 0, u1, v1, o.broken ? -s.T + 0.02 : -d);
    if (!o.broken) {
      // цоколь витрины слева и справа от двери
      const kp = [[u0, du0], [du1, u1]];
      for (const [a, b] of kp) if (b - a > 0.05) F.box('frameDark', a, b, 0, kick, -d - 0.02, -d + 0.03, 'bd');
      frame(F, 'frameDark', u0, u1, 0, v1, d, 0.07);
      F.box('frameDark', du0 - 0.03, du0 + 0.03, 0.07, v1 - 0.07, -d - 0.03, -d + 0.05, 'b');
      F.box('frameDark', du1 - 0.03, du1 + 0.03, 0.07, v1 - 0.07, -d - 0.03, -d + 0.05, 'b');
      F.box('frameDark', du0, du1, 2.25, 2.33, -d - 0.03, -d + 0.05, 'blr');
      F.box('chrome', du0 + 0.15, du1 - 0.15, 1.0, 1.04, -d + 0.05, -d + 0.09, 'b'); // ручка-штанга
      // средник витрины
      const rest = o.door === 'left' ? [du1, u1] : [u0, du0];
      const panes = Math.max(1, Math.round((rest[1] - rest[0]) / 1.4));
      for (let k = 1; k < panes; k++) {
        const u = rest[0] + ((rest[1] - rest[0]) * k) / panes;
        F.box('frameDark', u - 0.03, u + 0.03, kick, v1 - 0.07, -d - 0.03, -d + 0.05, 'btd');
      }
    }
  }
  const signTop = s.groundH - 0.2;
  if (o.sign) emitSign(F, o.sign, o.uc, v1 + 0.18, u1 - u0 + 0.3, Math.min(0.62, signTop - v1 - 0.22));
  if (o.awning) {
    const a0 = u0 - 0.1;
    const a1 = u1 + 0.1;
    const top = v1 + 0.08;
    const low = v1 - 0.5;
    const out = 1.25;
    F.slope(o.awning, a0, a1, top, 0.02, low, out);
    F.box(o.awning, a0, a1, low - 0.25, low, out - 0.01, out + 0.01);
    for (const u of [a0, a1]) {
      F.b.triangle(o.awning, F.p(u, top, 0.02), F.p(u, low, out), F.p(u, low, 0.02));
      F.b.triangle(o.awning, F.p(u, top, 0.02), F.p(u, low, 0.02), F.p(u, low, out));
    }
  }
}

function emitDoor(F, s, o) {
  const d = 0.16;
  const { u0, u1, v1, uc } = o;
  const leaf = Math.min(2.3, v1 - 0.4);
  F.rect(s.doorMat, u0, 0, u1, leaf, -d);
  F.box(s.frame === 'frameWhite' ? 'frameBrown' : s.frame, uc - 0.02, uc + 0.02, 0, leaf, -d, -d + 0.03, 'bd');
  for (const [a, b] of [[u0 + 0.12, uc - 0.12], [uc + 0.12, u1 - 0.12]]) {
    F.box(s.doorMat, a, b, 0.25, 0.95, -d, -d + 0.03, 'b');
    F.box(s.doorMat, a, b, 1.15, leaf - 0.2, -d, -d + 0.03, 'b');
  }
  F.rect('glass', u0, leaf, u1, v1, -d);
  frame(F, s.frame, u0, u1, 0, v1, d, 0.07);
  F.box(s.frame, u0 + 0.07, u1 - 0.07, leaf - 0.03, leaf + 0.03, -d - 0.03, -d + 0.045, 'blr');
  F.box('stone', u0 - 0.35, u1 + 0.35, 0, 0.15, 0, 0.5, 'bd'); // ступенька
  if (o.canopy || s.style === 'panel') {
    F.box('concreteWall', u0 - 0.5, u1 + 0.5, v1 + 0.2, v1 + 0.34, 0, 1.2, 'b');
  } else if (!s.noDoorTrim) {
    F.box(s.trim, u0 - 0.15, u0, 0, v1, 0, 0.05, 'bd');
    F.box(s.trim, u1, u1 + 0.15, 0, v1, 0, 0.05, 'bd');
    F.box(s.trim, u0 - 0.3, u1 + 0.3, v1, v1 + 0.2, 0, 0.12, 'b');
  }
}

function emitBalcony(F, s, o) {
  const y = s.levels[o.floor];
  const u0 = o.u0 - 0.45;
  const u1 = o.u1 + 0.45;
  if (s.balcony === 'panel') {
    const depth = 1.1;
    F.box('concreteWall', u0, u1, y - 0.16, y, 0, depth, 'b');
    F.box(s.balconyFront ?? 'concreteWall', u0, u1, y, y + 1.0, depth - 0.08, depth, 'b');
    F.box(s.balconyFront ?? 'concreteWall', u0, u0 + 0.06, y, y + 1.0, 0, depth - 0.08, 'b');
    F.box(s.balconyFront ?? 'concreteWall', u1 - 0.06, u1, y, y + 1.0, 0, depth - 0.08, 'b');
    if (o.glazed) {
      const top = s.levels[o.floor + 1] - 0.16;
      F.rect(s.glassMat, u0, y + 1.0, u1, top, depth - 0.04);
      F.box('frameWhite', u0, u1, top - 0.05, top, 0, depth, 'b');
      for (let k = 0; k <= 3; k++) {
        const u = u0 + ((u1 - u0) * k) / 3;
        F.box('frameWhite', u - 0.03, u + 0.03, y + 1.0, top - 0.05, depth - 0.07, depth, 'btd');
      }
    }
    return;
  }
  const depth = 0.95;
  const slab = s.style === 'stalin' ? s.trim : 'stone';
  F.box(slab, u0, u1, y - 0.18, y + 0.03, 0, depth, 'b');
  for (const cu of [u0 + 0.22, u1 - 0.22]) F.box(slab, cu - 0.07, cu + 0.07, y - 0.5, y - 0.18, 0, 0.4, 'b');
  const top = y + 1.0;
  if (s.balcony === 'balustrade') {
    F.box(slab, u0, u1, top - 0.1, top, depth - 0.16, depth, 'b');
    F.box(slab, u0, u0 + 0.16, top - 0.1, top, 0, depth - 0.16, 'b');
    F.box(slab, u1 - 0.16, u1, top - 0.1, top, 0, depth - 0.16, 'b');
    for (let u = u0 + 0.12; u < u1 - 0.05; u += 0.2) F.box(slab, u - 0.045, u + 0.045, y + 0.03, top - 0.1, depth - 0.12, depth - 0.03, 'td');
    return;
  }
  const m = 'metalDark';
  F.box(m, u0, u1, top - 0.04, top, depth - 0.05, depth, 'b');
  F.box(m, u0, u0 + 0.04, top - 0.04, top, 0, depth - 0.05, 'b');
  F.box(m, u1 - 0.04, u1, top - 0.04, top, 0, depth - 0.05, 'b');
  F.box(m, u0, u1, y + 0.06, y + 0.1, depth - 0.05, depth, 'b');
  for (let u = u0 + 0.06; u < u1 - 0.03; u += 0.14) F.box(m, u - 0.012, u + 0.012, y + 0.03, top - 0.04, depth - 0.035, depth - 0.01, 'td');
  for (let w = 0.12; w < depth - 0.05; w += 0.14) {
    F.box(m, u0 + 0.008, u0 + 0.032, y + 0.03, top - 0.04, w - 0.012, w + 0.012, 'td');
    F.box(m, u1 - 0.032, u1 - 0.008, y + 0.03, top - 0.04, w - 0.012, w + 0.012, 'td');
  }
}

/* ------------------------------------------------------------------ */
/* Фасад целиком                                                       */
/* ------------------------------------------------------------------ */

/** Отрезки [a, b] за вычетом проёмов, пересекающих полосу [v0, v1]. */
function spans(a, b, v0, v1, openings) {
  let list = [[a, b]];
  for (const o of openings) {
    if (o.v1 <= v0 || o.v0 >= v1) continue;
    const next = [];
    for (const [p, q] of list) {
      if (o.u1 <= p || o.u0 >= q) next.push([p, q]);
      else {
        if (o.u0 > p) next.push([p, o.u0]);
        if (o.u1 < q) next.push([o.u1, q]);
      }
    }
    list = next;
  }
  return list.filter(([p, q]) => q - p > 0.02);
}

function emitFacade(F, s, side, rnd, keep) {
  const kind = s.sides[side] ?? 'side';
  const { L } = F;
  const T = s.T;
  const H = s.H;
  const openings = layoutOpenings(s, side, F, rnd).filter((o) => keep(F, o));
  if (s.lod === 'far') {
    // дальний фон: стена одним прямоугольником, окна — стёкла поверх стены
    F.box(s.wall, 0, L, 0, H + (s.parapet || 0), -T, 0, 'blrtd');
    for (const o of openings) {
      if (o.type === 'arch') continue;
      const m = o.type === 'door' ? s.doorMat : o.type === 'shop' ? 'glassShop' : o.broken ? 'interiorDark' : s.glassMat;
      F.rect(m, o.u0, o.v0, o.u1, o.v1, 0.015);
    }
    if (s.plinthH) F.box(s.plinth, 0, L, 0, s.plinthH, 0, 0.04, 'bdlr');
    if (s.cornice === 'big' || s.cornice === 'corbel') F.box(s.trim, 0, L, H - 0.3, H, 0, 0.3, 'blr');
    return openings;
  }
  const simple = kind === 'back';
  const [leftAdj, rightAdj] = ADJACENT[side].map((a) => (s.sides[a] ?? 'side') !== 'blank');
  const ext = (e) => [leftAdj ? -e : 0, rightAdj ? L + e : L];

  // стена по полосам этажей
  const lv = s.levels;
  for (let f = 0; f < s.floors; f++) {
    for (const p of cutBand(L, lv[f], f === s.floors - 1 ? H : lv[f + 1], openings)) {
      if (keep(F, p)) F.box(p.wall ?? s.wall, p.u0, p.u1, p.v0, p.v1, -T, 0, pieceSkip(p, L, { back: !s.interior }));
    }
  }
  if (s.parapet > 0) {
    const p = { u0: 0, u1: L, v0: H, v1: H + s.parapet, kind: 'pier' };
    if (keep(F, p)) F.box(s.wall, 0, L, H, H + s.parapet, -T, 0, 'lrtd');
    const [c0, c1] = [leftAdj ? -0.04 : 0, rightAdj ? L + 0.04 : L];
    F.box(s.coping ?? 'zinc', c0, c1, H + s.parapet, H + s.parapet + 0.07, -T - 0.04, 0.05, 'd');
  }

  for (const o of openings) {
    if (o.type === 'window' || o.type === 'balconyDoor') emitWindow(F, s, o, rnd, simple);
    else if (o.type === 'shop') emitShop(F, s, o, rnd);
    else if (o.type === 'door') emitDoor(F, s, o);
    else if (o.type === 'ribbon') emitRibbon(F, s, o);
    else if (o.type === 'gate') {
      F.rect('shutter', o.u0, 0, o.u1, o.v1, -0.12);
      frame(F, 'frameDark', o.u0, o.u1, 0, o.v1, 0.12, 0.12);
      F.box('concreteDark', o.u0 - 0.3, o.u1 + 0.3, o.v1, o.v1 + 0.35, 0, 0.12, 'b');
    }
    if (o.type === 'balconyDoor') emitBalcony(F, s, { ...o, glazed: rnd() < 0.4 });
    // кондиционеры под окнами
    if (o.type === 'window' && o.floor > 0 && !simple && rnd() < s.ac) {
      F.box('signWhite', o.uc - 0.4, o.uc + 0.4, o.v0 - 0.7, o.v0 - 0.18, 0, 0.28, 'b');
      F.box('metalGrey', o.uc - 0.3, o.uc + 0.3, o.v0 - 0.62, o.v0 - 0.26, 0.28, 0.29, 'b');
    }
  }

  // цоколь
  if (s.plinthH > 0) {
    for (const [a, b] of spans(...ext(0.06), 0, s.plinthH, openings)) F.box(s.plinth, a, b, 0, s.plinthH, 0, 0.06, 'bd');
  }
  // руст первого этажа
  if (s.rustication && kind === 'main') {
    for (let v = s.plinthH + 0.05; v < s.groundH - 0.5; v += 0.46) {
      for (const [a, b] of spans(0, L, v, v + 0.4, openings)) F.box(s.trim, a, b, v, v + 0.4, 0, 0.035, 'b');
    }
  }
  // межэтажные тяги
  if (s.course && !simple) {
    for (let f = 1; f < s.floors; f++) {
      const y = lv[f];
      for (const [a, b] of spans(...ext(0.08), y - 0.1, y + 0.1, openings)) F.box(s.trim, a, b, y - 0.1, y + 0.1, 0, 0.08, 'b');
    }
  }
  // швы панелей
  if (s.seams) {
    for (let f = 1; f <= s.floors; f++) F.box('seam', 0, L, lv[f] - 0.025, lv[f] + 0.025, 0, 0.012, 'b');
    const { width, centers } = bays(s, L);
    for (const uc of [centers[0] - width / 2, ...centers.map((c) => c + width / 2)]) {
      if (uc > 0.1 && uc < L - 0.1) F.box('seam', uc - 0.025, uc + 0.025, s.plinthH, H, 0, 0.012, 'b');
    }
  }
  // углы: руст или пилястры
  if (s.corners === 'quoins' && !simple) {
    let k = 0;
    for (let v = s.groundH; v < H - 0.8; v += 0.4, k++) {
      const w = k % 2 ? 0.38 : 0.56;
      F.box(s.trim, 0, w, v, v + 0.34, 0, 0.035, 'b');
      F.box(s.trim, L - w, L, v, v + 0.34, 0, 0.035, 'b');
    }
  } else if (s.corners === 'pilasters' && !simple) {
    F.box(s.trim, 0, 0.7, s.groundH, H - 0.5, 0, 0.06, 'bd');
    F.box(s.trim, L - 0.7, L, s.groundH, H - 0.5, 0, 0.06, 'bd');
  }
  // венчающий карниз
  const layers = {
    big: [[0.75, 0.6, 0.05], [0.44, 0.3, 0.12], [0.3, 0.15, 0.25], [0.15, 0, 0.42]],
    corbel: [[0.6, 0.45, 0.06], [0.45, 0.3, 0.12], [0.3, 0.12, 0.18]],
    slab: [[0.3, 0, 0.3]],
  }[s.cornice];
  if (layers && !(simple && s.cornice === 'big')) {
    for (const [top, bottom, depth] of layers) F.box(s.trim, ...ext(depth), H - top, H - bottom, 0, depth, 'b');
  }
  // водосточные трубы
  if (s.roof !== 'flat' && kind !== 'blank' && L > 6) {
    for (const u of [0.3, L - 0.3]) {
      F.box('zinc', u - 0.06, u + 0.06, 0.15, H - 0.05, 0.1, 0.22, 'b');
      F.box('zinc', u - 0.12, u + 0.12, H - 0.3, H - 0.05, 0.05, 0.3, 'b');
    }
  }
  // жёлтая газовая труба на дворовых фасадах
  if ((kind === 'back' || kind === 'side') && s.style !== 'store' && rnd() < 0.5) {
    const y = Math.min(2.6, s.groundH - 0.4);
    F.box('signYellow', 0.4, L - 0.4, y, y + 0.09, 0.1, 0.19);
    F.box('signYellow', L - 0.49, L - 0.4, 0.3, y, 0.1, 0.19, 'd');
  }
  return openings;
}

/* ------------------------------------------------------------------ */
/* Крыши                                                               */
/* ------------------------------------------------------------------ */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Скат крыши: UV вдоль карниза (u) и вверх по скату (v), чтобы ряды черепицы шли ровно. */
function roofPlane(b, material, pts, origin, along, up, tile, twoSided = false) {
  const e = unit(along);
  const s = unit(up);
  const uv = pts.map((p) => [dot(sub(p, origin), e) / tile, dot(sub(p, origin), s) / tile]);
  if (pts.length === 4) {
    b.quad(material, ...pts, uv);
    if (twoSided) b.quad(material, pts[1], pts[0], pts[3], pts[2], [uv[1], uv[0], uv[3], uv[2]]);
  } else {
    b.triangle(material, ...pts, uv);
    if (twoSided) b.triangle(material, pts[1], pts[0], pts[2], [uv[1], uv[0], uv[2]]);
  }
}

/** Скатная крыша (вальмовая или двускатная) над пятном x0..x1 × z0..z1 на высоте y. */
function pitchedRoof(b, s, x0, z0, x1, z1, y, rnd) {
  const o = s.overhang ?? 0.45;
  const tan = Math.tan((s.pitch * Math.PI) / 180);
  const alongX = x1 - x0 >= z1 - z0;
  // всё считаем для конька вдоль X, а для конька вдоль Z меняем оси местами
  const P = alongX ? (a, h, c) => [a, h, c] : (a, h, c) => [c, h, a];
  const [a0, a1, c0, c1] = alongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
  const A0 = a0 - o;
  const A1 = a1 + o;
  const C0 = c0 - o;
  const C1 = c1 + o;
  const cc = (c0 + c1) / 2;
  const half = (C1 - C0) / 2;
  const rise = half * tan;
  const yr = y + rise;
  const hip = s.roof === 'hip';
  let ra = hip ? A0 + half : A0;
  let rb = hip ? A1 - half : A1;
  if (ra > rb) ra = rb = (A0 + A1) / 2;
  const tile = 2;
  const mat = s.roofMat;
  const flip = !alongX; // при обмене осей обход граней меняется на обратный
  const plane = (pts, origin, along, up, two) => roofPlane(b, mat, flip ? [...pts].reverse() : pts, origin, along, up, tile, two);

  // скат «+c» и скат «−c»
  plane([P(A0, y, C1), P(A1, y, C1), P(rb, yr, cc), P(ra, yr, cc)], P(A0, y, C1), P(1, 0, 0), sub(P(ra, yr, cc), P(ra, y, C1)), !hip);
  plane([P(A1, y, C0), P(A0, y, C0), P(ra, yr, cc), P(rb, yr, cc)], P(A1, y, C0), P(-1, 0, 0), sub(P(ra, yr, cc), P(ra, y, C0)), !hip);
  if (hip) {
    plane([P(A0, y, C0), P(A0, y, C1), P(ra, yr, cc)], P(A0, y, C0), P(0, 0, 1), sub(P(ra, yr, cc), P(A0, y, cc)));
    plane([P(A1, y, C1), P(A1, y, C0), P(rb, yr, cc), ], P(A1, y, C1), P(0, 0, -1), sub(P(rb, yr, cc), P(A1, y, cc)));
  } else {
    // фронтоны — стена
    const ye = y + o * tan;
    for (const [a, sign] of [[a0, -1], [a1, 1]]) {
      const pts = [P(a, y, c0), P(a, y, c1), P(a, ye, c1), P(a, yr - 0.02, cc), P(a, ye, c0)];
      const ordered = (sign < 0) !== flip ? pts : [...pts].reverse();
      for (let k = 1; k < ordered.length - 1; k++) b.triangle(s.wall, ordered[0], ordered[k], ordered[k + 1]);
    }
  }
  // конёк
  if (rb - ra > 0.1) {
    const [p, q] = [P(ra, yr - 0.06, cc - 0.13), P(rb, yr + 0.07, cc + 0.13)];
    b.box(s.ridgeMat ?? (mat === 'roofTiles' ? 'roofTiles' : 'zinc'), Math.min(p[0], q[0]), p[1], Math.min(p[2], q[2]), Math.max(p[0], q[0]), q[1], Math.max(p[2], q[2]), 'y-');
  }
  // подшивка свеса и водосток по длинным сторонам
  for (const [c, C] of [[c1, C1], [c0, C0]]) {
    const lo = Math.min(c, C);
    const hi = Math.max(c, C);
    const p0 = P(hip ? A0 : a0, y, lo);
    const p1 = P(hip ? A1 : a1, y, hi);
    b.box('trimGrey', Math.min(p0[0], p1[0]), y - 0.04, Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), y, Math.max(p0[2], p1[2]), 'y+');
    const g0 = P(A0, y - 0.16, C - 0.07);
    const g1 = P(A1, y + 0.02, C + 0.07);
    b.box('zinc', Math.min(g0[0], g1[0]), g0[1], Math.min(g0[2], g1[2]), Math.max(g0[0], g1[0]), g1[1], Math.max(g0[2], g1[2]));
  }
  if (hip) {
    for (const [a, A] of [[a0, A0], [a1, A1]]) {
      const p0 = P(Math.min(a, A), y, c0);
      const p1 = P(Math.max(a, A), y, c1);
      b.box('trimGrey', Math.min(p0[0], p1[0]), y - 0.04, Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), y, Math.max(p0[2], p1[2]), 'y+');
    }
  }
  // трубы
  const chimneys = s.chimneys ?? 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < chimneys; k++) {
    const ca = a0 + 1.5 + rnd() * Math.max(0.1, a1 - a0 - 3);
    const cz = cc + (rnd() - 0.5) * half * 0.8;
    const p = P(ca, 0, cz);
    const top = yr + 0.5 + rnd() * 0.5;
    b.box(s.chimneyMat ?? 'brick', p[0] - 0.35, y, p[2] - 0.35, p[0] + 0.35, top, p[2] + 0.35, 'y-');
    b.box('concreteDark', p[0] - 0.42, top, p[2] - 0.42, p[0] + 0.42, top + 0.1, p[2] + 0.42, 'y-');
  }
  return yr;
}

/** Плоская кровля внутри парапета + надстройки. */
function flatRoof(b, s, x0, z0, x1, z1, y, rnd) {
  b.quad(s.roofMat, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
  if (s.noRoofStuff) return y;
  const w = x1 - x0;
  const d = z1 - z0;
  // выход на крышу / машинное отделение лифта
  const hx = x0 + 2 + rnd() * Math.max(0.1, w - 7);
  const hz = z0 + 1.5 + rnd() * Math.max(0.1, d - 5.5);
  b.box(s.wall === 'brick' ? 'brick' : 'concreteWall', hx, y, hz, hx + 3, y + 2.6, hz + 2.4, 'y-');
  b.box('roofTar', hx - 0.1, y + 2.6, hz - 0.1, hx + 3.1, y + 2.75, hz + 2.5, 'y-');
  b.box('doorMetal', hx + 0.9, y, hz + 2.4, hx + 1.8, y + 2.05, hz + 2.45, 'y-z-');
  // вентиляция, кондиционеры, антенны
  const n = 3 + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) {
    const px = x0 + 1 + rnd() * (w - 2);
    const pz = z0 + 1 + rnd() * (d - 2);
    const t = rnd();
    if (t < 0.4) b.box('concreteWall', px - 0.4, y, pz - 0.4, px + 0.4, y + 0.9, pz + 0.4, 'y-');
    else if (t < 0.7) b.box('metalGrey', px - 0.5, y, pz - 0.35, px + 0.5, y + 0.7, pz + 0.35, 'y-');
    else {
      b.box('metalDark', px - 0.025, y, pz - 0.025, px + 0.025, y + 2.8, pz + 0.025, 'y-');
      for (let r = 0; r < 3; r++) {
        const yy = y + 1.8 + r * 0.35;
        b.box('metalDark', px - 0.5 + r * 0.1, yy, pz - 0.015, px + 0.5 - r * 0.1, yy + 0.03, pz + 0.015);
      }
    }
  }
  return y;
}

/* ------------------------------------------------------------------ */
/* Руины                                                               */
/* ------------------------------------------------------------------ */

/**
 * Поле разрушения: угол дома обрушен. ruin: { x, z — центр обрушения
 * (обычно угол), r0 — радиус у земли, r1 — у крыши }. Край рваный: к радиусу
 * добавляется шум по ячейкам ~0,7 м. Возвращает alive([x, y, z]) → уцелело ли.
 */
function ruinField(s) {
  const { x, z, r0, r1, seed = 1 } = s.ruin;
  const hash = (px, py, pz) => {
    let h = (Math.imul(Math.floor(px / 0.7), 73856093) ^ Math.imul(Math.floor(py / 0.7), 19349663) ^ Math.imul(Math.floor(pz / 0.7), 83492791) ^ Math.imul(seed, 2654435761)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return ([px, py, pz]) => {
    const t = Math.min(1, Math.max(0, (py - s.y) / s.H));
    const R = r0 + (r1 - r0) * t;
    return Math.hypot(px - x, pz - z) + (hash(px, py, pz) - 0.5) * 2.2 > R;
  };
}

/** Тонкий брусок от a до b (арматура, балки). */
function bar(b, material, a, c, size) {
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const dz = c[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...a), new THREE.Vector3(...c), new THREE.Vector3(0, 1, 0));
  m.setPosition((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
  b.add(material, new THREE.BoxGeometry(size, size, len), m);
}

/** Перекрытия, перегородки, арматура, завал и пандус из обломков на второй этаж. */
function ruinInterior(b, s, alive, rnd, openings) {
  const { x0, z0, x1, z1, y } = s;
  const collision = [];
  const cell = 1.0;
  const nx = Math.max(1, Math.round((x1 - x0) / cell));
  const nz = Math.max(1, Math.round((z1 - z0) / cell));
  const cw = (x1 - x0) / nx;
  const cd = (z1 - z0) / nz;
  const slabs = [...s.levels.slice(1, s.floors), s.H];

  // перекрытия: ячейки 1×1 м, уцелевшие склеиваются в полосы
  for (const level of slabs) {
    const top = y + level;
    const kept = [];
    for (let iz = 0; iz < nz; iz++) {
      kept.push([]);
      for (let ix = 0; ix < nx; ix++) kept[iz].push(alive([x0 + (ix + 0.5) * cw, top - 0.1, z0 + (iz + 0.5) * cd]));
    }
    for (let iz = 0; iz < nz; iz++) {
      let ix = 0;
      while (ix < nx) {
        if (!kept[iz][ix]) {
          ix++;
          continue;
        }
        const start = ix;
        while (ix < nx && kept[iz][ix]) ix++;
        const bx0 = Math.max(x0 + start * cw, x0 + 0.03);
        const bx1 = Math.min(x0 + ix * cw, x1 - 0.03);
        const bz0 = Math.max(z0 + iz * cd, z0 + 0.03);
        const bz1 = Math.min(z0 + (iz + 1) * cd, z1 - 0.03);
        b.box('concreteDark', bx0, top - 0.25, bz0, bx1, top, bz1);
        collision.push([bx0, top - 0.25, bz0, bx1, top, bz1]);
      }
      // арматура торчит из рваного края
      for (let k = 0; k < nx; k++) {
        if (!kept[iz][k]) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => {
          const jx = k + dx;
          const jz = iz + dz;
          return jx >= 0 && jx < nx && jz >= 0 && jz < nz && !kept[jz][jx];
        });
        if (!edge || rnd() > 0.45) continue;
        const cx = x0 + (k + 0.5) * cw + edge[0] * cw * 0.5;
        const cz = z0 + (iz + 0.5) * cd + edge[1] * cd * 0.5;
        for (let r = 0; r < 3; r++) {
          const off = (rnd() - 0.5) * 0.8;
          const a = [cx + (edge[1] ? off : 0), top - 0.12, cz + (edge[0] ? off : 0)];
          const len = 0.3 + rnd() * 0.6;
          const c = [a[0] + edge[0] * len, a[1] - rnd() * 0.35, a[2] + edge[1] * len];
          bar(b, 'rust', a, c, 0.025);
        }
      }
    }
  }

  // перегородки внутри: поперёк дома, с дверным проёмом
  const across = x1 - x0 >= z1 - z0;
  for (let f = 0; f < s.floors; f++) {
    const lo = y + s.levels[f];
    const hi = y + (f === s.floors - 1 ? s.H : s.levels[f + 1]) - 0.25;
    for (const t of [0.35, 0.68]) {
      const door = 0.2 + rnd() * 0.6;
      const segs = across ? [[z0 + s.T, z0 + (z1 - z0) * door - 0.5], [z0 + (z1 - z0) * door + 0.5, z1 - s.T]] : [[x0 + s.T, x0 + (x1 - x0) * door - 0.5], [x0 + (x1 - x0) * door + 0.5, x1 - s.T]];
      const at = across ? x0 + (x1 - x0) * t : z0 + (z1 - z0) * t;
      for (const [p, q] of segs) {
        for (let c0 = p; c0 < q - 0.01; c0 += 1.0) {
          const c1 = Math.min(q, c0 + 1.0);
          for (let v = lo; v < hi - 0.01; v += 1.0) {
            const v1 = Math.min(hi, v + 1.0);
            const centre = across ? [at, (v + v1) / 2, (c0 + c1) / 2] : [(c0 + c1) / 2, (v + v1) / 2, at];
            if (!alive(centre)) continue;
            if (across) b.box('interior', at - 0.1, v, c0, at + 0.1, v1, c1);
            else b.box('interior', c0, v, at - 0.1, c1, v1, at + 0.1);
          }
        }
      }
    }
  }

  // стены для физики: уцелевшие куски по метровой сетке
  for (const side of ['n', 'e', 's', 'w']) {
    const F = new Facade(null, side, x0, z0, x1, z1, y);
    const n = Math.max(1, Math.round(F.L));
    const rows = Math.max(1, Math.round((s.H + s.parapet) / 1.0));
    for (let j = 0; j < rows; j++) {
      const v0 = ((s.H + s.parapet) * j) / rows;
      const v1 = ((s.H + s.parapet) * (j + 1)) / rows;
      let i = 0;
      while (i < n) {
        const ok = (k) => alive(F.p(((k + 0.5) * F.L) / n, (v0 + v1) / 2, -s.T / 2));
        if (!ok(i)) {
          i++;
          continue;
        }
        const start = i;
        while (i < n && ok(i)) i++;
        const a = F.p((start * F.L) / n, v0, -s.T);
        const c = F.p((i * F.L) / n, v1, 0);
        collision.push([Math.min(a[0], c[0]), a[1], Math.min(a[2], c[2]), Math.max(a[0], c[0]), c[1], Math.max(a[2], c[2])]);
      }
    }
  }

  // завал: конус обломков у центра обрушения и пандус на второй этаж
  const { x: rx, z: rz, r0, r1 } = s.ruin;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const inward = [cx - rx, cz - rz];
  const il = Math.hypot(...inward) || 1;
  inward[0] /= il;
  inward[1] /= il;
  const level1 = y + s.levels[1];
  const reach = r0 + (r1 - r0) * (s.levels[1] / s.H) + 1.6;
  const B = [rx + inward[0] * reach, level1, rz + inward[1] * reach];
  const out = s.ruin.ramp ?? 6.5;
  const A = [rx - inward[0] * out, y, rz - inward[1] * out];
  const chunks = ['concreteDark', s.wall, s.wall === 'brick' ? 'brickDark' : 'brick', 'interior', 'concreteWall'];
  const piece = new THREE.BoxGeometry(1, 1, 1);
  const place = (px, py, pz, size, mat) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(px, py, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)),
      new THREE.Vector3(size * (0.6 + rnd()), size * (0.4 + rnd() * 0.6), size * (0.6 + rnd())),
    );
    b.add(mat, piece, m);
  };
  // по пандусу
  for (let k = 0; k < 170; k++) {
    const t = rnd();
    const side = (rnd() - 0.5) * 3.4;
    const px = A[0] + (B[0] - A[0]) * t + -inward[1] * side;
    const pz = A[2] + (B[2] - A[2]) * t + inward[0] * side;
    const py = A[1] + (B[1] - A[1]) * t - rnd() * 0.35 - Math.abs(side) * 0.25;
    place(px, Math.max(y, py), pz, 0.35 + rnd() * 0.55, chunks[Math.floor(rnd() * chunks.length)]);
  }
  // конус вокруг
  const pileR = r0 + 4;
  for (let k = 0; k < 160; k++) {
    const ang = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * pileR;
    const h = Math.max(0, 2.2 * (1 - d / pileR) ** 1.3);
    place(rx + Math.cos(ang) * d, y + rnd() * h, rz + Math.sin(ang) * d, 0.25 + rnd() * 0.6, chunks[Math.floor(rnd() * chunks.length)]);
  }
  // обломки плит, прислонённые к завалу
  for (let k = 0; k < 6; k++) {
    const ang = rnd() * Math.PI * 2;
    const d = 1 + rnd() * (pileR - 2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(rx + Math.cos(ang) * d, y + 0.6 + rnd() * 0.8, rz + Math.sin(ang) * d),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 1.2, rnd() * 3, (rnd() - 0.5) * 1.2)),
      new THREE.Vector3(1.6 + rnd() * 1.2, 0.22, 1.2 + rnd()),
    );
    b.add('concreteDark', piece, m);
  }
  // пандус для физики: наклонная плита от A до B
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const dz = B[2] - A[2];
  const run = Math.hypot(dx, dz);
  const len = Math.hypot(run, dy);
  const ramp = new THREE.Matrix4().compose(
    new THREE.Vector3((A[0] + B[0]) / 2, (A[1] + B[1]) / 2 - 0.3, (A[2] + B[2]) / 2),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(dy, run), Math.atan2(dx, dz), 0, 'YXZ')),
    new THREE.Vector3(3.2, 0.6, len + 0.4),
  );
  // низ здания (первый этаж) — пол уже есть: плита квартала
  return { builder: b, collision, ramps: [ramp], top: y + s.H + s.parapet, H: s.H, levels: s.levels, openings, spec: s };
}

/* ------------------------------------------------------------------ */
/* Дом целиком                                                         */
/* ------------------------------------------------------------------ */

/**
 * spec: { name, x0, z0, x1, z1, y, style, floors, wall, sides, ground, signs,
 *         balconies, damage, boarded, arches, seed, ... } — всё, что не задано,
 * берётся из стиля. Возвращает { builder, collision, top, info }.
 */
export function createBuilding(spec, builder = new MeshBuilder()) {
  const style = STYLES[spec.style ?? 'classic'];
  const s = {
    floors: 4, damage: 0.05, boarded: 0.02, balconies: 0.15, ac: 0.08, y: 0.15,
    glassMat: 'glass', doorMat: 'doorWood', wall: 'plasterCream', style: spec.style ?? 'classic',
    ...style, ...spec,
  };
  s.sides = { n: 'side', e: 'side', s: 'side', w: 'side', ...spec.sides };
  s.levels = [0];
  for (let f = 0; f < s.floors; f++) s.levels.push(s.levels[f] + (f === 0 ? s.groundH : s.floorH));
  s.H = s.levels[s.floors] + (s.attic ?? 0);
  const rnd = random(s.seed ?? 1);
  const keep = spec.keep ?? (() => true);
  const { x0, z0, x1, z1, y } = s;
  const alive = s.ruin ? ruinField(s) : null;
  if (alive) Object.assign(s, { interior: true, openWindows: true, damage: Math.max(s.damage, 0.7), roof: 'flat', parapet: 0.45, noRoofStuff: true, ac: 0 });

  const openings = {};
  for (const side of ['n', 'e', 's', 'w']) {
    const F = new Facade(builder, side, x0, z0, x1, z1, y);
    if (alive) Object.assign(F, { filter: alive, chunk: 1.0 });
    openings[side] = emitFacade(F, s, side, rnd, keep);
  }
  if (alive) return ruinInterior(builder, s, alive, rnd, openings);

  // проезды-арки сквозь дом
  const collision = [];
  const roofY = y + s.H;
  for (const arch of s.arches ?? []) {
    const { at, width: aw, height: ah } = arch;
    const alongZ = arch.sides.includes('n') || arch.sides.includes('s');
    const [a0, a1] = [at - aw / 2, at + aw / 2];
    if (alongZ) {
      builder.quad('stone', [a0, y, z1], [a0, y, z0], [a0, y + ah, z0], [a0, y + ah, z1]);
      builder.quad('stone', [a1, y, z0], [a1, y, z1], [a1, y + ah, z1], [a1, y + ah, z0]);
      builder.quad('trimGrey', [a0, y + ah, z0], [a1, y + ah, z0], [a1, y + ah, z1], [a0, y + ah, z1]);
      collision.push([x0, y, z0, a0, roofY, z1], [a1, y, z0, x1, roofY, z1], [a0, y + ah, z0, a1, roofY, z1]);
    } else {
      builder.quad('stone', [x0, y, a0], [x1, y, a0], [x1, y + ah, a0], [x0, y + ah, a0]);
      builder.quad('stone', [x1, y, a1], [x0, y, a1], [x0, y + ah, a1], [x1, y + ah, a1]);
      builder.quad('trimGrey', [x0, y + ah, a0], [x1, y + ah, a0], [x1, y + ah, a1], [x0, y + ah, a1]);
      collision.push([x0, y, z0, x1, roofY, a0], [x0, y, a1, x1, roofY, z1], [x0, y + ah, a0, x1, roofY, a1]);
    }
  }
  if (!s.arches?.length && !s.noCollision) collision.push([x0, y, z0, x1, roofY + (s.parapet || 0), z1]);

  let top = roofY + (s.parapet || 0);
  if (s.roof === 'flat') flatRoof(builder, s, x0, z0, x1, z1, roofY, rnd);
  else if (s.roof === 'hip' || s.roof === 'gable') {
    top = pitchedRoof(builder, s, x0, z0, x1, z1, roofY, rnd);
    collision.push([x0, roofY, z0, x1, (roofY + top) / 2, z1]);
  }
  return { builder, collision, top, H: s.H, levels: s.levels, openings, spec: s };
}

export { SIGNS };
