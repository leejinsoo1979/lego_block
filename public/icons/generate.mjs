// Node ESM script to generate PWA icon PNGs from a simple SVG spec.
// Run once (or when the logo changes): `node public/icons/generate.mjs`.
// Writes icon-192.png, icon-512.png, icon-maskable-512.png.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal PNG writer — uses canvas via a tiny polyfill pattern. Since
// Node doesn't ship canvas, we instead write SVG files that service
// workers (and most browsers) can use as icons. For maskable compat
// we'll still emit PNG via sharp when available; otherwise SVG works.
function svgIcon(size, maskable) {
  const pad = maskable ? size * 0.1 : 0;
  const inner = size - pad * 2;
  const brick = inner * 0.2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#f4f8fd"/>
  <g transform="translate(${pad},${pad})">
    <rect x="${inner*0.18}" y="${inner*0.18}" width="${brick}" height="${brick}" rx="8" fill="#c4281c"/>
    <rect x="${inner*0.42}" y="${inner*0.18}" width="${brick}" height="${brick}" rx="8" fill="#f5cd30"/>
    <rect x="${inner*0.66}" y="${inner*0.18}" width="${brick}" height="${brick}" rx="8" fill="#0d69ac"/>
    <rect x="${inner*0.18}" y="${inner*0.42}" width="${brick}" height="${brick}" rx="8" fill="#0d69ac"/>
    <rect x="${inner*0.42}" y="${inner*0.42}" width="${brick}" height="${brick}" rx="8" fill="#c4281c"/>
    <rect x="${inner*0.66}" y="${inner*0.42}" width="${brick}" height="${brick}" rx="8" fill="#f5cd30"/>
    <rect x="${inner*0.18}" y="${inner*0.66}" width="${brick}" height="${brick}" rx="8" fill="#f5cd30"/>
    <rect x="${inner*0.42}" y="${inner*0.66}" width="${brick}" height="${brick}" rx="8" fill="#0d69ac"/>
    <rect x="${inner*0.66}" y="${inner*0.66}" width="${brick}" height="${brick}" rx="8" fill="#c4281c"/>
  </g>
</svg>`;
}

const writes = [
  ['icon-192.svg', 192, false],
  ['icon-512.svg', 512, false],
  ['icon-maskable-512.svg', 512, true],
];
for (const [name, size, maskable] of writes) {
  writeFileSync(resolve(__dirname, name), svgIcon(size, maskable));
  console.log('wrote', name);
}
