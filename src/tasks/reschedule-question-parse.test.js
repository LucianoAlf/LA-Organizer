'use strict';
// reschedule-question-parse.test.js — Fatia 5 (confirmação parse-on-open, reagendamento).
// Espelha coord-question-parse (Fatia 3) e complete-question-parse (Fatia 4): extrai as
// (título → nova data) da PROPOSTA de remarcação do TOM, pra o hook genérico de fim-de-turno
// estagiar payload.reschedule ESTRUTURADO — aí o "sim" aplica determinístico em vez de o LLM
// re-emitir o marker (que não reemite → NOOP; caso Matheus 14/07, finding 5eb6bb00).
//
// FAIL-CLOSED: só produz ação quando há verbo de reagendar E linha "título → data ABSOLUTA"
// (DD/MM ou ISO). Data relativa/dia-da-semana sem DD/MM → linha ignorada. Remarcar pra DATA
// errada é pior que o drop atual. Puro (sem I/O; título resolve depois, no hook).
//
// Rodar: node --test src/tasks/reschedule-question-parse.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseRescheduleConfirmQuestion } = require('./reschedule-question-parse');

const TODAY = { todayYmd: '2026-08-24' };

// ── caso real reproduzido (spike #3): proposta em prosa "o que eu faria antes de mexer" ──
test('proposta bulletada resolve título→data (DD/MM próxima ocorrência)', () => {
  const reply = '📋 Vou reagendar:\n• *Comprar material* → 02/09\n• *Ligar fornecedor* → 29/08\n• *Enviar relatório* → 01/09\nConfirma?';
  const r = parseRescheduleConfirmQuestion(reply, TODAY);
  assert.ok(r, 'deveria extrair');
  assert.deepStrictEqual(r.actions, [
    { action: 'reschedule', title: 'Comprar material', new_due_date: '2026-09-02' },
    { action: 'reschedule', title: 'Ligar fornecedor', new_due_date: '2026-08-29' },
    { action: 'reschedule', title: 'Enviar relatório', new_due_date: '2026-09-01' },
  ]);
});

test('markdown e anotação de dia-da-semana no RHS não sujam (extrai o DD/MM)', () => {
  const reply = 'Reagendando as três:\n• Comprar material → sexta 28/08\n• *Ligar fornecedor* → 02/09 (quarta)\nConfirma?';
  const r = parseRescheduleConfirmQuestion(reply, TODAY);
  assert.ok(r);
  assert.deepStrictEqual(r.actions, [
    { action: 'reschedule', title: 'Comprar material', new_due_date: '2026-08-28' },
    { action: 'reschedule', title: 'Ligar fornecedor', new_due_date: '2026-09-02' },
  ]);
});

test('DD/MM já passado no ano vira próxima ocorrência (ano seguinte)', () => {
  const reply = 'Vou remarcar:\n• *Renovação* → 01/01\nConfirma?';
  const r = parseRescheduleConfirmQuestion(reply, TODAY);
  assert.deepStrictEqual(r.actions, [{ action: 'reschedule', title: 'Renovação', new_due_date: '2027-01-01' }]);
});

test('data ISO no RHS passa direto', () => {
  const reply = 'Reagendo:\n• *Report* → 2026-09-15\nConfirma?';
  const r = parseRescheduleConfirmQuestion(reply, TODAY);
  assert.deepStrictEqual(r.actions, [{ action: 'reschedule', title: 'Report', new_due_date: '2026-09-15' }]);
});

test('DD/MM/AAAA explícito respeita o ano dado', () => {
  const reply = 'Vou reagendar a *Vistoria* → 05/03/2027. Confirma?';
  const r = parseRescheduleConfirmQuestion(reply, TODAY);
  assert.deepStrictEqual(r.actions, [{ action: 'reschedule', title: 'Vistoria', new_due_date: '2027-03-05' }]);
});

