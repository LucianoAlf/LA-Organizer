'use strict';
// A ANCORA DO BRIEFING (06/09) — irma da que o fechamento ja tinha.
//
// Caso Bianca (03/09): o briefing listou "1. ⏰ 19h — Revisar relatorios dos pacientes". Ela
// respondeu "Relatorios revisados" e ouviu "nao achei nenhuma tarefa com esse nome". A recusa
// estava CERTA: aquela tarefa esta concluida desde 28/07. A linha veio de uma MEMORIA ("Bianca
// precisa revisar relatorios as 19h"), nao de uma tarefa. O fechamento tem lista deterministica
// e o briefing nao tinha — sem ancora, memoria vira item numerado, e item numerado vira promessa.
//
// O CASO VAZIO E O PRINCIPAL. Com zero tarefa, uma ancora que simplesmente nao aparece devolve a
// liberdade que causou o defeito. Por isso a secao SAI MESMO ASSIM, dizendo para nao numerar
// nada. Quem nao tem o que numerar precisa ouvir isso mais alto que quem tem.
const { test } = require('node:test');
const assert = require('node:assert');
const { secaoDoBriefing } = require('./briefing-anchor');

const IT = (i, t) => ({ index: i, type: 'task', id: 'id-' + i, title: t });

test('com tarefas: numera EXATAMENTE as que existem', () => {
  const s = secaoDoBriefing([IT(1, 'Ligar pro Dudu'), IT(2, 'Fechar a fatura')]);
  assert.match(s, /1\. Ligar pro Dudu/);
  assert.match(s, /2\. Fechar a fatura/);
  assert.match(s, /USE EXATAMENTE/);
});

test('com tarefas: proibe numerar o que nao esta na lista', () => {
  const s = secaoDoBriefing([IT(1, 'Ligar pro Dudu')]);
  assert.match(s, /mem[óo]ria/i, 'a proibicao tem que citar memoria — foi de la que veio o caso Bianca');
  assert.match(s, /não numere|nao numere/i);
});

test('SEM tarefa: a secao sai assim mesmo, mandando nao numerar nada', () => {
  const s = secaoDoBriefing([]);
  assert.ok(s, 'lista vazia devolveu string vazia — e a liberdade que causou o caso Bianca');
  assert.match(s, /não numere|nao numere/i);
  assert.doesNotMatch(s, /^1\./m, 'nao pode existir item numerado quando nao ha tarefa');
});

test('SEM tarefa: nao inventa que o dia esta livre — so proibe numerar', () => {
  const s = secaoDoBriefing([]);
  assert.doesNotMatch(s, /dia livre|nada para fazer|sem compromissos/i);
});

test('lista nula ou indefinida se comporta como vazia', () => {
  assert.strictEqual(secaoDoBriefing(null), secaoDoBriefing([]));
  assert.strictEqual(secaoDoBriefing(undefined), secaoDoBriefing([]));
});

test('titulo com quebra de linha nao quebra a numeracao', () => {
  const s = secaoDoBriefing([IT(1, 'Ligar\npro Dudu'), IT(2, 'Outra')]);
  const linhasNumeradas = s.split('\n').filter((l) => /^\d+\. /.test(l));
  assert.strictEqual(linhasNumeradas.length, 2, `numeracao vazou: ${JSON.stringify(linhasNumeradas)}`);
});

test('falha ao montar a lista NAO vira "nao ha tarefa" — isso seria mentira', () => {
  const s = secaoDoBriefing([], { falhou: true });
  assert.doesNotMatch(s, /não há nenhuma tarefa|nao ha nenhuma tarefa/i);
  assert.match(s, /não consegui|nao consegui/i);
  assert.match(s, /não numere|nao numere/i, 'a proibicao vale ainda mais quando nao sei o que existe');
});
