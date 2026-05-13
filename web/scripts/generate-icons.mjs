/**
 * Gera icon-192.png, icon-512.png e og-image.png para o PWA.
 * Fonte: public/Avata-Tom.png (ET avatar)
 * Run: cd web && node scripts/generate-icons.mjs
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const AVATAR = resolve(root, 'public/Avata-Tom.png');
const PUBLIC = resolve(root, 'public');
const BG = { r: 15, g: 17, b: 23, alpha: 255 }; // #0F1117

let sharp;
try { sharp = (await import('sharp')).default; } catch {
  console.error('Install sharp first: npm i -D sharp');
  process.exit(1);
}

async function makeIcon(size) {
  const avatarSize = Math.round(size * 0.70);
  const fontSize   = Math.round(size * 0.105);
  const textY      = size - Math.round(size * 0.055);
  const avatarLeft = Math.round((size - avatarSize) / 2);
  const avatarTop  = Math.round(size * 0.04);

  const avatar = await sharp(AVATAR)
    .resize(avatarSize, avatarSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();

  const textSvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <text x="${size / 2}" y="${textY}"
        font-family="Arial,Helvetica,sans-serif" font-weight="700"
        font-size="${fontSize}" fill="white" text-anchor="middle"
        dominant-baseline="auto" letter-spacing="0.5">LA Organizer</text>
    </svg>`
  );

  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([
      { input: avatar,   top: avatarTop,  left: avatarLeft },
      { input: textSvg,  top: 0,          left: 0 },
    ])
    .png()
    .toFile(resolve(PUBLIC, `icon-${size}.png`));

  console.log(`✓ icon-${size}.png`);
}

async function makeOgImage() {
  const W = 1200, H = 630;
  const avatarSize = 400;
  const avatarLeft = Math.round((W - avatarSize) / 2);
  const avatarTop  = 60;

  const avatar = await sharp(AVATAR)
    .resize(avatarSize, avatarSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();

  const svgOverlay = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="510"
        font-family="Arial,Helvetica,sans-serif" font-weight="900"
        font-size="76" fill="white" text-anchor="middle">LA Organizer</text>
      <text x="${W / 2}" y="582"
        font-family="Arial,Helvetica,sans-serif" font-weight="400"
        font-size="34" fill="#9CA3AF" text-anchor="middle">Seu assistente operacional</text>
    </svg>`
  );

  await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
    .composite([
      { input: avatar,      top: avatarTop,  left: avatarLeft },
      { input: svgOverlay,  top: 0,          left: 0 },
    ])
    .png()
    .toFile(resolve(PUBLIC, 'og-image.png'));

  console.log('✓ og-image.png (1200x630)');
}

await makeIcon(192);
await makeIcon(512);
await makeOgImage();
console.log('\nÍcones gerados em public/');
