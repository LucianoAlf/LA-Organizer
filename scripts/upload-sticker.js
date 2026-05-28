#!/usr/bin/env node
// Upload manual de um sticker .webp pro bucket tom-stickers e insert na tabela tom_stickers.
//
// Uso:
//   node scripts/upload-sticker.js <caminho.webp> <name_slug> "<when_to_use>"
//
// Ex:
//   node scripts/upload-sticker.js D:/la-organizer/Figurinhas/tom-dancando.webp tom_dancando "Celebração — quando alguém entrega tarefa, conclui projeto ou atinge meta."

const path = require('path');
const fs   = require('fs');
const root = path.join(__dirname, '..');
process.chdir(root);

// Carrega .env
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
  process.exit(1);
}

const [, , filePath, nameSlug, whenToUse] = process.argv;
if (!filePath || !nameSlug || !whenToUse) {
  console.error('Uso: node scripts/upload-sticker.js <arquivo.webp> <name_slug> "<when_to_use>"');
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`❌ Arquivo não encontrado: ${filePath}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

(async () => {
  try {
    const buffer = fs.readFileSync(filePath);
    const objectKey = `${nameSlug}.webp`;

    console.log(`📤 Subindo ${path.basename(filePath)} (${buffer.length} bytes) → tom-stickers/${objectKey}`);
    const { error: upErr } = await supabase.storage
      .from('tom-stickers')
      .upload(objectKey, buffer, {
        contentType: 'image/webp',
        upsert: true,
      });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from('tom-stickers').getPublicUrl(objectKey);
    const url = pub.publicUrl;
    console.log(`🌐 URL pública: ${url}`);

    const { error: dbErr } = await supabase
      .from('tom_stickers')
      .upsert({ name: nameSlug, url, when_to_use: whenToUse, is_active: true }, { onConflict: 'name' });
    if (dbErr) throw dbErr;

    console.log(`✅ Sticker '${nameSlug}' registrado.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Falhou:', err.message || err);
    process.exit(1);
  }
})();
