'use strict';
// Harness do BLOCO da atualizacao da pauta de anamnese (09:00-21:00) dentro do dispatcher.
//
// POR QUE ELE EXISTE. A logica de DECISAO mora em src/rituals/anamnese-pauta.js e tem 69 testes.
// O bloco do dispatcher nao tinha nenhum — e e nele que moram as tres coisas que mais custam
// dinheiro e silencio nesta feature: a chave de idempotencia por SLOT (sem ela o cron bate o
// mesmo slot 3x e a RPC de 6-8s roda 21 vezes por unidade por dia em vez de 7), o disparo dos 7
// slots, e o try/catch POR UNIDADE (um dado ruim so do Recreio nao pode matar Barra e CG no
// mesmo tick). Nada disso e alcancavel por teste de unidade do ritual: e codigo que so existe
// dentro de um `if` de 90 linhas no meio de um arquivo de 6800.
//
// COMO ELE FUNCIONA. Le o dispatcher instalado, RECORTA o bloco VERBATIM (por ancoras, sem
// copia-lo pra ca) e roda esse mesmo texto contra fakes. Uma copia do bloco aqui dentro nasceria
// desatualizada no primeiro dia em que alguem mexesse no original — e o harness ficaria verde
// provando um codigo que nao esta mais no ar.
//
// NAO TOCA O BANCO. Nao carrega .env, nao abre cliente Supabase, nao chama o LA Report: o
// `require` visto pelo bloco e interceptado e todo modulo real e substituido por fake. O unico
// modulo de verdade que este arquivo carrega e ./anamnese-pauta, que e puro (recebe supabase e
// laReport por parametro) e ja e carregado pela suite do lado.
//
// ONDE ELE MORA, E POR QUE (lacuna 2, 04/09). Ele nasceu em scripts/ e por isso nao era
// `*.test.js`, nao estava em package.json, nao estava em workflow nenhum: rodava so quando um
// humano lembrava. E ele e a UNICA guarda contra alguem reordenar os blocos e reabrir a
// contradicao das 09:00 (a mensagem anunciando a pendencia cheia e a atualizacao apagando parte
// dela segundos depois). Guarda que so roda quando alguem lembra nao e guarda. Convencao da
// casa: os testes vivem AO LADO do codigo, em src/ — e o codigo que este arquivo recorta e
// src/rituals/dispatcher.js. Entao ele mora aqui, e entra nos `node --env-file=.env --test src/`.
//
// RODAR SO ELE:  node --test src/rituals/pauta-refresh-harness.test.js

const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test } = require('node:test');

const { atualizarPautaDaUnidade } = require('./anamnese-pauta');

const DISPATCHER = path.join(__dirname, 'dispatcher.js');

// ── RECORTE VERBATIM ────────────────────────────────────────────────────────────────────────
// Ancoras ASCII-safe (o transporte ate a VPS ja corrompeu acento em heredoc nesta casa) e
// UNICAS: se uma ancora de INICIO casar zero ou duas vezes, o harness PARA em vez de rodar meio
// bloco — ou o bloco errado — e dizer que passou.
//
// LACUNA 5 (04/09): este comentario ja prometia isso, e o codigo so detectava ZERO (findIndex
// devolve a primeira e ignora o resto). Num arquivo de 6100 linhas, ancora ambigua e exatamente
// o que se quer pegar: duas linhas identicas fariam o harness provar um trecho que nao e o que
// roda as 09:00, e ele ficaria verde. Agora quem cumpre a promessa e o codigo.
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

// So a ancora de INICIO precisa ser unica no arquivo. A de FIM e "a primeira depois do inicio"
// por definicao (o `}` que fecha a funcao aparece centenas de vezes, e e o proximo que importa).
function recortar(linhas, { de, ate, nome }) {
  const ini = acharUnica(linhas, de, `inicio de ${nome}`);
  const fim = linhas.findIndex((l, i) => i > ini && ate(l));
  if (fim < 0) throw new Error(`[harness] nao achei o fim de "${nome}" em dispatcher.js`);
  return { texto: linhas.slice(ini, fim + 1).join('\n'), ini: ini + 1, fim: fim + 1 };
}

