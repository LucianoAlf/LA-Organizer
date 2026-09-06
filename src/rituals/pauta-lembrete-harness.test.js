'use strict';
// Harness do BLOCO do lembrete de hora em hora (09:00-19:00) dentro do dispatcher.
//
// POR QUE ELE EXISTE. A decisao de TEXTO mora em src/services/anamnese-pauta.js e a de LEITURA em
// src/rituals/anamnese-pauta.js, as duas com teste de unidade. O que NAO e alcancavel por elas e
// justamente o que manda uma mensagem pra um grupo REAL de WhatsApp: a chave de idempotencia por
// unidade E por hora, a regra de so cobrar depois que a abertura da unidade saiu, a guarda de
// duplicata por conteudo e o try/catch por unidade. Isso so existe dentro de um `if` no meio de
// um arquivo de 7100 linhas.
//
// COMO ELE FUNCIONA. Le o dispatcher instalado, RECORTA o bloco VERBATIM (por ancoras, sem
// copia-lo pra ca) e roda esse mesmo texto contra fakes. Uma copia do bloco aqui dentro nasceria
// desatualizada no primeiro dia em que alguem mexesse no original.
//
// NAO TOCA O BANCO e NAO POSTA EM GRUPO NENHUM: o `require` visto pelo bloco e interceptado e
// todo modulo real vira fake.
//
// RODAR SO ELE:  node --test src/rituals/pauta-lembrete-harness.test.js

const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test } = require('node:test');

const DISPATCHER = path.join(__dirname, 'dispatcher.js');

// Mesma mecanica de recorte do harness da atualizacao (pauta-refresh-harness.test.js): ancora de
// INICIO tem que casar UMA vez — duas linhas iguais fariam o harness provar um trecho que nao e o
// que roda as 09:00, e ele ficaria verde.
function acharUnica(linhas, pred, nome) {
  const casos = [];
  for (let i = 0; i < linhas.length; i += 1) if (pred(linhas[i], i)) casos.push(i);
  if (!casos.length) throw new Error(`[harness] nao achei "${nome}" em dispatcher.js`);
  if (casos.length > 1) {
    throw new Error(`[harness] a ancora "${nome}" casou ${casos.length} vezes em dispatcher.js `
      + `(linhas ${casos.map((i) => i + 1).join(', ')}) — ancora ambigua nao prova nada`);
  }
  return casos[0];
}

function recortar(linhas, { de, ate, nome }) {
  const ini = acharUnica(linhas, de, `inicio de ${nome}`);
  const fim = linhas.findIndex((l, i) => i > ini && ate(l));
  if (fim < 0) throw new Error(`[harness] nao achei o fim de "${nome}" em dispatcher.js`);
  return linhas.slice(ini, fim + 1).join('\n');
}

const LINHAS = fs.readFileSync(DISPATCHER, 'utf8').split('\n');

// timeToSlot e a lista dos horarios saem do arquivo REAL, nunca redigitados.
const fnTimeToSlot = recortar(LINHAS, {
  nome: 'timeToSlot',
  de: (l) => l === 'function timeToSlot(t) {',
  ate: (l) => l === '}',
});
const linhaHorarios = LINHAS[acharUnica(LINHAS,
  (l) => l.startsWith('const PAUTA_ANAMNESE_LEMBRETE_TIMES ='), 'PAUTA_ANAMNESE_LEMBRETE_TIMES')];

// A tabela de quem fala UMA VEZ POR DIA sai do arquivo REAL pelo mesmo motivo dos horarios: uma
// copia aqui ficaria verde no dia em que o dono trocasse a hora da Barra la e ninguem lembrasse
// deste arquivo.
const linhaUnicoPorUnidade = LINHAS[acharUnica(LINHAS,
  (l) => l.startsWith('const PAUTA_ANAMNESE_LEMBRETE_UNICO_POR_UNIDADE ='), 'PAUTA_ANAMNESE_LEMBRETE_UNICO_POR_UNIDADE')];

const iBloco = acharUnica(LINHAS,
  (l) => l.startsWith('  const _pautaLembreteHora = PAUTA_ANAMNESE_LEMBRETE_TIMES'), 'inicio do bloco do lembrete');
const iCatch = acharUnica(LINHAS,
  (l) => l.includes('[Pauta] lembrete erro (fora do loop por unidade)'), 'catch externo do bloco do lembrete');
if (iCatch < iBloco) throw new Error('[harness] o catch externo aparece ANTES do inicio do bloco');
if (LINHAS[iCatch + 1] !== '  }') {
  throw new Error(`[harness] a linha apos o catch externo nao e o fecho do if: ${JSON.stringify(LINHAS[iCatch + 1])}`);
}
const BLOCO = LINHAS.slice(iBloco, iCatch + 2).join('\n');

