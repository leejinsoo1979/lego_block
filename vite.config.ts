import { defineConfig } from 'vite';

export default defineConfig({
  // Treat these binary formats as static assets. Without this, Vite
  // tries to parse `.glb` / `.hdr` / audio files as JS modules and the
  // dev server returns the raw file with the wrong MIME type — which
  // the browser then rejects ("Failed to load module script: Expected
  // a JavaScript-or-Wasm module script but got model/gltf-binary").
  assetsInclude: [
    '**/*.glb',
    '**/*.gltf',
    '**/*.hdr',
    '**/*.exr',
    '**/*.fbx',
    '**/*.obj',
    '**/*.mp3',
    '**/*.wav',
    '**/*.ogg',
  ],
  server: {
    port: 5173,
    strictPort: false,
  },
});
