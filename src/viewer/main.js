import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CATALOG } from '../models/index.js';
import { exportGLB } from '../models/export.js';

/*
 * Просмотрщик моделей.
 * Параметры адреса (удобно для скриншотов): ?model=pistol&view=side&ui=0&rotate=0
 * Модель можно выбрать и через якорь: index.html#machine_gun
 */

const params = new URLSearchParams(location.search);
const bare = params.get('ui') === '0';
if (bare) document.body.classList.add('bare');

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('view');
const app = $('app');

/* ---------- Рендер и сцена ---------- */

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const labelRenderer = new CSS2DRenderer();
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
stage.appendChild(labelRenderer.domElement);

const BACKGROUND = new THREE.Color('#1b1f19');
const scene = new THREE.Scene();
scene.background = BACKGROUND;
scene.fog = new THREE.Fog(BACKGROUND, 10, 30);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight('#e9e9e2', '#2a2d26', 1.1));
const sun = new THREE.DirectionalLight('#fff4e4', 2.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight('#dfe6f2', 1.4);
scene.add(rim);

// «Пол» только принимает тени, поэтому фон остаётся ровным
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(40, 72).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ color: '#000000', opacity: 0.38 }),
);
ground.receiveShadow = true;
scene.add(ground);
let grid = null;

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotateSpeed = 1.2;

/* ---------- Текущая модель ---------- */

const holder = new THREE.Group(); // ставит модель на «пол», сама модель остаётся в своих координатах
scene.add(holder);

const state = {
  entry: null,
  model: null,
  controller: null,
  size: 1,
  view: params.get('view'),
  values: {},
  helpers: [],
};

const VIEWS = {
  hero: [-0.28, 0.2, 1],
  iso: [-1, 0.42, 0.62],
  side: [-1, 0.16, 0.0001],
  front: [0.0001, 0.1, 1],
  top: [0.0001, 1, 0.12],
};

function triangleCount(root) {
  let count = 0;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const g = obj.geometry;
    count += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return count;
}

function materialCount(root) {
  const set = new Set();
  root.traverse((obj) => {
    if (obj.isMesh) [].concat(obj.material).forEach((m) => set.add(m.name));
  });
  return set.size;
}

const number = (value, digits = 2) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });

function anchorsOf(root) {
  const list = [];
  root.traverse((obj) => {
    if (obj.type === 'Object3D' && obj !== root) list.push(obj);
  });
  return list;
}

function frameModel() {
  holder.position.set(0, 0, 0);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(state.model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  state.size = radius;

  // подставка: модель стоит на полу (оружие чуть приподнято)
  const lift = state.entry.kind === 'weapon' ? radius * 0.12 : 0;
  holder.position.set(-center.x, -box.min.y + lift, -center.z);
  const target = new THREE.Vector3(0, size.y / 2 + lift, 0);

  // расстояние камеры подбирается так, чтобы габариты модели влезли в кадр
  const dir = new THREE.Vector3(...(VIEWS[state.view] ?? VIEWS.iso)).normalize();
  const forward = dir.clone().negate();
  const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  const up = right.clone().cross(forward).normalize();
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * camera.aspect;
  let distance = 0;
  for (let i = 0; i < 8; i++) {
    const corner = new THREE.Vector3(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );
    corner.add(holder.position).sub(target);
    const need = corner.dot(dir) + Math.max(Math.abs(corner.dot(right)) / tanH, Math.abs(corner.dot(up)) / tanV);
    distance = Math.max(distance, need);
  }
  distance *= state.entry.kind === 'weapon' ? 1.25 : 1.15;
  camera.position.copy(target).addScaledVector(dir, distance);
  // ручная камера для скриншотов: ?cam=x,y,z&target=x,y,z (координаты модели)
  if (params.get('cam') && params.get('target')) {
    target.fromArray(params.get('target').split(',').map(Number)).add(holder.position);
    camera.position.fromArray(params.get('cam').split(',').map(Number)).add(holder.position);
    distance = camera.position.distanceTo(target);
  }
  camera.near = distance / 100;
  camera.far = distance * 20;
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.minDistance = radius * 0.6;
  controls.maxDistance = distance * 4;
  controls.update();

  // свет ставится относительно выбранного ракурса: ключевой — сверху-слева
  // от камеры, контровой — сзади, чтобы видимая сторона модели была освещена
  const flat = new THREE.Vector3(dir.x, 0, dir.z);
  if (flat.lengthSq() < 1e-4) flat.set(0, 0, 1);
  flat.normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(flat); // «лево» для камеры
  sun.position.copy(target).addScaledVector(flat, radius * 3).addScaledVector(side, radius * 2.2).add(new THREE.Vector3(0, radius * 5, 0));
  sun.target.position.set(0, target.y * 0.5, 0);
  const s = radius * 1.6;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.01, far: radius * 14 });
  sun.shadow.camera.updateProjectionMatrix();
  rim.position.copy(target).addScaledVector(flat, -radius * 4).addScaledVector(side, -radius * 2).add(new THREE.Vector3(0, radius * 2, 0));
  scene.fog.near = distance * 1.5;
  scene.fog.far = distance * 6;

  // сетка: шаг 10 см для оружия, 50 см для бойцов
  if (grid) scene.remove(grid);
  const step = radius > 0.7 ? 0.5 : radius > 0.2 ? 0.1 : 0.05;
  const cells = Math.ceil((radius * 4) / step);
  grid = new THREE.GridHelper(cells * step, cells, '#394031', '#2b3126');
  grid.position.y = 0.0005;
  scene.add(grid);
}

