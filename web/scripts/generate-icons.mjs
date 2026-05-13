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

const WHITE = { r: 255, g: 255, b: 255, alpha: 255 };
const DARK  = { r: 15,  g: 17,  b: 23,  alpha: 255 };

let sharp;
try { sharp = (await import('sharp')).default; } catch {
  console.error('Install sharp first: npm i -D sharp');
  process.exit(1);
}

// Ícone do app: fundo branco, ET centralizado com padding, sem texto
async function makeIcon(size) {
  const pad        = Math.round(size * 0.10);
  const avatarSize = size - pad * 2;

  const avatar = await sharp(AVATAR)
    .resize(avatarSize, avatarSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png().toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: avatar, top: pad, left: pad }])
    .png()
    .toFile(resolve(PUBLIC, `icon-${size}.png`));

  console.log(`✓ icon-${size}.png`);
}

// OG image para WhatsApp: fundo escuro, ET + título + subtítulo
async function makeOgImage() {
  const W = 1200, H = 630;
  const avatarSize = 400;
  const avatarLeft = Math.round((W - avatarSize) / 2);
  const avatarTop  = 50;

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

  await sharp({ create: { width: W, height: H, channels: 4, background: DARK } })
    .composite([
      { input: avatar,     top: avatarTop, left: avatarLeft },
      { input: svgOverlay, top: 0,         left: 0 },
    ])
    .png()
    .toFile(resolve(PUBLIC, 'og-image.png'));

  console.log('✓ og-image.png (1200x630)');
}

await makeIcon(192);
await makeIcon(512);
await makeOgImage();
console.log('\nIcones gerados em public/');
