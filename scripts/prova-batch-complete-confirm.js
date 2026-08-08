#!/usr/bin/env node
// scripts/prova-batch-complete-confirm.js
// Prova ponta a ponta do fix CONFIRM-ELONGATION-BLIND / CONFIRM-QUANTIFIER-BLIND.
//
//   N=2 node --env-file=.env scripts/prova-batch-complete-confirm.js
//
// O CASO (Vitoria 27/07 16:50, medido no banco)
// O TOM pergunta "Confirma o fechamento destas 9 tarefas?" e o guard A2 deixa aberta uma
// intent `confirmation` com payload.batch_complete[9]. Ela responde "Siim".
// detectUserConfirmation devolvia null (YES_RE exige "sim" exato) -> o executor
// determinístico executeBatchComplete não disparava -> o turno seguia até o LLM -> o LLM
// re-emitia os completes -> o A2 re-perguntava e superseded a intent 92ms depois -> LOOP.
// As 9 tarefas seguiram `pending` por 12 dias.
//
// ANTI-VACUIDADE: não basta a tarefa ficar `done` — o LLM também sabe concluir e isso
// mascararia o fix. A prova exige que a intent seja resolvida com a nota
// `batch complete (engine)`, string que SÓ o bloco determinístico do engine escreve.
// Sem essa marca o cenário reprova, mesmo com tudo concluído.
//
// SEGURANÇA — nada disso encosta em dado real:
// - Remetente é o perfil descartável de QA (faixa 5500…), nunca uma pessoa.
// - Tarefas próprias, criadas e apagadas por este script (título com prefixo [QA]).
// - Tudo dentro de `runInTurn({ qa: true })`: a trava suprime qualquer envio.
// - Limpeza no finally, fail-closed: sem remetente QA identificado, não apaga nada.

const supabase = require('../src/supabase/client');
const turnClaim = require('../src/services/turn-claim');
const engine = require('../src/engine');
const pendingIntents = require('../src/services/pending-intents');

const N = Number(process.env.N || 2);
const QA_PHONE = (process.env.TOM_QA_PHONES || '5500000000001').split(',')[0].trim();
const RUN = `qa-batchconf-${Date.now()}`;

// As duas falas reais que o fix destrava, uma por repetição.
const FALAS = ['Siim', 'Todas feitas'];

async function senderQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name, phone').eq('phone', QA_PHONE).maybeSingle();
  if (!data) throw new Error(`perfil QA ${QA_PHONE} não existe`);
  if (!/^5500\d{9}$/.test(String(data.phone || '').replace(/\D/g, ''))) throw new Error('remetente fora da faixa de QA');
  return data;
}

async function montar(sender, rep) {
  const titulos = ['Mensagem enviada', 'Cliente respondeu', 'Visita agendada'];
  const { data: tarefas, error } = await supabase.from('tasks').insert(
    titulos.map((t) => ({ title: `[QA] ${t} ${RUN}-${rep}`, assigned_to: sender.id, created_by: sender.id, status: 'pending' })),
  ).select('id, title');
  if (error) throw new Error(`tarefas: ${error.message}`);
  // Espelha o A2: short-id de 8 chars, exatamente como applyTaskActions grava.
  const ids = tarefas.map((t) => String(t.id).slice(0, 8));
  const intentId = await pendingIntents.openIntent(sender.id, 'confirmation',
    { batch_complete: ids }, `Confirmar fechamento em lote: ${titulos.join(', ')}?`);
  if (!intentId) throw new Error('openIntent devolveu null');
  return { tarefas, intentId };
}

async function limpar(sender, fx) {
  if (!sender || !/^5500/.test(String(sender.phone || '').replace(/\D/g, ''))) return; // fail-closed
  if (fx && fx.tarefas) await supabase.from('tasks').delete().in('id', fx.tarefas.map((t) => t.id));
  await supabase.from('pending_intents').delete().eq('collaborator_id', sender.id);
  await supabase.from('conversation_history').delete().eq('collaborator_id', sender.id);
}

(async () => {
  const sender = await senderQA();
  console.log('=== PROVA: confirmação de fechamento em lote (fluxo real, perfil descartável) ===');
  console.log(`remetente: ${sender.full_name} (${sender.phone}) · N=${N}\n`);

  let reprovou = false;
  for (let rep = 1; rep <= N; rep++) {
    const fala = FALAS[(rep - 1) % FALAS.length];
    let fx = null;
    try {
      fx = await montar(sender, rep);
      await turnClaim.runInTurn({ waMessageId: `${RUN}-${rep}`, qa: true, runId: RUN }, async () => {
        await engine.processMessage(sender.phone, fala, {});
      });

      const { data: depois } = await supabase.from('tasks')
        .select('id, status').in('id', fx.tarefas.map((t) => t.id));
      const feitas = (depois || []).filter((t) => t.status === 'done').length;
      const { data: intent } = await supabase.from('pending_intents')
        .select('resolution, resolution_note').eq('id', fx.intentId).maybeSingle();

      const nota = (intent && intent.resolution_note) || '';
      const todasFeitas = feitas === fx.tarefas.length;
      // Anti-vacuidade: só o bloco determinístico escreve esta nota.
      const foiOExecutor = /^batch complete \(engine\)/.test(nota);

      if (!todasFeitas || !foiOExecutor) reprovou = true;
      console.log(`  rep ${rep}/${N} "${fala}": concluídas=${feitas}/${fx.tarefas.length} ${todasFeitas ? 'OK' : 'FALHOU'} · executor determinístico=${foiOExecutor ? 'OK' : 'NÃO RODOU'}`);
      console.log(`      intent: ${intent ? `${intent.resolution} — ${nota}` : '(sumiu)'}`);
    } catch (e) {
      reprovou = true;
      console.log(`  rep ${rep}/${N} "${fala}": ERRO ${e.message}`);
    } finally {
      try { await limpar(sender, fx); } catch (e) { console.log(`      (limpeza falhou: ${e.message})`); }
      turnClaim.limparEvidenciasQA && turnClaim.limparEvidenciasQA();
    }
  }

  const { count } = await supabase.from('tasks')
    .select('id', { count: 'exact', head: true }).eq('assigned_to', sender.id).like('title', '[QA]%');
  console.log(`\n  resíduo: ${count || 0} tarefa(s) [QA]`);
  if (count) reprovou = true;
  console.log(reprovou ? '\n=== REPROVADO ===' : '\n=== APROVADO (o engine fechou o lote sem passar pelo LLM) ===');
  process.exit(reprovou ? 1 : 0);
})().catch((e) => { console.error('erro fatal:', e); process.exit(1); });
