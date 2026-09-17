'use strict';
// pix-consulta-fontes.test.js — leitura das fontes (get_pix_migracao_v1 / get_situacao_alunos_v1)
// e orquestração do turno do grupo. Nenhum teste aqui toca banco: tudo por `deps`.
const { test } = require('node:test');
const assert = require('node:assert');
const f = require('./pix-consulta-fontes');

const DADO = '2026-09-17T09:00:00Z';
const linha = (o) => ({ pagador_nome: 'X', pagador_chave: 'k', alunos: [], dado_atualizado_em: DADO, fatia: null, categoria: 'nao_mexe', ...o });
const ok = (data) => async () => ({ data, error: null });
const erro = (msg) => async () => ({ data: null, error: { message: msg } });
const semRetry = (consulta) => consulta();

// Fonte do PIX parecida com a real: migrar com fatia, autorizacao_pendente com fatia nula,
// ja_migrou/nao_mexe/inadimplente fora da pauta (e com fatia nula).
const PIX = [
  linha({ categoria: 'migrar', fatia: 'pix_avulso', pagador_nome: 'Bia', alunos: ['B1'] }),
  linha({ categoria: 'migrar', fatia: 'pix_avulso', pagador_nome: 'Ana', alunos: ['A1', 'A2'] }),
  linha({ categoria: 'migrar', fatia: 'cheque', pagador_nome: 'Caio' }),
  linha({ categoria: 'autorizacao_pendente', fatia: null, pagador_nome: 'Dora' }),
  linha({ categoria: 'ja_migrou', fatia: null, pagador_nome: 'Edu', migrou_em: '2026-09-10' }),
  // Quem JÁ migrou mas a fonte ainda carimba com a fatia de origem: nunca pode aparecer na lista
  // de "pix avulso" (seria cobrar de novo quem já resolveu).
  linha({ categoria: 'ja_migrou', fatia: 'pix_avulso', pagador_nome: 'Alice', migrou_em: '2026-09-11' }),
  linha({ categoria: 'nao_mexe', fatia: null, pagador_nome: 'Fred' }),
  linha({ categoria: 'nao_mexe', fatia: null, pagador_nome: 'Gil' }),
  linha({ categoria: 'inadimplente', fatia: null, pagador_nome: 'Hugo' }),
  linha({ categoria: 'nao_pagante', fatia: null, pagador_nome: 'Ivo' }),
  linha({ categoria: 'excecao', fatia: null, pagador_nome: 'Joca' }),
  linha({ categoria: 'categoria_nova_da_fonte', fatia: null, pagador_nome: 'Lia' }),
];
const ALUNOS = [
  { nome: 'Aluno 1', anamnese_preenchida: false, contrato_assinatura_status: 'nao_assinado', contrato_dado_fresco: true },
  { nome: 'Aluno 2', anamnese_preenchida: true, contrato_assinatura_status: 'assinado', contrato_dado_fresco: true },
  { nome: 'Aluno 3', anamnese_preenchida: false, contrato_assinatura_status: 'sem_contrato', contrato_dado_fresco: true },
  { nome: 'Aluno 4', anamnese_preenchida: true, contrato_assinatura_status: 'nao_verificado', contrato_dado_fresco: false },
];
const depsFeliz = { rpcPix: ok(PIX), rpcSituacao: ok(ALUNOS), retry: semRetry };

// ── numerosDaUnidade ──────────────────────────────────────────────────────────────────────────
test('conta por categoria e por fatia — fatia SÓ do que está na pauta (migrar + autorização)', async () => {
  const n = await f.numerosDaUnidade({ unidadeId: 'u1', unidadeNome: 'Barra', hoje: '2026-09-17', deps: depsFeliz });
  assert.strictEqual(n.pix.total, 12);
  assert.strictEqual(n.pix.migrar, 3);
  assert.strictEqual(n.pix.autorizacao_pendente, 1);
  assert.strictEqual(n.pix.faltam, 4);
  assert.strictEqual(n.pix.ja_migrou, 2);
  assert.strictEqual(n.pix.nao_mexe, 2);
  assert.strictEqual(n.pix.inadimplente, 1);
  assert.strictEqual(n.pix.nao_pagante, 1);
  assert.strictEqual(n.pix.excecao, 1);
  assert.strictEqual(n.pix.outras, 1, 'categoria que a fonte inventar não some — cai em outras');
  assert.strictEqual(n.pix.fatias.pix_avulso, 2);
  assert.strictEqual(n.pix.fatias.cheque, 1);
  assert.strictEqual(n.pix.fatias.autorizacao_pendente, 1);
  // O DEFEITO QUE ISTO PRENDE: contar fatia sobre TODAS as linhas jogaria as 7 linhas de fatia
  // nula (ja_migrou/nao_mexe/inadimplente/…) em sem_historico — no dado real de hoje isso são
  // 215 clientes virando "sem histórico" no Recreio.
  assert.strictEqual(n.pix.fatias.sem_historico, 0);
  assert.strictEqual(n.dadoEm, DADO);
  assert.strictEqual(n.motivo, null);
});

