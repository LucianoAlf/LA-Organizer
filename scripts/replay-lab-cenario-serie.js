#!/usr/bin/env node
// scripts/replay-lab-cenario-serie.js — CENÁRIO B do Replay Lab: alvo por ciclo corrente.
//
//   TOM_TASK_TARGET_SERIES=1 N=20 bash scripts/replay-lab-run.sh cenario-serie
//
// O QUE ELE MEDE
// Quando o título casa com várias instâncias vivas da MESMA série, o lookup legado
// (`created_at desc` + `.limit(1)`) escolhia uma instância qualquer — na prática a última
// materializada, lá na frente. Em produção, "Presença Emusys" tem 35 instâncias vivas: o
// legado pegava a de 04/09 enquanto a de 01/08 estava atrasada. A Fatia A troca isso por
// ciclo corrente (menor `due_date`).
//
// A FIXTURE É MONTADA PARA SEPARAR OS DOIS COMPORTAMENTOS
// 12 instâncias da mesma série, todas com prazo FORA da janela do prompt, e o `created_at` é
// gravado EXPLICITAMENTE em ordem crescente de prazo. Logo: a de MAIOR `created_at` é a mais
// distante (hoje+43) e a de MENOR `due_date` é a corrente (hoje+10). Legado e executor novo
// apontam para instâncias DIFERENTES por construção — é isso que permite a prova de reversão
// (com a flag desligada o cenário TEM de reprovar).
//
// O molde da série tem título PROPOSITALMENTE diferente do das instâncias: ele precisa existir
// (as filhas apontam para ele), mas não pode entrar na lista de candidatos do `ilike` — senão
// o cenário mediria a escolha entre molde e instância, que é outro defeito.
//
// DOIS DESVIOS DELIBERADOS DO PLANO, ambos por medição:
//
// 1. O plano punha a corrente em hoje-2. Assim ela aparecia no contexto injetado, o LLM
//    emitia o marker já com o `id`, e o bloco `if (!a.id && a.title)` era pulado inteiro: o
//    cenário passava verde COM A FLAG DESLIGADA, sem tocar em uma linha da Fatia A. Daí o
//    check `executor_rodou`, que lê o stdout do servidor e exige o rastro do title-lookup.
//
// 2. O plano marca `mexeu_na_corrente` como absoluto N/N. Aqui ele é absoluto SOBRE AS
//    REPETIÇÕES EM QUE O TOM AGIU, e `pedido_entendido` é só reportado. Motivo: fora da
//    janela do prompt o LLM às vezes pergunta "são 3 com esse nome, qual delas?" — resposta
//    legítima que esta fatia não conserta nem piora. Somar isso ao executor reportaria
//    hesitação do LLM como defeito determinístico, que é justamente o que a fatia separa.
//    O que bloqueia: errar o alvo, espalhar para as irmãs, ou dizer que fez sem ter feito.

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
const FLAG_LIGADA = process.env.TOM_TASK_TARGET_SERIES === '1';

const RUN_ID = process.env.TOM_QA_RUN_ID;
const SAIDA = process.env.TOM_QA_EVIDENCE_FILE || path.join(require('node:os').tmpdir(), `${RUN_ID}.jsonl`);

if (!RUN_ID) { console.error('sem TOM_QA_RUN_ID — rode via scripts/replay-lab-run.sh'); process.exit(1); }
if (!SEGREDO) { console.error('sem WEBHOOK_SECRET — rode via scripts/replay-lab-run.sh'); process.exit(1); }
if (!QA_PHONE) { console.error('sem TOM_QA_PHONES'); process.exit(1); }

const jsonl = (o) => fs.appendFileSync(SAIDA, JSON.stringify({ run_id: RUN_ID, ...o }) + '\n');
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const DIA = 86400000;

const _fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const _fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' });
const ymdBrt = (d) => _fmtYmd.format(d);
const nomeDia = (d) => _fmtDia.format(d).replace(/-feira.*$/, '').trim().toLowerCase();

const AGORA = new Date();
const ALVO_D = new Date(AGORA.getTime() + 2 * DIA);
const ALVO = ymdBrt(ALVO_D);
const NOME_ALVO = nomeDia(ALVO_D);
const INICIO_RUN = new Date(AGORA.getTime() - 60_000).toISOString();

