#!/usr/bin/env node
// scripts/replay-lab-cenario-piso.js
// CENÁRIO A do Replay Lab — piso do lembrete (caso Matheus, 04/08/2026).
//
// Reproduz o incidente real: tarefa com due_date de ontem e remind_at 45 dias no passado.
// A pessoa pede "passa pra <dia>". O prazo vai pra frente, mas o lembrete vencido
// sobrevive ao deslocamento por delta — e o cobrador ("remind_at <= agora?") cobra ANTES
// da data combinada. O Matheus pediu três vezes, em maiúsculas, que não fizessem isso.
//
// O QUE ESTE CENÁRIO PROVA
// (a) o BANCO: o piso é exato, não "algum instante no futuro";
// (b) a FALA: o que o TOM disse, capturado no ponto único de saída — metade dos 76 casos
//     do diagnóstico é "anotado" sem ter anotado, e conferir só o banco pega a outra metade;
// (c) o COBRADOR de verdade: `checkReminders`, o único handler que lê `remind_at`. A v1
//     dirigia `remindOperationalTasks`, que filtra por `due_date = amanhã` e nem seleciona
//     a tarefa — "não cobrou antes" passava por VACUIDADE, verde com o bug presente.
//     A exigência é ZERO SELEÇÃO, não zero envio.
//
// DATAS SÃO RELATIVAS, e isso não é estilo. A v1 cravava '2026-08-05'/'2026-08-06' e o
// piso compara a nova data contra o relógio de parede: passada a meia-noite, "quinta"
// vira hoje, a guarda deixa de valer e o cenário muda de significado sozinho. Um teste que
// só é verdadeiro hoje é a mesma família de falso-verde que ele existe para caçar.
//
// CRITÉRIO É TAXA, não passa/falha — o LLM não é determinístico (provado em produção: a
// mesma frase falhou num dia e funcionou no outro).
//
//   N=5  bash scripts/replay-lab-run.sh cenario-piso    # validação do mecanismo
//   N=20 bash scripts/replay-lab-run.sh cenario-piso    # bateria oficial
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

// O run vem do RUNNER, não daqui: o turno conversacional nasce no processo do SERVIDOR
// (webhook), e só um run compartilhado pelos dois processos prova que o contexto de replay
// atravessou a fronteira. Gerar aqui deixaria a evidência do TOM órfã de run.
const RUN_ID = process.env.TOM_QA_RUN_ID;
const RUN_CRON = `${RUN_ID}#cron`;   // o cron roda NESTE processo — run próprio separa as duas fontes
const SAIDA = process.env.TOM_QA_EVIDENCE_FILE || path.join(require('node:os').tmpdir(), `${RUN_ID}.jsonl`);

if (!SEGREDO || !QA_PHONE) { console.error('faltou WEBHOOK_SECRET ou TOM_QA_PHONES'); process.exit(1); }
if (!RUN_ID || RUN_ID.length < 8) {
  console.error('faltou TOM_QA_RUN_ID (exportado pelo runner) — sem ele a fala do TOM fica sem run');
  process.exit(1);
}

const jsonl = (o) => fs.appendFileSync(SAIDA, JSON.stringify({ run_id: RUN_ID, ...o }) + '\n');
const dorme = (ms) => new Promise(r => setTimeout(r, ms));
const DIA = 86400000;

// ---- Datas ancoradas no HOJE real, em BRT (nunca toISOString para dia local) ----
const _fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const _fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' });
const ymdBrt = (d) => _fmtYmd.format(d);
const nomeDia = (d) => _fmtDia.format(d).replace(/-feira.*$/, '').trim().toLowerCase();

const AGORA = new Date();
const ONTEM = ymdBrt(new Date(AGORA.getTime() - DIA));
const ALVO_D = new Date(AGORA.getTime() + 2 * DIA);
const ALVO = ymdBrt(ALVO_D);
const NOME_ALVO = nomeDia(ALVO_D);            // "quinta", "sábado"… — sempre a próxima ocorrência
// Instante UTC 45 dias atrás (aqui slice(0,10) é proposital: quero um DIA UTC, não local).
const REMIND_VENCIDO = `${new Date(AGORA.getTime() - 45 * DIA).toISOString().slice(0, 10)}T12:00:00.000Z`;
// O piso preserva a hora-do-dia UTC do lembrete original sobre a nova data: 12:00Z = 09:00 BRT.
const PISO_ESPERADO = `${ALVO}T12:00:00.000Z`;
const INICIO_RUN = new Date(AGORA.getTime() - 60_000).toISOString();

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Dias da semana que a FALA do TOM menciona. Usado para pegar confabulação de data:
// "passei pra sexta" com o banco em quinta é exatamente o padrão que o laboratório caça.
function diasMencionados(texto) {
  const t = semAcento(texto);
  return DIAS_SEMANA.filter(d => t.includes(semAcento(d)));
}

