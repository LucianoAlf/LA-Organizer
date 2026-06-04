// scripts/smoke-uuid-hallucination.js
// Smoke END-TO-END: prova que um UUID ALUCINADO (head correto + tail lixo) resolve e
// PERSISTE nos ramos por-id do template de tarefa (complete/reschedule/delegate compartilham
// resolveTaskByShortId). Cria 1 tarefa de teste self-owned (created_by==assigned_to => sem
// nenhum WhatsApp, ver notifyTaskCreatorOfAction:3505) e apaga no fim.
//
// Rodar no VPS:  cd /opt/LA-Organizer && set -a && . ./.env && node scripts/smoke-uuid-hallucination.js

const { applyTaskActions, resolveTaskByShortId } = require('../src/engine');
const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(SUPA_URL, SUPA_KEY);

const LUCIANO = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';

// mantém os 8 primeiros hex (head estável) e inventa o resto — igual ao caso cadeira ADM
function hallucinate(realId) {
  const head = realId.replace(/-/g, '').slice(0, 8);
  return `${head}-f1f8-4b5e-9b1a-2c3d4e5f6a7b`;
}

async function main() {
  const results = [];
  let realId = null;
  try {
    const { data: collab, error: ce } = await supabase
      .from('collaborators').select('*').eq('id', LUCIANO).single();
    if (ce || !collab) throw new Error('collab Luciano não encontrado: ' + (ce && ce.message));

    const { data: task, error: te } = await supabase.from('tasks').insert({
      title: '[SMOKE] uuid-alucinado — apagar', assigned_to: LUCIANO, created_by: LUCIANO,
      context: 'work', status: 'pending', due_date: '2026-06-10',
    }).select().single();
    if (te || !task) throw new Error('insert task falhou: ' + (te && te.message));
    realId = task.id;
    const fakeId = hallucinate(realId);
    console.log(`real = ${realId}`);
    console.log(`fake = ${fakeId}   (head ${realId.slice(0,8)} OK, tail inventado)\n`);

    // 1) resolver direto com id alucinado
    const resolved = await resolveTaskByShortId(LUCIANO, fakeId);
    results.push(['resolveTaskByShortId(fake) acha a real', !!resolved && resolved.id === realId]);

    // 2) RESCHEDULE via applyTaskActions com id alucinado
    const r1 = await applyTaskActions(collab, [{ action: 'reschedule', id: fakeId, new_due_date: '2026-06-12' }]);
    const { data: afterR } = await supabase.from('tasks').select('due_date').eq('id', realId).single();
    results.push(['reschedule(fake) gravou due=12/06', r1.okCount === 1 && afterR.due_date === '2026-06-12']);

    // 3) COMPLETE via applyTaskActions com id alucinado
    const r2 = await applyTaskActions(collab, [{ action: 'complete', id: fakeId }]);
    const { data: afterC } = await supabase.from('tasks').select('status').eq('id', realId).single();
    results.push(['complete(fake) marcou done', r2.okCount === 1 && afterC.status === 'done']);
  } catch (e) {
    console.error('ERRO no smoke:', e.message);
    results.push(['execução sem exceção', false]);
  } finally {
    if (realId) {
      await supabase.from('tasks').delete().eq('id', realId);
      const { data: gone } = await supabase.from('tasks').select('id').eq('id', realId);
      results.push(['cleanup: tarefa de teste apagada', !gone || gone.length === 0]);
    }
  }

  console.log('\n=== RESULTADOS ===');
  let allPass = true;
  for (const [name, ok] of results) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) allPass = false; }
  console.log(allPass ? '\n🟢 SMOKE PASS' : '\n🔴 SMOKE FAIL');
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
