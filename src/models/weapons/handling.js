import * as THREE from 'three';
import { DEG } from '../kit.js';

/*
 * Общая «геометрия хвата» и анимации самого оружия.
 *
 * У всего длинноствольного оружия рукоять стоит под одним углом, а точка
 * левой руки (grip_l) и точка, за которую берут магазин, — на одних и тех же
 * местах относительно правой руки. Поэтому одни и те же анимации бойца
 * подходят к автомату, винтовке, пулемёту и снайперке без доработки.
 *
 * Координаты — в системе оружия: начало в точке хвата правой рукой (grip_r),
 * +Z — к дулу, +Y — вверх, +X — левый бок оружия.
 */
export const LONG_GUN = {
  gripAngle: 18 * DEG,
  support: [0, 0.07, 0.33], // grip_l: цевьё, газовая трубка или ложа
  magazine: [0, -0.02, 0.16], // где левая рука держит магазин при перезарядке
};

export const PISTOL = {
  gripAngle: 22 * DEG,
  support: [0.028, -0.01, 0.0025], // левая кисть обхватывает правую сбоку
};

/*
 * Путь левой руки при перезарядке. Каждый ключ: [время, позиция, поворот].
 * Позиция — центр кулака, поворот (градусы) — относительно хвата за цевьё:
 * ось +Y — от ладони к удерживаемой детали, +Z — куда смотрит большой палец.
 */
export const RELOAD = {
  long: {
    duration: 2.3,
    grab: 0.45, // рука взялась за магазин
    insert: 1.75, // новый магазин встал на место
    keys: [
      [0, LONG_GUN.support, [0, 0, 0]],
      [0.2, LONG_GUN.support, [0, 0, 0]],
      [0.45, LONG_GUN.magazine, [-90, 0, 0]],
      [0.72, [0, -0.17, 0.17], [-90, 0, -10]],
      [1.02, [0.12, -0.25, -0.02], [-60, 30, -30]],
      [1.22, [0.12, -0.26, 0.0], [-60, 30, -30]],
      [1.55, [0, -0.17, 0.17], [-90, 0, -10]],
      [1.75, LONG_GUN.magazine, [-90, 0, 0]],
      [1.82, [0, -0.012, 0.162], [-90, 0, 0]],
      [1.9, LONG_GUN.magazine, [-90, 0, 0]],
      [2.1, LONG_GUN.support, [0, 0, 0]],
      [2.3, LONG_GUN.support, [0, 0, 0]],
    ],
  },
  pistol: {
    duration: 1.7,
    drop: [0.15, 0.35], // пустой магазин выпадает
    appear: 0.62, // новый магазин в руке
    insert: 1.15,
    keys: [
      [0, PISTOL.support, [0, 0, 0]],
      [0.2, PISTOL.support, [0, 0, 0]],
      [0.55, [0.18, -0.3, -0.25], [-90, 0, 0]],
      [0.62, [0.18, -0.3, -0.25], [-90, 0, 0]],
      [0.95, [0, -0.17, 0.0], [0, 0, 0]],
      [1.15, [0, -0.08, 0.0], [0, 0, 0]],
      [1.3, [0, -0.08, 0.0], [0, 0, 0]],
      [1.5, PISTOL.support, [0, 0, 0]],
      [1.7, PISTOL.support, [0, 0, 0]],
    ],
  },
};

const smooth = (x) => x * x * (3 - 2 * x);

/** Матрица кулака левой руки в системе оружия в момент t (плавно между ключами). */
export function reloadHand(kind, t) {
  const { keys } = RELOAD[kind];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, p0, r0] = keys[i];
  const [t1, p1, r1] = keys[i + 1];
  const k = smooth(THREE.MathUtils.clamp((t - t0) / Math.max(t1 - t0, 1e-6), 0, 1));
  const position = new THREE.Vector3(...p0).lerp(new THREE.Vector3(...p1), k);
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(r0[0] * DEG, r0[1] * DEG, r0[2] * DEG));
  const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(r1[0] * DEG, r1[1] * DEG, r1[2] * DEG));
  return new THREE.Matrix4().compose(position, q0.slerp(q1, k), new THREE.Vector3(1, 1, 1));
}

/**
 * Положение магазина (локальная матрица относительно корня оружия) в момент t.
 * rest — локальная матрица магазина в покое. Между «взял» и «вставил»
 * магазин жёстко следует за левой рукой.
 */
