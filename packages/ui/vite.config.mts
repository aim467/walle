import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// UI 构建产物输出到 packages/cli/ui/dist —— walle serve 从磁盘静态加载（walle 无 Node 运行时依赖）
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: '../cli/ui/dist',
    emptyOutDir: true,
  },
  server: {
    // 开发模式：vite dev 代理到 walle serve 的 API
    proxy: { '/api': 'http://127.0.0.1:4173' },
  },
});
