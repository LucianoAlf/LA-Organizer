'use strict';
// Harness do CAMINHO DE ENVIO do relatorio de FIM DE DIA dentro do dispatcher.
//
// POR QUE ELE EXISTE. O irmao dele (pauta-fimdia-harness.test.js) prova a AMARRA DE HORARIO — em
// que slot cada unidade relata. O que ele nao alcanca e o que aconteceu na Barra em 04/09, as
// 19:30: a leitura da fonte falhou por segundos, o ritual devolveu `motivo` e um texto degradado
// ("Nao consegui conferir o dia agora"), a mensagem degradada foi pro grupo REAL — e o marcador
// carimbou `executed ok=0 falta=0 semver=0`. Duas mentiras numa linha so: quem audita
// marker_logs nao distingue "zero por falha" de "zero por saude", e `executed` TRAVAVA a chave de
// idempotencia, entao nenhum tick seguinte tentou de novo e o relatorio do dia se perdeu por uma
// falha de segundos.
//
// SEGUNDA RODADA (04/09, a noite): so trocar o rotulo do marcador nao bastava. O bloco abria em
// UM slot de 15 min — quando a fonte voltou, dez minutos depois, nao havia mais tick nenhum
// olhando. Agora ele abre numa JANELA (da hora da unidade ate o teto) e quem decide se ainda ha o
// que fazer e a GUARDA DE CONTEUDO, nao o relogio. Os cenarios de janela, teto e "executed nao
// bloqueia" moram aqui embaixo.
//
// COMO ELE FUNCIONA. Le o dispatcher INSTALADO, recorta o bloco VERBATIM por ancoras e roda esse
// mesmo texto contra fakes — mesma mecanica de pauta-lembrete-harness.test.js. Uma copia do bloco
// aqui dentro nasceria desatualizada no primeiro dia em que alguem mexesse no original.
//
// NAO TOCA O BANCO e NAO POSTA EM GRUPO NENHUM: o `require` visto pelo bloco e interceptado. O
// UNICO modulo real que entra e o PURO (services/anamnese-pauta), de proposito: e dele que sai o
// texto degradado que a guarda de duplicata precisa reconhecer, e uma copia da frase aqui faria o
// teste ficar verde no dia em que o texto de producao mudasse e a guarda ficasse cega.
//
// RODAR SO ELE:  node --test src/rituals/pauta-fimdia-envio-harness.test.js

const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test } = require('node:test');

const pura = require('../services/anamnese-pauta');

const DISPATCHER = path.join(__dirname, 'dispatcher.js');
const FONTE = fs.readFileSync(DISPATCHER, 'utf8');
const LINHAS = FONTE.split('\n');

// Ancora de recorte tem que casar UMA vez: duas linhas iguais fariam o harness provar um trecho
// que nao e o que roda as 19:30 — e ele ficaria verde do mesmo jeito.
function acharUnica(pred, nome) {
  const casos = [];
  for (let i = 0; i < LINHAS.length; i += 1) if (pred(LINHAS[i], i)) casos.push(i);
  if (!casos.length) throw new Error(`[harness] nao achei "${nome}" em dispatcher.js`);
  if (casos.length > 1) {
    throw new Error(`[harness] a ancora "${nome}" casou ${casos.length} vezes `
      + `(linhas ${casos.map((i) => i + 1).join(', ')}) — ancora ambigua nao prova nada`);
  }
  return casos[0];
}

function recortarFuncao(nome) {
  const ini = acharUnica((l) => l === `function ${nome}(t) {`, nome);
  const fim = LINHAS.findIndex((l, i) => i > ini && l === '}');
  return LINHAS.slice(ini, fim + 1).join('\n');
}

const fnTimeToSlot = recortarFuncao('timeToSlot');