// TODAS as instâncias ficam FORA da janela do prompt (o contexto injeta só prazos dos
// próximos 7 dias, com `slice(0,8)`). Isso não é detalhe: a v1 deste cenário punha a
// corrente em hoje-2, ela aparecia no prompt, o LLM emitia o marker com o `id` pronto e o
// bloco `if (!a.id && a.title)` era pulado inteiro — o cenário passava verde com a flag
// DESLIGADA porque não tocava no código da Fatia A. É assim que o title-lookup roda de
// verdade em produção (67 vezes nos logs): quando a tarefa não está visível no prompt e só
// resta o título que a pessoa falou.
// hoje+2 (o alvo do pedido) fica fora da lista: se uma instância já vencesse no dia do
// pedido, "mudou para o alvo" e "já estava no alvo" ficariam indistinguíveis.
const OFFSETS = [10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43];
const CORRENTE_OFF = 10;

const ASSUNTO = 'conferir presença no Emusys';
const TITULO = `[${RUN_ID}] ${ASSUNTO}`;

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function diasMencionados(texto) {
  const t = semAcento(texto);
  return DIAS_SEMANA.filter((d) => t.includes(semAcento(d)));
}

async function colaboradorQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name, phone').eq('phone', QA_PHONE).maybeSingle();
  if (!data) throw new Error(`perfil QA ${QA_PHONE} não existe — rode scripts/replay-lab-perfis.sql`);
  return data;
}

// Fixture limpa por repetição — inclusive o histórico. Sem isso a rep 7 responde lembrando
// da rep 6 ("já passei essa pra quinta") e a taxa mede contaminação, não comportamento.
async function prepararFixture(collab) {
  await limparFixture(collab);

  const { data: molde, error: eM } = await supabase.from('tasks').insert({
    title: `[${RUN_ID}] molde tecnico da serie`,   // NÃO casa com o ilike do pedido
    assigned_to: collab.id,
    created_by: collab.id,
    status: 'pending',
    due_date: ymdBrt(new Date(AGORA.getTime() + 60 * DIA)),
    recurrence_rule: 'FREQ=WEEKLY',
  }).select('id').maybeSingle();
  if (eM) throw new Error(`molde falhou: ${eM.message}`);

  // created_at CRESCENTE junto com o prazo: a última criada é a mais distante. É o que faz
  // legado (created_at desc) e novo (menor due_date) divergirem por construção.
  const base = AGORA.getTime() - 3600_000;
  const linhas = OFFSETS.map((off, i) => ({
    title: TITULO,
    assigned_to: collab.id,
    created_by: collab.id,
    status: 'pending',
    due_date: ymdBrt(new Date(AGORA.getTime() + off * DIA)),
    recurrence_parent_id: molde.id,
    created_at: new Date(base + i * 1000).toISOString(),
  }));
  const { data: insts, error: eI } = await supabase.from('tasks').insert(linhas).select('id, due_date, created_at');
  if (eI) throw new Error(`instâncias falharam: ${eI.message}`);
  if (!insts || insts.length !== OFFSETS.length) throw new Error(`esperava ${OFFSETS.length} instâncias, vieram ${(insts || []).length}`);

  const correnteYmd = ymdBrt(new Date(AGORA.getTime() + CORRENTE_OFF * DIA));
  const corrente = insts.find((t) => t.due_date === correnteYmd);
  if (!corrente) throw new Error('fixture sem a instância corrente — cenário não mediria nada');
  const legado = insts.slice().sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))[0];
  if (legado.id === corrente.id) throw new Error('fixture degenerada: legado e corrente coincidem — sem poder de discriminação');

  return { molde, insts, corrente, legado, antes: Object.fromEntries(insts.map((t) => [t.id, t.due_date])) };
}

