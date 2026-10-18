import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/**
 * Экспорт модели в бинарный glTF (.glb) — формат, который понимают
 * Unity (через glTFast), Unreal, Godot, Blender и веб-движки.
 * Анимации (если есть) берутся из root.animations.
 */
export function exportGLB(root) {
  return new GLTFExporter().parseAsync(root, {
    binary: true,
    animations: root.animations ?? [],
    onlyVisible: true,
  });
}
