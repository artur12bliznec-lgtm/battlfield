// Выгружает все модели из каталога в assets/models/*.glb и проверяет,
// что каждый файл читается обратно. Запуск: npm run export
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// GLTFExporter написан для браузера и читает Blob через FileReader —
// в Node его нет, поэтому подставляем минимальную замену.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { CATALOG } = await import('../src/models/index.js');
const { exportGLB } = await import('../src/models/export.js');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'assets', 'models');
await mkdir(outDir, { recursive: true });

const only = process.argv.slice(2);
const rows = [];
for (const entry of CATALOG) {
  if (entry.kind === 'scene' || (only.length && !only.includes(entry.id))) continue;
  const data = await exportGLB(entry.create());
  const file = path.join(outDir, `${entry.id}.glb`);
  await writeFile(file, Buffer.from(data));

  // проверка: файл должен открываться загрузчиком glTF
  const gltf = await new GLTFLoader().parseAsync(data, '');
  let triangles = 0;
  let skins = 0;
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    const g = node.geometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (node.isSkinnedMesh) skins++;
  });
  rows.push({
    файл: `${entry.id}.glb`,
    'размер, КБ': Math.round(data.byteLength / 1024),
    треугольники: triangles,
    скелет: skins ? 'да' : '—',
    анимации: gltf.animations.map((clip) => clip.name).join(', ') || '—',
  });
}
console.table(rows);
console.log(`Готово: ${path.relative(root, outDir)}/`);