// Fail-closed nos dois eixos: sem run válido não apaga nada; sem telefone da faixa
// reservada de QA, idem. As filhas saem antes do molde (elas apontam para ele).
async function limparFixture(collab) {
  if (!RUN_ID || RUN_ID.length < 8) throw new Error('run_id inválido: recusando limpar');
  if (!/^5500\d{9}$/.test(String(collab.phone || '').replace(/\D/g, ''))) {
    throw new Error(`recusando limpar: ${collab.phone} não é da faixa reservada de QA`);
  }
  // Limpa TUDO do perfil descartável, não só o que tem o prefixo do run. Motivo medido: ao
  // não achar a tarefa pelo título, o TOM CRIA uma nova — com o título limpo, sem prefixo
  // ("Conferir presença no Emusys", prazo no alvo). Ela sobrevivia à limpeza por prefixo,
  // entrava no `ilike` das repetições seguintes e aparecia no contexto ("essa já tá pra
  // domingo"), envenenando o resto da bateria. Pior: o contador de resíduo também filtrava
  // por prefixo e reportava 0 — falso-verde na própria limpeza.
  const { data: minhas } = await supabase.from('tasks').select('id').eq('assigned_to', collab.id);
  for (const t of (minhas || [])) {
    await supabase.from('notifications').delete().eq('reference_id', t.id);
  }
  await supabase.from('tasks').delete().eq('assigned_to', collab.id).not('recurrence_parent_id', 'is', null);
  await supabase.from('tasks').delete().eq('assigned_to', collab.id);
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

// A fala nasce no OUTRO processo (o servidor efêmero) e chega por este arquivo.
// Linha parcial de append concorrente é ignorada, não derruba o cenário.
function evidenciasDaConversa(desdeIso) {
  let bruto = '';
  try { bruto = fs.readFileSync(SAIDA, 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const linha of bruto.split('\n')) {
    if (!linha.trim()) continue;
    let o; try { o = JSON.parse(linha); } catch (_) { continue; }
    if (o.evento !== 'outbound_suppressed') continue;
    if (desdeIso && o.ts < desdeIso) continue;
    out.push(o);
  }
  return out;
}
const falasDoTom = (desdeIso) => evidenciasDaConversa(desdeIso).filter((e) => e.runId === RUN_ID && e.texto).map((e) => e.texto);

// PROVA DE QUE O CAMINHO FOI EXERCITADO. O executor da Fatia A só entra quando o marker
// chega SEM `id` — e o rastro disso ("title-lookup") sai no stdout do servidor efêmero, que
// é outro processo. Fail-closed de propósito: sem o log, o check reprova em vez de degradar
// para verde. Foi exatamente um verde silencioso assim que quase deixou passar um cenário
// que não tocava na linha que dizia testar.
const LAB_LOG = process.env.TOM_QA_LAB_LOG;
function lookupsNoLog() {
  if (!LAB_LOG) return null;
  try {
    return (fs.readFileSync(LAB_LOG, 'utf8').match(/title-lookup/g) || []).length;
  } catch (_) { return null; }
}

async function lerDatas(ids) {
  const { data } = await supabase.from('tasks').select('id, due_date').in('id', ids);
  return Object.fromEntries((data || []).map((t) => [t.id, t.due_date]));
}

// Espera o EFEITO (alguma instância mudou de prazo) + a fala. Dormir tempo fixo é a origem
// de teste instável que ninguém confia.
async function esperarTurno(fx, marco, ateMs) {
  const ids = fx.insts.map((t) => t.id);
  const limite = Date.now() + ateMs;
  let depois = fx.antes;
  while (Date.now() < limite) {
    depois = await lerDatas(ids);
    const mudou = ids.some((id) => depois[id] !== fx.antes[id]);
    if (mudou && falasDoTom(marco).length) return { depois, falas: falasDoTom(marco) };
    await dorme(1500);
  }
  depois = await lerDatas(ids);
  return { depois, falas: falasDoTom(marco) };
}

(async () => {
  const collab = await colaboradorQA();
  console.log(`=== CENÁRIO B — alvo por ciclo corrente · run=${RUN_ID} · N=${N} ===`);
  console.log(`perfil QA: ${collab.full_name} (${collab.phone})`);
  console.log(`TOM_TASK_TARGET_SERIES=${FLAG_LIGADA ? '1 (LIGADA)' : '(desligada — espera-se REPROVAR)'}`);
  console.log(`série de ${OFFSETS.length} · corrente=hoje${CORRENTE_OFF} · alvo do pedido=${ALVO} (${NOME_ALVO})`);
  console.log(`evidência: ${SAIDA}\n`);

  const resultados = [];
  for (let rep = 1; rep <= N; rep++) {
    const t0 = Date.now();
    let terminal = 'ok';
    const checks = {};
    let fx = null;
    let falas = [];
    let mudadas = [];
    try {
      fx = await prepararFixture(collab);
      const marco = new Date().toISOString();
      const lookupsAntes = lookupsNoLog();
      const pedido = `passa a ${ASSUNTO} pra ${NOME_ALVO}`;
      checks.webhook_200 = (await injetar(pedido, `QA-${RUN_ID}-${rep}`)) === 200;

      const r = await esperarTurno(fx, marco, TIMEOUT_MS);
      falas = r.falas;
      mudadas = fx.insts.filter((t) => r.depois[t.id] !== fx.antes[t.id])
        .map((t) => ({ id: t.id, de: fx.antes[t.id], para: r.depois[t.id] }));

      // (0) o marker chegou SEM id e caiu no title-lookup. Sem isto, tudo abaixo pode
      // estar verde sem que uma linha da Fatia A tenha sido executada.
      const lookupsDepois = lookupsNoLog();
      // Só faz sentido exigir o lookup quando ele AGIU: se hesitou e perguntou, nenhum
      // caminho de escrita foi tomado. Mas se agiu, tem de ter passado por aqui — agir por
      // `id` significaria que a Fatia A não foi tocada e o verde seria vazio.
      checks.executor_rodou = checks.pedido_entendido
        ? (lookupsAntes !== null && lookupsDepois !== null && lookupsDepois > lookupsAntes)
        : null;

      // (1) absoluto — o TOM falou e a trava capturou o texto
      checks.tom_respondeu = falas.length > 0;
      // (2) estatístico — depende do LLM entender o pedido e emitir o marker
      checks.pedido_entendido = mudadas.length > 0;
      if (!checks.pedido_entendido) terminal = 'llm_nao_agiu';

      // (3) absoluto (entre as que entenderam) — mexeu na CORRENTE, e ela foi para o alvo
      checks.mexeu_na_corrente = checks.pedido_entendido
        ? (r.depois[fx.corrente.id] === ALVO)
        : null;
      // (4) absoluto — nenhuma das outras 11 se moveu. É o que separa "acertou o alvo" de
      // "mexeu em tudo e acertou por tabela".
      checks.nao_mexeu_nas_outras = fx.insts
        .filter((t) => t.id !== fx.corrente.id)
        .every((t) => r.depois[t.id] === fx.antes[t.id]);
      // (5) estatístico — se ele nomeia um dia da semana, é o do alvo
      const dias = [...new Set(falas.flatMap(diasMencionados))];
      checks.fala_confere = dias.length === 0 || (dias.length === 1 && dias[0] === NOME_ALVO);
      // (5b) ABSOLUTO — se NÃO mexeu em nada, não pode ter dito que mexeu. Hesitar e
      // perguntar "qual das 3?" é resposta legítima; dizer "Fechou, vai pra domingo" sem
      // ter movido nada é confabulação, e foi observado aqui em 1 de 3 na primeira bateria.
      const AFIRMOU_RE = /\b(feito|fechou|pronto|movi|movendo|reagend|passei|troquei|atualiz)/i;
      checks.sem_confabulacao = checks.pedido_entendido || !falas.some((f) => AFIRMOU_RE.test(f));
      // (6) absoluto — o recibo carrega o run: prova que o contexto QA chegou no envio
      const evs = evidenciasDaConversa(marco);
      checks.evidencia_com_run = evs.length > 0 && evs.every((e) => e.runId === RUN_ID);

      jsonl({
        rep, terminal, ms: Date.now() - t0, checks, pedido, falou: falas,
        corrente: { id: fx.corrente.id, due_antes: fx.antes[fx.corrente.id], due_depois: r.depois[fx.corrente.id] },
        legado_teria_pego: { id: fx.legado.id, due: fx.antes[fx.legado.id] },
        mudadas,
      });
    } catch (e) {
      terminal = 'erro_infra';
      jsonl({ rep, terminal, erro: String(e.message).slice(0, 200), checks });
    } finally {
      if (fx) { try { await limparFixture(collab); } catch (_) {} }
      turnClaim.limparEvidenciasQA();
    }
    resultados.push({ rep, terminal, checks });
    const relevantes = Object.values(checks).filter((v) => v !== null);
    const marca = relevantes.every(Boolean) && terminal === 'ok' ? 'ok' : 'FALHOU';
    console.log(`  rep ${rep}/${N}: ${marca} (${terminal}) ${JSON.stringify(checks)}`);
    if (mudadas.length) console.log(`      mexeu em: ${mudadas.map((m) => `${m.de}→${m.para}`).join(', ')}`);
    if (falas.length) console.log(`      TOM disse: ${JSON.stringify(falas[0].slice(0, 110))}`);
  }

  // ---- Taxa por verificação ----
  // `mexeu_na_corrente` tem denominador próprio: só as reps em que o LLM agiu. Misturar com
  // as que ele não entendeu reportaria falha de compreensão como falha do executor.
  const conta = (k) => resultados.filter((r) => r.checks[k] === true).length;
  const denom = (k) => resultados.filter((r) => r.checks[k] !== null && r.checks[k] !== undefined).length;
  const entendidas = conta('pedido_entendido');
  const criterios = [
    ['webhook_200', N, N, 'absoluto'],
    ['executor_rodou', entendidas, entendidas, 'ABSOLUTO sobre as entendidas (anti-vacuidade)'],
    ['tom_respondeu', N, N, 'absoluto (a fala foi capturada)'],
    // `pedido_entendido` é REPORTADO, não bloqueante: com a série fora da janela do prompt
    // (que é a condição em que o title-lookup roda), o LLM às vezes pergunta "qual das 3?"
    // em vez de agir — resposta legítima que esta fatia não conserta nem piora. O piso 1 só
    // garante que houve amostra para avaliar o executor. O que BLOQUEIA é o executor errar
    // o alvo, espalhar para as irmãs, ou o TOM dizer que fez sem ter feito.
    ['pedido_entendido', N, 1, 'reportado (LLM hesita fora da janela do prompt)'],
    ['mexeu_na_corrente', entendidas, entendidas, 'ABSOLUTO sobre as entendidas (o executor)'],
    ['nao_mexeu_nas_outras', N, N, 'absoluto (não espalhou)'],
    ['sem_confabulacao', N, N, 'ABSOLUTO (não disse que fez sem ter feito)'],
    ['fala_confere', N, Math.ceil(N * 0.95), 'estatístico (fala x banco)'],
    ['evidencia_com_run', N, N, 'absoluto (contexto chegou)'],
  ];
  console.log('\n=== TAXA ===');
  let reprovou = false;
  for (const [k, sobre, piso, tipo] of criterios) {
    const v = conta(k);
    const passou = v >= piso;
    if (!passou) reprovou = true;
    console.log(`  ${passou ? 'OK  ' : 'FALHA'} ${k}: ${v}/${sobre} (piso ${piso}) — ${tipo}${denom(k) !== N ? ` [avaliado em ${denom(k)}]` : ''}`);
  }

  const { data: resto } = await supabase.from('tasks').select('id').eq('assigned_to', collab.id);
  const { data: restoHist } = await supabase.from('conversation_history').select('id').eq('collaborator_id', collab.id).gte('created_at', INICIO_RUN);
  console.log(`  resíduo: ${(resto || []).length} tarefa(s), ${(restoHist || []).length} linha(s) de histórico`);
  if ((resto || []).length || (restoHist || []).length) reprovou = true;

  console.log(`\nJSONL: ${SAIDA}`);
  console.log(reprovou ? '=== CENÁRIO B: REPROVADO ===' : '=== CENÁRIO B: APROVADO ===');
  process.exit(reprovou ? 1 : 0);
})().catch((e) => { console.error('erro fatal:', e); process.exit(1); });
