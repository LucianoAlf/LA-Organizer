#!/usr/bin/env node
// Backfill embeddings para memórias existentes sem embedding
// Uso: node scripts/backfill-embeddings.js
// Requer: OPENAI_API_KEY e SUPABASE_URL + SUPABASE_SERVICE_KEY no .env

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getEmbedding } = require('../src/services/embeddings');
const supabase = require('../src/supabase/client');

async function main() {
  const { data: memories, error } = await supabase
    .from('collaborator_memory')
    .select('id, content, memory_type')
    .eq('is_active', true)
    .is('embedding', null)
    .limit(200);

  if (error) { console.error('Query error:', error.message); process.exit(1); }
  console.log(`Found ${memories.length} memories without embedding`);

  let ok = 0, fail = 0;
  for (const mem of memories) {
    try {
      const embedding = await getEmbedding(mem.content);
      const { error: updErr } = await supabase
        .from('collaborator_memory')
        .update({ embedding })
        .eq('id', mem.id);
      if (updErr) throw new Error(updErr.message);
      ok++;
      if (ok % 10 === 0) console.log(`  ${ok}/${memories.length} done...`);
    } catch (e) {
      console.error(`  FAIL id=${mem.id.slice(0,8)}: ${e.message}`);
      fail++;
    }
    // Rate limit: 50ms entre requests
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(`Done: ${ok} ok, ${fail} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
