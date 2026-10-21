// Генерирует godot/scenes/city.tscn из данных планировки (src/map/layout.js):
// окружение боя (небо в дыму, низкое солнце, туман), карту, отметки режима
// (точка захвата, места появления, позиции союзников у въездов на площадь и
// кольцом у памятника) и наблюдателя.
// Запуск: npm run scene
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MODE, SIDEWALK } from '../src/map/layout.js';

const f = (v) => {
  const r = Math.round(v * 1e5) / 1e5;
  return Object.is(r, -0) ? '0' : String(r);
};
const color = ([r, g, b, a = 1]) => `Color(${f(r)}, ${f(g)}, ${f(b)}, ${f(a)})`;
/** Transform3D: базис (строки) + точка. yaw/pitch в градусах (Y, затем X). */
function transform([x, y, z] = [0, 0, 0], yaw = 0, pitch = 0) {
  const cy = Math.cos((yaw * Math.PI) / 180);
  const sy = Math.sin((yaw * Math.PI) / 180);
  const cp = Math.cos((pitch * Math.PI) / 180);
  const sp = Math.sin((pitch * Math.PI) / 180);
  // R = Ry * Rx
  const m = [
    [cy, sy * sp, sy * cp],
    [0, cp, -sp],
    [-sy, cy * sp, cy * cp],
  ];
  return `Transform3D(${m.flat().map(f).join(', ')}, ${f(x)}, ${f(y)}, ${f(z)})`;
}
function lookBasis(dir, [x, y, z]) {
  // ось Z узла смотрит против dir (у света и камеры «вперёд» — это −Z)
  const n = Math.hypot(...dir);
  const Z = dir.map((v) => -v / n);
  let X = [Z[2], 0, -Z[0]]; // up × Z
  const xl = Math.hypot(...X);
  X = X.map((v) => v / xl);
  const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  const rows = [[X[0], Y[0], Z[0]], [X[1], Y[1], Z[1]], [X[2], Y[2], Z[2]]];
  return `Transform3D(${rows.flat().map(f).join(', ')}, ${f(x)}, ${f(y)}, ${f(z)})`;
}
const yawTo = ([x, z], [tx, tz]) => (Math.atan2(-(tx - x), -(tz - z)) * 180) / Math.PI;

const ext = [];
const sub = [];
const nodes = [];
const extRes = (type, path, id) => ext.push(`[ext_resource type="${type}" path="${path}" id="${id}"]`);
const subRes = (type, id, props) => sub.push(`[sub_resource type="${type}" id="${id}"]\n${Object.entries(props).map(([k, v]) => `${k} = ${v}`).join('\n')}`);
const node = (header, props = {}) => nodes.push(`[node ${header}]\n${Object.entries(props).map(([k, v]) => `${k} = ${v}`).join('\n')}`.trimEnd());

extRes('Script', 'res://scripts/city.gd', '1_city');
extRes('PackedScene', 'res://assets/maps/city.glb', '2_map');
extRes('Script', 'res://scripts/spectator.gd', '3_spectator');

