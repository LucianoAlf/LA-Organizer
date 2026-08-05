#!/usr/bin/env node
// scripts/replay-lab-cenario-piso.js
// CENÁRIO A do Replay Lab — piso do lembrete (caso Matheus, 04/08/2026).
//
// Reproduz o incidente real: tarefa com due_date de ontem e remind_at 45 dias no passado.
// A pessoa pede "passa pra quinta". O prazo vai pra frente, mas o lembrete vencido
// sobrevive ao deslocamento por delta — e o cron ("remind_at <= agora?") cobra ANTES da
// data combinada. O Matheus pediu três vezes, em maiúsculas, que não fizessem isso.
//
// O QUE ESTE CENÁRIO PROVA, E O QUE NÃO PROVA
// Conferir remind_at prova o CAMPO. Quem cobrou foi o CRON — então o cron roda aqui, de
// verdade, com relógio controlado, dentro do contexto de replay. E a exigência é ZERO
// SELEÇÃO, não zero envio: se o cobrador selecionar a tarefa e só não mandar porque a
// trava de QA segurou, o bug continua de pé e o verde seria do laboratório, não do fix.
//
// CRITÉRIO É TAXA, não passa/falha — o LLM não é determinístico (provado em produção: a
// mesma frase falhou num dia e funcionou no outro). Verificações determinísticas têm
// piso absoluto; as que dependem do modelo têm piso estatístico.
//
//   N=5  node scripts/replay-lab-cenario-piso.js     # validação do mecanismo
//   N=20 node scripts/replay-lab-cenario-piso.js     # bateria oficial
'use strict';

const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');

const supabase = require('../src/supabase/client');
const turnClaim = require('../src/services/turn-claim');

const N = Number(process.env.N || 5);
const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 120000);
const RUN_ID = `piso-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const SAIDA = process.env.TOM_QA_EVIDENCE_FILE || path.join(require('node:os').tmpdir(), `${RUN_ID}.jsonl`);

if (!SEGREDO || !QA_PHONE) {
  console.error('faltou WEBHOOK_SECRET ou TOM_QA_PHONES');
  process.exit(1);
}

const jsonl = (o) => fs.appendFileSync(SAIDA, JSON.stringify({ run_id: RUN_ID, ...o }) + '\n');
const dorme = (ms) => new Promise(r => setTimeout(r, ms));

// Datas ancoradas: segunda 03/08 é referência do incidente real.
const HOJE = '2026-08-05';           // quarta
const QUINTA = '2026-08-06';
const ONTEM = '2026-08-04';
const REMIND_VENCIDO = '2026-06-20T12:00:00Z';   // 45 dias atrás, 09:00 BRT

async function colaboradorQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name, phone').eq('phone', QA_PHONE).maybeSingle();
  if (!data) throw new Error(`perfil QA ${QA_PHONE} não existe — rode scripts/replay-lab-perfis.sql`);
  return data;
}

// FIXTURE LIMPA POR REPETIÇÃO: sem isso a rep 7 herda estado da 6 e a taxa mede
// contaminação, não comportamento.
async function prepararFixture(collab, rep) {
  await limparFixture(collab);
  const titulo = `[${RUN_ID}] Finalizar inventário de musicalização r${rep}`;
  const { data, error } = await supabase.from('tasks').insert({
    title: titulo,
    assigned_to: collab.id,
    created_by: collab.id,
    status: 'in_progress',
    due_date: ONTEM,
    remind_at: REMIND_VENCIDO,
    reminded_at: null,
  }).select('id, title, due_date, remind_at, reminded_at, status').maybeSingle();
  if (error) throw new Error(`fixture falhou: ${error.message}`);
  return data;
}

async function limparFixture(collab) {
  // SÓ por prefixo do run_id. Se o filtro vier vazio, não apaga nada — fail-closed.
  if (!RUN_ID || RUN_ID.length < 8) throw new Error('run_id inválido: recusando limpar');
  await supabase.from('tasks').delete().eq('assigned_to', collab.id).like('title', `[${RUN_ID}]%`);
}

async function injetar(texto, waId) {
  const corpo = JSON.stringify({
    EventType: 'messages',
    message: { id: waId, sender: `${QA_PHONE}@s.whatsapp.net`, chatid: `${QA_PHONE}@s.whatsapp.net`, text: texto, fromMe: false },
  });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  const res = await fetch(`http://127.0.0.1:${PORTA}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig },
    body: corpo,
  });
  return res.status;
}

// Espera o efeito no banco em vez de dormir um tempo fixo — dormir fixo é a origem de
// teste instável que ninguém confia.
async function esperarMudanca(taskId, ateMs) {
  const limite = Date.now() + ateMs;
  while (Date.now() < limite) {
    const { data } = await supabase.from('tasks').select('due_date, remind_at, reminded_at, status').eq('id', taskId).maybeSingle();
    if (data && data.due_date !== ONTEM) return { mudou: true, task: data };
    await dorme(1500);
  }
  const { data } = await supabase.from('tasks').select('due_date, remind_at, reminded_at, status').eq('id', taskId).maybeSingle();
  return { mudou: false, task: data };
}