// O require do modulo puro e o dia da semana vem de CIMA do bloco (sao compartilhados com a fala
// da manha de proposito: dois calculos do dia da semana no mesmo tick poderiam divergir).
const iRequire = acharUnica((l) => l.startsWith('  const _pautaAbertura = require('), 'require do modulo puro');
const iDia = acharUnica((l) => l.startsWith('  const _pautaDiaSemana ='), 'dia da semana de hoje');
// As constantes de teto da insistencia, VERBATIM do arquivo. Ficam de fora do recorte do bloco
// (moram no topo do modulo), entao entram no preparo — e sao lidas por filtro, e nao por ancora
// obrigatoria, pra que a ausencia delas apareca como o teste de teto FALHANDO (que diz o que
// falta) e nao como um erro de recorte no carregamento do arquivo (que nao diz nada).
const LINHAS_TETO = LINHAS.filter((l) => /^const PAUTA_ANAMNESE_FIMDIA_(JANELA_MIN|TETO) = /.test(l));
const PREPARO = [...LINHAS_TETO, LINHAS[iRequire], LINHAS[iDia]].join('\n');

const iBloco = acharUnica((l) => l.startsWith('  const _pautaHorasFimDia ='), 'inicio do bloco de fim de dia');
const iCatch = acharUnica((l) => l.includes('[Pauta] fim de dia erro (fora do loop por unidade)'), 'catch externo do bloco');
if (iCatch < iBloco) throw new Error('[harness] o catch externo aparece ANTES do inicio do bloco');
if (LINHAS[iCatch + 1] !== '  }') {
  throw new Error(`[harness] a linha apos o catch externo nao e o fecho do if: ${JSON.stringify(LINHAS[iCatch + 1])}`);
}
const BLOCO = LINHAS.slice(iBloco, iCatch + 2).join('\n');

// eslint-disable-next-line no-new-func
const { timeToSlot } = new Function(`${fnTimeToSlot}\nreturn { timeToSlot };`)();

// eslint-disable-next-line no-new-func
const rodarBloco = new Function(
  'opts', 'now', 'slotNow', 'timeToSlot', 'supabase', 'require',
  `return (async () => {\n${PREPARO}\n${BLOCO}\n})();`,
);

// ── FAKES ───────────────────────────────────────────────────────────────────────────────────
const YMD = '2026-09-04';          // sexta — a Barra relata as 19:30
const YMD_SABADO = '2026-09-05';   // sabado — a Barra relata as 15:30
const DATA_BR = '04/09';
const UNIDADE = 'u-barra';
const BARRA = { id: 'u-barra', nome: 'Barra' };
const RECREIO = { id: 'u-recreio', nome: 'Recreio' };

// Os DOIS textos saem da funcao pura REAL, nunca redigitados: o degradado e exatamente o que a
// Barra recebeu em 04/09, e e ele que a guarda de duplicata tem que saber diferenciar do relatorio
// de verdade — os dois comecam pela MESMA linha de cabecalho.
const TEXTO_DEGRADADO = pura.mensagemDeFimDeDia({ erro: true, dataBr: DATA_BR });
const TEXTO_REAL = pura.mensagemDeFimDeDia({
  preencheram: 3, faltaram: [{ hora: '15:00', pessoa: { nome: 'Ana' } }], semVerificacao: 0, dataBr: DATA_BR,
});
assert.strictEqual(TEXTO_DEGRADADO.split('\n')[0], TEXTO_REAL.split('\n')[0],
  'premissa do teste: os dois textos compartilham o cabecalho — e por isso que a guarda por cabecalho sozinha nao serve');

const REL_REAL = {
  texto: TEXTO_REAL, preencheram: 3, faltaram: [{ hora: '15:00', pessoa: { nome: 'Ana' } }],
  semVerificacao: 0, motivo: null,
};
const MOTIVO_DEGRADADO = 'nao consegui ler quem entrou na pauta de hoje';
const REL_DEGRADADO = {
  texto: TEXTO_DEGRADADO, preencheram: 0, faltaram: [], semVerificacao: 0, motivo: MOTIVO_DEGRADADO,
};
// Os mesmos dois textos com a data do SABADO: o dispatcher deriva o degradado da data de `now`, e
// um relatorio datado de sexta num tick de sabado faria o cenario exercitar o caminho errado.
const TEXTO_DEGRADADO_SAB = pura.mensagemDeFimDeDia({ erro: true, dataBr: '05/09' });
const TEXTO_REAL_SAB = pura.mensagemDeFimDeDia({
  preencheram: 3, faltaram: [{ hora: '15:00', pessoa: { nome: 'Ana' } }], semVerificacao: 0, dataBr: '05/09',
});
const REL_DEGRADADO_SAB = { ...REL_DEGRADADO, texto: TEXTO_DEGRADADO_SAB };
const REL_REAL_SAB = { ...REL_REAL, texto: TEXTO_REAL_SAB };