// eslint-disable-next-line no-new-func
const { timeToSlot, PAUTA_ANAMNESE_LEMBRETE_TIMES, UNICO_REAL } = new Function(
  `${fnTimeToSlot}\n${linhaHorarios}\n${linhaUnicoPorUnidade}\nreturn { timeToSlot, PAUTA_ANAMNESE_LEMBRETE_TIMES, UNICO_REAL: PAUTA_ANAMNESE_LEMBRETE_UNICO_POR_UNIDADE };`,
)();

// eslint-disable-next-line no-new-func
const rodarBloco = new Function(
  'opts', 'now', 'slotNow', 'timeToSlot', 'supabase', 'require', 'PAUTA_ANAMNESE_LEMBRETE_TIMES',
  'PAUTA_ANAMNESE_LEMBRETE_UNICO_POR_UNIDADE',
  `return (async () => {\n${BLOCO}\n})();`,
);

// ── FAKES ───────────────────────────────────────────────────────────────────────────────────
const UNIDADES = ['u-recreio', 'u-barra', 'u-cg'];
const NOMES = { 'u-recreio': 'Recreio', 'u-barra': 'Barra', 'u-cg': 'Campo Grande' };
const YMD = '2026-09-04';
// Os dois textos abaixo sao FIXTURES no formato real (arrumacao de 04/09: separado por horario,
// pendencia em negrito). Nao precisam bater byte a byte com o modulo puro — quem trava a copy e
// services/anamnese-pauta.test.js — mas ficam no formato de verdade de proposito: um fixture com
// cara antiga faria alguem ler este arquivo e achar que o texto de producao ainda e aquele.
const TEXTO = (hora) => `⏰ *Próxima hora — ${hora}*\n· Ana (Canto) — *anamnese*`;
// O texto da RECUPERACAO: cabecalho de FAIXA, blocos por hora abaixo dele. Ele existe aqui porque
// a guarda de duplicata do bloco casa pelo PRIMEIRO caractere ate o fim da primeira linha — se o
// cabecalho novo nao for visto por ela, a faixa sai duas vezes num grupo real de WhatsApp. Repare
// que o agrupamento comeca DEPOIS da primeira linha: e isso que mantem a guarda enxergando.
// A pendencia dos dois e *anamnese*: desde a reversao de 04/09 (CONTRATO_NA_PAUTA, em
// services/anamnese-pauta.js) o lembrete nao cobra contrato, e um fixture com "*contrato*" aqui
// faria quem le este arquivo achar que o texto de producao ainda cobra.
const TEXTO_RECUP = (hora) => `⏰ *Do começo do dia até as ${hora}*\n`
  + `\n🕗 *08:00*\n· Ana (Canto) — *anamnese*\n`
  + `\n🕘 *09:00*\n· Bento (Violão) — *anamnese*`;

async function semBarulho(fn, saida) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capturar = (nivel) => (...args) => saida.push(`${nivel} ${args.join(' ')}`);
  console.log = capturar('log'); console.warn = capturar('warn'); console.error = capturar('error');
  try { return await fn(); } finally { Object.assign(console, original); }
}