function renderSpecs() {
  const { entry, model } = state;
  const info = model.userData;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const rows = [];
  if (entry.kind === 'weapon') {
    rows.push(['Калибр', info.caliber], ['Магазин', `${info.capacity} патр.`], ['Темп', `${info.rpm} выстр/мин`]);
    rows.push(['Режимы', info.modes], ['Длина', `${number(size.z)} м`]);
  } else if (entry.kind === 'soldier') {
    rows.push(['Фракция', info.factionName], ['Рост', `${number(size.y)} м`], ['Кости', info.bones]);
    rows.push(['Анимации', entry.clips ?? 0]);
  } else if (entry.kind === 'scene') {
    rows.push(['Моделей', info.models], ['Сторон', 2], ['Оружия', 4]);
  } else {
    rows.push(['Размер', `${number(size.x * 100, 0)}×${number(size.y * 100, 0)}×${number(size.z * 100, 0)} см`]);
  }
  rows.push(['Треугольники', number(triangleCount(model), 0)], ['Материалы', materialCount(model)]);
  $('specs').replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

function setPointsVisible(visible) {
  for (const h of state.helpers) h.removeFromParent();
  state.helpers = [];
  if (!visible || !state.model) return;
  for (const node of anchorsOf(state.model)) {
    const axes = new THREE.AxesHelper(state.size * 0.12);
    axes.material.depthTest = false;
    axes.renderOrder = 10;
    const tag = document.createElement('span');
    tag.className = 'point-label';
    tag.textContent = node.name;
    const label = new CSS2DObject(tag);
    label.center.set(-0.08, 1.1);
    node.add(axes, label);
    state.helpers.push(axes, label);
  }
}

function setWireframe(on) {
  state.model?.traverse((obj) => {
    if (obj.isMesh) [].concat(obj.material).forEach((m) => (m.wireframe = on));
  });
}

function disposeModel() {
  if (!state.model) return;
  setPointsVisible(false);
  state.model.traverse((obj) => obj.geometry?.dispose());
  holder.remove(state.model);
  state.model = null;
}

/* ---------- Настройки модели (оружие в руках, анимация, сошки...) ---------- */

function renderOptions() {
  const box = $('options');
  box.replaceChildren();
  for (const option of state.entry.options ?? []) {
    const id = `opt-${option.id}`;
    const fromUrl = params.get(option.id);
    const urlValue = fromUrl === null ? undefined : option.type === 'select' ? fromUrl : fromUrl === '1' || fromUrl === 'true';
    const value = state.values[option.id] ?? urlValue ?? option.default;
    state.values[option.id] = value;
    if (option.type === 'select') {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      label.className = 'field-label';
      label.htmlFor = id;
      label.textContent = option.label;
      const select = document.createElement('select');
      select.id = id;
      for (const [v, text] of option.choices) select.add(new Option(text, v, false, v === value));
      select.addEventListener('change', () => applyOption(option, select.value));
      field.append(label, select);
      box.append(field);
    } else {
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = value;
      input.addEventListener('change', () => applyOption(option, input.checked));
      label.append(input, ` ${option.label}`);
      box.append(label);
    }
  }
}

function applyOption(option, value) {
  state.values[option.id] = value;
  option.apply(state.model, value, state.controller);
  if (option.reframe) frameModel();
}

/* ---------- Выбор модели ---------- */

function show(id) {
  const entry = CATALOG.find((e) => e.id === id) ?? CATALOG[0];
  disposeModel();
  state.entry = entry;
  state.values = {};
  state.model = entry.create(true); // для просмотра анимации не запекаются — позы считаются на лету
  holder.add(state.model);
  state.model.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = obj.receiveShadow = true;
  });
  state.controller = entry.controller?.(state.model) ?? null;
  if (!params.get('view')) state.view = entry.view ?? 'iso';

  renderOptions();
  for (const option of entry.options ?? []) option.apply(state.model, state.values[option.id], state.controller);

  frameModel();
  renderSpecs();
  setWireframe($('opt-wire').checked);
  setPointsVisible($('opt-points').checked);
  updateViewButtons();

  download.hidden = noDownload || entry.kind === 'scene';
  $('title').textContent = entry.name;
  $('subtitle').textContent = `${entry.group} · ${entry.note}`;
  document.querySelectorAll('.model-button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === entry.id)));
  if (!bare) {
    try {
      history.replaceState(null, '', `#${entry.id}`);
    } catch {
      // во встроенной песочнице адрес может быть недоступен — не страшно
    }
  }
}