test('anamnese e contrato saem de filtrarPorRecorte, com a base (total de linhas da fonte)', async () => {
  const n = await f.numerosDaUnidade({ unidadeId: 'u1', unidadeNome: 'Barra', hoje: '2026-09-17', deps: depsFeliz });
  assert.deepStrictEqual(n.anamnese, { pendentes: 2, base: 4 });
  // nao_verificado com dado não-fresco NÃO é cobrável (regra de situacao-aluno.js)
  assert.deepStrictEqual(n.contrato, { pendentes: 2, base: 4 });
});

test('dadoEm é o dado_atualizado_em MAIS NOVO do PIX', async () => {
  const n = await f.numerosDaUnidade({
    unidadeId: 'u1', unidadeNome: 'Barra', hoje: '2026-09-17',
    deps: { ...depsFeliz, rpcPix: ok([linha({ dado_atualizado_em: '2026-09-15T10:00:00Z' }), linha({ dado_atualizado_em: '2026-09-17T06:00:00Z' })]) },
  });
  assert.strictEqual(n.dadoEm, '2026-09-17T06:00:00Z');
});

test('hoje: o bloco sabe se o dado é de hoje ou não (não cobra em cima de dado velho calado)', async () => {
  const a = await f.numerosDaUnidade({ unidadeId: 'u1', unidadeNome: 'Barra', hoje: '2026-09-17', deps: depsFeliz });
  assert.strictEqual(a.dadoDeHoje, true);
  const b = await f.numerosDaUnidade({ unidadeId: 'u1', unidadeNome: 'Barra', hoje: '2026-09-19', deps: depsFeliz });
  assert.strictEqual(b.dadoDeHoje, false);
});

test('PIX falhou: motivo preenchido, pix null, e NADA inventado (anamnese ainda responde)', async () => {
  const n = await f.numerosDaUnidade({
    unidadeId: 'u1', unidadeNome: 'Barra', hoje: '2026-09-17',
    deps: { ...depsFeliz, rpcPix: erro('timeout na RPC') },
  });
  assert.strictEqual(n.pix, null);
  assert.strictEqual(n.dadoEm, null);
  assert.match(n.motivo, /timeout na RPC/);
  assert.deepStrictEqual(n.anamnese, { pendentes: 2, base: 4 });
});

test('situação dos alunos falhou: anamnese e contrato null, PIX segue inteiro', async () => {
  const n = await f.numerosDaUnidade({
    unidadeId: 'u1', unidadeNome: 'Barra', hoje: '2026-09-17',
    deps: { ...depsFeliz, rpcSituacao: erro('conexão caiu') },
  });
  assert.strictEqual(n.anamnese, null);
  assert.strictEqual(n.contrato, null);
  assert.strictEqual(n.pix.faltam, 4);
  assert.match(n.motivo, /conexão caiu/);
});

test('as duas fontes fora: tudo null e motivo com as duas causas', async () => {
  const n = await f.numerosDaUnidade({
    unidadeId: 'u1', unidadeNome: 'Barra', hoje: '2026-09-17',
    deps: { rpcPix: erro('erro A'), rpcSituacao: erro('erro B'), retry: semRetry },
  });
  assert.strictEqual(n.pix, null);
  assert.strictEqual(n.anamnese, null);
  assert.match(n.motivo, /erro A/);
  assert.match(n.motivo, /erro B/);
});

test('a leitura passa por consultaComRetry (uma falha passageira não derruba o número)', async () => {
  let chamadas = 0;
  const n = await f.numerosDaUnidade({
    unidadeId: 'u1', unidadeNome: 'Barra', hoje: '2026-09-17',
    deps: {
      ...depsFeliz,
      rpcPix: async () => { chamadas += 1; return chamadas === 1 ? { data: null, error: { message: 'oscilou' } } : { data: PIX, error: null }; },
      retry: undefined, // usa o consultaComRetry de verdade
      esperaMs: 0,
    },
  });
  assert.strictEqual(chamadas, 2, 'tentou de novo');
  assert.strictEqual(n.pix.faltam, 4);
  assert.strictEqual(n.motivo, null);
});

// ── itensDaLista ──────────────────────────────────────────────────────────────────────────────
test('alvo pix: só quem falta migrar, na ordem de prioridade já existente', async () => {
  const itens = await f.itensDaLista({ unidadeId: 'u1', alvo: 'pix', deps: depsFeliz });
  assert.deepStrictEqual(itens.map((i) => i.pagador), ['Dora', 'Ana', 'Bia', 'Caio']);
  assert.deepStrictEqual(itens[1].alunos, ['A1', 'A2']);
  assert.ok(!itens.some((i) => ['Alice', 'Edu', 'Fred', 'Hugo', 'Ivo', 'Joca', 'Lia'].includes(i.pagador)));
});

