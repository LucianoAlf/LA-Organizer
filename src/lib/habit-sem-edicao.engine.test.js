'use strict';
// PROVA DE WIRING — o helper existe e está LIGADO no engine.
//
// Um executor determinístico só conta se estiver ligado: o FIN-RECEIPT-CONFIRM-NOOP (25/06) foi
// exatamente isso — detector pronto, 8 testes verdes, órfão no engine, bug vivo por semanas.
// Aqui o risco é o mesmo: `habit-sem-edicao.test.js` passaria 9/9 com o engine intacto.
//
// Este teste extrai o bloco REAL do engine.js e o executa. Se alguém apagar o bloco ou renomear
// as funções, a extração falha e o teste fica vermelho — que é o ponto.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const INICIO = "      const { pediuEdicaoDeHabito, respostaSemEdicaoDeHabito } = require('./lib/habit-sem-edicao');";
// Fecha no início do ramo IRMÃO (marker bem formado), para que o if/else do bloco venha inteiro
// — inclusive o `else`, que é o caminho normal e precisa ser exercido pela contraprova.
const FIM = '    } else if (parsedHab) {';

function extrairBloco() {
  const i = ENGINE.indexOf(INICIO);
  assert.notStrictEqual(i, -1, 'bloco HABIT-EDIT-SEM-CAMINHO sumiu do engine.js — o helper virou órfão');
  const j = ENGINE.indexOf(FIM, i);
  assert.notStrictEqual(j, -1, 'fim do bloco não encontrado — âncora mudou');
  return ENGINE.slice(i, j);
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function rodarBloco({ motivos, cleanText }) {
  const marcadores = [];
  const ctx = {
    reply: 'valor original — deve ser trocado',
    parsedHab: { malformed: true, cleanText, motivos },
    collab: { id: 'collab-teste' },
    logMarker: async (...a) => { marcadores.push(a); },
    require: (p) => require(p.replace('./lib/', './')),
  };
  const fn = new AsyncFunction('ctx', `
    let { reply, parsedHab, collab, logMarker, require } = ctx;
    ${extrairBloco()}
    ctx.reply = reply;
  `);
  await fn(ctx);
  return { reply: ctx.reply, marcadores };
}

test('WIRING: ação inexistente no engine devolve o caminho do app', async () => {
  const r = await rodarBloco({
    motivos: ['action[0]:unknown_action'],
    cleanText: 'Entendi: quer tirar o lembrete das 6h de *Tomar remédios*, certo?\n\n✅ Lembrete das 6h removido.',
  });
  assert.match(r.reply, /Hábitos/, 'o engine não está usando o helper');
  assert.ok(!/removido/i.test(r.reply), 'a confirmação falsa passou pelo engine');
});

test('WIRING: o redirecionamento é medido em marker_logs', async () => {
  const r = await rodarBloco({ motivos: ['action[0]:unknown_action'], cleanText: '✅ Removido!' });
  const m = r.marcadores.find((a) => a[3] === 'sem_capacidade:edicao');
  assert.ok(m, 'sem linha em marker_logs não dá pra saber quantas pessoas esbarram nisso');
  assert.equal(m[1], 'HABIT_ACTION');
  assert.equal(m[2], 'redirected');
});

// Contraprova: sem unknown_action o bloco não age, e o caminho normal (cleanText) segue.
test('WIRING: schema torto em ação existente NÃO recebe o caminho do app', async () => {
  const r = await rodarBloco({ motivos: ['action[0]:bad_habit_id'], cleanText: 'Qual hábito?' });
  assert.doesNotMatch(r.reply, /Hábitos.*app|abre o app/i);
});

// O parser precisa PROPAGAR os motivos, senão `pediuEdicaoDeHabito` recebe undefined e o bloco
// nunca dispara — falha silenciosa que os testes do helper não pegariam.
test('WIRING: parseHabitMarker sobe os motivos no retorno malformed', () => {
  assert.match(ENGINE, /return \{ malformed: true, cleanText, motivos: dropped \};/,
    'sem `motivos` no retorno do parser o bloco fica morto');
});
