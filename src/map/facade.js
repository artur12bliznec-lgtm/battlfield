/*
 * Фасад — плоскость стены дома в своих координатах:
 *   u — вдоль фасада слева направо (как видит прохожий, стоящий лицом к дому),
 *   v — вверх от земли,
 *   w — наружу из стены (w = 0 — плоскость стены, w < 0 — внутри дома).
 * Все детали — прямоугольные коробки, поэтому в мире они тоже выровнены по осям.
 */

const SIDES = {
  s: { U: [1, 0, 0], W: [0, 0, 1] },
  n: { U: [-1, 0, 0], W: [0, 0, -1] },
  e: { U: [0, 0, -1], W: [1, 0, 0] },
  w: { U: [0, 0, 1], W: [-1, 0, 0] },
};

const faceName = ([x, , z]) => (x > 0 ? 'x+' : x < 0 ? 'x-' : z > 0 ? 'z+' : 'z-');
const negate = ([x, y, z]) => [-x, -y, -z];

export class Facade {
  /**
   * side — сторона света ('n' | 'e' | 's' | 'w'), куда смотрит фасад;
   * x0..z1 — пятно дома, y — отметка земли.
   */
  constructor(builder, side, x0, z0, x1, z1, y) {
    const { U, W } = SIDES[side];
    this.b = builder;
    this.side = side;
    this.U = U;
    this.W = W;
    const origins = {
      s: [[x0, y, z1], x1 - x0],
      n: [[x1, y, z0], x1 - x0],
      e: [[x1, y, z1], z1 - z0],
      w: [[x0, y, z0], z1 - z0],
    };
    [this.O, this.L] = origins[side];
    // грани коробки в координатах фасада: f — лицевая, b — задняя, l/r — торцы, t/d — верх/низ
    this.faces = { f: faceName(W), b: faceName(negate(W)), r: faceName(U), l: faceName(negate(U)), t: 'y+', d: 'y-' };
  }

  /** Точка фасада (u, v, w) в мировых координатах. */
  p(u, v, w = 0) {
    const { O, U, W } = this;
    return [O[0] + u * U[0] + w * W[0], O[1] + v, O[2] + u * U[2] + w * W[2]];
  }

