import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The person cut-out ("Any background") runs MediaPipe's WebAssembly runtime in the browser. The runtime
 * (about 13 MB) comes from node_modules, so it is served in dev and copied into the build at /mediapipe/ rather
 * than committed. It is only fetched when someone turns the cut-out on. (The 250 KB model is in public/models/.)
 */
function mediapipeRuntime(): Plugin {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'node_modules/@mediapipe/tasks-vision/wasm');
  const files = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];
  return {
    name: 'mediapipe-runtime',
    configureServer(server) {
      server.middlewares.use('/mediapipe', (req, res, next) => {
        const file = path.basename((req.url ?? '').split('?')[0]);
        if (!files.includes(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(fs.readFileSync(path.join(dir, file)));
      });
    },
    generateBundle() {
      for (const file of files) this.emitFile({ type: 'asset', fileName: `mediapipe/${file}`, source: fs.readFileSync(path.join(dir, file)) });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mediapipeRuntime()],
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
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
