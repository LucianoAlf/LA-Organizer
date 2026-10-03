'use strict';
// NADA-A-REGISTRAR NO GRUPO (35e58476 ligou o veto só no 1:1). No grupo, a mesma trava de
// honestidade roda em buildTomContent (porta reportedState) — e sem o veto, quem pede pra NÃO
// registrar e recebe a resposta certa ("nada marcado") levava "não consegui registrar".
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildTomContent } = require('./group-chat-engine');
const { NO_MARKER_HONEST_NOTE } = require('../lib/optimistic-confirm');

// Turno de grupo no formato real: o membro recua do "concluído" e o TOM confirma que nada mudou.
const MEMBRO = 'não não, espera — ainda não foram feitas, deixa elas em aberto por enquanto';
const TOM = 'Beleza, fica tudo como tá — nada marcado como concluído, as tarefas seguem em aberto.\n\nQuando fechar me avisa aqui no grupo. 👍';

test('grupo: "deixa elas em aberto" + "nada marcado como concluído" chega intacto', () => {
  const out = buildTomContent(TOM, [], { userText: MEMBRO });
  assert.strictEqual(out, TOM.trim());
  assert.ok(!out.includes(NO_MARKER_HONEST_NOTE));
});

test('prova de que o veto é o que muda: sem pedido de não registrar, a MESMA fala leva a nota', () => {
  const out = buildTomContent(TOM, [], { userText: 'as duas tarefas de hoje' });
  assert.ok(out.includes(NO_MARKER_HONEST_NOTE));
});

test('grupo: TOM em 1ª pessoa de escrita segue pego mesmo com pedido de não marcar', () => {
  const out = buildTomContent('✅ Marquei as duas como concluídas', [], { userText: MEMBRO });
  assert.ok(out.includes(NO_MARKER_HONEST_NOTE));
});

test('grupo: pedido misto ("não marca a 1, marca a 2") não é liberado', () => {
  const out = buildTomContent('A 2 foi marcada como concluída ✅', [], { userText: 'não marca a 1, marca a 2 como feita' });
  assert.ok(out.includes(NO_MARKER_HONEST_NOTE));
});

test('grupo: ação que FALHOU no turno não é mascarada pelo veto (a falha reescreve a fala)', () => {
  const out = buildTomContent(TOM, [{ kind: 'task', status: 'fail', verbo: 'complete', detail: 'não achei essa tarefa no grupo' }], { userText: MEMBRO });
  assert.ok(!out.startsWith('Beleza, fica tudo'), 'falha do turno reescreve a fala');
});

// âncora: a porta do grupo soma o veto, com a fala do MEMBRO e a prosa do grupo.
const grupo = fs.readFileSync(path.join(__dirname, 'group-chat-engine.js'), 'utf8');
test('âncora: porta reportedState do grupo inclui pedidoDeNadaARegistrar(userText, prose)', () => {
  assert.match(grupo, /require\('\.\.\/lib\/nada-a-registrar'\)/);
  assert.match(grupo, /\|\| linhasAcusadasSaoPergunta\(prose\)(?:\s*\|\| vetoDePergunta\(prose, [^\n]*\)\.veto)?\s*\|\| pedidoDeNadaARegistrar\(\(opts && opts\.userText\) \|\| '', prose\);/);
});
