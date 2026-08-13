'use strict';
// TASK-COMPLETE-ALVO-NAO-ACHADO — o `complete` é o único title-lookup que falha MUDO.
//
// Os dois casos do banco (findings a07af6ae e b25cee18, ambos `dropped_request`):
//
//   11/08 15:02 BRT — Clayton, "Sim"
//     marker: {"action":"complete","title":"Não esquecer de verificar o report se está tudo
//              certo","to_name":"Fefê"}
//     marker_logs: TASK_UPDATE | rejected | all_failed:1 | {"fails":[]}   ← fails VAZIO
//     TOM: "_não consegui registrar agora. Me passa de novo?_"
//     banco: a tarefa existe, `pending`, assigned_to=Fefê, created_by=Clayton.
//
//   11/08 13:47 e 13:48 BRT — Mayra, "Feito" e depois "Feito tom"
//     marker: {"action":"complete","title":"Marcar presencas do horário"}
//     mesma rejeição `all_failed:1` com `fails:[]`, duas vezes seguidas.
//     banco: não existe tarefa aberta nenhuma com esse título.
//
// A raiz é engine.js:4507 — o ramo `else` do title-lookup do handler `complete` faz `failCount++`
// e `continue` SEM empurrar nada em `failMessages`. Com `failMessages` vazio, engine.js:11054 cai
// no genérico "_não consegui registrar agora. Me passa de novo?_" — que no caso do Clayton é um
// beco: a tarefa é da Fefê e o handler só casa por `assigned_to`, então repetir NUNCA funciona.
//
// Os irmãos já tratam isso: `reschedule` nomeia o dono (engine.js:4879-4888, "mensagem clara em
// vez de falha silenciosa (E2)") e `snooze` diz que não achou (engine.js:5042). O `complete` — a
// ação mais usada do sistema — ficou sem. Não muda QUEM pode concluir: muda só o que a pessoa lê.
//
// Mesmo princípio do habit-sem-edicao.js: "honestidade sem saída é beco".

const test = require('node:test');
const assert = require('node:assert');
const { mensagemAlvoNaoAchado } = require('./task-complete-alvo-nao-achado');

const TITULO_CLAYTON = 'Não esquecer de verificar o report se está tudo certo';
const TITULO_MAYRA = 'Marcar presencas do horário';

// Só existe UM jeito de o engine trocar o genérico pelo honesto: `failMessages` não pode voltar
// vazia (engine.js:11054 testa `.length`). É esta a prova de reversão.
const PEDIDO_DE_REPETICAO = /me manda de novo|me passa de novo|manda de novo|tenta de novo/i;

// ── PROVA DE REVERSÃO ────────────────────────────────────────────────────────────────────────
test('caso Clayton: a tarefa é da Fefê — a mensagem nomeia a dona', () => {
  const msg = mensagemAlvoNaoAchado(TITULO_CLAYTON, 'Fefê');
  assert.ok(msg && msg.trim(), 'sem mensagem o engine cai no genérico — é o bug');
  assert.match(msg, /Fefê/, 'sem o nome a pessoa não sabe pra quem olhar');
  assert.match(msg, /report se está tudo certo/, 'tem que dizer QUAL tarefa');
});

test('caso Clayton: não manda repetir — repetir nunca vai funcionar', () => {
  const msg = mensagemAlvoNaoAchado(TITULO_CLAYTON, 'Fefê');
  assert.doesNotMatch(msg, PEDIDO_DE_REPETICAO,
    'o handler só casa por assigned_to: pedir de novo devolve exatamente a mesma falha');
});

test('caso Mayra: não existe tarefa aberta com esse nome — diz isso, não "me manda de novo"', () => {
  const msg = mensagemAlvoNaoAchado(TITULO_MAYRA, null);
  assert.ok(msg && msg.trim());
  assert.match(msg, /não achei|Não achei/);
  assert.doesNotMatch(msg, PEDIDO_DE_REPETICAO,
    'a Mayra repetiu ("Feito" → "Feito tom") e levou a mesma resposta — o convite a repetir é o defeito');
});

// O invariante que faz o ramo do engine virar: qualquer entrada tem que render mensagem.
test('nunca devolve vazio — é isso que tira o engine do genérico', () => {
  for (const [t, d] of [[TITULO_CLAYTON, 'Fefê'], [TITULO_MAYRA, null], ['', null],
    [null, null], [undefined, undefined], ['x', ''], [42, 7]]) {
    const msg = mensagemAlvoNaoAchado(t, d);
    assert.equal(typeof msg, 'string');
    assert.ok(msg.trim().length > 0, `entrada (${JSON.stringify(t)}, ${JSON.stringify(d)}) voltou vazia`);
  }
});

// ── A MENSAGEM NÃO PODE VIRAR A PRÓXIMA MENTIRA ──────────────────────────────────────────────
// Ela sai no lugar do texto otimista do LLM (engine.js:11055 substitui `base`). Se afirmasse
// conclusão, o chokepoint rebaixaria ela mesma e a pessoa ficaria sem informação nenhuma.
test('não afirma que concluiu nada', () => {
  for (const msg of [mensagemAlvoNaoAchado(TITULO_CLAYTON, 'Fefê'), mensagemAlvoNaoAchado(TITULO_MAYRA, null)]) {
    assert.doesNotMatch(msg, /^✅|conclu[ií]|dei baixa|fechei|feito!/i);
  }
});

// Só o primeiro nome: é o padrão do irmão reschedule (engine.js:4886) e o jeito que o time se
// trata no WhatsApp.
test('usa só o primeiro nome do dono', () => {
  const msg = mensagemAlvoNaoAchado(TITULO_CLAYTON, 'Maria Fernanda Souza');
  assert.match(msg, /Maria/);
  assert.doesNotMatch(msg, /Fernanda|Souza/);
});

// Título longo vira parede num celular. Os irmãos cortam em 60.
test('título longo é truncado', () => {
  const longo = 'A'.repeat(200);
  const msg = mensagemAlvoNaoAchado(longo, null);
  assert.ok(msg.length < 200, `mensagem ficou com ${msg.length} chars`);
  assert.doesNotMatch(msg, /A{100}/);
});

test('dono só com espaço em branco cai no ramo de "não achei"', () => {
  assert.match(mensagemAlvoNaoAchado(TITULO_MAYRA, '   '), /não achei|Não achei/);
});
