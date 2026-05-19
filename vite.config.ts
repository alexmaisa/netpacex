import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'static',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
