'use strict';
// Achado ae5f4b42 (Alf 29/09 15:23 BRT): EVENT_UPDATE ok=1 fail=1 e a prosa disse "Cancelados ✅"
// pros dois. Turno real: conversation_history 2026-09-29T18:23:29Z + marker_logs 18:23:26Z.
const test = require('node:test');
const assert = require('node:assert');
const { relatoParcialPorItem } = require('./resultado-parcial-por-item');
const { buildOwnerGateMessage } = require('./event-owner-gate');

const PROSA_REAL = 'Entendi, Alf — desmarco os dois de amanhã:\n\n🗓️ *Mentoria com pessoal da Benji* (08:30)\n🗓️ *Jornada de Cordas* (13h–17h, com Quintela)\n\nCancelados ✅ — remarca quando resolver essa questão pessoal. Força aí.';
const RECUSA_REAL = buildOwnerGateMessage('cancel', 'Jornada de Cordas', 'Quintela');
const ITENS_REAIS = [
  { titulo: 'Mentoria com pessoal da Benji', acao: 'cancel', ok: true, mensagens: [] },
  { titulo: 'Jornada de Cordas', acao: 'cancel', ok: false, mensagens: [RECUSA_REAL] },
];

test('turno real: "Cancelados ✅" some; cada item diz o próprio resultado; a oferta de recado fica', () => {
  const r = relatoParcialPorItem(PROSA_REAL, ITENS_REAIS);
  assert.strictEqual(r.fired, true);
  const t = r.texto;
  assert.ok(!/Cancelados/.test(t), t);
  assert.ok(!/os dois/.test(t), t);
  assert.ok(t.includes('✅ *Mentoria com pessoal da Benji* (08:30) — cancelado'), t);
  assert.ok(t.includes('⚠️ *Jornada de Cordas* (13h–17h, com Quintela) — não consegui cancelar: quem pode cancelar é o dono do compromisso, *Quintela*'), t);
  assert.ok(t.includes('Remarca quando resolver essa questão pessoal. Força aí.'), t);
  assert.ok(/Sobre \*Jornada de Cordas\*: quer que eu mande um recado propondo a mudança\?\s*$/.test(t), t);
  // nenhum ✅ pra item que falhou
  for (const l of t.split('\n')) if (l.includes('Jornada de Cordas')) assert.ok(!l.includes('✅'), l);
});

test('prosa sem cartões ("✅ Cancelei os dois") → bloco por item no lugar da afirmação', () => {
  const r = relatoParcialPorItem('✅ Cancelei os dois compromissos de amanhã.', ITENS_REAIS);
  assert.strictEqual(r.fired, true);
  assert.ok(!/Cancelei/.test(r.texto));
  assert.ok(r.texto.startsWith('✅ *Mentoria com pessoal da Benji* — cancelado\n⚠️ *Jornada de Cordas* — não consegui cancelar'), r.texto);
});

test('controle: afirmação que nomeia SÓ o item que deu certo é verdadeira e fica', () => {
  const p = '✅ Cancelei a *Mentoria com pessoal da Benji*.';
  const r = relatoParcialPorItem(p, ITENS_REAIS);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.texto, p);
});

test('controle: lote todo ok ou todo falho não passa por aqui', () => {
  assert.strictEqual(relatoParcialPorItem(PROSA_REAL, [ITENS_REAIS[0]]).fired, false);
  assert.strictEqual(relatoParcialPorItem(PROSA_REAL, [ITENS_REAIS[1]]).fired, false);
});

test('pergunta multi-linha (evento ambíguo) segue inteira no fim', () => {
  const amb = 'Tenho mais de um evento com _"Reunião"_ — qual deles?\n1. Reunião ADM (01/10)\n2. Reunião Pedagógica (02/10)';
  const r = relatoParcialPorItem('Remarcados ✅', [
    { titulo: 'Mentoria com pessoal da Benji', acao: 'reschedule', ok: true, mensagens: [] },
    { titulo: 'Reunião', acao: 'reschedule', ok: false, mensagens: [amb] },
  ]);
  assert.strictEqual(r.fired, true);
  assert.ok(r.texto.includes('⚠️ *Reunião* — não consegui remarcar: detalhe abaixo'), r.texto);
  assert.ok(r.texto.endsWith(amb), r.texto);
});
