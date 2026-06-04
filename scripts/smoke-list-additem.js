// scripts/smoke-list-additem.js
// Smoke END-TO-END do item 3+4 (Mercado/Luciano 03/06): o LLM emitiu `text`, `items[]` e
// `add_items` → 4/4 rejeitados por nome/formato → o TOM confabulou. Prova que agora os 3
// formatos PERSISTEM via applyPersonalListActions. Cria lista de teste e apaga no fim.
//
// Rodar no VPS:  cd /opt/LA-Organizer && set -a && . ./.env && node scripts/smoke-list-additem.js

const { applyPersonalListActions } = require('../src/engine');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
const LUCIANO = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';

async function items(listId) {
  const { data } = await supabase.from('personal_checklist_items')
    .select('description').eq('list_id', listId).order('sort_order');
  return (data || []).map(r => r.description);
}

async function main() {
  const results = [];
  let listId = null;
  try {
    const { data: collab } = await supabase.from('collaborators').select('*').eq('id', LUCIANO).single();
    const { data: list, error } = await supabase.from('personal_checklists')
      .insert({ owner_collab_id: LUCIANO, name: '[SMOKE] lista add — apagar', list_type: 'shopping', context: 'personal' })
      .select('id').single();
    if (error || !list) throw new Error('insert list falhou: ' + (error && error.message));
    listId = list.id;
    const short = listId.slice(0, 8);
    console.log(`list = ${listId} (short ${short})\n`);

    // Os 3 formatos EXATOS que o LLM emitiu e que falhavam:
    const r = await applyPersonalListActions(collab, [
      { action: 'add_item', list_id: short, text: 'Refrigerante' },       // `text` + list_id PREFIXO
      { action: 'add_item', list_id: listId, items: ['Suco', 'Bolo'] },   // `items[]` (múltiplos)
      { action: 'add_items', list_id: listId, items: ['Carne'] },         // `add_items` alias
    ]);
    const got = await items(listId);
    results.push(['add_item text="Refrigerante" (prefixo)', got.includes('Refrigerante')]);
    results.push(['add_item items=[Suco,Bolo]', got.includes('Suco') && got.includes('Bolo')]);
    results.push(['add_items items=[Carne]', got.includes('Carne')]);
    results.push(['4 itens persistidos, 0 fail', got.length === 4 && r.okCount === 3 && r.failCount === 0]);
    console.log('itens na lista:', JSON.stringify(got));
  } catch (e) {
    console.error('ERRO:', e.message);
    results.push(['execução sem exceção', false]);
  } finally {
    if (listId) {
      await supabase.from('personal_checklist_items').delete().eq('list_id', listId);
      await supabase.from('personal_checklists').delete().eq('id', listId);
      const { data: gone } = await supabase.from('personal_checklists').select('id').eq('id', listId);
      results.push(['cleanup: lista de teste apagada', !gone || gone.length === 0]);
    }
  }
  console.log('\n=== RESULTADOS ===');
  let allPass = true;
  for (const [n, ok] of results) { console.log(`${ok ? '✅' : '❌'} ${n}`); if (!ok) allPass = false; }
  console.log(allPass ? '\n🟢 SMOKE PASS' : '\n🔴 SMOKE FAIL');
  process.exit(allPass ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(2); });