// `marcadores` e `mensagens` sao o estado que atravessa ticks — o papel do marker_logs e do
// group_chat_messages em producao. Passar os MESMOS arrays pra varios ticks e o que reproduz o
// cron batendo o mesmo slot 3x.
function mundo({
  marcadores = null, mensagens = [], abertura = UNIDADES, resultado = null, explode = null,
  unidades = UNIDADES, erroMensagemJaEnviada = null,
  // O DEFAULT e "a recuperacao do dia JA aconteceu": os cenarios de idempotencia, guarda e falha
  // abaixo sao sobre o comportamento de REGIME, que continua sendo o de sempre (so a proxima
  // hora). Quem exercita a PRIMEIRA passada do dia passa recuperacaoFeita:false — sao os testes
  // do fim do arquivo.
  recuperacaoFeita = true, erroEnvioMensagem = null, erroChecagemRecuperacao = null,
  // A CADENCIA POR UNIDADE (06/09). O default e a tabela REAL do dispatcher — os cenarios de
  // cadencia no fim do arquivo provam o que o dono pediu sem redigitar hora nenhuma. Os
  // cenarios de MECANISMO (idempotencia, abertura, guarda de duplicata, try/catch, recuperacao)
  // passam `{}`: eles falam do caminho de hora em hora, que e o modo real do Recreio, e
  // precisam das tres unidades falando no mesmo slot pra provar isolamento entre elas.
  unicoPorUnidade = UNICO_REAL,
} = {}) {
  // Abertura de cada unidade ja registrada: e a prova, em marker_logs, de que a pauta do dia saiu
  // no grupo. Sem ela o lembrete nao pode cobrar (Campo Grande abre as 10:00).
  // O sufixo do marcador da abertura perdeu o `contrato=N` com a reversao de 04/09 — o fixture
  // acompanha. Quem casa aqui e o PREFIXO (`pauta_fala:<u>:<ymd>`), entao o sufixo e so honestidade.
  const logs = marcadores || abertura.map((u) => ({ result: 'executed', reason: `pauta_fala:${u}:${YMD} itens=4` }));
  if (recuperacaoFeita) {
    for (const u of unidades) logs.push({ result: 'executed', reason: `pauta_lembrete_recup:${u}:${YMD} faixa ate 09:00 coberta` });
  }
  const chamadas = [];
  const inseridos = [];
  const enviadas = [];
  const console_ = [];

  const resolver = (q) => {
    if (q.tabela === 'work_groups') return { data: { id: `grp-${q.eq.la_report_unidade_id}` }, error: null };
    if (q.tabela === 'marker_logs' && q.op === 'insert') {
      // marker_logs.result so aceita executed|rejected|skipped|fallback — o fake recusa o resto,
      // senao um bug de mapeamento passaria batido aqui e estouraria no banco de producao.
      assert.ok(['executed', 'rejected', 'skipped', 'fallback'].includes(q.dados.result),
        `result invalido gravado em marker_logs: ${q.dados.result}`);
      assert.ok(q.dados.reason.length <= 120, `reason acima de 120 chars: ${q.dados.reason.length}`);
      logs.push(q.dados); inseridos.push(q.dados);
      return { error: null };
    }
    if (q.tabela === 'marker_logs' && q.op === 'select') {
      const prefixo = String(q.like || '').replace(/%$/, '');
      if (erroChecagemRecuperacao && prefixo.startsWith('pauta_lembrete_recup:')) {
        return { data: null, error: { message: erroChecagemRecuperacao } };
      }
      const achou = logs.some((m) => String(m.reason).startsWith(prefixo)
        && ['executed', 'skipped'].includes(m.result));
      return { data: achou ? [{ id: 1 }] : [], error: null };
    }
    if (q.tabela === 'group_chat_messages' && q.op === 'select') {
      if (erroMensagemJaEnviada) return { data: null, error: { message: erroMensagemJaEnviada } };
      const prefixo = String(q.like || '').replace(/%$/, '');
      const achou = mensagens.some((m) => m.group_id === q.eq.group_id && String(m.content).startsWith(prefixo));
      return { data: achou ? [{ id: 1 }] : [], error: null };
    }
    if (q.tabela === 'group_chat_messages' && q.op === 'insert') {
      if (erroEnvioMensagem) return { error: { message: erroEnvioMensagem } };
      mensagens.push(q.dados); enviadas.push(q.dados);
      return { error: null };
    }
    throw new Error(`[harness] consulta nao prevista: ${q.tabela}/${q.op}`);
  };

  const supabase = {
    from(tabela) {
      const q = { tabela, op: null, like: null, dados: null, eq: {} };
      const chain = {
        select() { q.op = 'select'; return chain; },
        insert(row) { q.op = 'insert'; q.dados = row; return chain; },
        eq(col, val) { q.eq[col] = val; return chain; },
        not() { return chain; },
        in() { return chain; },
        gte() { return chain; },
        like(_col, val) { q.like = val; return chain; },
        limit() { return chain; },
        order() { return chain; },
        maybeSingle() { return chain; },
        then(ok, err) { return Promise.resolve().then(() => resolver(q)).then(ok, err); },
      };
      return chain;
    },
  };

  const requireFake = (nome) => {
    if (nome === './anamnese-pauta') {
      return {
        lembreteDaProximaHora: async ({ unidadeId, hora, recuperacao }) => {
          // A terceira posicao e o flag da recuperacao: e o que o bloco DECIDE, e por isso o que
          // os testes olham. Os cenarios antigos so leem [0] e [1] e nao mudaram de significado.
          chamadas.push([unidadeId, hora, !!recuperacao]);
          if (unidadeId === explode) throw new Error('dado ruim so desta unidade');
          if (resultado) return resultado(unidadeId, hora, !!recuperacao);
          return {
            texto: recuperacao ? TEXTO_RECUP(hora) : TEXTO(hora),
            alunos: [{ pessoa: { nome: 'Ana' } }], motivo: null,
          };
        },
      };
    }
    if (nome === '../services/situacao-aluno') {
      return { UNIDADES_IDS: unidades, nomeDaUnidade: (id) => NOMES[id] || id };
    }
    if (nome === '../services/la-report-client') return { laReportClient: {} };
    throw new Error(`[harness] o bloco pediu um modulo que o harness nao conhece: ${nome}`);
  };

  const tick = (hhmm, minuto = 0) => {
    const [h, m] = hhmm.split(':').map(Number);
    const now = { ymd: YMD, hour: h, minute: m + minuto, dow: 5 };
    const slotNow = h * 60 + Math.floor((m + minuto) / 15) * 15;
    return semBarulho(
      () => rodarBloco({ force: null }, now, slotNow, timeToSlot, supabase, requireFake, PAUTA_ANAMNESE_LEMBRETE_TIMES, unicoPorUnidade),
      console_,
    );
  };

  return { chamadas, inseridos, enviadas, mensagens, marcadores: logs, console: console_, tick };
}