async function colaboradorQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name, phone').eq('phone', QA_PHONE).maybeSingle();
  if (!data) throw new Error(`perfil QA ${QA_PHONE} não existe — rode scripts/replay-lab-perfis.sql`);
  return data;
}

// FIXTURE LIMPA POR REPETIÇÃO: sem isso a rep 7 herda estado da 6 e a taxa mede
// contaminação, não comportamento. Inclui o HISTÓRICO — o TOM lê as últimas mensagens, e
// sem limpar ele responderia à rep 2 lembrando da rep 1 ("já te falei que passei").
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

// SÓ o que este run criou, e só no perfil descartável. Fail-closed nos dois eixos: sem
// run válido não apaga nada; sem colaborador na faixa reservada, idem.
async function limparFixture(collab) {
  if (!RUN_ID || RUN_ID.length < 8) throw new Error('run_id inválido: recusando limpar');
  if (!/^5500\d{9}$/.test(String(collab.phone || '').replace(/\D/g, ''))) {
    throw new Error(`recusando limpar: ${collab.phone} não é da faixa reservada de QA`);
  }
  const { data: minhas } = await supabase.from('tasks').select('id').eq('assigned_to', collab.id).like('title', `[${RUN_ID}]%`);
  for (const t of (minhas || [])) {
    await supabase.from('notifications').delete().eq('reference_id', t.id).eq('notification_type', 'task_reminder');
  }
  await supabase.from('tasks').delete().eq('assigned_to', collab.id).like('title', `[${RUN_ID}]%`);
  await supabase.from('conversation_history').delete().eq('collaborator_id', collab.id).gte('created_at', INICIO_RUN);
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

// A fala do TOM vem do OUTRO processo (o servidor), então chega pelo JSONL — não pela
// memória deste. Linha parcial de append concorrente é ignorada, não derruba o cenário.
function falasDoTom(desdeIso) {
  let bruto = '';
  try { bruto = fs.readFileSync(SAIDA, 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const linha of bruto.split('\n')) {
    if (!linha.trim()) continue;
    let o; try { o = JSON.parse(linha); } catch (_) { continue; }
    if (o.evento !== 'outbound_suppressed') continue;
    if (o.runId !== RUN_ID) continue;          // #cron é outro run: aqui só a conversa
    if (desdeIso && o.ts < desdeIso) continue;
    if (o.texto) out.push(o.texto);
  }
  return out;
}

// Espera o EFEITO — no banco e na fala — em vez de dormir um tempo fixo. Dormir fixo é a
// origem de teste instável que ninguém confia.
async function esperarTurno(taskId, marco, ateMs) {
  const limite = Date.now() + ateMs;
  let task = null;
  while (Date.now() < limite) {
    const { data } = await supabase.from('tasks').select('due_date, remind_at, reminded_at, status').eq('id', taskId).maybeSingle();
    task = data || task;
    const falas = falasDoTom(marco);
    if (task && task.due_date !== ONTEM && falas.length) return { mudou: true, task, falas };
    await dorme(1500);
  }
  const { data } = await supabase.from('tasks').select('due_date, remind_at, reminded_at, status').eq('id', taskId).maybeSingle();
  return { mudou: !!(data && data.due_date !== ONTEM), task: data, falas: falasDoTom(marco) };
}

// O COBRADOR REAL, com relógio controlado, DENTRO do contexto de replay. Sem runInTurn o
// envio do dia do alvo sairia fora da trava — direto para a UAZAPI.
// Conta cobranças DESTA tarefa, não evidências no geral. A v1 usava um contador global e
// deu falso-vermelho na primeira rodada: o sweep pegou 24 lembretes de gente real (a trava
// barrou todos, mas o contador contou). O título carrega o run — é o que identifica a fala
// como sendo sobre a minha fixture, e não sobre o mundo.
function cobrancasDaFixture() {
  return turnClaim.evidenciasQA(RUN_CRON).filter(e => e.texto && e.texto.includes(RUN_ID));
}

async function rodarCron(quando) {
  const dispatcher = require('../src/rituals/dispatcher');
  const antes = cobrancasDaFixture().length;
  await turnClaim.runInTurn({ waMessageId: `cron-${RUN_ID}`, qa: true, runId: RUN_CRON }, async () => {
    try { await dispatcher.checkReminders(new Date(quando)); }
    catch (e) { console.warn(`  [cron ${quando}] ${e.message}`); }
  });
  return cobrancasDaFixture().length - antes;
}

(async () => {
  const collab = await colaboradorQA();
  console.log(`=== CENÁRIO A — piso do lembrete · run=${RUN_ID} · N=${N} ===`);
  console.log(`perfil QA: ${collab.full_name} (${collab.phone})`);
  console.log(`ontem=${ONTEM} → alvo=${ALVO} (${NOME_ALVO}) · piso esperado=${PISO_ESPERADO}`);
  console.log(`evidência: ${SAIDA}\n`);

  const resultados = [];
  for (let rep = 1; rep <= N; rep++) {
    const t0 = Date.now();
    let terminal = 'ok';
    const checks = {};
    let task = null;
    let falas = [];
    try {
      task = await prepararFixture(collab, rep);
      const marco = new Date().toISOString();
      const waId = `QA-${RUN_ID}-${rep}`;
      checks.webhook_200 = (await injetar(`passa essa do inventário pra ${NOME_ALVO}`, waId)) === 200;

      const r = await esperarTurno(task.id, marco, TIMEOUT_MS);
      if (!r.mudou) terminal = 'timeout';
      const depois = r.task || {};
      falas = r.falas;

      // (1) o TOM FALOU, e a trava capturou o que ele disse — absoluto
      checks.tom_respondeu = falas.length > 0;
      // (2) estatístico — depende do LLM entender e emitir o marker
      checks.due_virou_alvo = depois.due_date === ALVO;
      // (3) absoluto — o piso EXATO, não "algum instante no futuro".
      // Compara INSTANTE, não string: o Postgres devolve "+00:00" e o JS escreve ".000Z".
      // A v1 comparava texto e reprovou um piso que estava certo — falso-vermelho meu.
      checks.piso_exato = Date.parse(depois.remind_at) === Date.parse(PISO_ESPERADO);
      // (4) a fala bate com o banco: se ele nomeia um dia, é o dia que ele gravou
      const dias = [...new Set(falas.flatMap(diasMencionados))];
      checks.fala_confere = dias.length === 0 || (dias.length === 1 && dias[0] === NOME_ALVO);

      // (5) absoluto — o COBRADOR calado antes do alvo: zero seleção, zero tentativa.
      // O último tick é um minuto antes do piso: prova que não adianta nem por pouco.
      const antesDoAlvo = [];
      for (const quando of [`${ymdBrt(AGORA)}T12:00:00Z`, `${ymdBrt(AGORA)}T23:00:00Z`,
        `${ymdBrt(new Date(AGORA.getTime() + DIA))}T12:00:00Z`, `${ALVO}T11:59:00Z`]) {
        antesDoAlvo.push(await rodarCron(quando));
      }
      const { data: pos } = await supabase.from('tasks').select('reminded_at').eq('id', task.id).maybeSingle();
      checks.cron_calado_antes = antesDoAlvo.every(n => n === 0) && !(pos && pos.reminded_at);

      // (6) absoluto — no dia combinado ele cobra, e o envio passa pela trava com run_id
      const noAlvo = await rodarCron(`${ALVO}T12:30:00Z`);
      const evsCron = cobrancasDaFixture().filter(e => e.evento === 'outbound_suppressed');
      checks.cobrou_no_alvo = noAlvo >= 1;
      checks.evidencia_com_run = evsCron.length > 0 && evsCron.every(e => e.runId === RUN_CRON);

      jsonl({
        rep, terminal, ms: Date.now() - t0, checks,
        pedido: `passa essa do inventário pra ${NOME_ALVO}`,
        falou: falas,
        cobranca: evsCron.map(e => e.texto),
        banco_antes: { due_date: ONTEM, remind_at: REMIND_VENCIDO, reminded_at: null },
        banco_depois: depois,
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
    if (falas.length) console.log(`      TOM disse: ${JSON.stringify(falas[0].slice(0, 120))}`);
  }

  // ---- Taxa por verificação ----
  const conta = (k) => resultados.filter(r => r.checks[k]).length;
  const criterios = [
    ['webhook_200',      N,                  'absoluto'],
    ['tom_respondeu',    N,                  'absoluto (a fala foi capturada)'],
    ['due_virou_alvo',   Math.ceil(N * 0.95), 'estatístico (LLM)'],
    ['piso_exato',       N,                  'absoluto (o piso)'],
    ['fala_confere',     Math.ceil(N * 0.95), 'estatístico (fala x banco)'],
    ['cron_calado_antes', N,                 'absoluto (zero seleção)'],
    ['cobrou_no_alvo',   N,                  'absoluto'],
    ['evidencia_com_run', N,                 'absoluto (contexto chegou)'],
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
  const { data: restoHist } = await supabase.from('conversation_history').select('id').eq('collaborator_id', collab.id).gte('created_at', INICIO_RUN);
  console.log(`  resíduo: ${(resto || []).length} tarefa(s), ${(restoHist || []).length} linha(s) de histórico`);
  if ((resto || []).length || (restoHist || []).length) reprovou = true;

  console.log(`\nJSONL: ${SAIDA}`);
  console.log(reprovou ? '=== CENÁRIO A: REPROVADO ===' : '=== CENÁRIO A: APROVADO ===');
  process.exit(reprovou ? 1 : 0);
})().catch(e => { console.error('erro fatal:', e); process.exit(1); });
