'use strict';
// pix-bloqueio-emusys.test.js — cliente com 2+ matrículas (família OU aluno com 2+ cursos) NÃO
// consegue ter o PIX automático ligado a todas as faturas no Emusys: só a uma. Confirmado pelo
// Alf em 19/09 ("o Emusys bloqueia, ainda tá ajustando, já pedi pro Mateus resolver"); a equipe de
// Campo Grande já operava assim (priorizar quem NÃO é família). Medido em 19/09: 82 dos 357
// clientes da pauta (23%) têm 2+ matrículas.
//
// O QUE MUDA (deliberadamente pequeno): quem está bloqueado vai pro FIM da fila e leva 🔒. Ninguém
// some — continua contado em "faltam", continua nas listas, e a mensagem diz quantos são.
// Interruptor: TOM_PIX_BLOQUEIO_EMUSYS=off (quando o Emusys liberar), sem deploy.
const { test } = require('node:test');
const assert = require('node:assert');
const pura = require('./pix-migracao');
const consulta = require('./pix-consulta');
const f = require('./pix-consulta-fontes');
const { resolverUnidade } = require('./situacao-aluno');

const BARRA = resolverUnidade('barra');
const DADO = '2026-09-19T09:00:00Z';
const L = (o) => ({ pagador_chave: `k-${o.pagador_nome}`, alunos: [], matriculas: [1], dado_atualizado_em: DADO, categoria: 'migrar', fatia: 'pix_avulso', ...o });
const livre = (nome, fatia = 'pix_avulso') => L({ pagador_nome: nome, fatia, matriculas: [11] });
const preso = (nome, fatia = 'pix_avulso') => L({ pagador_nome: nome, fatia, matriculas: [21, 22] });

const semInterruptor = async (fn) => {
  const antes = process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  delete process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  try { return await fn(); } finally { if (antes !== undefined) process.env.TOM_PIX_BLOQUEIO_EMUSYS = antes; }
};
const comInterruptor = async (valor, fn) => {
  const antes = process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  process.env.TOM_PIX_BLOQUEIO_EMUSYS = valor;
  try { return await fn(); } finally { if (antes === undefined) delete process.env.TOM_PIX_BLOQUEIO_EMUSYS; else process.env.TOM_PIX_BLOQUEIO_EMUSYS = antes; }
};

// ── bloqueadoNoEmusys ─────────────────────────────────────────────────────────────────────────
test('bloqueadoNoEmusys: precisa de cadastro NOVO (migrar) e ter 2+ matrículas', () => semInterruptor(() => {
  assert.strictEqual(pura.bloqueadoNoEmusys(preso('A')), true);
  assert.strictEqual(pura.bloqueadoNoEmusys(livre('B')), false);
  assert.strictEqual(pura.bloqueadoNoEmusys(L({ pagador_nome: 'C', matriculas: [1, 2, 3, 4] })), true);
}));

test('bloqueadoNoEmusys: quem JÁ está cadastrado (autorizacao_pendente) ou já migrou não é barrado', () => semInterruptor(() => {
  assert.strictEqual(pura.bloqueadoNoEmusys(L({ pagador_nome: 'A', categoria: 'autorizacao_pendente', matriculas: [1, 2] })), false);
  assert.strictEqual(pura.bloqueadoNoEmusys(L({ pagador_nome: 'B', categoria: 'ja_migrou', matriculas: [1, 2] })), false);
}));

test('bloqueadoNoEmusys: dado torto (sem matrículas, texto, número) nunca bloqueia — na dúvida, cobra', () => semInterruptor(() => {
  for (const matriculas of [undefined, null, [], 'x', 5, {}]) {
    assert.strictEqual(pura.bloqueadoNoEmusys(L({ pagador_nome: 'X', matriculas })), false, JSON.stringify(matriculas));
  }
  assert.strictEqual(pura.bloqueadoNoEmusys(null), false);
  assert.strictEqual(pura.bloqueadoNoEmusys(undefined), false);
}));

test('interruptor TOM_PIX_BLOQUEIO_EMUSYS=off desliga tudo (Emusys liberou); qualquer outro valor mantém ligado', async () => {
  await comInterruptor('off', () => assert.strictEqual(pura.bloqueadoNoEmusys(preso('A')), false));
  await comInterruptor('OFF', () => assert.strictEqual(pura.bloqueadoNoEmusys(preso('A')), false));
  await comInterruptor('on', () => assert.strictEqual(pura.bloqueadoNoEmusys(preso('A')), true));
  await comInterruptor('', () => assert.strictEqual(pura.bloqueadoNoEmusys(preso('A')), true));
});