const LINHAS = fs.readFileSync(DISPATCHER, 'utf8').split('\n');

// timeToSlot e a lista dos 7 horarios saem do arquivo REAL, nunca redigitados: um harness que
// redigita a regra de slot passa a testar a copia dele, nao o que roda as 09:00.
const fnTimeToSlot = recortar(LINHAS, {
  nome: 'timeToSlot',
  de: (l) => l === 'function timeToSlot(t) {',
  ate: (l) => l === '}',
});
const linhaHorarios = LINHAS[acharUnica(LINHAS,
  (l) => l.startsWith('const PAUTA_ANAMNESE_REFRESH_TIMES ='), 'PAUTA_ANAMNESE_REFRESH_TIMES')];

// O bloco em si: do `const _pautaRefreshHora` ate o `}` que fecha o `if`, logo depois do catch
// externo. Conferimos que essa linha seguinte e mesmo o fecho — se o formato mudar, para.
const iBloco = acharUnica(LINHAS,
  (l) => l.startsWith('  const _pautaRefreshHora = PAUTA_ANAMNESE_REFRESH_TIMES'), 'inicio do bloco da atualizacao');
const iCatch = acharUnica(LINHAS,
  (l) => l.includes('[Pauta] atualizacao erro (fora do loop por unidade)'), 'catch externo do bloco da atualizacao');
if (iCatch < iBloco) throw new Error('[harness] o catch externo aparece ANTES do inicio do bloco');
if (LINHAS[iCatch + 1] !== '  }') {
  throw new Error(`[harness] a linha apos o catch externo nao e o fecho do if: ${JSON.stringify(LINHAS[iCatch + 1])}`);
}
const BLOCO = LINHAS.slice(iBloco, iCatch + 2).join('\n');

// eslint-disable-next-line no-new-func
const { timeToSlot, PAUTA_ANAMNESE_REFRESH_TIMES } = new Function(
  `${fnTimeToSlot.texto}\n${linhaHorarios}\nreturn { timeToSlot, PAUTA_ANAMNESE_REFRESH_TIMES };`,
)();

// `require` entra como PARAMETRO: dentro do bloco ele sombreia o require real, e nenhum modulo
// de verdade (nem o cliente do LA Report, nem o do Supabase) chega a ser carregado.
// eslint-disable-next-line no-new-func
const rodarBloco = new Function(
  'opts', 'now', 'slotNow', 'timeToSlot', 'supabase', 'require', 'PAUTA_ANAMNESE_REFRESH_TIMES',
  `return (async () => {\n${BLOCO}\n})();`,
);

// ── FAKES ───────────────────────────────────────────────────────────────────────────────────
const UNIDADES = ['u-recreio', 'u-barra', 'u-cg'];
const NOMES = { 'u-recreio': 'Recreio', 'u-barra': 'Barra', 'u-cg': 'Campo Grande' };
const RESULTADO_FELIZ = { atualizou: true, fechadas: 1, continuamPendentes: 2, naoDecididas: 0, falhasAoFechar: 0, motivo: null };

// O bloco recortado FALA no console — e deve mesmo: em producao aquele rastro e a unica forma de
// um humano descobrir hoje, e nao pelo painel vazio. Dentro da suite, porem, sao dezenas de
// linhas no meio de 3600 testes, barulho que esconde falha de verdade. Silenciamos SO durante o
// tick e guardamos o que ele imprimiu: vira dado assertavel em vez de poluicao.
async function semBarulho(fn, saida) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capturar = (nivel) => (...args) => saida.push(`${nivel} ${args.join(' ')}`);
  console.log = capturar('log'); console.warn = capturar('warn'); console.error = capturar('error');
  try { return await fn(); } finally { Object.assign(console, original); }
}

