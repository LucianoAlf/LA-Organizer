'use strict';
// PROVA DE WIRING — o módulo existe e está LIGADO no engine.
//
// `task-done-recente.test.js` passaria 10/10 com o engine intacto: o helper puro não sabe se
// alguém o chama. O FIN-RECEIPT-CONFIRM-NOOP (25/06) foi exatamente isso — detector pronto, 8
// testes verdes, órfão no engine, bug vivo por semanas. Aqui o teste extrai o bloco REAL e o
// executa; se apagarem o bloco ou renomearem as funções, a extração falha e isto fica vermelho.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const INICIO = '        if (!hasConcrete && !_liberaCriacao) {';
const FIM = "          } catch (e) { console.warn('[TaskHonesty] lookup err (non-fatal):', e.message); }";

function extrairBloco() {
  const i = ENGINE.indexOf(INICIO);
  assert.notStrictEqual(i, -1, 'bloco TASK-HONESTY sumiu do engine.js — o helper virou órfão');
  const j = ENGINE.indexOf(FIM, i);
  assert.notStrictEqual(j, -1, 'fim do bloco não encontrado — âncora mudou');
  return ENGINE.slice(i, j + FIM.length) + '\n        }';
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function rodarBloco({ doneRows, hasConcrete = false, liberaCriacao = false }) {
  const marcadores = [];
  const REGRA = 'REGRA ORIGINAL: você NÃO consegue executar isso agora. NÃO emita marker nenhum. peça pra pessoa repetir.';
  const ctx = {
    markerRule: REGRA,
    hasConcrete,
    _liberaCriacao: liberaCriacao,
    collab: { id: 'collab-teste' },
    logMarker: async (...a) => { marcadores.push(a); },
    supabase: {
      from: () => {
        const o = {};
        for (const m of ['select', 'eq', 'gte', 'order']) o[m] = () => o;
        o.limit = () => Promise.resolve({ data: doneRows, error: null });
        return o;
      },
    },
    require: (p) => require(p.replace('./lib/', './')),
  };
  const fn = new AsyncFunction('ctx', `
    let { markerRule, hasConcrete, _liberaCriacao, collab, logMarker, supabase, require } = ctx;
    const console = { log(){}, warn(){} };
    ${extrairBloco()}
    ctx.markerRule = markerRule;
  `);
  await fn(ctx);
  return { markerRule: ctx.markerRule, marcadores, REGRA };
}

const AGORA = () => new Date().toISOString();

test('WIRING: baixa recente muda a regra dentro do engine', async () => {
  const r = await rodarBloco({ doneRows: [{ title: 'Enviar todos os checklists pendentes', completed_at: AGORA() }] });
  assert.match(r.markerRule, /PROIBIDO/, 'o engine não está aplicando o helper');
  assert.match(r.markerRule, /checklists pendentes/);
  assert.match(r.markerRule, /REGRA ORIGINAL/, 'a regra base tem que continuar embaixo, não ser substituída');
});

test('WIRING: sem baixa recente a regra fica idêntica', async () => {
  const r = await rodarBloco({ doneRows: [] });
  assert.strictEqual(r.markerRule, r.REGRA);
  assert.equal(r.marcadores.length, 0, 'não pode logar marker quando não agiu');
});

test('WIRING: baixa ANTIGA não dispara (a janela é aplicada de verdade)', async () => {
  const r = await rodarBloco({ doneRows: [{ title: 'Coisa de ontem', completed_at: '2020-01-01T00:00:00Z' }] });
  assert.strictEqual(r.markerRule, r.REGRA);
});

test('WIRING: o redirecionamento é medido em marker_logs', async () => {
  const r = await rodarBloco({ doneRows: [{ title: 'X', completed_at: AGORA() }] });
  const m = r.marcadores.find((a) => a[1] === 'TASK_DONE_RECENTE');
  assert.ok(m, 'sem linha em marker_logs não dá pra saber com que frequência isso salva alguém');
  assert.equal(m[2], 'redirected');
});

// Falha de leitura do banco não pode derrubar o turno nem inventar aviso: vale a regra original.
test('WIRING: erro na consulta é não-fatal e preserva a regra', async () => {
  const marcadores = [];
  const REGRA = 'REGRA ORIGINAL';
  const ctx = {
    markerRule: REGRA, hasConcrete: false, _liberaCriacao: false,
    collab: { id: 'x' }, logMarker: async (...a) => { marcadores.push(a); },
    supabase: { from: () => { throw new Error('banco fora'); } },
    require: (p) => require(p.replace('./lib/', './')),
  };
  const fn = new AsyncFunction('ctx', `
    let { markerRule, hasConcrete, _liberaCriacao, collab, logMarker, supabase, require } = ctx;
    const console = { log(){}, warn(){} };
    ${extrairBloco()}
    ctx.markerRule = markerRule;
  `);
  await fn(ctx);
  assert.strictEqual(ctx.markerRule, REGRA);
});

// O ramo de criação (F3, 08/08) tem instrução própria e não pode receber este aviso por cima.
test('WIRING: o ramo de liberação de criação não é tocado', async () => {
  const r = await rodarBloco({ doneRows: [{ title: 'X', completed_at: AGORA() }], liberaCriacao: true });
  assert.strictEqual(r.markerRule, r.REGRA);
});

test('WIRING: payload concreto não paga a consulta nem muda de regra', async () => {
  const r = await rodarBloco({ doneRows: [{ title: 'X', completed_at: AGORA() }], hasConcrete: true });
  assert.strictEqual(r.markerRule, r.REGRA);
});
