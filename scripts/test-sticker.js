#!/usr/bin/env node
// Manda um sticker do catálogo tom_stickers pra um número WhatsApp.
//
// Uso:
//   node scripts/test-sticker.js <phone> <sticker_name> ["<texto opcional antes do sticker>"]
//
// Ex:
//   node scripts/test-sticker.js 5521966950296 tom_dancando

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

const { createClient } = require('@supabase/supabase-js');
const w = require(path.join(root, 'src/services/whatsapp'));

const [, , phone, stickerName, optText] = process.argv;
if (!phone || !stickerName) {
  console.error('Uso: node scripts/test-sticker.js <phone> <sticker_name> ["<texto antes>"]');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

(async () => {
  try {
    const { data: row, error } = await supabase
      .from('tom_stickers')
      .select('url')
      .eq('name', stickerName)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error(`Sticker '${stickerName}' não encontrado ou inativo`);
    if (optText) await w.sendMessage(phone, optText);
    await w.sendMedia(phone, { url: row.url, type: 'sticker' });
    console.log(`✅ Sticker '${stickerName}' enviado pra ${phone.slice(-4)}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Falhou:', err.message);
    process.exit(1);
  }
})();
