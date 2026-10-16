import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = `http://localhost:${process.env.PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { '/ws': { target: SERVER, ws: true } },
  },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { main: 'index.html', dev: 'dev.html' } },
  },
});
