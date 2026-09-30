import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The Nest app's ServeStaticModule serves this directory alongside
    // dist/ -- see app.module.ts's second ServeStaticModule.forRoot().
    outDir: '../dist-web',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Dev-only: the built app is same-origin in production (Nest serves
      // dist-web/ directly), so this proxy exists purely so `npm run dev`
      // doesn't need CORS/cookie cross-origin handling during development.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
