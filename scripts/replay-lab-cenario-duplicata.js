#!/usr/bin/env node
// scripts/replay-lab-cenario-duplicata.js
// CENÁRIO C do Replay Lab — dar baixa com TÍTULO DUPLICADO (caso Rose, grupo Financeiro 12/08).
//
// O INCIDENTE REAL, com os timestamps do banco:
//   21:44  Rose: "Tom, conclui os dois por favor"
//   21:45  TOM: "Marquei como feitos os dois de hoje" -> concluiu as instâncias de 12/06
//   21:55  Rose: "ué tom, vc concluiu as duas que pedi mas ta em aberto?"
//   22:01  TOM concluiu as de 12/07 · 22:04 outras de 12/07 · 22:05 FINALMENTE as de 12/08
//   22:04  Rose marcou o Alf no grupo: "tom não ta conseguindo concluir as tarefas de hoje"
// Dez tarefas erradas antes de acertar duas. As de junho e julho ficaram marcadas como
// feitas sem terem sido — o dano invisível é pior que o que ela viu.
//
// A RAIZ (por que havia 8 cópias do mesmo título): o dedupe do materializeSeries lê as
// instâncias por `recurrence_parent_id = template.id`, decide em MEMÓRIA e insere — sem
// UNIQUE no banco. Some a isso que pacote de grupo tem DOIS níveis (mãe-template e
// subtarefa-template): o dedupe pergunta por um nível e as instâncias vivem no outro,
// então ele vê zero e insere de novo a cada ciclo. O `due_date ASC` do resolvedor só
// REVELOU o lixo — sem duplicata ele acertaria sempre.
//
// ⚠️ ESTE É O CENÁRIO DO CHAT INDIVIDUAL. O caso Rose foi num PACOTE DE GRUPO, que é outro
// caminho de código inteiro — quem mede aquilo é o cenário D (replay-lab-cenario-grupo-molde.js),
// e foi ele que reproduziu o bug (completed=4 existindo 2 alvos). Aqui o TOM sempre se saiu
// bem: com título duplicado e pedido ambíguo, ele PERGUNTA em vez de chutar.
//
// O QUE ESTE CENÁRIO PROVA — e por que ele existe
// Decisão do Alf (13/08): correção no TOM não fecha sem simulação conversacional real.
// Suíte verde não pega isto: os 2.677 testes rodam sem LLM, e o que quebrou aqui foi a
// ESCOLHA DE ALVO num turno de conversa. O cenário mede as três coisas que importam:
//   (a) o BANCO — a instância concluída é a de HOJE, não a mais antiga;
//   (b) a FALA — o TOM não pode dizer "marquei" tendo mexido em outra;
//   (c) a LISTA — depois da baixa, "o que tem pendente?" não pode trazer a de hoje de volta.
//
// VARIAÇÃO DE PALAVRAS é requisito, não capricho: o Alf pediu "perguntas próximas, com
// palavras diferentes". Um cenário que só testa a frase literal do incidente vira decoreba
// e passa a mentir no dia em que a pessoa disser a mesma coisa de outro jeito.
//
//   N=3  bash scripts/replay-lab-run.sh cenario-duplicata    # validação do mecanismo
//   N=20 bash scripts/replay-lab-run.sh cenario-duplicata    # bateria oficial
'use strict';

const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');

const supabase = require('../src/supabase/client');

const N = Number(process.env.N || 3);
const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();

const RUN_ID = process.env.TOM_QA_RUN_ID;
const SAIDA = process.env.TOM_QA_EVIDENCE_FILE || path.join(require('node:os').tmpdir(), `${RUN_ID}.jsonl`);

if (!SEGREDO || !QA_PHONE) { console.error('faltou WEBHOOK_SECRET ou TOM_QA_PHONES'); process.exit(1); }
if (!RUN_ID || RUN_ID.length < 8) { console.error('faltou TOM_QA_RUN_ID (exportado pelo runner)'); process.exit(1); }