// ── CENARIOS ────────────────────────────────────────────────────────────────────────────────
const contar = (arr, u) => arr.filter((x) => x[0] === u).length;

test('bloco do lembrete: cada tick fala da PROXIMA hora (as 09:00 fala das 10:00, as 19:00 das 20:00)', async () => {
  const w = mundo({ unicoPorUnidade: {} });
  await w.tick('09:00');
  assert.ok(w.chamadas.every(([, hora]) => hora === '10:00'), `esperava 10:00, veio ${JSON.stringify(w.chamadas)}`);
  assert.ok(w.enviadas.every((m) => m.content.startsWith('⏰ *Próxima hora — 10:00*')));
  const w2 = mundo({ unicoPorUnidade: {} });
  await w2.tick('19:00');
  assert.ok(w2.chamadas.every(([, hora]) => hora === '20:00'), 'a ultima aula do dia e as 20:00');
});

test('bloco do lembrete: 3 ticks do MESMO slot mandam UMA mensagem por unidade, nao 3', async () => {
  const w = mundo({ unicoPorUnidade: {} });
  await w.tick('15:00', 0);
  await w.tick('15:00', 5);
  await w.tick('15:00', 10);
  assert.strictEqual(w.enviadas.length, 3, 'uma por unidade — o cron bate o slot 3x');
  for (const u of UNIDADES) assert.strictEqual(contar(w.chamadas, u), 1, `${NOMES[u]} falou mais de uma vez no mesmo slot`);
});

test('bloco do lembrete: os 11 slots disparam — e so eles', async () => {
  const w = mundo({ unicoPorUnidade: {} });
  assert.strictEqual(PAUTA_ANAMNESE_LEMBRETE_TIMES.length, 11, '09:00 as 19:00, de hora em hora');
  for (const h of PAUTA_ANAMNESE_LEMBRETE_TIMES) await w.tick(h);
  assert.strictEqual(w.enviadas.length, 33, '11 slots x 3 unidades');
  const w2 = mundo({ unicoPorUnidade: {} });
  await w2.tick('08:00');   // antes do primeiro slot
  await w2.tick('20:00');   // depois do ultimo
  await w2.tick('09:30');   // meio de hora nao e slot
  assert.deepStrictEqual(w2.chamadas, [], 'o bloco rodou num horario que nao e slot de lembrete');
  assert.deepStrictEqual(w2.enviadas, []);
});

test('bloco do lembrete: unidade SEM a mensagem de abertura fica quieta — e deixa rastro', async () => {
  // Campo Grande abre as 10:00: as 09:00 ela nao pode ser cobrada sem ter recebido a pauta do dia.
  const w = mundo({ unicoPorUnidade: {}, abertura: ['u-recreio', 'u-barra'] });
  await w.tick('09:00');
  assert.strictEqual(w.enviadas.length, 2, 'so as duas que ja abriram');
  assert.ok(!w.enviadas.some((m) => m.group_id === 'grp-u-cg'));
  assert.deepStrictEqual(w.chamadas.map(([u]) => u), ['u-recreio', 'u-barra'],
    'a unidade sem abertura nem chega a gastar a RPC de 6-8s');
  const doCG = w.inseridos.find((m) => m.reason.includes('u-cg'));
  assert.ok(doCG, 'ficar quieta nao pode ser indistinguivel de nao ter rodado');
  assert.strictEqual(doCG.result, 'skipped', 'desfecho RESOLVIDO deste slot, nao falha');
  assert.match(doCG.reason, /abertura/i);
});

test('bloco do lembrete: hora sem ninguem pendente NAO manda mensagem, mas deixa rastro (zero por saude)', async () => {
  const w = mundo({ unicoPorUnidade: {}, resultado: () => ({ texto: null, alunos: [], motivo: null }) });
  await w.tick('13:00');
  assert.deepStrictEqual(w.enviadas, [], 'silencio ali e noticia boa, nao mensagem vazia');
  assert.strictEqual(w.inseridos.length, 3);
  assert.ok(w.inseridos.every((m) => m.result === 'skipped'), 'rodou e nao tinha ninguem: desfecho resolvido');
  assert.ok(w.inseridos.every((m) => !/erro=/.test(m.reason)), 'zero por SAUDE nao pode sair com cara de zero por FALHA');
  assert.ok(w.inseridos.every((m) => /ninguem/i.test(m.reason)), `o rastro precisa dizer o que aconteceu: ${w.inseridos[0].reason}`);
  const antes = w.chamadas.length;
  await w.tick('13:00', 5);
  assert.strictEqual(w.chamadas.length, antes, 'skipped trava o slot — 3 RPCs de 6-8s por slot seria desperdicio puro');
});

