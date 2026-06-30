'use strict';
// KRISSYA-PROJECT-CLOSE-NO-HANDLER (auditoria 30/06): o ritual de aderência oferecia
// "Fecho? 🚀" pra projeto pronto, mas NÃO existe handler de fechar projeto pelo zap →
// "Fecha o Teclas" virava pedido largado. Interim: só informa o status, sem o CTA.
// Rodar: node --test src/rituals/adherence-text.test.js (ou com --env-file=.env na VPS).
const test = require('node:test');
const assert = require('node:assert');
const { buildAdherenceText } = require('./adherence-text');

const COLLAB = { full_name: 'Krissya Silva' };
const TODAY = '2026-06-29';

test('projeto pronto NÃO oferece "Fecho?" (sem handler de fechar projeto)', () => {
  const signals = { overdueTasks: [], pausedProjects: [], readyProjects: [{ id: '1', name: 'LA Teclas', last_update: '2026-06-12', days_since: 17 }] };
  const txt = buildAdherenceText(COLLAB, signals, TODAY);
  assert.ok(txt, 'readyProjects é sinal → deve gerar texto');
  assert.ok(!/Fecho\?/i.test(txt), 'NÃO pode oferecer "Fecho?" (cheque sem fundo)');
  assert.ok(!/🚀/.test(txt), 'sem o CTA 🚀 de fechar');
  assert.match(txt, /LA Teclas/, 'mantém o nome do projeto (informa status)');
  assert.match(txt, /concluídas/, 'informa que as tarefas estão concluídas');
});

test('parado segue com "Reagenda? Cancela?" (ação que o engine cumpre)', () => {
  const signals = { overdueTasks: [], pausedProjects: [{ id: '2', name: 'ProjParado', days_since: 10 }], readyProjects: [] };
  assert.match(buildAdherenceText(COLLAB, signals, TODAY), /Reagenda\? Cancela\?/);
});

test('sem sinal → null', () => {
  assert.strictEqual(buildAdherenceText(COLLAB, { overdueTasks: [], pausedProjects: [], readyProjects: [] }, TODAY), null);
});