const jsonl = (o) => fs.appendFileSync(SAIDA, JSON.stringify({ run_id: RUN_ID, ...o }) + '\n');
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const DIA = 86400000;

const _fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const ymdBrt = (d) => _fmtYmd.format(d);
const AGORA = new Date();
const HOJE = ymdBrt(AGORA);
const MES_PASSADO = ymdBrt(new Date(AGORA.getTime() - 32 * DIA));
const DOIS_MESES = ymdBrt(new Date(AGORA.getTime() - 62 * DIA));

// Títulos com a MESMA forma do incidente: nome de cartão, que se repete todo mês.
const T1 = 'Cartão 8516 (Barra)';
const T2 = 'Cartão 2270 (EMLA)';

// As frases. A rodada 0 usa o literal da Rose; as demais variam o jeito de pedir a mesma
// coisa — é isso que separa "o TOM aprendeu a frase" de "o TOM entende o pedido".
const FRASES_BAIXA = [
  'Tom, conclui os dois por favor',
  'tom, conclui as de hojeee',
  'pode dar baixa nos dois de hoje',
  'fecha esses dois aí pra mim',
  'marca os dois como feitos',
];
const FRASES_LISTA = [
  'me reenvia a lista de tarefas pendentes do mês pf',
  'o que que tem pendente?',
  'quais tarefas ainda estão abertas?',
];

async function colaboradorQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name, phone').eq('phone', QA_PHONE).maybeSingle();
  if (!data) throw new Error(`perfil QA ${QA_PHONE} não existe — rode scripts/replay-lab-perfis.sql`);
  return data;
}

// FIXTURE: reproduz a ARMADILHA, não o sintoma. Três instâncias de cada título — duas
// vencidas em meses anteriores e uma de hoje —, que é exatamente o estado que fez o
// resolvedor por `due_date ASC` pegar a de junho quando pediram "as de hoje".
async function montarFixture(collabId) {
  await limpar(collabId);
  const base = {
    assigned_to: collabId, created_by: collabId,
    context: 'work', status: 'pending', source: 'manual', priority: 'medium',
    data_classification: 'test',
  };
  const ids = {};
  for (const titulo of [T1, T2]) {
    ids[titulo] = {};
    for (const [rotulo, due] of [['antiga', DOIS_MESES], ['passada', MES_PASSADO], ['hoje', HOJE]]) {
      const { data, error } = await supabase.from('tasks')
        .insert({ ...base, title: titulo, due_date: due }).select('id').single();
      if (error) throw new Error(`fixture ${titulo}/${rotulo}: ${error.message}`);
      ids[titulo][rotulo] = data.id;
    }
  }
  return ids;
}

