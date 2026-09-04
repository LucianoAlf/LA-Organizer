'use strict';
// Harness do BLOCO da atualizacao da pauta de anamnese (09:00-21:00) dentro do dispatcher.
//
// POR QUE ELE EXISTE. A logica de DECISAO mora em src/rituals/anamnese-pauta.js e tem 63 testes.
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
// `require` visto pelo bloco e interceptado e todo modulo real e substituido por fake.
//
// RODAR:  node scripts/pauta-refresh-harness.js
// Sai com codigo 1 na primeira falha.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const RAIZ = path.join(__dirname, '..');
const DISPATCHER = path.join(RAIZ, 'src', 'rituals', 'dispatcher.js');

// ── RECORTE VERBATIM ────────────────────────────────────────────────────────────────────────
// Ancoras ASCII-safe (o transporte ate a VPS ja corrompeu acento em heredoc nesta casa) e
// UNICAS: se uma delas casar zero ou duas vezes, o harness PARA em vez de rodar meio bloco e
// dizer que passou.
function recortar(linhas, { de, ate, nome }) {
  const ini = linhas.findIndex(de);
  if (ini < 0) throw new Error(`[harness] nao achei o inicio de "${nome}" em dispatcher.js`);
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
const linhaHorarios = LINHAS.find((l) => l.startsWith('const PAUTA_ANAMNESE_REFRESH_TIMES ='));
if (!linhaHorarios) throw new Error('[harness] nao achei PAUTA_ANAMNESE_REFRESH_TIMES');

// O bloco em si: do `const _pautaRefreshHora` ate o `}` que fecha o `if`, logo depois do catch
// externo. Conferimos que essa linha seguinte e mesmo o fecho — se o formato mudar, para.
const iBloco = LINHAS.findIndex((l) => l.startsWith('  const _pautaRefreshHora = PAUTA_ANAMNESE_REFRESH_TIMES'));
if (iBloco < 0) throw new Error('[harness] nao achei o inicio do bloco da atualizacao');
const iCatch = LINHAS.findIndex((l, i) => i > iBloco && l.includes('[Pauta] atualizacao erro (fora do loop por unidade)'));
if (iCatch < 0) throw new Error('[harness] nao achei o catch externo do bloco da atualizacao');
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

// `marcadores` e o unico estado que atravessa ticks — e exatamente o papel do marker_logs em
// producao. Passar o MESMO array pra varios ticks e o que reproduz o cron batendo o slot 3x.
function mundo({ marcadores = [], resultado = () => RESULTADO_FELIZ, explode = null } = {}) {
  const chamadas = [];     // unidades em que atualizarPautaDaUnidade foi de fato invocada
  const inseridos = [];    // linhas gravadas em marker_logs

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
      return { UNIDADES_IDS: UNIDADES, nomeDaUnidade: (id) => NOMES[id] || id };
    }
    if (nome === '../services/la-report-client') return { laReportClient: {} };
    throw new Error(`[harness] o bloco pediu um modulo que o harness nao conhece: ${nome}`);
  };

  const tick = (hhmm, minuto = 0) => {
    const [h, m] = hhmm.split(':').map(Number);
    const now = { ymd: '2026-09-04', hour: h, minute: m + minuto, dow: 5 };
    const slotNow = h * 60 + Math.floor((m + minuto) / 15) * 15;
    return rodarBloco({ force: null }, now, slotNow, timeToSlot, supabase, requireFake, PAUTA_ANAMNESE_REFRESH_TIMES);
  };

  return { chamadas, inseridos, marcadores, tick };
}

// ── CENARIOS ────────────────────────────────────────────────────────────────────────────────
let falhas = 0;
const casos = [];
const caso = (nome, fn) => casos.push({ nome, fn });
const contar = (arr, u) => arr.filter((x) => x === u).length;

caso('3 ticks do MESMO slot chamam a unidade 1x, nao 3x (a chave por slot e o que segura a RPC de 6-8s)', async () => {
  const w = mundo();
  await w.tick('09:00', 0);
  await w.tick('09:00', 5);
  await w.tick('09:00', 10);
  assert.strictEqual(w.chamadas.length, 3, 'esperado 1 chamada por unidade (3 unidades), nao 9');
  for (const u of UNIDADES) assert.strictEqual(contar(w.chamadas, u), 1, `${NOMES[u]} rodou mais de uma vez no mesmo slot`);
  assert.strictEqual(w.inseridos.length, 3);
  assert.ok(w.inseridos.every((m) => m.result === 'executed'));
});

caso('os 7 slots disparam — e so eles (21 chamadas no dia, 7 por unidade)', async () => {
  const w = mundo();
  assert.strictEqual(PAUTA_ANAMNESE_REFRESH_TIMES.length, 7, 'o arquivo real precisa continuar com 7 horarios');
  for (const h of PAUTA_ANAMNESE_REFRESH_TIMES) await w.tick(h, 0);
  assert.strictEqual(w.chamadas.length, 21, '7 slots x 3 unidades');
  for (const u of UNIDADES) assert.strictEqual(contar(w.chamadas, u), 7);
});

