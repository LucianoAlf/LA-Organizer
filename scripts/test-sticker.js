#!/usr/bin/env node
// Teste: manda o sticker tom_dancando pro Alf.
const path = require('path');
const fs   = require('fs');
const root = path.join(__dirname, '..');
process.chdir(root);

const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const w = require(path.join(root, 'src/services/whatsapp'));

(async () => {
  try {
    const url = 'https://cesnbnrynvxvgdhfmaua.supabase.co/storage/v1/object/public/tom-stickers/tom_dancando.webp';
    await w.sendMessage('5521981278047', 'Testando figurinha 🧪 — se aparecer o alien dançando logo abaixo, deu certo!');
    await w.sendMedia('5521981278047', { url, type: 'sticker' });
    console.log('✅ Sticker enviado pro Alf');
    process.exit(0);
  } catch (err) {
    console.error('❌ Falhou:', err.message);
    process.exit(1);
  }
})();