test('alvo de fatia: só aquela fatia, em ordem alfabética dentro dela', async () => {
  const itens = await f.itensDaLista({ unidadeId: 'u1', alvo: 'pix_avulso', deps: depsFeliz });
  assert.deepStrictEqual(itens.map((i) => i.pagador), ['Ana', 'Bia']);
});

test('alvo ja_migrou e autorizacao_pendente leem CATEGORIA, não fatia', async () => {
  assert.deepStrictEqual((await f.itensDaLista({ unidadeId: 'u1', alvo: 'ja_migrou', deps: depsFeliz })).map((i) => i.pagador), ['Alice', 'Edu']);
  assert.deepStrictEqual((await f.itensDaLista({ unidadeId: 'u1', alvo: 'autorizacao_pendente', deps: depsFeliz })).map((i) => i.pagador), ['Dora']);
});

test('alvo anamnese/contrato lê a situação dos alunos, não o PIX', async () => {
  assert.deepStrictEqual((await f.itensDaLista({ unidadeId: 'u1', alvo: 'anamnese', deps: depsFeliz })).map((i) => i.pagador), ['Aluno 1', 'Aluno 3']);
  assert.deepStrictEqual((await f.itensDaLista({ unidadeId: 'u1', alvo: 'contrato', deps: depsFeliz })).map((i) => i.pagador), ['Aluno 1', 'Aluno 3']);
});

test('fonte falhou: itensDaLista LANÇA — quem chama responde honesto, ninguém devolve lista vazia', async () => {
  await assert.rejects(
    () => f.itensDaLista({ unidadeId: 'u1', alvo: 'pix', deps: { ...depsFeliz, rpcPix: erro('caiu') } }),
    /caiu/,
  );
});

test('nenhum item carrega telefone, cpf, e-mail, valor ou id de fatura', async () => {
  for (const alvo of ['pix', 'pix_avulso', 'anamnese', 'contrato']) {
    for (const it of await f.itensDaLista({ unidadeId: 'u1', alvo, deps: depsFeliz })) {
      assert.deepStrictEqual(Object.keys(it).sort(), ['alunos', 'pagador']);
    }
  }
});

// ── atenderPedidoNoGrupo ──────────────────────────────────────────────────────────────────────
const postados = () => { const p = []; return [p, async (t) => { p.push(t); return { id: `m${p.length}` }; }]; };

test('pedido de LISTA num grupo COM unidade: posta as mensagens em ordem e não chama o LLM', async () => {
  const [p, postar] = postados();
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: 'u1', unidadeNome: 'Barra', text: 'me manda a lista completa do pix avulso',
    hoje: '2026-09-17', postar, deps: depsFeliz,
  });
  assert.strictEqual(r.tratou, true);
  assert.strictEqual(r.numerosContext, '');
  assert.strictEqual(p.length, 1);
  assert.match(p[0], /Pix avulso — Barra/);
  assert.match(p[0], /• Ana — A1, A2/);
  assert.strictEqual(r.ultimo.id, 'm1');
});

test('lista com 120 clientes: sai em 3 mensagens, na ordem, e o grupo recebe TODAS', async () => {
  const muitos = Array.from({ length: 120 }, (_, i) => linha({ categoria: 'migrar', fatia: 'pix_avulso', pagador_nome: `Cliente ${String(i + 1).padStart(3, '0')}` }));
  const [p, postar] = postados();
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: 'u1', unidadeNome: 'Campo Grande', text: 'manda a lista completa do pix avulso',
    hoje: '2026-09-17', postar, deps: { ...depsFeliz, rpcPix: ok(muitos) },
  });
  assert.strictEqual(r.tratou, true);
  assert.strictEqual(p.length, 3);
  assert.match(p[0], /parte 1\/3/);
  assert.match(p[2], /parte 3\/3/);
  assert.strictEqual(p.reduce((s, m) => s + (m.split('\n• ').length - 1), 0), 120);
});

