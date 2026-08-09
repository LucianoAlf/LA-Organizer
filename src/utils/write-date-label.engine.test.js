'use strict';
// Prova de WIRING — CONFAB-WRITE-DATE-NO-RELLABEL.
//
// A lib estar verde não prova nada se o engine não a chamar direito: "handler errado =
// verde por vacuidade" já custou uma rodada aqui. E o engine não tem teste interno
// (14k linhas, zero cobertura), então carregar processMessage não é opção.
//
// Solução, a mesma do AUTO_RETRY_DATE_POISON: extrair o BLOCO REAL do engine.js e
// executá-lo com as variáveis do turno injetadas. É o código que roda em produção —
// não uma cópia que pode divergir. Se alguém apagar ou renomear o bloco, este teste
// falha na extração, que é exatamente o alarme que se quer.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ENGINE = path.join(__dirname, '..', 'engine.js');
const INICIO = '// CONFAB-WRITE-DATE-NO-RELLABEL (Anne 05/08, alta)';
const FIM = '// Cascata de grupo — só no caminho de sucesso';

function blocoDoEngine() {
  const src = fs.readFileSync(ENGINE, 'utf8');
  const i = src.indexOf(INICIO);
  assert.ok(i > 0, 'o bloco WRITE_DATE_RELABEL sumiu do engine.js — regressão de wiring');
  const f = src.indexOf(FIM, i);
  assert.ok(f > i, 'não achei o fim do bloco no engine.js');
  return src.slice(i, f);
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Roda o bloco do engine com o estado de um turno. Devolve o `base` final (a fala que
// iria pro WhatsApp) e os markers que ele gravou.
async function rodaTurno({ okCount, failCount, base, actions, hoje }) {
  const markers = [];
  const fn = new AsyncFunction(
    'okCount', 'failCount', 'base', 'parsedTask', 'todayYmdSP', 'logMarker', 'collab', 'require', 'console',
    `${blocoDoEngine()}\n; return base;`
  );
  const texto = await fn(
    okCount, failCount, base,
    { actions },
    () => hoje,
    async (_id, tipo, result, reason, raw) => { markers.push({ tipo, result, reason, raw }); },
    { id: 'collab-teste' },
    (p) => require(path.resolve(path.dirname(ENGINE), p)),
    { warn() {}, error() {}, log() {} }
  );
  return { texto, markers };
}

// O turno literal da Anne (conversation_history 2026-08-06 01:14:14Z + marker_logs
// 01:14:12): marker gravou 07/08, fala saiu "amanhã", era quarta 05/08.
test('turno da Anne: o engine reescreve o rótulo e registra o marker', async () => {
  const { texto, markers } = await rodaTurno({
    okCount: 1,
    failCount: 0,
    base: '✅ Fechei os cheques do dia 5. E anotei o lembrete pra amanhã às 10h30!',
    actions: [{ action: 'create', title: 'Separar cheques para depósito do dia 8', remind_at: '2026-08-07T10:30:00-03:00' }],
    hoje: '2026-08-05',
  });
  assert.equal(texto, '✅ Fechei os cheques do dia 5. E anotei o lembrete pra sexta (07/08) às 10h30!');
  assert.equal(markers.length, 1);
  assert.equal(markers[0].tipo, 'WRITE_DATE_RELABEL');
  assert.equal(markers[0].reason, 'disse=amanhã gravado=2026-08-07 virou=sexta (07/08)');
});

test('rótulo certo: o engine não toca na fala nem loga', async () => {
  const fala = '✅ Anotado! Amanhã às 9h te lembro de finalizar a conciliação.';
  const { texto, markers } = await rodaTurno({
    okCount: 1, failCount: 0, base: fala,
    actions: [{ action: 'create', remind_at: '2026-06-12T09:00:00-03:00' }],
    hoje: '2026-06-11',
  });
  assert.equal(texto, fala);
  assert.equal(markers.length, 0);
});

// Com falha no lote não dá pra saber se a data narrada é de uma que entrou ou de uma
// que caiu — e o texto já vai levar o rodapé honesto de parcial.
test('turno com falha parcial: não age', async () => {
  const fala = 'Anotei o lembrete pra amanhã às 10h30.';
  const { texto, markers } = await rodaTurno({
    okCount: 1, failCount: 1, base: fala,
    actions: [{ action: 'create', remind_at: '2026-08-07T10:30:00-03:00' }],
    hoje: '2026-08-05',
  });
  assert.equal(texto, fala);
  assert.equal(markers.length, 0);
});

test('duas datas no mesmo turno: não age (correspondência ambígua)', async () => {
  const fala = 'Anotei o lembrete pra amanhã às 10h30.';
  const { texto, markers } = await rodaTurno({
    okCount: 2, failCount: 0, base: fala,
    actions: [
      { action: 'create', due_date: '2026-08-07' },
      { action: 'create', due_date: '2026-08-11' },
    ],
    hoje: '2026-08-05',
  });
  assert.equal(texto, fala);
  assert.equal(markers.length, 0);
});