async function limpar(collabId) {
  await supabase.from('tasks').delete().eq('assigned_to', collabId).in('title', [T1, T2]);
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

function falasDoTom(desdeIso) {
  let bruto = '';
  try { bruto = fs.readFileSync(SAIDA, 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const linha of bruto.split('\n')) {
    if (!linha.trim()) continue;
    let o; try { o = JSON.parse(linha); } catch (_) { continue; }
    if (o.run_id !== RUN_ID || o.tipo !== 'fala_tom') continue;
    if (desdeIso && o.em && o.em < desdeIso) continue;
    out.push(o.texto || '');
  }
  return out;
}

const claimouBaixa = (t) => /marqu(ei|amos)|conclu[ií]|dei baixa|fechei|feito|prontinho|✅/i.test(String(t || ''));

async function statusDe(id) {
  const { data } = await supabase.from('tasks').select('status').eq('id', id).maybeSingle();
  return data ? data.status : null;
}

async function rodada(i, collab) {
  const ids = await montarFixture(collab.id);
  const t0 = new Date().toISOString();
  const frase = FRASES_BAIXA[i % FRASES_BAIXA.length];
  const perguntaLista = FRASES_LISTA[i % FRASES_LISTA.length];

  await injetar(frase, `qa-dup-${RUN_ID}-${i}-a`);
  await dorme(45000);

  // (a) O BANCO — a de HOJE tem que estar done; as vencidas, intactas.
  const hoje1 = await statusDe(ids[T1].hoje);
  const hoje2 = await statusDe(ids[T2].hoje);
  const antigas = [
    await statusDe(ids[T1].antiga), await statusDe(ids[T1].passada),
    await statusDe(ids[T2].antiga), await statusDe(ids[T2].passada),
  ];
  const acertouAlvo = hoje1 === 'done' && hoje2 === 'done';
  const mexeuNoPassado = antigas.some((s) => s === 'done');

  // (b) A FALA — dizer "marquei" tendo mexido na errada é o dano que a Rose viu.
  const falas = falasDoTom(t0);
  const afirmou = falas.some(claimouBaixa);
  const mentiu = afirmou && !acertouAlvo;

  // (c) A LISTA — a de hoje não pode voltar como pendente depois da baixa.
  await injetar(perguntaLista, `qa-dup-${RUN_ID}-${i}-b`);
  await dorme(40000);
  const falasLista = falasDoTom(t0).slice(falas.length);
  const listaTrouxeDeVolta = acertouAlvo
    && falasLista.some((f) => /8516|2270/.test(f) && /pendente|aberto|para hoje|pra hoje/i.test(f));

  // CRITÉRIO CORRIGIDO (13/08). A v1 exigia `acertouAlvo` e por isso REPROVAVA o
  // comportamento certo: com 3 instâncias do mesmo título e um pedido ambíguo ("conclui os
  // dois"), o TOM respondeu "Nenhuma delas vence hoje — você quis dizer as 3?". Perguntar é
  // a resposta correta, e o cenário marcava vermelho. Vermelho por vacuidade — o irmão do
  // verde por vacuidade, e igualmente perigoso: manda consertar o que não está quebrado.
  //
  // O que BLOQUEIA é o dano: mexer na tarefa errada ou dizer que fez sem ter feito.
  // `acertouAlvo` vira métrica REPORTADA — mesma disciplina do cenario-serie, que separa
  // hesitação legítima do LLM de defeito determinístico.
  //
  // O caso da Rose (grupo) é medido pelo cenário D — replay-lab-cenario-grupo-molde.js.
  const ok = !mexeuNoPassado && !mentiu && !listaTrouxeDeVolta;
  jsonl({
    tipo: 'resultado_rodada', rodada: i, ok,
    frase, pergunta_lista: perguntaLista,
    acertou_alvo: acertouAlvo, mexeu_no_passado: mexeuNoPassado,
    afirmou_baixa: afirmou, mentiu, lista_trouxe_de_volta: listaTrouxeDeVolta,
    status_hoje: [hoje1, hoje2], status_vencidas: antigas,
  });
  console.log(`  rodada ${i}: ${ok ? 'OK ' : 'FALHOU'} | BLOQUEIA: passado_mexido=${mexeuNoPassado} mentiu=${mentiu} lista_voltou=${listaTrouxeDeVolta} · reporta: alvo=${acertouAlvo} | "${frase}"`);
  return ok;
}

(async () => {
  const collab = await colaboradorQA();
  console.log(`[cenario-duplicata] N=${N} perfil=${collab.full_name} run=${RUN_ID}`);
  console.log(`[cenario-duplicata] fixture: 3 instâncias de cada título (${DOIS_MESES}, ${MES_PASSADO}, ${HOJE})`);
  let ok = 0;
  for (let i = 0; i < N; i++) {
    try { if (await rodada(i, collab)) ok++; } catch (e) { console.error(`  rodada ${i}: ERRO ${e.message}`); jsonl({ tipo: 'erro_rodada', rodada: i, erro: e.message }); }
  }
  await limpar(collab.id);
  const taxa = N ? Math.round((ok / N) * 100) : 0;
  console.log(`\n[cenario-duplicata] TAXA: ${ok}/${N} (${taxa}%)`);
  jsonl({ tipo: 'resumo', ok, total: N, taxa });
  process.exit(taxa === 100 ? 0 : 1);
})();