// ── ordem: bloqueado vai pro fim, a prioridade das fatias segue dentro de cada grupo ───────────
test('ordenarPorPrioridade: livre de fatia baixa passa na frente de bloqueado de fatia alta', () => semInterruptor(() => {
  const ord = pura.ordenarPorPrioridade([preso('Zé Avulso', 'pix_avulso'), livre('Ana Dinheiro', 'dinheiro'), preso('Bia Cheque', 'cheque'), livre('Caio Boleto', 'boleto')]);
  assert.deepStrictEqual(ord.map((l) => l.pagador_nome), ['Caio Boleto', 'Ana Dinheiro', 'Zé Avulso', 'Bia Cheque']);
}));

test('ordenarPorPrioridade: 🔵 cadastrado sem cobrança continua sempre primeiro', () => semInterruptor(() => {
  const ord = pura.ordenarPorPrioridade([livre('Livre'), L({ pagador_nome: 'Cadastrada', categoria: 'autorizacao_pendente', fatia: null, matriculas: [1, 2] })]);
  assert.strictEqual(ord[0].pagador_nome, 'Cadastrada');
}));

test('ordenarPorPrioridade: com o interruptor off a ordem volta EXATAMENTE à de antes', async () => {
  const entrada = [preso('Zé Avulso', 'pix_avulso'), livre('Ana Dinheiro', 'dinheiro'), preso('Bia Cheque', 'cheque')];
  await comInterruptor('off', () => {
    assert.deepStrictEqual(pura.ordenarPorPrioridade(entrada).map((l) => l.pagador_nome), ['Zé Avulso', 'Bia Cheque', 'Ana Dinheiro']);
  });
});

test('loteDoDia: com folga de livres, o lote de 10 não leva nenhum bloqueado', () => semInterruptor(() => {
  const linhas = [
    ...Array.from({ length: 12 }, (_, i) => livre(`Livre ${String(i).padStart(2, '0')}`)),
    ...Array.from({ length: 3 }, (_, i) => preso(`Preso ${i}`)),
  ];
  const lote = pura.loteDoDia(linhas);
  assert.strictEqual(lote.length, 10);
  assert.ok(lote.every((l) => !pura.bloqueadoNoEmusys(l)));
}));

test('loteDoDia: quando os livres acabam, os bloqueados entram — ninguém fica sem vez pra sempre', () => semInterruptor(() => {
  const linhas = [...Array.from({ length: 4 }, (_, i) => livre(`Livre ${i}`)), ...Array.from({ length: 10 }, (_, i) => preso(`Preso ${String(i).padStart(2, '0')}`))];
  const lote = pura.loteDoDia(linhas);
  assert.strictEqual(lote.length, 10);
  assert.strictEqual(lote.filter((l) => pura.bloqueadoNoEmusys(l)).length, 6);
  assert.deepStrictEqual(lote.slice(0, 4).map((l) => l.pagador_nome), ['Livre 0', 'Livre 1', 'Livre 2', 'Livre 3']);
}));

// ── mensagem da unidade ───────────────────────────────────────────────────────────────────────
const msg = (linhas, extra = {}) => pura.mensagemDaUnidade({ unidadeNome: 'Campo Grande', linhas, lote: pura.loteDoDia(linhas), ...extra });

test('mensagem: nome de bloqueado no lote leva 🔒 e a linha diz quantos são', () => semInterruptor(() => {
  const linhas = [livre('Ana Livre'), preso('Bia Presa'), preso('Caio Preso')];
  const t = msg(linhas);
  assert.match(t, /• Bia Presa 🔒/);
  assert.match(t, /• Caio Preso 🔒/);
  assert.ok(!/Ana Livre 🔒/.test(t), 'livre nunca leva 🔒');
  assert.match(t, /🔒 Aguardando o Emusys \(2\)/);
  assert.match(t, /fim da fila/);
}));

test('mensagem: o "faltam" NÃO muda — bloqueado continua contado', () => semInterruptor(() => {
  const linhas = [livre('Ana Livre'), preso('Bia Presa'), preso('Caio Preso')];
  assert.match(msg(linhas), /faltam 3 · meta/);
}));

test('mensagem: a contagem 🔒 inclui bloqueado que ficou de fora do lote (só contado na fatia)', () => semInterruptor(() => {
  const linhas = [...Array.from({ length: 12 }, (_, i) => livre(`Livre ${String(i).padStart(2, '0')}`)), preso('Presa Um'), preso('Presa Dois'), preso('Presa Tres')];
  const t = msg(linhas);
  assert.match(t, /🔒 Aguardando o Emusys \(3\)/);
  assert.ok(!/Presa Um/.test(t), 'fora do lote não é listado por nome (igual a qualquer outro fora do lote)');
  assert.match(t, /faltam 15 · meta/);
}));

test('mensagem: sem nenhum bloqueado o texto é IDÊNTICO ao de antes (nada de linha nova)', () => semInterruptor(() => {
  const t = msg([livre('Ana'), livre('Bia')]);
  assert.ok(!/🔒|Emusys liberar|Aguardando o Emusys/.test(t));
}));

