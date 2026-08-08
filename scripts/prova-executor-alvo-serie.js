#!/usr/bin/env node
// scripts/prova-executor-alvo-serie.js — prova DETERMINÍSTICA do executor de alvo (Fatia A).
//
//   node --env-file=.env scripts/prova-executor-alvo-serie.js
//
// POR QUE ESTE SCRIPT EXISTE
// O cenário B do Replay Lab não consegue provar esta peça. Ele conversa com o LLM, e fora da
// janela do prompt o LLM quase sempre responde "tem 3 com esse nome, qual delas?" — resposta
// correta, mas que impede o executor de rodar (0 a 33% de ação por bateria). Provar uma peça
// determinística através de um componente não-determinístico não dá N/N nunca.
//
// Aqui o LLM sai do caminho: monta-se a fixture, chama-se `applyTaskActions` direto com o
// marker SEM `id` (que é a condição em que o title-lookup roda) e confere-se QUAL tarefa foi
// afetada. Os dois modos rodam no MESMO processo e sobre a MESMA fixture, porque a flag é lida
// em tempo de execução — o que elimina "foi outra coisa que mudou entre as rodadas".
//
// SEGURANÇA
// - Só o perfil descartável de QA (faixa 5500…), fail-closed: fora dela, recusa rodar.
// - Tudo dentro de `runInTurn({ qa: true })`: se algum ramo tentar falar com alguém, a trava
//   suprime. Chamar o executor direto, fora de turno, mandaria mensagem real.
// - Não altera nada fora da fixture que ele mesmo cria, e limpa ao fim de cada caso.

const supabase = require('../src/supabase/client');
const turnClaim = require('../src/services/turn-claim');
const engine = require('../src/engine');

const QA_PHONE = (process.env.TOM_QA_PHONES || '5500000000001').split(',')[0].trim();
const RUN = `prova-alvo-${Date.now()}`;
const DIA = 86400000;
const _fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const ymd = (d) => _fmtYmd.format(d);
const AGORA = new Date();

// A corrente fica ATRASADA de propósito. O cenário do Replay Lab precisava da série fora da
// janela do prompt para forçar o title-lookup; aqui o LLM não está no caminho, então essa
// restrição não vale — e ela ATRAPALHA: com tudo no futuro o `complete` é barrado pelo guard
// isFutureCompletion (não se conclui tarefa que ainda não venceu) e o caso morre antes do
// executor, dando um vermelho que não é do alvo.
const OFFSETS = [-5, -2, 1, 4, 7, 10, 13, 16, 19, 22, 25, 40];
const ASSUNTO = 'conferir presenca no emusys prova';

async function colaboradorQA() {
  const { data } = await supabase.from('collaborators').select('*').eq('phone', QA_PHONE).maybeSingle();
  if (!data) throw new Error(`perfil QA ${QA_PHONE} não existe`);
  if (!/^5500\d{9}$/.test(String(data.phone || '').replace(/\D/g, ''))) {
    throw new Error(`recusando rodar: ${data.phone} não é da faixa reservada de QA`);
  }
  return data;
}

async function limpar(collab) {
  if (!/^5500\d{9}$/.test(String(collab.phone || '').replace(/\D/g, ''))) throw new Error('fail-closed: fora da faixa QA');
  const { data: minhas } = await supabase.from('tasks').select('id').eq('assigned_to', collab.id);
  for (const t of (minhas || [])) await supabase.from('notifications').delete().eq('reference_id', t.id);
  await supabase.from('tasks').delete().eq('assigned_to', collab.id).not('recurrence_parent_id', 'is', null);
  await supabase.from('tasks').delete().eq('assigned_to', collab.id);
}

async function montar(collab) {
  await limpar(collab);
  const { data: molde, error: eM } = await supabase.from('tasks').insert({
    title: `[${RUN}] molde tecnico`, assigned_to: collab.id, created_by: collab.id,
    status: 'pending', due_date: ymd(new Date(AGORA.getTime() + 90 * DIA)), recurrence_rule: 'FREQ=WEEKLY',
  }).select('id').maybeSingle();
  if (eM) throw new Error(`molde: ${eM.message}`);

  // created_at cresce junto com o prazo: a última criada é a MAIS DISTANTE. É o que separa
  // o legado (created_at desc) do executor novo (menor due_date).
  const base = AGORA.getTime() - 7200_000;
  const { data: insts, error: eI } = await supabase.from('tasks').insert(OFFSETS.map((off, i) => ({
    title: `[${RUN}] ${ASSUNTO}`, assigned_to: collab.id, created_by: collab.id, status: 'pending',
    due_date: ymd(new Date(AGORA.getTime() + off * DIA)),
    recurrence_parent_id: molde.id,
    created_at: new Date(base + i * 1000).toISOString(),
  }))).select('id, due_date, created_at');
  if (eI) throw new Error(`instâncias: ${eI.message}`);

  const corrente = insts.slice().sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
  const legado = insts.slice().sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))[0];
  if (corrente.id === legado.id) throw new Error('fixture degenerada: sem poder de discriminação');
  return { insts, corrente, legado };
}