test('as partes saem UMA POR VEZ, na ordem — mesmo com a parte 1 demorando mais que as outras', async () => {
  const muitos = Array.from({ length: 120 }, (_, i) => linha({ categoria: 'migrar', fatia: 'pix_avulso', pagador_nome: `Cliente ${String(i + 1).padStart(3, '0')}` }));
  const p = [];
  // Postagem em paralelo (Promise.all) entregaria as partes 2 e 3 ANTES da 1 — no grupo a lista
  // chegaria embaralhada, com "parte 3/3" em cima de "parte 1/3".
  const postar = async (t) => {
    if (/parte 1\/3/.test(t)) await new Promise((r) => setTimeout(r, 30));
    p.push(t.split('\n')[0]);
    return { id: `m${p.length}` };
  };
  await f.atenderPedidoNoGrupo({
    unidadeId: 'u1', unidadeNome: 'Campo Grande', text: 'manda a lista completa do pix avulso',
    hoje: '2026-09-17', postar, deps: { ...depsFeliz, rpcPix: ok(muitos) },
  });
  assert.deepStrictEqual(p.map((l) => /parte (\d)\/3/.exec(l)[1]), ['1', '2', '3']);
});

test('pedido de LISTA num grupo SEM unidade: pergunta a unidade e não lê fonte nenhuma', async () => {
  const [p, postar] = postados();
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: null, unidadeNome: null, text: 'me manda a lista completa do pix avulso',
    hoje: '2026-09-17', postar,
    deps: { rpcPix: async () => { throw new Error('não deveria ler a fonte'); }, rpcSituacao: async () => { throw new Error('não deveria ler a fonte'); }, retry: semRetry },
  });
  assert.strictEqual(r.tratou, true);
  assert.strictEqual(p.length, 1);
  assert.match(p[0], /unidade/i);
});

test('pedido de LISTA com a fonte fora: uma linha honesta, nunca lista vazia nem silêncio', async () => {
  const [p, postar] = postados();
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: 'u1', unidadeNome: 'Barra', text: 'me manda a lista completa do pix avulso',
    hoje: '2026-09-17', postar, deps: { ...depsFeliz, rpcPix: erro('a RPC caiu') },
  });
  assert.strictEqual(r.tratou, true);
  assert.strictEqual(p.length, 1);
  assert.match(p[0], /LA Report/);
  assert.ok(!/parte 1/.test(p[0]), 'não posta cabeçalho de lista sem lista');
});

test('pedido de NÚMEROS: NÃO intercepta — injeta o bloco no prompt do LLM', async () => {
  const [p, postar] = postados();
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: 'u1', unidadeNome: 'Barra', text: 'quantos faltam de contrato?',
    hoje: '2026-09-17', postar, deps: depsFeliz,
  });
  assert.strictEqual(r.tratou, false);
  assert.strictEqual(p.length, 0, 'nada postado — quem fala é o LLM');
  assert.match(r.numerosContext, /Contrato: 2 pendentes de 4/);
  assert.match(r.numerosContext, /faltam migrar 4/);
  assert.match(r.numerosContext, /Nunca estime/);
});

test('fala solta que cita o assunto também ganha os números (qualquer forma de perguntar)', async () => {
  const [, postar] = postados();
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: 'u1', unidadeNome: 'Barra', text: 'e a anamnese, como tá indo?',
    hoje: '2026-09-17', postar, deps: depsFeliz,
  });
  assert.strictEqual(r.tratou, false);
  assert.match(r.numerosContext, /Anamnese: 2 pendentes de 4/);
});

test('GATE BARATO: mensagem sem nenhum dos assuntos NÃO lê a fonte', async () => {
  const [, postar] = postados();
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: 'u1', unidadeNome: 'Barra', text: 'bom dia, time!', hoje: '2026-09-17', postar,
    deps: { rpcPix: async () => { throw new Error('leu a fonte à toa'); }, rpcSituacao: async () => { throw new Error('leu a fonte à toa'); }, retry: semRetry },
  });
  assert.strictEqual(r.tratou, false);
  assert.strictEqual(r.numerosContext, '');
});

test('GATE DE UNIDADE nos números: grupo sem unidade não lê fonte e não injeta nada', async () => {
  const [, postar] = postados();
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: null, unidadeNome: null, text: 'quantos faltam de contrato?', hoje: '2026-09-17', postar,
    deps: { rpcPix: async () => { throw new Error('leu a fonte sem unidade'); }, rpcSituacao: async () => { throw new Error('leu a fonte sem unidade'); }, retry: semRetry },
  });
  assert.strictEqual(r.tratou, false);
  assert.strictEqual(r.numerosContext, '');
});

test('fonte fora no pedido de NÚMEROS: injeta o bloco DIZENDO que não leu (nunca número inventado)', async () => {
  const [, postar] = postados();
  const r = await f.atenderPedidoNoGrupo({
    unidadeId: 'u1', unidadeNome: 'Barra', text: 'quantos faltam pra migrar?', hoje: '2026-09-17', postar,
    deps: { rpcPix: erro('caiu'), rpcSituacao: erro('caiu'), retry: semRetry },
  });
  assert.strictEqual(r.tratou, false);
  assert.match(r.numerosContext, /NÃO CONSEGUI LER/);
  assert.ok(!/faltam migrar \d/.test(r.numerosContext));
});
