'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectProjectCloseQuestionAtEnd: q } = require('./detect-project-status-intent');
const { resolveProjectByName } = require('./project-status');

// Leo 11/09 08:11:45 BRT (a3a511bc): o TOM perguntou, o Leo disse "Sim" 25s depois e levou
// "não consegui registrar" — o projeto FISCALIZAÇÃO EMUSYS seguia `active` no dia seguinte.
// A raiz não é o executor (a2), que já existe desde 11/09: a pergunta nunca virou pending_intent,
// porque detectConfirmationQuestion só conhece idioma de tarefa/evento/"Confirma?".
const LEO = 'Ótimo, Leo! Quer fechar o projeto *Fiscalização Emusys* como concluído?';

test('Leo: a pergunta de fechar projeto é reconhecida como confirmação estagiável', () => {
  const r = q(LEO);
  assert.strictEqual(r && r.action, 'complete');
  const vivos = [{ id: 'e7', name: 'FISCALIZAÇÃO EMUSYS' }, { id: 'r2', name: 'Recital 2026' }];
  const m = resolveProjectByName(vivos, r.nameHint, r.quotedText);
  assert.deepStrictEqual([m.status, m.project && m.project.id], ['match', 'e7']);
});

test('só a pergunta FINAL conta — projeto citado antes não estagia', () => {
  // Medido em 12/09 sobre 16.190 outbound: ler a reply inteira dava 10 estágios novos, vários
  // informativos (briefing citando projeto) — um "Sim" ali FECHARIA projeto vivo. Só-a-última: 3.
  assert.strictEqual(q('Quer fechar o projeto *Recital 2026*? Antes disso, me confirma o horário?'), null);
  assert.strictEqual(q('Os três projetos — Fiscalização Emusys, Inventário e Recital — tão em 0%. Quer botar um passo mínimo hoje?'), null);
});

test('reply que não termina em pergunta nunca estagia', () => {
  assert.strictEqual(q('✅ *Fiscalização Emusys* fechado como concluído.'), null);
  assert.strictEqual(q('Quer fechar o projeto *Recital 2026*? Me avisa.'), null);
  assert.strictEqual(q(''), null);
  assert.strictEqual(q(null), null);
});

test('pergunta sobre TAREFA não vira mudança de projeto', () => {
  assert.strictEqual(q('Quer que eu feche a tarefa de hoje?'), null);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: a pergunta de projeto abre intent ANCORADA (executor (a))', () => {
  // O gate de estágio passa a aceitar a pergunta de projeto...
  assert.match(ENG, /detectProjectCloseQuestionAtEnd/);
  // ...e o payload nasce com a alça {anchor:{type:'project'}}, que é o que o executor (a) lê.
  assert.match(ENG, /_projAnchor[\s\S]{0,600}type: 'project'/);
  // fail-closed: só estagia quando resolveProjectByName casa um projeto VIVO do alcance dele.
  assert.match(ENG, /_rp\.status === 'match'/);
});