// ── FAIL-CLOSED ─────────────────────────────────────────────────────────────────
test('linha só com dia-da-semana (sem DD/MM) é ignorada', () => {
  const reply = 'Reagendando:\n• *Comprar material* → sexta\n• *Ligar fornecedor* → 29/08\nConfirma?';
  const r = parseRescheduleConfirmQuestion(reply, TODAY);
  assert.deepStrictEqual(r.actions, [{ action: 'reschedule', title: 'Ligar fornecedor', new_due_date: '2026-08-29' }]);
});

test('todas as linhas sem data absoluta → null', () => {
  const reply = 'Posso reagendar suas tarefas pra semana que vem? Confirma?';
  assert.strictEqual(parseRescheduleConfirmQuestion(reply, TODAY), null);
});

test('sem verbo NEM pergunta de confirmação (lista qualquer com datas) → null', () => {
  const reply = 'Suas tarefas de hoje:\n• *Comprar material* → 02/09\n• *Report* → 03/09';
  assert.strictEqual(parseRescheduleConfirmQuestion(reply, TODAY), null);
});

// SEM verbo de reagendar mas COM pergunta de confirmação — caso real que quebrava (spike #3:
// "aqui o que eu faria: … Confirma?"). O verbo não é confiável; a pergunta + "título → data" é.
test('verbo ausente + "Confirma?" ainda estagia (proposta aguardando confirmação)', () => {
  const reply = 'Claro, aqui o que eu faria:\n• *Comprar material* → 02/09\n• *Ligar fornecedor* → 29/08\nConfirma?';
  const r = parseRescheduleConfirmQuestion(reply, TODAY);
  assert.deepStrictEqual(r.actions, [
    { action: 'reschedule', title: 'Comprar material', new_due_date: '2026-09-02' },
    { action: 'reschedule', title: 'Ligar fornecedor', new_due_date: '2026-08-29' },
  ]);
});

// Formato "prazo atual → novo" (spike #3 round 3): a data velha fica no LHS, a nova no RHS.
test('formato "26/08 → 02/09" pega a data NOVA (RHS), ignora a velha (LHS)', () => {
  const reply = '📋 Aqui o que farei:\n• *Comprar material* 26/08 → 02/09 (quarta)\nConfirma?';
  const r = parseRescheduleConfirmQuestion(reply, TODAY);
  assert.deepStrictEqual(r.actions, [{ action: 'reschedule', title: 'Comprar material', new_due_date: '2026-09-02' }]);
});

test('confirmação de CRIAÇÃO/FECHAMENTO (outra fatia) → null', () => {
  assert.strictEqual(parseRescheduleConfirmQuestion('Crio a tarefa *X* pra 02/09? Confirma?', TODAY), null);
  assert.strictEqual(parseRescheduleConfirmQuestion('Confirma o fechamento destas 2 tarefas: *X*, *Y*?', TODAY), null);
});

test('negação "não vou reagendar" → null', () => {
  assert.strictEqual(parseRescheduleConfirmQuestion('Não vou reagendar nada agora.\n• *X* → 02/09', TODAY), null);
});

test('data inválida (mês 13) é ignorada', () => {
  const reply = 'Reagendo:\n• *X* → 10/13\n• *Y* → 28/08\nConfirma?';
  const r = parseRescheduleConfirmQuestion(reply, TODAY);
  assert.deepStrictEqual(r.actions, [{ action: 'reschedule', title: 'Y', new_due_date: '2026-08-28' }]);
});

test('vazio/nulo/não-string → null sem lançar', () => {
  for (const v of [null, undefined, '', '   ', 42, {}]) {
    assert.strictEqual(parseRescheduleConfirmQuestion(v, TODAY), null);
  }
});

test('título vazio (só marcador) não vira ação', () => {
  const reply = 'Reagendo:\n• *  * → 02/09\nConfirma?';
  assert.strictEqual(parseRescheduleConfirmQuestion(reply, TODAY), null);
});
