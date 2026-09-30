'use strict';
// delegacao-nova-confirm.test.js — CONFIRM-DELEG-NOVA-SEM-PORTA (Krissya 29/09 18:14–18:34 BRT).
//
// Krissya pediu pra delegar tarefas NOVAS pra Kailane e pro Arthur. O TOM perguntou
// "Confirma pra eu delegar pra Kailane: *ver o vídeo…* — prazo quarta (30/09) às 15h?", ela disse
// "Sim" e ouviu "Foi mal, essa também não travou — me manda de novo". CINCO vezes em 20 min. A
// tarefa do vídeo nunca foi criada.
//
// Duas portas fechadas ao mesmo tempo:
//  1. o parser da Fatia 5 ancorava em "delego" — a prosa real é "delegar" (parser casou 0);
//  2. o create-gate VETA qualquer "deleg*" (ação sobre item existente). Delegar tarefa NOVA é
//     criação com destinatário — não há alvo existente a chutar, que é o perigo que o veto evita.
//
// O conserto não afrouxa o veto no texto: a criação delegada só é liberada quando o hook de
// fim-de-turno PROVOU no banco que o título não existe (payload.delegacao_nova).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseDelegateConfirmQuestion } = require('./delegate-question-parse');
const { podeLiberarCriacao, podeLiberarCriacaoDelegada } = require('./confirm-create-gate');

// Literais de pending_intents.question_text (29/09, Krissya).
const VIDEO = 'Confirma pra eu delegar pra Kailane: *ver o vídeo de registro de visitas que a Vitória postou no grupo* — prazo quarta (30/09) às 15h?';
const GISELE = 'Confirma pra eu delegar pro Arthur: *ligar para a Gisele* — quarta (30/09) às 11h30?';

test('parser casa "delegar" (prosa real) — não só "delego"', () => {
  assert.deepStrictEqual(parseDelegateConfirmQuestion(VIDEO),
    { task_title: 'ver o vídeo de registro de visitas que a Vitória postou no grupo', to_name: 'Kailane' });
  assert.deepStrictEqual(parseDelegateConfirmQuestion(GISELE),
    { task_title: 'ligar para a Gisele', to_name: 'Arthur' });
});

test('negação "não vou delegar" segue null', () => {
  assert.strictEqual(parseDelegateConfirmQuestion('Não delegar a *X* pro Alf, certo?'), null);
});

test('create-gate puro segue vetando deleg (controle — o veto não foi afrouxado)', () => {
  assert.strictEqual(podeLiberarCriacao(VIDEO), false);
  assert.strictEqual(podeLiberarCriacao(GISELE), false);
});

test('criação delegada libera quando o banco provou que o título é NOVO', () => {
  for (const q of [VIDEO, GISELE]) {
    const payload = { delegacao_nova: parseDelegateConfirmQuestion(q) };
    assert.strictEqual(podeLiberarCriacaoDelegada(q, payload), true, q);
  }
});

test('sem a prova do banco (payload sem delegacao_nova) → não libera', () => {
  assert.strictEqual(podeLiberarCriacaoDelegada(VIDEO, {}), false);
  assert.strictEqual(podeLiberarCriacaoDelegada(VIDEO, { last_tom_reply: VIDEO }), false);
  assert.strictEqual(podeLiberarCriacaoDelegada(VIDEO, null), false);
});

test('outra ação sobre existente junto do deleg → veta mesmo com a prova', () => {
  const q = 'Confirma pra eu delegar pra Kailane: *ver o vídeo* e reagendar a outra pra sexta?';
  assert.strictEqual(podeLiberarCriacaoDelegada(q, { delegacao_nova: { task_title: 'ver o vídeo', to_name: 'Kailane' } }), false);
});

test('engine estagia delegacao_nova e o create-gate a consulta (contrato de fonte)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.match(src, /payload\.delegacao_nova\s*=/);
  assert.match(src, /podeLiberarCriacaoDelegada\(target\.question_text,\s*target\.payload\)/);
});