// O COBRADOR REAL, com relógio controlado, DENTRO do contexto de replay. Sem runInTurn o
// envio de quinta sairia fora da trava — direto para a UAZAPI.
async function rodarCron(quando) {
  const dispatcher = require('../src/rituals/dispatcher');
  const antes = turnClaim.evidenciasQA(RUN_ID).length;
  await turnClaim.runInTurn({ waMessageId: `cron-${RUN_ID}`, qa: true, runId: RUN_ID }, async () => {
    try { await dispatcher.remindOperationalTasks(new Date(quando)); }
    catch (e) { console.warn(`  [cron ${quando}] ${e.message}`); }
  });
  return turnClaim.evidenciasQA(RUN_ID).length - antes;
}

(async () => {
  const collab = await colaboradorQA();
  console.log(`=== CENÁRIO A — piso do lembrete · run=${RUN_ID} · N=${N} ===`);
  console.log(`perfil QA: ${collab.full_name} (${collab.phone}) · evidência: ${SAIDA}\n`);

  const resultados = [];
  for (let rep = 1; rep <= N; rep++) {
    const t0 = Date.now();
    let terminal = 'ok';
    const checks = {};
    let task = null;
    try {
      task = await prepararFixture(collab, rep);
      const waId = `QA-${RUN_ID}-${rep}`;
      const status = await injetar('passa essa do inventário pra quinta', waId);
      checks.webhook_200 = status === 200;

      const r = await esperarMudanca(task.id, TIMEOUT_MS);
      if (!r.mudou) terminal = 'timeout';
      const depois = r.task || {};

      // (1) estatístico — depende do LLM entender e emitir o marker
      checks.due_virou_quinta = depois.due_date === QUINTA;
      // (2) absoluto — é o piso, determinístico
      checks.remind_no_futuro = !!depois.remind_at && Date.parse(depois.remind_at) > Date.now();

      // (3) absoluto — o COBRADOR calado antes da quinta: zero seleção, zero tentativa
      const antesQuinta = [];
      for (const quando of ['2026-08-05T09:00:00-03:00', '2026-08-05T18:00:00-03:00', '2026-08-05T23:59:00-03:00']) {
        antesQuinta.push(await rodarCron(quando));
      }
      const { data: pos } = await supabase.from('tasks').select('reminded_at').eq('id', task.id).maybeSingle();
      checks.cron_calado_antes = antesQuinta.every(n => n === 0) && !(pos && pos.reminded_at);

      // (4) absoluto — na quinta ele cobra, e o envio passa pela trava com run_id
      const naQuinta = await rodarCron('2026-08-06T09:30:00-03:00');
      const evs = turnClaim.evidenciasQA(RUN_ID).filter(e => e.evento === 'outbound_suppressed');
      checks.cobrou_na_quinta = naQuinta >= 1;
      checks.evidencia_com_run_id = evs.length > 0 && evs.every(e => e.runId === RUN_ID);

      jsonl({
        rep, terminal, ms: Date.now() - t0, checks,
        banco_antes: { due_date: ONTEM, remind_at: REMIND_VENCIDO, reminded_at: null },
        banco_depois: depois,
        evidencias: turnClaim.evidenciasQA(RUN_ID).length,
      });
    } catch (e) {
      terminal = 'erro_infra';
      jsonl({ rep, terminal, erro: String(e.message).slice(0, 200), checks });
    } finally {
      if (task) { try { await limparFixture(collab); } catch (_) {} }
      turnClaim.limparEvidenciasQA();
    }
    resultados.push({ rep, terminal, checks });
    const marca = Object.values(checks).every(Boolean) && terminal === 'ok' ? 'ok' : 'FALHOU';
    console.log(`  rep ${rep}/${N}: ${marca} (${terminal}) ${JSON.stringify(checks)}`);
  }

  // ---- Taxa por verificação ----
  const conta = (k) => resultados.filter(r => r.checks[k]).length;
  const criterios = [
    ['webhook_200',           N,               'absoluto'],
    ['due_virou_quinta',      Math.ceil(N*0.95), 'estatístico (LLM)'],
    ['remind_no_futuro',      N,               'absoluto (o piso)'],
    ['cron_calado_antes',     N,               'absoluto (zero seleção)'],
    ['cobrou_na_quinta',      N,               'absoluto'],
    ['evidencia_com_run_id',  N,               'absoluto (contexto chegou)'],
  ];
  console.log('\n=== TAXA ===');
  let reprovou = false;
  for (const [k, piso, tipo] of criterios) {
    const v = conta(k);
    const passou = v >= piso;
    if (!passou) reprovou = true;
    console.log(`  ${passou ? 'OK  ' : 'FALHA'} ${k}: ${v}/${N} (piso ${piso}) — ${tipo}`);
  }
  const { data: resto } = await supabase.from('tasks').select('id').eq('assigned_to', collab.id).like('title', `[${RUN_ID}]%`);
  console.log(`  resíduo: ${(resto || []).length} tarefa(s) do run`);
  if ((resto || []).length) reprovou = true;

  console.log(`\nJSONL: ${SAIDA}`);
  console.log(reprovou ? '=== CENÁRIO A: REPROVADO ===' : '=== CENÁRIO A: APROVADO ===');
  process.exit(reprovou ? 1 : 0);
})().catch(e => { console.error('erro fatal:', e); process.exit(1); });
