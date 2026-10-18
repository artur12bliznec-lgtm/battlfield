import { defineConfig } from 'vite';

// base: './' — относительные пути, чтобы собранный просмотрщик открывался
// из любой папки (GitHub Pages, локальный файл-сервер и т.п.).
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