// небо в дыму: вверху серо-синее, у горизонта — бурая дымка пожаров
subRes('ProceduralSkyMaterial', 'sky_material', {
  sky_top_color: color([0.27, 0.31, 0.37]),
  sky_horizon_color: color([0.64, 0.56, 0.47]),
  sky_curve: '0.12',
  ground_bottom_color: color([0.18, 0.17, 0.16]),
  ground_horizon_color: color([0.64, 0.56, 0.47]),
  sun_angle_max: '40.0',
  sun_curve: '0.08',
});
subRes('Sky', 'sky', { sky_material: 'SubResource("sky_material")' });
subRes('Environment', 'environment', {
  background_mode: '2',
  sky: 'SubResource("sky")',
  ambient_light_source: '3',
  ambient_light_energy: '0.85',
  reflected_light_source: '2',
  tonemap_mode: '2',
  tonemap_white: '6.0',
  ssao_enabled: 'true',
  ssao_radius: '1.2',
  ssao_intensity: '1.6',
  // свечение: огонь, вспышки, трассеры
  glow_enabled: 'true',
  glow_intensity: '0.7',
  glow_bloom: '0.03',
  glow_hdr_threshold: '1.1',
  // дымка боя: даль тонет в бурой мгле
  fog_enabled: 'true',
  fog_light_color: color([0.58, 0.53, 0.47]),
  fog_sun_scatter: '0.3',
  fog_density: '0.005',
  fog_aerial_perspective: '0.35',
  fog_sky_affect: '0.5',
  // объёмный туман: лучи солнца сквозь дым, ореолы у пожаров
  volumetric_fog_enabled: 'true',
  volumetric_fog_density: '0.01',
  volumetric_fog_albedo: color([0.78, 0.74, 0.68]),
  volumetric_fog_anisotropy: '0.4',
  volumetric_fog_length: '96.0',
  volumetric_fog_sky_affect: '0.3',
  // приглушённые цвета
  adjustment_enabled: 'true',
  adjustment_contrast: '1.08',
  adjustment_saturation: '0.8',
});
subRes('CylinderShape3D', 'capture_shape', { height: '8.0', radius: f(MODE.capture.radius) });
subRes('CapsuleShape3D', 'body_shape', { radius: '0.4', height: '1.8' });
const mat = (id, rgba) => subRes('StandardMaterial3D', id, { transparency: '1', shading_mode: '0', albedo_color: color(rgba) });
mat('zone_material', [0.95, 0.77, 0.25, 0.28]);
mat('defender_material', [0.24, 0.48, 0.88, 0.55]);
mat('attacker_material', [0.88, 0.31, 0.24, 0.55]);
subRes('CylinderMesh', 'zone_mesh', { material: 'SubResource("zone_material")', top_radius: f(MODE.capture.radius), bottom_radius: f(MODE.capture.radius), height: '0.06', radial_segments: '64', rings: '1' });
subRes('CylinderMesh', 'defender_mesh', { material: 'SubResource("defender_material")', top_radius: '0.45', bottom_radius: '0.45', height: '2.0', radial_segments: '12', rings: '1' });
subRes('CylinderMesh', 'attacker_mesh', { material: 'SubResource("attacker_material")', top_radius: '0.45', bottom_radius: '0.45', height: '2.0', radial_segments: '12', rings: '1' });

node('name="City" type="Node3D"', { script: 'ExtResource("1_city")' });
node('name="WorldEnvironment" type="WorldEnvironment" parent="."', { environment: 'SubResource("environment")' });
// низкое тёплое солнце с запада — длинные тени через улицы
node('name="Sun" type="DirectionalLight3D" parent="."', {
  transform: lookBasis([0.86, -0.4, -0.32], [0, 60, 0]),
  light_color: color([1, 0.8, 0.6]),
  light_energy: '1.5',
  shadow_enabled: 'true',
  directional_shadow_max_distance: '220.0',
});
node('name="Map" parent="." instance=ExtResource("2_map")');