test('bloco do lembrete: fonte fora do ar NAO fala, diz por que, e NAO trava o slot', async () => {
  const w = mundo({ unicoPorUnidade: {}, resultado: () => ({ texto: null, alunos: [], motivo: 'fonte fora no lembrete: timeout' }) });
  await w.tick('11:00');
  assert.deepStrictEqual(w.enviadas, [], 'nunca "ninguem pendente" quando nao deu pra apurar');
  assert.ok(w.inseridos.every((m) => m.result === 'fallback'), 'falha nao pode travar a chave do slot');
  assert.ok(w.inseridos.every((m) => /erro=fonte fora/.test(m.reason)), `o motivo precisa chegar no reason: ${w.inseridos[0].reason}`);
  const antes = w.chamadas.length;
  await w.tick('11:00', 5);
  assert.strictEqual(w.chamadas.length, antes + 3, 'fallback deixa o proximo tick tentar de novo');
});

test('bloco do lembrete: o MESMO lembrete nao sai duas vezes no mesmo slot, nem se o marcador falhar', async () => {
  // O pior desfecho desta feature: a mensagem entra no grupo REAL e o marker_logs falha logo
  // depois. A guarda olha o ARTEFATO (o conteudo ja no grupo), nao o registro sobre ele.
  const mensagens = [{ group_id: 'grp-u-barra', content: `${TEXTO('16:00')}`, role: 'tom' }];
  const w = mundo({ unicoPorUnidade: {}, mensagens });
  await w.tick('15:00');
  const daBarra = w.enviadas.filter((m) => m.group_id === 'grp-u-barra');
  assert.deepStrictEqual(daBarra, [], 'a mensagem ja estava no grupo — nao pode sair de novo');
  const marcador = w.inseridos.find((m) => m.reason.includes('u-barra'));
  assert.strictEqual(marcador.result, 'skipped', 'so fecha o marcador que faltou');
  assert.strictEqual(w.enviadas.length, 2, 'as outras duas unidades falam normalmente');
});

test('bloco do lembrete: cabecalho de OUTRA hora no grupo nao bloqueia o lembrete desta hora', async () => {
  const mensagens = [{ group_id: 'grp-u-barra', content: TEXTO('11:00'), role: 'tom' }];
  const w = mundo({ unicoPorUnidade: {}, mensagens });
  await w.tick('15:00');
  assert.strictEqual(w.enviadas.length, 3, 'a guarda casa por HORA — senao o lembrete das 16:00 nunca sairia');
});

test('bloco do lembrete: checagem de duplicata que falha NAO arrisca falar no escuro', async () => {
  const w = mundo({ unicoPorUnidade: {}, erroMensagemJaEnviada: 'PostgREST caiu' });
  await w.tick('15:00');
  assert.deepStrictEqual(w.enviadas, [], 'falar duas vezes num grupo real e o pior desfecho');
  assert.ok(w.inseridos.every((m) => m.result === 'fallback'), 'o proximo tick tenta de novo com a leitura corrigida');
});

test('bloco do lembrete: throw numa unidade NAO mata as outras duas no mesmo tick', async () => {
  const w = mundo({ unicoPorUnidade: {}, explode: 'u-barra' });
  await w.tick('17:00');
  assert.deepStrictEqual(w.chamadas.map(([u]) => u), UNIDADES, 'as tres precisam ser tentadas, na ordem');
  assert.strictEqual(w.enviadas.length, 2);
  assert.ok(!w.enviadas.some((m) => m.group_id === 'grp-u-barra'));
  // e a que estourou volta no tick seguinte do mesmo slot; as outras nao
  const antes = w.chamadas.length;
  await w.tick('17:00', 5);
  assert.deepStrictEqual(w.chamadas.slice(antes).map(([u]) => u), ['u-barra']);
});

// ── O QUE O AUDITOR VE EM marker_logs ───────────────────────────────────────────────────────
// O reason e cortado em 120 caracteres e a chave (com uuid de unidade REAL) ja gasta 68 deles. As
// unidades fake acima tem id curto e escondem esse aperto.
const UUID_UNIDADE = '11111111-2222-3333-4444-555555555555';
const CHAVE_ESPERADA = `pauta_lembrete:${UUID_UNIDADE}:${YMD}:16:00`;