// `marcadores` e o unico estado que atravessa ticks — e exatamente o papel do marker_logs em
// producao. Passar o MESMO array pra varios ticks e o que reproduz o cron batendo o slot 3x.
function mundo({
  marcadores = [], resultado = () => RESULTADO_FELIZ, explode = null, unidades = UNIDADES,
} = {}) {
  const chamadas = [];     // unidades em que atualizarPautaDaUnidade foi de fato invocada
  const inseridos = [];    // linhas gravadas em marker_logs
  const console_ = [];     // o que o bloco imprimiu, capturado em vez de vazado na suite

  const resolver = (q) => {
    if (q.tabela === 'work_groups') return { data: { id: `grp-${q.eq.la_report_unidade_id}` }, error: null };
    if (q.tabela === 'marker_logs' && q.op === 'insert') {
      // marker_logs.result so aceita executed|rejected|skipped|fallback — o fake recusa o resto,
      // senao um bug de mapeamento passaria batido aqui e estouraria no banco de producao.
      assert.ok(['executed', 'rejected', 'skipped', 'fallback'].includes(q.dados.result),
        `result invalido gravado em marker_logs: ${q.dados.result}`);
      marcadores.push(q.dados); inseridos.push(q.dados);
      return { error: null };
    }
    if (q.tabela === 'marker_logs' && q.op === 'select') {
      const prefixo = String(q.like || '').replace(/%$/, '');
      // Mesma semantica da consulta instalada: so EXECUTED/SKIPPED travam a retentativa.
      const achou = marcadores.some((m) => String(m.reason).startsWith(prefixo)
        && ['executed', 'skipped'].includes(m.result));
      return { data: achou ? [{ id: 1 }] : [], error: null };
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
        atualizarPautaDaUnidade: async ({ unidadeId }) => {
          chamadas.push(unidadeId);
          if (unidadeId === explode) throw new Error('dado ruim so desta unidade');
          return resultado(unidadeId);
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
    const now = { ymd: '2026-09-04', hour: h, minute: m + minuto, dow: 5 };
    const slotNow = h * 60 + Math.floor((m + minuto) / 15) * 15;
    return semBarulho(
      () => rodarBloco({ force: null }, now, slotNow, timeToSlot, supabase, requireFake, PAUTA_ANAMNESE_REFRESH_TIMES),
      console_,
    );
  };

  return { chamadas, inseridos, marcadores, console: console_, tick };
}

// ── CENARIOS ────────────────────────────────────────────────────────────────────────────────
const contar = (arr, u) => arr.filter((x) => x === u).length;

test('bloco da pauta: 3 ticks do MESMO slot chamam a unidade 1x, nao 3x (a chave por slot e o que segura a RPC de 6-8s)', async () => {
  const w = mundo();
  await w.tick('09:00', 0);
  await w.tick('09:00', 5);
  await w.tick('09:00', 10);
  assert.strictEqual(w.chamadas.length, 3, 'esperado 1 chamada por unidade (3 unidades), nao 9');
  for (const u of UNIDADES) assert.strictEqual(contar(w.chamadas, u), 1, `${NOMES[u]} rodou mais de uma vez no mesmo slot`);
  assert.strictEqual(w.inseridos.length, 3);
  assert.ok(w.inseridos.every((m) => m.result === 'executed'));
});

test('bloco da pauta: os 7 slots disparam — e so eles (21 chamadas no dia, 7 por unidade)', async () => {
  const w = mundo();
  assert.strictEqual(PAUTA_ANAMNESE_REFRESH_TIMES.length, 7, 'o arquivo real precisa continuar com 7 horarios');
  for (const h of PAUTA_ANAMNESE_REFRESH_TIMES) await w.tick(h, 0);
  assert.strictEqual(w.chamadas.length, 21, '7 slots x 3 unidades');
  for (const u of UNIDADES) assert.strictEqual(contar(w.chamadas, u), 7);
});

test('bloco da pauta: hora fora da lista nao dispara nada (10:00 e 22:00 estao no meio do dia e nao sao slot)', async () => {
  const w = mundo();
  await w.tick('10:00', 0);
  await w.tick('22:00', 0);
  assert.deepStrictEqual(w.chamadas, [], 'o bloco rodou num horario que nao e slot de atualizacao');
  assert.deepStrictEqual(w.inseridos, []);
});

test('bloco da pauta: throw numa unidade NAO mata as outras duas no mesmo tick', async () => {
  const w = mundo({ explode: 'u-barra' });
  await w.tick('11:00', 0);
  assert.deepStrictEqual(w.chamadas, UNIDADES, 'as tres precisam ser tentadas, na ordem');
  assert.strictEqual(w.inseridos.length, 2, 'Recreio e CG gravam marcador; a Barra caiu antes de gravar');
  assert.ok(!w.inseridos.some((m) => m.reason.includes('u-barra')));
});

test('bloco da pauta: a unidade que estourou RETENTA no tick seguinte do mesmo slot, e as outras nao', async () => {
  const w = mundo({ explode: 'u-barra' });
  await w.tick('11:00', 0);
  const antes = w.chamadas.length;
  await w.tick('11:00', 5);
  const novas = w.chamadas.slice(antes);
  assert.deepStrictEqual(novas, ['u-barra'],
    'so a Barra pode voltar: as outras duas ja tem marcador executed e a chave do slot as trava');
});

test('bloco da pauta: BRECHA 1 — filha travada com outras fechando vira executed com falha=N no reason (nao reabre o slot)', async () => {
  const w = mundo({
    resultado: () => ({ atualizou: true, fechadas: 2, continuamPendentes: 1, naoDecididas: 0, falhasAoFechar: 1, motivo: null }),
  });
  await w.tick('13:00', 0);
  assert.strictEqual(w.inseridos.length, 3);
  assert.ok(w.inseridos.every((m) => m.result === 'executed'), 'trabalho aconteceu: o desfecho e executed');
  assert.ok(w.inseridos.every((m) => / falha=1\b/.test(m.reason)), `a falha precisa aparecer no reason: ${w.inseridos[0].reason}`);
  const antes = w.chamadas.length;
  await w.tick('13:00', 5);
  assert.strictEqual(w.chamadas.length, antes, 'executed TRAVA o slot — era exatamente o custo de 21 RPCs que a brecha 1 pagava');
});

test('bloco da pauta: BRECHA 1 — dia saudavel nao gasta o reason com falha=0', async () => {
  const w = mundo();
  await w.tick('15:00', 0);
  assert.ok(w.inseridos.every((m) => !/falha=/.test(m.reason)), 'sem falha, o contador nao entra no reason (120 chars)');
});

test('bloco da pauta: BRECHA 2 — disjuntor volta como fallback e NAO trava o slot (o proximo tick tenta de novo)', async () => {
  const w = mundo({
    resultado: () => ({
      atualizou: false, fechadas: 0, continuamPendentes: 30, naoDecididas: 0, falhasAoFechar: 0,
      motivo: 'disjuntor 30/30 (100%) acima de 15 E de 60% dos pendentes',
    }),
  });
  await w.tick('17:00', 0);
  assert.ok(w.inseridos.every((m) => m.result === 'fallback'), 'motivo sem semPauta = fallback');
  assert.ok(w.inseridos.every((m) => /erro=disjuntor/.test(m.reason)), `o motivo do disjuntor precisa chegar no reason: ${w.inseridos[0].reason}`);
  const antes = w.chamadas.length;
  await w.tick('17:00', 5);
  assert.strictEqual(w.chamadas.length, antes + 3, 'fallback nao trava: as tres unidades voltam no tick seguinte');
});

test('bloco da pauta: semPauta vira skipped e TRAVA o slot (domingo, ou manha que nao montou)', async () => {
  const w = mundo({
    resultado: () => ({ atualizou: false, fechadas: 0, continuamPendentes: 0, naoDecididas: 0, falhasAoFechar: 0, semPauta: true, motivo: 'nao ha pauta de hoje na tela para encolher no meio do dia' }),
  });
  await w.tick('19:00', 0);
  assert.ok(w.inseridos.every((m) => m.result === 'skipped'));
  assert.ok(w.inseridos.every((m) => !/erro=/.test(m.reason)), 'desfecho resolvido nao vira "erro=" no log');
  const antes = w.chamadas.length;
  await w.tick('19:00', 5);
  assert.strictEqual(w.chamadas.length, antes, 'skipped trava o slot: 7 RPCs por dia num domingo seria desperdicio puro');
});

test('bloco da pauta: BRECHA 4 — no dispatcher instalado, o bloco da ATUALIZACAO vem ANTES do bloco da FALA', async () => {
  const iRefresh = acharUnica(LINHAS,
    (l) => l.startsWith("  if (opts.force === 'pauta_anamnese_refresh'"), 'bloco da atualizacao');
  const iFala = acharUnica(LINHAS,
    (l) => l.startsWith("  if (opts.force === 'pauta_anamnese_fala'"), 'bloco da fala');
  assert.ok(iRefresh < iFala,
    `as 09:00 os dois caem no mesmo slot: se a fala vier primeiro, ela anuncia a pendencia cheia e a atualizacao apaga parte dela segundos depois (refresh=${iRefresh + 1}, fala=${iFala + 1})`);
});

// ── LACUNA 4 (04/09): o que o AUDITOR ve em marker_logs ─────────────────────────────────────
// O reason e cortado em 120 caracteres, e a chave de idempotencia do slot ja gasta 67 deles com
// um uuid de unidade de verdade (as unidades fake acima tem id curto e escondem o aperto). Este
// e o unico lugar da suite onde a formula REAL do dispatcher encontra uma chave REAL: o motivo
// vem do ritual REAL, nada e redigitado. Antes, o banco guardava `erro=disjuntor do meio do dia:
// 3` e o tamanho do lote barrado — o numero que separa incidente de dado de dia estranho — nunca
// chegava a quem audita.
const UUID_UNIDADE = '11111111-2222-3333-4444-555555555555';   // 36 chars, como as unidades reais
const CHAVE_ESPERADA = `pauta_refresh:${UUID_UNIDADE}:2026-09-04:17:00`;

// Fixture minima do formato que a RPC do LA Report devolve, so pra arrancar do ritual REAL o
// texto REAL do disjuntor. Redigitar o motivo aqui mediria a copia, e ficaria verde no dia em
// que alguem alongasse o texto la.
const alunoFake = (nome, temAnamnese) => ({
  nome, pessoa_chave: `pk-${nome}`, classificacao: 'LA',
  aulas_resumo: ['Canto — Sexta-feira 09:00'],
  anamnese_preenchida: !!temAnamnese, cadastro_faltando: temAnamnese ? [] : ['anamnese'],
});

async function motivoRealDoDisjuntor(preencheram, pendentes) {
  const alunos = Array.from({ length: pendentes }, (_, i) => alunoFake(`P${i}`, i < preencheram));
  const filhas = Array.from({ length: pendentes }, (_, i) => ({ id: `f-${i}`, title: `09:00 Anamnese — P${i}` }));
  const saida = [];
  const r = await semBarulho(() => atualizarPautaDaUnidade({
    supabase: {}, laReport: { rpc: async () => ({ data: alunos, error: null }) },
    unidadeId: 'u1', groupId: 'grp', hoje: '2026-09-04',
    deps: {
      acharContainer: async () => ({ containerId: 'cont-1', erro: null }),
      listarFilhasPendentes: async () => ({ filhas, erro: null }),
      fecharFilha: async () => { throw new Error('[harness] o disjuntor deixou fechar filha'); },
    },
  }), saida);
  assert.ok(r.motivo && /disjuntor/i.test(r.motivo), `esperava o motivo do disjuntor, veio: ${r.motivo}`);
  return r;
}

test('bloco da pauta: LACUNA 4 — a chave ocupa os 67 primeiros chars e sobrevive INTACTA ao corte', async () => {
  // Motivo absurdamente longo de proposito: e o corte que esta sob teste, nao o texto. A chave e
  // o que impede o slot de re-rodar; se o corte a alcancasse, a idempotencia morreria em silencio
  // e a RPC de 6-8s voltaria a rodar 3x por slot.
  const w = mundo({
    unidades: [UUID_UNIDADE],
    resultado: () => ({
      atualizou: false, fechadas: 0, continuamPendentes: 30, naoDecididas: 0, falhasAoFechar: 0,
      motivo: 'X'.repeat(400),
    }),
  });
  await w.tick('17:00', 0);
  const { reason } = w.inseridos[0];
  assert.strictEqual(reason.length, 120, 'o corte do dispatcher e em 120 — se mudar, os orcamentos abaixo mudam junto');
  assert.strictEqual(reason.slice(0, CHAVE_ESPERADA.length), CHAVE_ESPERADA,
    'a chave de idempotencia do slot nao pode ser tocada pelo corte');
  assert.strictEqual(CHAVE_ESPERADA.length, 67, 'a chave com uuid real gasta 67 dos 120 caracteres');
  // O que sobra pro motivo depois de ` fech=0 pend=30 nd=0` e ` erro=`. E este numero que o teste
  // de orcamento do ritual (anamnese-pauta.test.js) usa pra exigir os numeros na frente do texto.
  const sobra = reason.length - (reason.indexOf(' erro=') + ' erro='.length);
  assert.strictEqual(sobra, 27, `o motivo tem ${sobra} caracteres no marcador — o ritual precisa por sensor e numeros ai dentro`);
});

test('bloco da pauta: LACUNA 4 — os NUMEROS do disjuntor chegam ao marker_logs, nao so a palavra', async () => {
  const real = await motivoRealDoDisjuntor(19, 30);   // assimetrico: 19 e 30 sao distinguiveis no reason
  const w = mundo({
    unidades: [UUID_UNIDADE],
    resultado: () => ({
      atualizou: false, fechadas: 0, continuamPendentes: real.continuamPendentes,
      naoDecididas: real.naoDecididas, falhasAoFechar: 0, motivo: real.motivo,
    }),
  });
  await w.tick('17:00', 0);
  const { reason, result } = w.inseridos[0];
  assert.strictEqual(result, 'fallback', 'o disjuntor e falha: nao pode travar a chave do slot');
  assert.ok(/erro=disjuntor/.test(reason), `o sensor tem que sobreviver ao corte: ${reason}`);
  assert.ok(/\b19\b/.test(reason.slice(reason.indexOf(' erro='))),
    `o TAMANHO do lote barrado tem que chegar ao banco, nao so ao console: ${reason}`);
  assert.ok(/\b19\b/.test(reason.slice(reason.indexOf(' erro='))) && /\b30\b/.test(reason.slice(reason.indexOf(' erro='))),
    `quantos de quantos: sem os dois numeros o auditor nao sabe se foi incidente ou dia estranho: ${reason}`);
});

// A promessa do cabecalho ("NAO TOCA O BANCO") virou teste ao entrar na suite (lacuna 2, 04/09):
// antes ele rodava a mao, uma vez a cada tanto; agora roda 7x por dia em CI e no terminal de
// quem mexe no repo. Um `require` de cliente real que escorregasse pra ca abriria conexao com
// PRODUCAO em cada rodada de teste — e as 102 tarefas do dia estao la.
test('bloco da pauta: o harness nao toca o banco — nenhum node_modules foi carregado', () => {
  const deFora = Object.keys(require.cache).filter((k) => k.includes('node_modules'));
  assert.deepStrictEqual(deFora, [],
    `so fs/path/assert e modulos puros do repo: qualquer client aqui vira conexao com producao a cada rodada (${deFora.join(', ')})`);
});

test('bloco da pauta: o harness nao vaza log na suite — o rastro do bloco fica capturado', async () => {
  const w = mundo();
  await w.tick('09:00', 0);
  assert.ok(w.console.length > 0, 'o bloco fala mesmo — e esse rastro que salva a depuracao em producao');
  assert.ok(w.console.every((l) => l.startsWith('log ') || l.startsWith('warn ') || l.startsWith('error ')),
    'as linhas foram capturadas, e nao impressas no meio dos 3600 testes');
});