async function semBarulho(fn, saida) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capturar = (nivel) => (...args) => saida.push(`${nivel} ${args.join(' ')}`);
  console.log = capturar('log'); console.warn = capturar('warn'); console.error = capturar('error');
  try { return await fn(); } finally { Object.assign(console, original); }
}

// `logs` e `mensagens` sao o estado que atravessa ticks — o papel do marker_logs e do
// group_chat_messages em producao. Os MESMOS arrays em varios ticks e o que reproduz o cron
// batendo o slot de 5 em 5 minutos.
function mundo({
  relatorios = [REL_REAL], mensagens = [], logs = [], erroEnvio = null,
  unidades = [BARRA], ymd = YMD,
} = {}) {
  const inseridos = [];
  const enviadas = [];
  const console_ = [];
  // Quantas vezes a FONTE foi lida, por unidade. E o custo que a janela de insistencia cria (a RPC
  // leva 6-8s) e o que prova que quem ja entregou nao paga esse custo.
  const chamadasRel = {};
  const iRel = {};

  const resolver = (q) => {
    if (q.tabela === 'work_groups') {
      return { data: { id: `grp-${q.eq.la_report_unidade_id}` }, error: null };
    }
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
      // O filtro de `result` sai do PROPRIO codigo sob teste (`.in(...)`), nunca de uma copia aqui.
      // Uma lista redigitada no fake e o jeito classico de um teste ficar verde enquanto a
      // producao trava: foi exatamente `executed` nessa lista que segurou a Barra em 04/09.
      const aceitos = q.in && q.in.col === 'result' ? q.in.vals : [];
      assert.ok(Array.isArray(aceitos) && aceitos.length,
        'o bloco tem que filtrar marker_logs por result — sem isso a chave do dia nao significa nada');
      const achou = logs.some((m) => String(m.reason).startsWith(prefixo) && aceitos.includes(m.result));
      return { data: achou ? [{ id: 1 }] : [], error: null };
    }
    if (q.tabela === 'group_chat_messages' && q.op === 'select') {
      const prefixo = String(q.like || '').replace(/%$/, '');
      // Devolve o CONTEUDO, e nao so o id: e o conteudo que diz se o que ja esta no grupo e o
      // relatorio de verdade ou o degradado.
      const achadas = mensagens
        .filter((m) => m.group_id === q.eq.group_id && String(m.content).startsWith(prefixo))
        .map((m, i) => ({ id: i + 1, content: m.content }));
      return { data: achadas, error: null };
    }
    if (q.tabela === 'group_chat_messages' && q.op === 'insert') {
      if (erroEnvio) return { error: { message: erroEnvio } };
      mensagens.push(q.dados); enviadas.push(q.dados);
      return { error: null };
    }
    throw new Error(`[harness] consulta nao prevista: ${q.tabela}/${q.op}`);
  };

  const supabase = {
    from(tabela) {
      const q = {
        tabela, op: null, like: null, dados: null, eq: {}, in: null,
      };
      const chain = {
        select() { q.op = 'select'; return chain; },
        insert(row) { q.op = 'insert'; q.dados = row; return chain; },
        eq(col, val) { q.eq[col] = val; return chain; },
        not() { return chain; },
        in(col, vals) { q.in = { col, vals }; return chain; },
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

  const nomes = Object.fromEntries(unidades.map((u) => [u.id, u.nome]));
  const requireFake = (nome) => {
    // O PURO e o de verdade: a tabela de horarios e o texto degradado sob teste sao os de producao.
    if (nome === '../services/anamnese-pauta') return pura;
    if (nome === './anamnese-pauta') {
      return {
        relatorioDeFimDeDia: async ({ unidadeId }) => {
          chamadasRel[unidadeId] = (chamadasRel[unidadeId] || 0) + 1;
          const n = iRel[unidadeId] || 0;
          iRel[unidadeId] = n + 1;
          return relatorios[Math.min(n, relatorios.length - 1)];
        },
      };
    }
    if (nome === '../services/situacao-aluno') {
      return { UNIDADES_IDS: unidades.map((u) => u.id), nomeDaUnidade: (id) => nomes[id] || id };
    }
    if (nome === '../services/la-report-client') return { laReportClient: {} };
    throw new Error(`[harness] o bloco pediu um modulo que o harness nao conhece: ${nome}`);
  };

  // `hhmm` e a hora de PAREDE do tick do cron (*/5). O slot e o de 15 min que a contem — e o que o
  // dispatcher enxerga.
  const tickEm = (hhmm) => {
    const [hh, mm] = hhmm.split(':').map(Number);
    const now = { ymd, hour: hh, minute: mm, dow: pura.diaSemanaBrt(ymd) };
    const slotNow = hh * 60 + Math.floor(mm / 15) * 15;
    return semBarulho(
      () => rodarBloco({ force: null }, now, slotNow, timeToSlot, supabase, requireFake),
      console_,
    );
  };
  // Compat com os cenarios da primeira rodada: minutos contados a partir das 19:30.
  const tick = (minuto = 0) => tickEm(`19:${30 + minuto}`);

  return {
    inseridos, enviadas, mensagens, logs, console: console_, chamadasRel, tick, tickEm,
  };
}

// ── CENARIOS ────────────────────────────────────────────────────────────────────────────────

test('fim de dia: relatorio DE VERDADE vira executed, com a contagem no reason', async () => {
  const w = mundo({ relatorios: [REL_REAL] });
  await w.tick();
  assert.strictEqual(w.enviadas.length, 1, 'o relatorio tem que ir pro grupo');
  assert.strictEqual(w.enviadas[0].content, TEXTO_REAL);
  assert.strictEqual(w.inseridos.length, 1);
  assert.strictEqual(w.inseridos[0].result, 'executed');
  assert.match(w.inseridos[0].reason, /ok=3 falta=1 semver=0$/);
});

test('fim de dia: relatorio DEGRADADO vai pro grupo mas o marcador diz FALLBACK, com o motivo', async () => {
  // O caso medido na Barra em 04/09. A mensagem honesta sai (a equipe precisa saber que o TOM
  // nao conferiu), mas 'executed' seria mentira em dois sentidos: o sensor viraria um dia de
  // zeros indistinguivel de um dia saudavel, e a chave do dia travaria a retentativa.
  const w = mundo({ relatorios: [REL_DEGRADADO] });
  await w.tick();
  assert.strictEqual(w.enviadas.length, 1, 'a mensagem degradada continua saindo — silencio seria pior');
  assert.strictEqual(w.enviadas[0].content, TEXTO_DEGRADADO);
  assert.strictEqual(w.inseridos.length, 1);
  assert.strictEqual(w.inseridos[0].result, 'fallback',
    'degradado carimbado como executed e o defeito de 04/09: mente no sensor E trava a retentativa');
  assert.ok(w.inseridos[0].reason.includes(MOTIVO_DEGRADADO),
    `o motivo tem que estar no reason: ${w.inseridos[0].reason}`);
  assert.ok(!/ok=0 falta=0 semver=0/.test(w.inseridos[0].reason),
    'zeros que ninguem mediu nao entram no marcador');
});

test('fim de dia: a RETENTATIVA substitui o degradado pelo relatorio de verdade quando a fonte volta', async () => {
  // Tick 1: fonte fora, sai o degradado. Tick 2 (5 min depois, mesmo slot): fonte de volta.
  // A chave de idempotencia nao pode travar (fallback nao trava) E a guarda de duplicata por
  // cabecalho nao pode bloquear — os dois textos comecam pela mesma linha.
  const w = mundo({ relatorios: [REL_DEGRADADO, REL_REAL] });
  await w.tick(0);
  await w.tick(5);
  assert.strictEqual(w.enviadas.length, 2, 'o relatorio de verdade tem que alcancar o grupo no tick seguinte');
  assert.strictEqual(w.enviadas[0].content, TEXTO_DEGRADADO);
  assert.strictEqual(w.enviadas[1].content, TEXTO_REAL);
  assert.deepStrictEqual(w.inseridos.map((m) => m.result), ['fallback', 'executed']);
});

test('fim de dia: relatorio de verdade NAO sai duas vezes — nem por tick repetido, nem pela guarda', async () => {
  const w = mundo({ relatorios: [REL_REAL, REL_REAL, REL_REAL] });
  await w.tick(0);
  await w.tick(5);
  await w.tick(10);
  assert.strictEqual(w.enviadas.length, 1, 'o cron bate o mesmo slot 3x — um relatorio, nao tres');

  // E se o marcador tivesse falhado depois do envio (nenhuma linha em marker_logs), a guarda de
  // conteudo ainda segura: a mensagem real ja esta no grupo.
  const w2 = mundo({ relatorios: [REL_REAL], mensagens: [{ group_id: `grp-${UNIDADE}`, content: TEXTO_REAL }] });
  await w2.tick();
  assert.strictEqual(w2.enviadas.length, 0, 'relatorio real ja no grupo — nao manda de novo');
  assert.strictEqual(w2.inseridos.length, 1);
  assert.strictEqual(w2.inseridos[0].result, 'skipped', 'ja tem relatorio de verdade: desfecho resolvido');
});

test('fim de dia: degradado nao se repete no grupo, mas o dia CONTINUA aberto pra fonte voltar', async () => {
  // Tres ticks com a fonte fora: uma unica mensagem degradada no grupo (repetir "nao consegui
  // conferir" a cada 5 min seria ruido), e nenhum marcador executed/skipped — senao o relatorio
  // de verdade nunca mais poderia sair hoje.
  const w = mundo({ relatorios: [REL_DEGRADADO, REL_DEGRADADO, REL_DEGRADADO, REL_REAL] });
  await w.tick(0);
  await w.tick(5);
  await w.tick(10);
  assert.strictEqual(w.enviadas.length, 1, 'uma mensagem degradada basta');
  assert.deepStrictEqual(w.inseridos.map((m) => m.result), ['fallback', 'fallback', 'fallback'],
    'nenhum executed/skipped: um deles fecharia o dia com o relatorio degradado como resposta final');
  await w.tick(10);
  assert.strictEqual(w.enviadas.length, 2, 'fonte de volta: o relatorio de verdade alcanca o grupo');
  assert.strictEqual(w.enviadas[1].content, TEXTO_REAL);
});

test('fim de dia: envio que FALHA continua fallback e sem marcador de sucesso', async () => {
  const w = mundo({ relatorios: [REL_REAL], erroEnvio: 'timeout' });
  await w.tick();
  assert.strictEqual(w.enviadas.length, 0);
  assert.strictEqual(w.inseridos[0].result, 'fallback');
  assert.ok(w.inseridos[0].reason.includes('envio falhou'));
});

// ── SEGUNDA RODADA: A INSISTENCIA ───────────────────────────────────────────────────────────

test('fim de dia: o teto da insistencia mora em constantes do dispatcher, nao em numero solto', async () => {
  // Ler o teto do proprio arquivo e o que faz os cenarios abaixo medirem o corte de PRODUCAO. Um
  // numero redigitado aqui provaria a opiniao do teste, nao o comportamento do dispatcher.
  assert.match(FONTE, /^const PAUTA_ANAMNESE_FIMDIA_JANELA_MIN = 120;$/m,
    'a janela relativa (+2h da hora da unidade) impede a unidade de insistir depois de a casa dela esvaziar');
  assert.match(FONTE, /^const PAUTA_ANAMNESE_FIMDIA_TETO = '22:00';$/m,
    "o teto absoluto para uma hora antes do fechamento das 23:00 — atropelar o bloco que DECIDE o dia e pior que perder o relatorio");
});

test('fim de dia: a unidade INSISTE depois da hora dela ate entregar o relatorio de verdade', async () => {
  // O caso da Barra em 04/09, agora com o relogio andando de verdade: a fonte cai as 19:30, sai a
  // mensagem degradada, e a fonte so volta as 19:50 — DOIS slots depois. Na versao antiga o bloco
  // ja tinha fechado e o relatorio do dia se perdia.
  const w = mundo({ relatorios: [REL_DEGRADADO, REL_DEGRADADO, REL_DEGRADADO, REL_REAL] });
  await w.tickEm('19:30');
  await w.tickEm('19:40');
  await w.tickEm('19:45');
  assert.strictEqual(w.enviadas.length, 1, 'ate aqui so o degradado');
  await w.tickEm('19:50');
  assert.strictEqual(w.enviadas.length, 2, 'a fonte voltou 20 min depois — o relatorio de verdade tem que sair');
  assert.strictEqual(w.enviadas[1].content, TEXTO_REAL);
  assert.strictEqual(w.inseridos[w.inseridos.length - 1].result, 'executed');
});

test('fim de dia: o marcador EXECUTED de um degradado NAO bloqueia a retentativa', async () => {
  // O estado REAL da Barra em 04/09 as 19:30, gravado antes do conserto do rotulo: marcador
  // `executed ok=0 falta=0 semver=0` no banco e SO a mensagem degradada no grupo. A decisao tem
  // que sair da guarda de conteudo (o artefato), nunca do marcador (o registro SOBRE o artefato,
  // que e justamente o que pode mentir).
  const w = mundo({
    relatorios: [REL_REAL],
    mensagens: [{ group_id: `grp-${UNIDADE}`, content: TEXTO_DEGRADADO }],
    logs: [{ marker_type: 'PAUTA_ANAMNESE', result: 'executed', reason: `pauta_fimdia:${UNIDADE}:${YMD} ok=0 falta=0 semver=0` }],
  });
  await w.tickEm('19:50');
  assert.strictEqual(w.enviadas.length, 1, "'executed' no banco nao pode calar a retentativa — foi ele que perdeu o dia 04/09");
  assert.strictEqual(w.enviadas[0].content, TEXTO_REAL);
  assert.strictEqual(w.inseridos[w.inseridos.length - 1].result, 'executed');

  // E o oposto, na mesma moeda: com o relatorio REAL ja no grupo, o mesmo 'executed' que nao
  // bloqueia aqui tambem nao e o que segura o reenvio — quem segura e o artefato.
  const w2 = mundo({
    relatorios: [REL_REAL],
    mensagens: [{ group_id: `grp-${UNIDADE}`, content: TEXTO_REAL }],
    logs: [{ marker_type: 'PAUTA_ANAMNESE', result: 'executed', reason: `pauta_fimdia:${UNIDADE}:${YMD} ok=3 falta=1 semver=0` }],
  });
  await w2.tickEm('19:50');
  assert.strictEqual(w2.enviadas.length, 0, 'nunca dois relatorios de verdade no mesmo grupo, no mesmo dia');
});

test('fim de dia: quem JA entregou nao paga a leitura da fonte a cada tick', async () => {
  // A insistencia custa uma RPC de 6-8s por tick. Com a janela aberta por 2h isso so pode ser
  // pago por quem ainda nao entregou: a guarda de conteudo (consulta barata em
  // group_chat_messages) roda ANTES da RPC, e o 'skipped' que ela grava tira a unidade da janela
  // no tick seguinte — dai em diante nem essa consulta roda.
  const w = mundo({ relatorios: [REL_REAL] });
  await w.tickEm('19:30');
  assert.strictEqual(w.chamadasRel[UNIDADE], 1, 'a primeira entrega le a fonte uma vez');
  await w.tickEm('19:45');
  await w.tickEm('20:15');
  await w.tickEm('21:30');
  assert.strictEqual(w.chamadasRel[UNIDADE], 1,
    'depois de entregue, nenhum tick da janela pode voltar a ler a fonte');
  assert.strictEqual(w.enviadas.length, 1);
  assert.deepStrictEqual(w.inseridos.map((m) => m.result), ['executed', 'skipped'],
    "um 'skipped' fecha a chave logo no tick seguinte — os outros dois ticks nao gravam nada");
});

test('fim de dia: unidade NAO tenta antes da hora dela, mesmo com o bloco aberto pela outra', async () => {
  // As 19:30 o bloco abre por causa da Barra. O Recreio so relata as 20:30 — se ele entrasse
  // junto, falaria uma hora antes da hora dele, com aula ainda acontecendo.
  const w = mundo({ relatorios: [REL_REAL], unidades: [BARRA, RECREIO] });
  await w.tickEm('19:30');
  assert.strictEqual(w.chamadasRel[RECREIO.id], undefined, 'o Recreio nao pode nem ler a fonte antes das 20:30');
  assert.deepStrictEqual(w.enviadas.map((m) => m.group_id), ['grp-u-barra']);
  await w.tickEm('20:30');
  assert.strictEqual(w.chamadasRel[RECREIO.id], 1, 'na hora dele, o Recreio relata');
  assert.deepStrictEqual(w.enviadas.map((m) => m.group_id), ['grp-u-barra', 'grp-u-recreio']);
});

test('fim de dia: depois do TETO a unidade para de tentar — o relatorio nao invade a madrugada', async () => {
  // Barra: janela relativa 19:30 + 2h = 21:30 (ultimo slot). O tick das 21:45 ja nao existe pra
  // ela, mesmo com a fonte fora o tempo todo e o dia sem relatorio.
  const w = mundo({ relatorios: [REL_DEGRADADO, REL_DEGRADADO, REL_REAL, REL_REAL] });
  await w.tickEm('19:30');
  await w.tickEm('21:30');
  assert.strictEqual(w.chamadasRel[UNIDADE], 2, 'as 21:30 ainda esta dentro da janela da Barra');
  await w.tickEm('21:45');
  await w.tickEm('22:30');
  assert.strictEqual(w.chamadasRel[UNIDADE], 2, 'passou de 21:30: a Barra nao tenta mais hoje');

  // Recreio: 20:30 + 2h daria 22:30, mas o teto ABSOLUTO das 22:00 corta antes — as 23:00 roda o
  // fechamento, que rele a fonte e decide o dia.
  const w2 = mundo({ relatorios: [REL_DEGRADADO, REL_DEGRADADO, REL_REAL], unidades: [RECREIO] });
  await w2.tickEm('22:00');
  assert.strictEqual(w2.chamadasRel[RECREIO.id], 1, 'as 22:00 e o ultimo slot que o teto absoluto permite');
  await w2.tickEm('22:15');
  assert.strictEqual(w2.chamadasRel[RECREIO.id], 1, 'depois das 22:00 ninguem mais tenta — o fechamento das 23:00 e logo ali');
});

test('fim de dia: no SABADO a janela anda junto com a hora de sabado, nao com a de dia util', async () => {
  // Sabado a Barra relata 15:30 e a escola fecha logo depois. A janela relativa e o que impede a
  // insistencia de virar um relatorio as 21:00 pra predio vazio — o teto absoluto sozinho deixaria.
  const w = mundo({ relatorios: [REL_DEGRADADO_SAB, REL_DEGRADADO_SAB, REL_REAL_SAB], ymd: YMD_SABADO });
  await w.tickEm('15:30');
  assert.strictEqual(w.chamadasRel[UNIDADE], 1, 'no sabado a Barra relata as 15:30');
  await w.tickEm('17:30');
  assert.strictEqual(w.chamadasRel[UNIDADE], 2, '15:30 + 2h: 17:30 ainda e o ultimo slot da janela');
  await w.tickEm('17:45');
  await w.tickEm('19:30');
  await w.tickEm('21:00');
  assert.strictEqual(w.chamadasRel[UNIDADE], 2,
    'depois das 17:30 de um sabado a casa esta vazia — insistir seria falar sozinho');
});