test('bloco do lembrete: a chave de idempotencia sobrevive INTACTA ao corte de 120 chars', async () => {
  const w = mundo({
    unidades: [UUID_UNIDADE],
    marcadores: [{ result: 'executed', reason: `pauta_fala:${UUID_UNIDADE}:${YMD} itens=4` }],
    resultado: () => ({ texto: null, alunos: [], motivo: 'X'.repeat(400) }),
  });
  await w.tick('15:00');
  const { reason } = w.inseridos[0];
  assert.strictEqual(reason.length, 120, 'o corte do dispatcher e em 120');
  assert.strictEqual(reason.slice(0, CHAVE_ESPERADA.length), CHAVE_ESPERADA,
    'a chave por unidade E por hora nao pode ser tocada pelo corte — e ela que impede o reenvio');
  assert.strictEqual(CHAVE_ESPERADA.length, 68, 'a chave com uuid real gasta 68 dos 120 caracteres');
  const sobra = reason.length - (reason.indexOf(' erro=') + ' erro='.length);
  assert.ok(sobra >= 40, `sobram ${sobra} chars pro motivo — o sensor da fonte tem que caber ai`);
});

test('bloco do lembrete: no dispatcher instalado, o lembrete vem DEPOIS da fala da manha', async () => {
  const iFala = acharUnica(LINHAS,
    (l) => l.startsWith("  if (opts.force === 'pauta_anamnese_fala'"), 'bloco da fala');
  const iLembrete = acharUnica(LINHAS,
    (l) => l.startsWith("  if (opts.force === 'pauta_anamnese_lembrete'"), 'bloco do lembrete');
  assert.ok(iFala < iLembrete,
    `as 09:00 os dois caem no mesmo slot: a Barra tem que RECEBER a pauta do dia antes de ser cobrada `
    + `(fala=${iFala + 1}, lembrete=${iLembrete + 1})`);
});

test('bloco do lembrete: o force novo esta na lista fixa do guard — senao nunca chega no bloco', () => {
  const iGuard = acharUnica(LINHAS,
    (l) => l.startsWith('  if (opts.force && opts.force !=='), 'guard de force do dispatcher');
  assert.ok(LINHAS[iGuard].includes("opts.force !== 'pauta_anamnese_lembrete'"),
    'o guard filtra por lista fixa: force que nao esta nela morre antes de chegar aqui');
});

test('bloco do lembrete: o harness nao toca o banco — nenhum node_modules foi carregado', () => {
  const deFora = Object.keys(require.cache).filter((k) => k.includes('node_modules'));
  assert.deepStrictEqual(deFora, [],
    `qualquer client aqui vira conexao com PRODUCAO a cada rodada de teste (${deFora.join(', ')})`);
});

test('bloco do lembrete: o harness nao vaza log na suite — o rastro do bloco fica capturado', async () => {
  const w = mundo({ unicoPorUnidade: {}, explode: 'u-barra' });
  await w.tick('09:00');
  assert.ok(w.console.length > 0, 'o bloco fala mesmo — e esse rastro que salva a depuracao em producao');
  assert.ok(w.console.every((l) => l.startsWith('log ') || l.startsWith('warn ') || l.startsWith('error ')));
});

// ── O PRIMEIRO LEMBRETE DO DIA E DE RECUPERACAO ─────────────────────────────────────────────
// Cada lembrete fala da hora SEGUINTE — entao quem tem aula na hora em que a unidade ABRE nunca
// aparecia em lembrete nenhum: 25 aulas por semana invisiveis, medido na fonte. Na primeira
// passada do dia de cada unidade a mensagem cobre do comeco do dia ate o fim da hora seguinte; da
// segunda em diante volta a ser so a proxima hora. A escolha e do BLOCO — ele e quem tem o
// marker_logs — e por isso so este harness alcanca.

test('recuperacao: o PRIMEIRO lembrete do dia cobre a faixa; do segundo em diante, so a proxima hora', async () => {
  const w = mundo({ unicoPorUnidade: {}, recuperacaoFeita: false });
  await w.tick('09:00');
  assert.deepStrictEqual(w.chamadas, UNIDADES.map((u) => [u, '10:00', true]));
  assert.ok(w.enviadas.every((m) => m.content.startsWith('⏰ *Do começo do dia até as 10:00*')),
    `cabecalho da primeira mensagem: ${JSON.stringify(w.enviadas.map((m) => m.content.split('\n')[0]))}`);
  const antes = w.chamadas.length;
  await w.tick('10:00');
  assert.deepStrictEqual(w.chamadas.slice(antes), UNIDADES.map((u) => [u, '11:00', false]),
    'a mesma gente 11 vezes e o ruido que este lembrete existe pra evitar');
  assert.ok(w.enviadas.slice(3).every((m) => m.content.startsWith('⏰ *Próxima hora — 11:00*')));
});

