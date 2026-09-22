/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/new/',
  build: { outDir: '../client/next', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' }, fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: { modules: { classNameStrategy: 'non-scoped' } }
  }
});
