'use strict';
// TITULO-REESCRITO na prova de existência da delegação (Krissya → Kailane, 29–30/09).
//
// A Krissya pediu pra delegar "ver o vídeo da Vitória"; a tarefa gravada (781d8547, criada por ela,
// atribuída à Kailane) ficou "Ver o vídeo de registro de visitas (postado pela Vitória no grupo)".
// A prova "a tarefa ainda não existe" era ilike '%ver o vídeo da Vitória%' → zero linhas → 'nova'
// → o "sim" liberava criar OUTRA. Agora o engine busca as abertas da pessoa e o classificador
// filtra por tarefasParecidas (trecho OU mesma tarefa por conteúdo).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { classificarItensDelegacao } = require('./delegacao-itens-resolve');
const { resolveTaskTarget } = require('../lib/task-target');

const GRAVADA = { id: '781d8547-0000-4000-8000-000000000001', title: 'Ver o vídeo de registro de visitas (postado pela Vitória no grupo)', criou: true };
const OUTRA = { id: '9dd7904a-0000-4000-8000-000000000002', title: 'Follow up L.A Session com Jereh (ver se Alves gravou)', criou: true };

// Fake do engine NOVO: devolve TODAS as abertas da pessoa (sem ilike) — quem filtra é o classificador.
function bancoSemIlike(tarefas) {
  return {
    queryDono: async () => tarefas.filter((t) => t.dono),
    queryCriadas: async () => tarefas.filter((t) => t.criou),
  };
}
const ITEM = [{ task_title: 'ver o vídeo da Vitória', to_name: 'Kailane' }];

test('título reescrito já existe → ambigua (pergunta "é essa ou crio nova?"), não "nova"', async () => {
  const r = await classificarItensDelegacao({ itens: ITEM, ...bancoSemIlike([GRAVADA, OUTRA]), resolveTaskTarget });
  assert.strictEqual(r.tipo, 'ambigua');
  assert.strictEqual(r.delegacao_nova, undefined);
  assert.deepStrictEqual(r.delegacao_ambigua.itens[0].parecidas, [GRAVADA.title]); // só a parecida, não a do Jereh
});

test('só tarefa não relacionada aberta → continua "nova" (o filtro não acha parecida onde não há)', async () => {
  const r = await classificarItensDelegacao({ itens: ITEM, ...bancoSemIlike([OUTRA]), resolveTaskTarget });
  assert.strictEqual(r.tipo, 'nova');
});

test('título INTEIRO de uma tarefa minha segue sendo repasse determinístico (existente)', async () => {
  const minha = { id: 'aaaaaaaa-0000-4000-8000-000000000003', title: 'Ver o vídeo de registro de visitas (postado pela Vitória no grupo)', dono: true };
  const r = await classificarItensDelegacao({
    itens: [{ task_title: minha.title, to_name: 'Kailane' }], ...bancoSemIlike([minha, OUTRA]), resolveTaskTarget,
  });
  assert.strictEqual(r.tipo, 'existente');
  assert.strictEqual(r.delegation.task_id, 'aaaaaaaa');
});

test('engine: a prova da delegação não usa mais ilike no título (busca as abertas da pessoa)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  const ini = src.indexOf('const _abertasD = async');
  assert.ok(ini > 0);
  const corpo = src.slice(ini, src.indexOf('};', ini));
  assert.doesNotMatch(corpo, /\.ilike\(/);
  assert.match(corpo, /\.not\('status', 'in', '\("done","cancelled"\)'\)/);
});