test('recuperacao: a unidade que abre mais tarde faz a faixa DELA, na primeira hora dela', async () => {
  // Campo Grande abre as 10:00: as 09:00 ela grava 'skipped' com a chave do lembrete daquela
  // hora. Esse marcador NAO pode aposentar a recuperacao dela — senao a unidade que abre por
  // ultimo seria justamente a que ficaria sem, que e o bug ao contrario.
  const w = mundo({ unicoPorUnidade: {}, recuperacaoFeita: false, abertura: ['u-recreio', 'u-barra'] });
  await w.tick('09:00');
  assert.deepStrictEqual(w.chamadas, [['u-recreio', '10:00', true], ['u-barra', '10:00', true]]);
  w.marcadores.push({ result: 'executed', reason: `pauta_fala:u-cg:${YMD} itens=3` });
  const antes = w.chamadas.length;
  await w.tick('10:00');
  assert.deepStrictEqual(w.chamadas.slice(antes),
    [['u-recreio', '11:00', false], ['u-barra', '11:00', false], ['u-cg', '11:00', true]],
    'o Campo Grande faz a faixa dele quando abre; as outras duas ja fizeram a delas');
});

test('recuperacao: envio que falha NAO gasta a recuperacao — o proximo tick refaz a faixa inteira', async () => {
  const w = mundo({ unicoPorUnidade: {}, recuperacaoFeita: false, erroEnvioMensagem: 'PostgREST caiu' });
  await w.tick('09:00');
  assert.deepStrictEqual(w.enviadas, []);
  assert.ok(w.inseridos.every((m) => m.result === 'fallback'), 'falha nao trava a chave da hora');
  const antes = w.chamadas.length;
  await w.tick('09:00', 5);
  assert.deepStrictEqual(w.chamadas.slice(antes), UNIDADES.map((u) => [u, '10:00', true]),
    'um retry que virasse lembrete de uma hora so perderia exatamente quem a recuperacao existe pra pegar');
});

test('recuperacao: fonte fora do ar NAO gasta a recuperacao', async () => {
  const w = mundo({ unicoPorUnidade: {}, recuperacaoFeita: false, resultado: () => ({ texto: null, alunos: [], motivo: 'fonte fora: timeout' }) });
  await w.tick('11:00');
  assert.deepStrictEqual(w.enviadas, [], 'nunca "ninguem pendente" quando nao deu pra apurar');
  const antes = w.chamadas.length;
  await w.tick('11:00', 5);
  assert.ok(w.chamadas.slice(antes).every(([, , recup]) => recup === true),
    'a faixa continua devendo enquanto a fonte nao responder');
});

test('recuperacao: faixa sem ninguem pendente APOSENTA a recuperacao — rodou e nao tinha ninguem', async () => {
  const w = mundo({ unicoPorUnidade: {}, recuperacaoFeita: false, resultado: () => ({ texto: null, alunos: [], motivo: null }) });
  await w.tick('09:00');
  assert.deepStrictEqual(w.enviadas, [], 'silencio ali e noticia boa');
  assert.ok(w.inseridos.some((m) => /^pauta_lembrete_recup:/.test(m.reason)),
    'zero por SAUDE tambem precisa deixar rastro — senao a faixa sairia de novo toda hora');
  const antes = w.chamadas.length;
  await w.tick('10:00');
  assert.ok(w.chamadas.slice(antes).every(([, , recup]) => recup === false),
    'a faixa foi coberta: a hora seguinte volta ao comportamento normal');
});

test('recuperacao: a guarda de duplicata cobre o cabecalho NOVO', async () => {
  const mensagens = [{ group_id: 'grp-u-barra', content: TEXTO_RECUP('10:00'), role: 'tom' }];
  const w = mundo({ unicoPorUnidade: {}, recuperacaoFeita: false, mensagens });
  await w.tick('09:00');
  assert.deepStrictEqual(w.enviadas.filter((m) => m.group_id === 'grp-u-barra'), [],
    'a faixa ja estava no grupo — se a guarda nao enxergar o cabecalho novo, ela sai duas vezes');
  assert.strictEqual(w.enviadas.length, 2, 'as outras duas falam normalmente');
  const marcador = w.inseridos.find((m) => m.reason.includes('u-barra') && !/^pauta_lembrete_recup:/.test(m.reason));
  assert.strictEqual(marcador.result, 'skipped', 'so fecha o marcador que faltou');
  const antes = w.chamadas.length;
  await w.tick('10:00');
  const daBarra = w.chamadas.slice(antes).find(([u]) => u === 'u-barra');
  assert.strictEqual(daBarra[2], false, 'achar a faixa no grupo tambem aposenta a recuperacao');
});

test('recuperacao: checagem que falha NAO escolhe entre faixa e hora unica no escuro', async () => {
  const w = mundo({ unicoPorUnidade: {}, recuperacaoFeita: false, erroChecagemRecuperacao: 'PostgREST caiu' });
  await w.tick('09:00');
  assert.deepStrictEqual(w.enviadas, [],
    'no escuro, ou repete gente num grupo real ou deixa alguem invisivel de novo');
  assert.deepStrictEqual(w.chamadas, [], 'nem chega a gastar a RPC de 6-8s');
});

