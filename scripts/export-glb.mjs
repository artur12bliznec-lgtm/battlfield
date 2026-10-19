// Выгружает все модели из каталога в godot/assets/models/*.glb (карты — в
// godot/assets/maps/) и проверяет, что каждый файл читается обратно.
// Запуск: npm run export [id ...]
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/*
 * GLTFExporter написан для браузера: читает Blob через FileReader и кодирует
 * текстуры через canvas. В Node подставляем минимальные замены, а PNG
 * собираем сами (камуфляж из 4–5 цветов — палитровый PNG весит пару КБ).
 */
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

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Непрозрачная RGBA-картинка → PNG (палитровый, если цветов не больше 256). */
function encodePNG({ data, width, height }) {
  const palette = new Map();
  for (let i = 0; i < data.length && palette.size <= 256; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (!palette.has(key)) palette.set(key, palette.size);
  }
  const indexed = palette.size <= 256;
  const stride = indexed ? width : width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = y * (stride + 1) + 1;
      if (indexed) raw[o + x] = palette.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      else raw.set([data[i], data[i + 1], data[i + 2]], o + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, indexed ? 3 : 2, 0, 0, 0], 8);
  const chunks = [pngChunk('IHDR', header)];
  if (indexed) chunks.push(pngChunk('PLTE', Buffer.from([...palette.keys()].flatMap((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]))));
  chunks.push(pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

globalThis.ImageData ??= class {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
};

globalThis.OffscreenCanvas ??= class {
  constructor(width, height) {
    Object.assign(this, { width, height, image: null });
  }

  getContext() {
    const canvas = this;
    return {
      translate() {},
      scale() {},
      putImageData(image) {
        canvas.image = image;
      },
      drawImage() {
        throw new Error('В Node можно выгружать только процедурные текстуры (DataTexture)');
      },
    };
  }

  async convertToBlob() {
    return new Blob([encodePNG(this.image)], { type: 'image/png' });
  }
};

const { Texture } = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { CATALOG } = await import('../src/models/index.js');
const { exportGLB } = await import('../src/models/export.js');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assets = path.join(root, 'godot', 'assets');

const only = process.argv.slice(2);
const rows = [];
for (const entry of CATALOG) {
  if (entry.kind === 'scene' || entry.dev || (only.length && !only.includes(entry.id))) continue;
  const data = await exportGLB(entry.create());
  const outDir = path.join(assets, entry.kind === 'map' ? 'maps' : 'models');
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${entry.id}.glb`);
  await writeFile(file, Buffer.from(data));

  // проверка: файл должен открываться загрузчиком glTF (картинки в Node не декодируем)
  const loader = new GLTFLoader().register(() => ({ name: 'skip_images', loadTexture: async () => new Texture() }));
  const gltf = await loader.parseAsync(data, '');
  let triangles = 0;
  let skins = 0;
  let colliders = 0;
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    if (node.name.endsWith('-colonly')) {
      colliders++;
      return;
    }
    const g = node.geometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (node.isSkinnedMesh) skins++;
  });
  rows.push({
    файл: `${entry.id}.glb`,
    'размер, КБ': Math.round(data.byteLength / 1024),
    треугольники: triangles,
    скелет: skins ? 'да' : '—',
    анимации: gltf.animations.length,
    коллизии: colliders || '—',
  });
}
console.table(rows);
console.log(`Готово: ${path.relative(root, assets)}/`);