node('name="Mode" type="Node3D" parent="."');
const { x: cx, z: cz } = MODE.capture;
// бойцы (игрок и боты) — на слое столкновений 2
node('name="CapturePoint" type="Area3D" parent="Mode"', { transform: transform([cx, SIDEWALK, cz]), collision_layer: '0', collision_mask: '2' });
node('name="Shape" type="CollisionShape3D" parent="Mode/CapturePoint"', { transform: transform([0, 4, 0]), shape: 'SubResource("capture_shape")' });
node('name="DefenderSpawns" type="Node3D" parent="Mode"');
MODE.defenders.forEach(([x, z], i) => node(`name="Spawn${i + 1}" type="Marker3D" parent="Mode/DefenderSpawns"`, { transform: transform([x, SIDEWALK, z], 180) }));
node('name="AttackerSpawns" type="Node3D" parent="Mode"');
const groundAt = (x, z) => (Math.abs(x) < 7 || Math.abs(z) < 5 || Math.abs(Math.abs(x) - 27) < 3 ? 0 : SIDEWALK);
const sides = { north: 'North', east: 'East', south: 'South', west: 'West' };
for (const [key, title] of Object.entries(sides)) {
  node(`name="${title}" type="Node3D" parent="Mode/AttackerSpawns"`);
  MODE.attackers[key].forEach(([x, z], i) => node(`name="Spawn${i + 1}" type="Marker3D" parent="Mode/AttackerSpawns/${title}"`, { transform: transform([x, groundAt(x, z), z], yawTo([x, z], [cx, cz])) }));
}
// союзники за баррикадами на въездах на площадь (смотрят вдоль улиц; третий — с пулемётом)
node('name="AllyPosts" type="Node3D" parent="Mode"');
const ALLY_POSTS = [
  [[4.2, 0, 25.9], 180],
  [[-4.2, 0, 24.9], 180],
  [[29.9, SIDEWALK, 0.3], -90],
  [[-30.6, 0, 1.8], 90],
  [[-22.6, SIDEWALK, -22.2], 0],
  [[22.6, SIDEWALK, -22.2], 0],
];
ALLY_POSTS.forEach(([p, yaw], i) => node(`name="Post${i + 1}" type="Marker3D" parent="Mode/AllyPosts"`, { transform: transform(p, yaw) }));
// кольцо позиций на самой точке: за дугами мешков с песком вокруг памятника
// (дуги — по диагоналям, r = 8), лицом наружу
node('name="DefensePosts" type="Node3D" parent="Mode"');
[26, 64, 116, 154, 206, 244, 296, 334].forEach((deg, i) => {
  const a = (deg * Math.PI) / 180;
  const p = [cx + Math.cos(a) * 6.7, cz + Math.sin(a) * 6.7];
  node(`name="Post${i + 1}" type="Marker3D" parent="Mode/DefensePosts"`, { transform: transform([p[0], SIDEWALK, p[1]], yawTo([cx, cz], p)) });
});
// видимые отметки (M — показать/скрыть)
node('name="Debug" type="Node3D" parent="Mode"');
node('name="CaptureZone" type="MeshInstance3D" parent="Mode/Debug"', { transform: transform([cx, SIDEWALK + 0.05, cz]), cast_shadow: '0', mesh: 'SubResource("zone_mesh")' });
MODE.defenders.forEach(([x, z], i) => node(`name="Defender${i + 1}" type="MeshInstance3D" parent="Mode/Debug"`, { transform: transform([x, SIDEWALK + 1, z]), cast_shadow: '0', mesh: 'SubResource("defender_mesh")' }));
let k = 0;
for (const list of Object.values(MODE.attackers)) {
  for (const [x, z] of list) node(`name="Attacker${++k}" type="MeshInstance3D" parent="Mode/Debug"`, { transform: transform([x, groundAt(x, z) + 1, z]), cast_shadow: '0', mesh: 'SubResource("attacker_mesh")' });
}

node('name="Spectator" type="CharacterBody3D" parent="."', { transform: transform([0, 14, 54], 0), script: 'ExtResource("3_spectator")', respawn: `Vector3(0, ${f(SIDEWALK + 0.5)}, -52)` });
node('name="Shape" type="CollisionShape3D" parent="Spectator"', { transform: transform([0, 0.9, 0]), shape: 'SubResource("body_shape")' });
node('name="Camera" type="Camera3D" parent="Spectator"', { transform: transform([0, 1.65, 0], 0, -14), current: 'true', fov: '70.0', far: '2000.0' });

const text = `[gd_scene load_steps=${ext.length + sub.length + 1} format=3]\n\n${ext.join('\n')}\n\n${sub.join('\n\n')}\n\n${nodes.join('\n\n')}\n`;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
writeFileSync(path.join(root, 'godot', 'scenes', 'city.tscn'), text);
console.log(text.split('\n').length, 'lines');