// Devolve as tarefas que SAÍRAM de pending (o complete/cancel) ou mudaram de prazo (reschedule).
async function afetadas(fx) {
  const { data } = await supabase.from('tasks').select('id, status, due_date').in('id', fx.insts.map((t) => t.id));
  const antes = Object.fromEntries(fx.insts.map((t) => [t.id, t.due_date]));
  return (data || []).filter((t) => t.status !== 'pending' || t.due_date !== antes[t.id]);
}

async function umCaso(collab, acao, ligada) {
  const fx = await montar(collab);
  process.env.TOM_TASK_TARGET_SERIES = ligada ? '1' : '0';
  const marker = { action: acao, title: ASSUNTO };
  // O engine exige `new_due_date` no reschedule (não `due_date`): com o nome errado o alvo
  // é resolvido certo e a ação é REJEITADA logo depois — verde no lookup, nada no banco.
  if (acao === 'reschedule') marker.new_due_date = ymd(new Date(AGORA.getTime() + 2 * DIA));

  await turnClaim.runInTurn({ waMessageId: `${RUN}-${acao}-${ligada}`, qa: true, runId: RUN }, async () => {
    await engine.applyTaskActions(collab, [marker]);
  });

  const mex = await afetadas(fx);
  const alvo = mex.length === 1 ? mex[0].id : null;
  const veredito = !alvo ? (mex.length ? `MEXEU EM ${mex.length}` : 'NAO MEXEU')
    : alvo === fx.corrente.id ? 'CORRENTE'
      : alvo === fx.legado.id ? 'LEGADO(a mais distante)' : 'OUTRA';
  const dueAlvo = alvo ? (fx.insts.find((t) => t.id === alvo) || {}).due_date : '—';
  await limpar(collab);
  return { veredito, dueAlvo, n: mex.length };
}

(async () => {
  const collab = await colaboradorQA();
  console.log(`=== PROVA DETERMINÍSTICA DO EXECUTOR DE ALVO (sem LLM) ===`);
  console.log(`perfil QA: ${collab.full_name} (${collab.phone}) · série de ${OFFSETS.length}`);
  console.log(`corrente = menor due_date (hoje${OFFSETS[0]}) · legado = maior created_at (hoje+${OFFSETS[OFFSETS.length - 1]})\n`);

  let reprovou = false;
  for (const acao of ['complete', 'cancel', 'reschedule']) {
    for (const ligada of [false, true]) {
      let r;
      try { r = await umCaso(collab, acao, ligada); }
      catch (e) { console.log(`  ${acao} flag=${ligada ? 'ON ' : 'OFF'} → ERRO: ${e.message}`); reprovou = true; continue; }
      // Esperado com a flag DESLIGADA depende do handler, e isto foi MEDIDO, não suposto:
      // no `complete` o legado escolhe a instância mais distante (futura) e o guard
      // isFutureCompletion a barra — resultado, o TOM não conclui NADA e devolve uma recusa
      // confusa a quem pediu para fechar a atrasada. Não é "marcou a errada como feita", que
      // é como eu havia descrito. Em cancel/reschedule não há guard de data e o legado
      // realmente age na instância errada.
      const esperado = ligada ? 'CORRENTE' : (acao === 'complete' ? 'NAO MEXEU' : 'LEGADO(a mais distante)');
      const ok = r.veredito === esperado;
      if (!ok) reprovou = true;
      console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${acao.padEnd(10)} flag=${ligada ? 'ON ' : 'OFF'} → escolheu ${r.veredito} (due=${r.dueAlvo}, afetadas=${r.n}) · esperado ${esperado}`);
    }
  }
  const { data: resto } = await supabase.from('tasks').select('id').eq('assigned_to', collab.id);
  console.log(`\n  resíduo: ${(resto || []).length} tarefa(s)`);
  if ((resto || []).length) reprovou = true;
  console.log(reprovou ? '\n=== PROVA: REPROVADA ===' : '\n=== PROVA: APROVADA (flag inverte o alvo nos 3 handlers) ===');
  process.exit(reprovou ? 1 : 0);
})().catch((e) => { console.error('erro fatal:', e); process.exit(1); });