export function reloadMagazine(kind, t, rest) {
  const spec = RELOAD[kind];
  const follow = (anchorTime) => reloadHand(kind, t).multiply(reloadHand(kind, anchorTime).invert()).multiply(rest);
  if (kind === 'long') {
    return t > spec.grab && t < spec.insert ? follow(spec.grab) : rest.clone();
  }
  const [dropStart, dropEnd] = spec.drop;
  if (t > dropStart && t < spec.appear) {
    // пустой магазин выскальзывает вниз и исчезает
    const k = THREE.MathUtils.clamp((t - dropStart) / (dropEnd - dropStart), 0, 1);
    const m = new THREE.Matrix4().makeTranslation(0, -0.16 * k * k, 0).multiply(rest);
    return k >= 1 ? m.scale(new THREE.Vector3(1e-4, 1e-4, 1e-4)) : m;
  }
  return t >= spec.appear && t < spec.insert ? follow(spec.insert) : rest.clone();
}

function sampleClip(name, duration, nodes, fps = 30) {
  const frames = Math.max(1, Math.round(duration * fps));
  const times = new Float32Array(frames + 1);
  const data = nodes.map(() => ({ p: new Float32Array((frames + 1) * 3), q: new Float32Array((frames + 1) * 4), s: new Float32Array((frames + 1) * 3) }));
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (let f = 0; f <= frames; f++) {
    const t = (f / frames) * duration;
    times[f] = t;
    nodes.forEach((node, i) => {
      node.matrixAt(t).decompose(p, q, s);
      p.toArray(data[i].p, f * 3);
      q.toArray(data[i].q, f * 4);
      s.toArray(data[i].s, f * 3);
    });
  }
  const tracks = nodes.flatMap((node, i) => [
    new THREE.VectorKeyframeTrack(`${node.name}.position`, times, data[i].p),
    new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, data[i].q),
    new THREE.VectorKeyframeTrack(`${node.name}.scale`, times, data[i].s),
  ]);
  return new THREE.AnimationClip(name, duration, tracks);
}

const restMatrix = (node) => new THREE.Matrix4().compose(node.position, node.quaternion, node.scale);

/** Поворот ноги сошек: 0 — сложена, 1 — разложена. */
export function bipodLegRotation(name, foldedForward, amount) {
  const side = name.endsWith('_l') ? 1 : -1;
  const tilt = (foldedForward ? 80 : -100) * DEG * amount;
  return new THREE.Euler(tilt, 0, side * 12 * DEG * amount, 'ZXY');
}

/**
 * Анимации самого оружия (сохраняются в его .glb):
 *   Reload       — магазин вынимается и вставляется синхронно с Rifle_Reload / Pistol_Reload бойца;
 *   Fire         — откат затвора (автомат) или кожуха-затвора (пистолет);
 *   Bipod_Deploy — сошки раскладываются (обратное — проиграть клип задом наперёд).
 */
export function weaponClips(root, { hold, foldedForward = true }) {
  const clips = [];
  const kind = hold === 'pistol' ? 'pistol' : 'long';
  const magazine = root.getObjectByName('magazine');
  if (magazine) {
    const rest = restMatrix(magazine);
    clips.push(sampleClip('Reload', RELOAD[kind].duration, [{ name: 'magazine', matrixAt: (t) => reloadMagazine(kind, t, rest) }]));
  }
  const recoil = root.getObjectByName(hold === 'pistol' ? 'slide' : 'bolt');
  if (recoil) {
    const rest = restMatrix(recoil);
    const travel = hold === 'pistol' ? 0.026 : 0.08;
    const back = (t) => (t < 0.025 ? t / 0.025 : Math.max(0, 1 - (t - 0.025) / 0.065));
    clips.push(sampleClip('Fire', 0.09, [{ name: recoil.name, matrixAt: (t) => new THREE.Matrix4().makeTranslation(0, 0, -travel * back(t)).multiply(rest) }], 100));
  }
  const legs = (root.userData.bipod ?? []).map((name) => root.getObjectByName(name));
  if (legs.length) {
    clips.push(sampleClip('Bipod_Deploy', 0.5, legs.map((leg) => {
      const rest = restMatrix(leg);
      return {
        name: leg.name,
        matrixAt: (t) => {
          const q = new THREE.Quaternion().setFromEuler(bipodLegRotation(leg.name, foldedForward, smooth(t / 0.5)));
          return new THREE.Matrix4().compose(new THREE.Vector3().setFromMatrixPosition(rest), q, new THREE.Vector3(1, 1, 1));
        },
      };
    })));
  }
  return clips;
}
