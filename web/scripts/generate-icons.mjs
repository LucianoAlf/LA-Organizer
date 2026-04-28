// Generates icon-192.png and icon-512.png from public/favicon.svg using sharp.
// Run: cd web && node scripts/generate-icons.mjs (sharp is a transient dep — install on demand)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const svg = readFileSync(resolve(root, 'public/favicon.svg'));

let sharp;
try { sharp = (await import('sharp')).default; } catch {
  console.error('Install sharp first: npm i -D sharp');
  process.exit(1);
}

for (const size of [192, 512]) {
  const out = resolve(root, `public/icon-${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log('wrote', out);
}