test('mensagem: interruptor off -> sem 🔒 e sem linha, mesmo com bloqueado na fonte', async () => {
  await comInterruptor('off', () => {
    const t = msg([livre('Ana'), preso('Bia Presa')]);
    assert.ok(!/🔒|Aguardando o Emusys/.test(t));
  });
});

test('mensagem: a linha 🔒 não usa a palavra do 1ª cobrança (são coisas diferentes)', () => semInterruptor(() => {
  const t = msg([preso('Bia Presa')], { aguardandoCobranca: 2 });
  assert.match(t, /⏳ Aguardando 1ª cobrança \(2\)/);
  assert.match(t, /🔒 Aguardando o Emusys \(1\)/);
  assert.match(t, /faltam 3 · meta/);
}));

// ── consulta por marcador/lista: mesma regra, mesma marca ─────────────────────────────────────
const ok = (data) => async () => ({ data, error: null });
const semRetry = (c) => c();
const PIX = [livre('Ana Livre'), preso('Bia Presa'), L({ pagador_nome: 'Cadastrada', categoria: 'autorizacao_pendente', fatia: null, matriculas: [1, 2] })];
const deps = { rpcPix: ok(PIX), rpcSituacao: ok([]), retry: semRetry };

test('lista do PIX: bloqueado leva 🔒 no nome, na MESMA lista (nada escondido) e a legenda explica', () => semInterruptor(async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['pix_avulso'], deps });
  const t = r.msgs.join('\n');
  assert.match(t, /Ana Livre/);
  assert.match(t, /Bia Presa 🔒/);
  assert.ok(!/Ana Livre 🔒/.test(t));
  assert.match(t, /🔒 = aguardando o Emusys/);
  assert.strictEqual(r.total, 2);
}));

test('lista do PIX: ordem segue a regra (livre antes de bloqueado) e sem bloqueado não há legenda', () => semInterruptor(async () => {
  const r = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['pix_avulso'], deps });
  const t = r.msgs.join('\n');
  assert.ok(t.indexOf('Ana Livre') < t.indexOf('Bia Presa'));
  const r2 = await f.mensagensDaListaPix({ unidadeId: BARRA, unidadeNome: 'Barra', alvos: ['pix_avulso'], deps: { ...deps, rpcPix: ok([livre('Só Livre')]) } });
  assert.ok(!/🔒/.test(r2.msgs.join('\n')));
}));

test('itens da lista continuam só com pagador+alunos (sem chave extra, sem dado sensível)', () => semInterruptor(async () => {
  for (const it of await f.itensDaLista({ unidadeId: BARRA, alvo: 'pix', deps })) {
    assert.deepStrictEqual(Object.keys(it).sort(), ['alunos', 'pagador']);
  }
}));

test('números: conta os bloqueados dentro do "faltam" e o prompt do LLM mostra a linha', () => semInterruptor(async () => {
  const n = await f.numerosDaUnidade({ unidadeId: BARRA, unidadeNome: 'Barra', hoje: '2026-09-19', deps });
  assert.strictEqual(n.pix.faltam, 3);
  assert.strictEqual(n.pix.bloqueado_emusys, 1);
  const bloco = consulta.blocoDeNumeros({ ...n, unidadeNome: 'Barra' });
  assert.match(bloco, /1 estão aguardando o Emusys/);
  assert.match(bloco, /2\+ (cursos|matr)/i);
}));

test('números: bloqueado_emusys = 0 não gera linha nenhuma no bloco', () => semInterruptor(async () => {
  const n = await f.numerosDaUnidade({ unidadeId: BARRA, unidadeNome: 'Barra', hoje: '2026-09-19', deps: { ...deps, rpcPix: ok([livre('Só Livre')]) } });
  assert.strictEqual(n.pix.bloqueado_emusys, 0);
  assert.ok(!/Emusys/.test(consulta.blocoDeNumeros({ ...n, unidadeNome: 'Barra' })));
}));

test('números das três unidades: soma os bloqueados na linha do TOTAL', () => semInterruptor(async () => {
  const porUnidade = await f.numerosDeTodasUnidades({ hoje: '2026-09-19', deps });
  const bloco = consulta.blocoDeNumerosTodasUnidades({ unidades: porUnidade });
  assert.match(bloco, /TOTAL[^\n]*/);
  assert.match(bloco, /TOTAL[^\n]*\(3 aguardando o Emusys/);
}));

test('prompt do marcador explica o 🔒 (o LLM não inventa o que ele significa)', () => {
  const p = require('./group-chat-prompt').buildGroupChatPrompt({ soulText: '', groupName: 'G', members: [], pool: [], history: [], senderName: 'X' });
  assert.match(p, /🔒[^\n]*Emusys/);
});