test('recuperacao: a chave propria nao colide com a do lembrete e cabe no corte de 120 chars', async () => {
  const w = mundo({
    unidades: [UUID_UNIDADE], recuperacaoFeita: false,
    marcadores: [{ result: 'executed', reason: `pauta_fala:${UUID_UNIDADE}:${YMD} itens=4` }],
  });
  await w.tick('15:00');
  const recup = w.inseridos.find((m) => /^pauta_lembrete_recup:/.test(m.reason));
  assert.ok(recup, 'sem o marcador da faixa, a recuperacao sairia em todo tick do dia');
  assert.ok(recup.reason.length <= 120, `reason acima de 120: ${recup.reason.length}`);
  assert.strictEqual(recup.result, 'executed');
  assert.ok(!recup.reason.startsWith(`pauta_lembrete:${UUID_UNIDADE}`),
    "'pauta_lembrete:' nao pode ser prefixo de 'pauta_lembrete_recup:' — as duas chaves sao lidas por LIKE de prefixo");
  assert.ok(!CHAVE_ESPERADA.startsWith('pauta_lembrete_recup:'));
});

// ── A CADENCIA POR UNIDADE (06/09) ───────────────────────────────────────────────────────────
// Pedido do time: "Recreio deixa do jeito que ta, de hora em hora. Barra so de manha, 9:00.
// Campo Grande as 13:00, so." Os cenarios daqui usam a tabela REAL do dispatcher (default do
// `mundo`) — nenhuma hora e redigitada, entao trocar a hora da Barra la muda o teste aqui.
test('cadencia: as 15:00 so o Recreio fala — Barra e Campo Grande ficam quietas', async () => {
  const w = mundo();
  await w.tick('15:00');
  assert.deepStrictEqual(w.enviadas.map((m) => m.group_id), ['grp-u-recreio'],
    'unidade de mensagem unica nao pode falar fora da hora dela');
});

test('cadencia: a Barra fala na hora dela, e o Campo Grande na dele', async () => {
  const manha = mundo();
  await manha.tick('09:00');
  assert.ok(manha.enviadas.some((m) => m.group_id === 'grp-u-barra'), 'a Barra nao falou as 09:00');
  const tarde = mundo();
  await tarde.tick('13:00');
  assert.ok(tarde.enviadas.some((m) => m.group_id === 'grp-u-cg'), 'o Campo Grande nao falou as 13:00');
  assert.ok(!tarde.enviadas.some((m) => m.group_id === 'grp-u-barra'), 'a Barra falou de novo a tarde');
});

test('cadencia: no dia inteiro sao 13 mensagens — 11 do Recreio, 1 da Barra, 1 do Campo Grande', async () => {
  const w = mundo();
  for (const h of PAUTA_ANAMNESE_LEMBRETE_TIMES) await w.tick(h);
  const porGrupo = (g) => w.enviadas.filter((m) => m.group_id === g).length;
  assert.strictEqual(porGrupo('grp-u-recreio'), PAUTA_ANAMNESE_LEMBRETE_TIMES.length);
  assert.strictEqual(porGrupo('grp-u-barra'), 1);
  assert.strictEqual(porGrupo('grp-u-cg'), 1);
});

test('cadencia: a unidade de mensagem unica NAO grava marcador nas horas em que nao fala', async () => {
  const w = mundo();
  await w.tick('15:00');
  // So os marcadores DESTE bloco: `pauta_fala:` e `pauta_lembrete_recup:` sao fixtures que o
  // `mundo` semeia, e contar fixture como escrita faria o teste passar por acidente.
  const escritosAgora = w.marcadores
    .map((m) => String(m.reason || ''))
    .filter((r) => r.startsWith('pauta_dia:u-barra') || r.startsWith('pauta_lembrete:u-barra'));
  assert.deepStrictEqual(escritosAgora, [],
    '10 linhas por dia por unidade so pra dizer "hoje ela nao fala nesta hora" e ruido, nao rastro');
});

test('cadencia: a chave da mensagem do dia nao carrega hora — 3 ticks da mesma hora mandam UMA', async () => {
  const w = mundo();
  await w.tick('09:00', 0);
  await w.tick('09:00', 5);
  await w.tick('09:00', 10);
  assert.strictEqual(w.enviadas.filter((m) => m.group_id === 'grp-u-barra').length, 1);
  const chaves = w.marcadores.map((m) => String(m.reason || '')).filter((r) => r.includes('u-barra'));
  assert.ok(chaves.some((r) => r.startsWith('pauta_dia:u-barra:')), `chave errada: ${JSON.stringify(chaves)}`);
});