caso('hora fora da lista nao dispara nada (10:00 e 22:00 estao no meio do dia e nao sao slot)', async () => {
  const w = mundo();
  await w.tick('10:00', 0);
  await w.tick('22:00', 0);
  assert.deepStrictEqual(w.chamadas, [], 'o bloco rodou num horario que nao e slot de atualizacao');
  assert.deepStrictEqual(w.inseridos, []);
});

caso('throw numa unidade NAO mata as outras duas no mesmo tick', async () => {
  const w = mundo({ explode: 'u-barra' });
  await w.tick('11:00', 0);
  assert.deepStrictEqual(w.chamadas, UNIDADES, 'as tres precisam ser tentadas, na ordem');
  assert.strictEqual(w.inseridos.length, 2, 'Recreio e CG gravam marcador; a Barra caiu antes de gravar');
  assert.ok(!w.inseridos.some((m) => m.reason.includes('u-barra')));
});

caso('a unidade que estourou RETENTA no tick seguinte do mesmo slot, e as outras nao', async () => {
  const w = mundo({ explode: 'u-barra' });
  await w.tick('11:00', 0);
  const antes = w.chamadas.length;
  await w.tick('11:00', 5);
  const novas = w.chamadas.slice(antes);
  assert.deepStrictEqual(novas, ['u-barra'],
    'so a Barra pode voltar: as outras duas ja tem marcador executed e a chave do slot as trava');
});

caso('BRECHA 1: filha travada com outras fechando vira executed com falha=N no reason (nao reabre o slot)', async () => {
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

caso('BRECHA 1: dia saudavel nao gasta o reason com falha=0', async () => {
  const w = mundo();
  await w.tick('15:00', 0);
  assert.ok(w.inseridos.every((m) => !/falha=/.test(m.reason)), 'sem falha, o contador nao entra no reason (120 chars)');
});

caso('BRECHA 2: disjuntor volta como fallback e NAO trava o slot (o proximo tick tenta de novo)', async () => {
  const w = mundo({
    resultado: () => ({
      atualizou: false, fechadas: 0, continuamPendentes: 30, naoDecididas: 0, falhasAoFechar: 0,
      motivo: 'disjuntor do meio do dia: 30 de 30 filhas pendentes (100%) fechariam de uma vez',
    }),
  });
  await w.tick('17:00', 0);
  assert.ok(w.inseridos.every((m) => m.result === 'fallback'), 'motivo sem semPauta = fallback');
  assert.ok(w.inseridos.every((m) => /erro=disjuntor/.test(m.reason)), `o motivo do disjuntor precisa chegar no reason: ${w.inseridos[0].reason}`);
  const antes = w.chamadas.length;
  await w.tick('17:00', 5);
  assert.strictEqual(w.chamadas.length, antes + 3, 'fallback nao trava: as tres unidades voltam no tick seguinte');
});

caso('semPauta vira skipped e TRAVA o slot (domingo, ou manha que nao montou)', async () => {
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

caso('BRECHA 4: no dispatcher instalado, o bloco da ATUALIZACAO vem ANTES do bloco da FALA', async () => {
  const iRefresh = LINHAS.findIndex((l) => l.startsWith("  if (opts.force === 'pauta_anamnese_refresh'"));
  const iFala = LINHAS.findIndex((l) => l.startsWith("  if (opts.force === 'pauta_anamnese_fala'"));
  assert.ok(iRefresh > 0 && iFala > 0, 'nao achei os dois blocos no dispatcher');
  assert.ok(iRefresh < iFala,
    `as 09:00 os dois caem no mesmo slot: se a fala vier primeiro, ela anuncia a pendencia cheia e a atualizacao apaga parte dela segundos depois (refresh=${iRefresh + 1}, fala=${iFala + 1})`);
});

(async () => {
  console.log(`[harness] bloco recortado de ${path.relative(RAIZ, DISPATCHER)}: linhas ${iBloco + 1}-${iCatch + 2} (${BLOCO.split('\n').length} linhas, verbatim)`);
  console.log('[harness] sem banco: supabase, LA Report e o ritual sao fakes\n');
  for (const c of casos) {
    try {
      await c.fn();
      console.log(`ok   ${c.nome}`);
    } catch (e) {
      falhas += 1;
      console.log(`FALHOU ${c.nome}`);
      console.log(`       ${e.message}`);
    }
  }
  console.log(`\n# casos ${casos.length}\n# ok    ${casos.length - falhas}\n# falha ${falhas}`);
  process.exit(falhas ? 1 : 0);
})();