  /**
   * Коробка [u0, u1] × [v0, v1] × [w0, w1]; skip — ненужные грани ('b', 'lr', 'td'...).
   * Если задан filter (разрушенный дом), длинные коробки режутся на куски
   * не больше chunk и строятся только уцелевшие куски — со всеми гранями.
   */
  box(material, u0, u1, v0, v1, w0, w1, skip = '') {
    if (this.filter) {
      const nu = Math.max(1, Math.ceil((u1 - u0) / this.chunk));
      const nv = Math.max(1, Math.ceil((v1 - v0) / this.chunk));
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const a0 = u0 + ((u1 - u0) * i) / nu;
          const a1 = u0 + ((u1 - u0) * (i + 1)) / nu;
          const b0 = v0 + ((v1 - v0) * j) / nv;
          const b1 = v0 + ((v1 - v0) * (j + 1)) / nv;
          if (!this.filter(this.p((a0 + a1) / 2, (b0 + b1) / 2, (w0 + w1) / 2))) continue;
          const a = this.p(a0, b0, w0);
          const c = this.p(a1, b1, w1);
          this.b.box(material, a[0], a[1], a[2], c[0], c[1], c[2]);
        }
      }
      return;
    }
    const a = this.p(u0, v0, w0);
    const c = this.p(u1, v1, w1);
    let s = '';
    for (const ch of skip) s += this.faces[ch] ?? '';
    this.b.box(material, a[0], a[1], a[2], c[0], c[1], c[2], s);
  }

  /** Уцелела ли точка фасада (для разрушенных домов). */
  alive(u, v, w = 0) {
    return !this.filter || this.filter(this.p(u, v, w));
  }

  /** Прямоугольник в плоскости w, смотрит наружу (+w) или внутрь (back = true). */
  rect(material, u0, v0, u1, v1, w, uv = null, back = false) {
    if (!this.alive((u0 + u1) / 2, (v0 + v1) / 2, w)) return;
    const a = this.p(u0, v0, w);
    const b = this.p(u1, v0, w);
    const c = this.p(u1, v1, w);
    const d = this.p(u0, v1, w);
    if (back) this.b.quad(material, b, a, d, c, uv && [uv[1], uv[0], uv[3], uv[2]]);
    else this.b.quad(material, a, b, c, d, uv);
  }

  /** Четырёхугольник по точкам фасада [u, v, w] (против часовой, если смотреть снаружи). */
  quad(material, a, b, c, d, uv = null) {
    if (!this.alive((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2)) return;
    this.b.quad(material, this.p(...a), this.p(...b), this.p(...c), this.p(...d), uv);
  }

  /**
   * Треугольная призма: треугольник (u, v) против часовой стрелки, выдавленный
   * от w0 до w1. Задняя грань (w0) не строится — она прижата к стене.
   */
  prism(material, tri, w0, w1) {
    const [a, b, c] = tri;
    if (!this.alive((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, w1)) return;
    this.b.triangle(material, this.p(a[0], a[1], w1), this.p(b[0], b[1], w1), this.p(c[0], c[1], w1));
    const edges = [[a, b], [b, c], [c, a]];
    for (const [p, q] of edges) {
      this.quad(material, [p[0], p[1], w0], [q[0], q[1], w0], [q[0], q[1], w1], [p[0], p[1], w1]);
    }
  }

  /** Наклонная плоскость (козырёк, маркиза): от линии (v0, w0) до (v1, w1) по ширине u0..u1, видна с двух сторон. */
  slope(material, u0, u1, v0, w0, v1, w1) {
    this.quad(material, [u0, v0, w0], [u1, v0, w0], [u1, v1, w1], [u0, v1, w1]);
    this.quad(material, [u1, v0, w0], [u0, v0, w0], [u0, v1, w1], [u1, v1, w1]);
  }
}

/**
 * Полоса стены [vb, vt] за вычетом проёмов: возвращает куски стены
 * (простенки, подоконные и надоконные части). Проёмы не должны
 * перекрываться по u внутри полосы.
 */
export function cutBand(L, vb, vt, openings) {
  const list = [];
  for (const o of openings) {
    if (o.v1 <= vb + 1e-4 || o.v0 >= vt - 1e-4) continue;
    list.push({ u0: o.u0, u1: o.u1, v0: Math.max(o.v0, vb), v1: Math.min(o.v1, vt) });
  }
  const xs = [...new Set([0, L, ...list.flatMap((o) => [o.u0, o.u1])])].filter((x) => x >= 0 && x <= L).sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    if (b - a < 1e-4) continue;
    const mid = (a + b) / 2;
    const o = list.find((q) => q.u0 <= mid && q.u1 >= mid);
    if (!o) {
      pieces.push({ u0: a, u1: b, v0: vb, v1: vt, kind: 'pier' });
    } else {
      if (o.v0 > vb + 1e-4) pieces.push({ u0: a, u1: b, v0: vb, v1: o.v0, kind: 'below' });
      if (o.v1 < vt - 1e-4) pieces.push({ u0: a, u1: b, v0: o.v1, v1: vt, kind: 'above' });
    }
  }
  return pieces;
}

/** Грани, которые не видно у куска стены: тыльная, торцы на углах дома, стыки полос. */
export function pieceSkip(piece, L, { back = true } = {}) {
  let skip = back ? 'b' : '';
  if (piece.u0 <= 1e-4) skip += 'l';
  if (piece.u1 >= L - 1e-4) skip += 'r';
  if (piece.kind !== 'below') skip += 't';
  if (piece.kind !== 'above') skip += 'd';
  return skip;
}