function renderList() {
  const groups = new Map();
  for (const entry of CATALOG) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  const nav = $('model-list');
  for (const [group, entries] of groups) {
    const section = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'group-label';
    title.textContent = group;
    const items = document.createElement('div');
    items.className = 'group-items';
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-button';
      button.dataset.id = entry.id;
      button.innerHTML = `<span class="swatch ${entry.swatch ?? ''}"></span><span class="model-name"></span><span class="model-note"></span>`;
      button.querySelector('.model-name').textContent = entry.name;
      button.querySelector('.model-note').textContent = entry.note;
      button.addEventListener('click', () => show(entry.id));
      items.append(button);
    }
    section.append(title, items);
    nav.append(section);
  }
}

function updateViewButtons() {
  document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
}

document.querySelectorAll('#views button').forEach((button) =>
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    updateViewButtons();
    frameModel();
  }),
);

$('opt-rotate').checked = params.get('rotate') !== '0' && !bare;
$('opt-rotate').addEventListener('change', (e) => (controls.autoRotate = e.target.checked));
$('opt-points').addEventListener('change', (e) => setPointsVisible(e.target.checked));
$('opt-wire').addEventListener('change', (e) => setWireframe(e.target.checked));
controls.autoRotate = $('opt-rotate').checked;

const download = $('download');
const noDownload = app.hasAttribute('data-no-download'); // в песочнице без скачивания кнопку прячем
download.addEventListener('click', async () => {
  const entry = state.entry;
  download.disabled = true;
  try {
    const data = await exportGLB(entry.create());
    const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry.id}.glb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    download.disabled = false;
  }
});

/* ---------- Цикл ---------- */

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

const timer = new THREE.Timer();
let frames = 0;
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.05);
  if (state.controller && params.has('t')) state.controller.time = Number(params.get('t'));
  state.controller?.update(params.has('t') ? 0 : dt);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  if (++frames === 3) window.__viewerReady = true; // для автоматических скриншотов
});

renderList();
show(location.hash.slice(1) || params.get('model') || CATALOG[0].id);
window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && id !== state.entry?.id) show(id);
});
