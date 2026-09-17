'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tratarCadastroInformadoNoGrupo } = require('./pix-cadastro-grupo');

const filha = (id, title, pagador_chave) => ({ id, title, pagador_chave });
const nuncaChama = (nome) => async () => { throw new Error(`${nome} não deveria ser chamado`); };
// deps.filhasPix devolve { pacotes, filhas } — `pacotes` = quantos pacotes PIX abertos o grupo tem
// (I5: sem pacote aberto, o atalho não intercepta).
const comPacote = (...filhas) => async () => ({ pacotes: 1, filhas });

test('1 filha casando: dá baixa, grava marcador com a chave (sem cortar) e responde o texto de sucesso', async () => {
  const fechadas = [];
  const marcadores = [];
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: comPacote(filha('t1', 'PIX automático — Ana Lima (Rafa)', 'u1:p1')),
      fecharFilha: async (id) => { fechadas.push(id); return true; },
      gravarMarcador: async (arg) => { marcadores.push(arg); return true; },
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.deepStrictEqual(fechadas, ['t1']);
  assert.strictEqual(marcadores.length, 1);
  assert.strictEqual(marcadores[0].collaboratorId, 'c1');
  assert.strictEqual(marcadores[0].pagadorChave, 'u1:p1');
  assert.match(out.texto, /Ana Lima/);
});

test('0 filhas casando (há pacote aberto): responde que o nome não está na pauta de hoje, sem nenhuma escrita', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: comPacote(filha('t1', 'PIX automático — Bruno Sá', 'u1:p2')),
      fecharFilha: nuncaChama('fecharFilha'),
      gravarMarcador: nuncaChama('gravarMarcador'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.strictEqual(out.texto, '*Ana Lima* não está na pauta do PIX de hoje deste grupo. Se já cadastrou, o Emusys confirma amanhã e sai da lista sozinho.');
});

test('2+ filhas casando: responde ambíguo, sem nenhuma escrita', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana no pix automático',
    deps: {
      filhasPix: comPacote(
        filha('t1', 'PIX automático — Ana Lima', 'u1:p1'),
        filha('t2', 'PIX automático — Ana Souza', 'u1:p2'),
      ),
      fecharFilha: nuncaChama('fecharFilha'),
      gravarMarcador: nuncaChama('gravarMarcador'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.match(out.texto, /mais de um/);
  assert.match(out.texto, /Ana Lima/);
  assert.match(out.texto, /Ana Souza/);
});

test('filha sem vínculo (pagador_chave nulo) não pode ser baixada: trata como nome fora da pauta', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: comPacote(filha('t1', 'PIX automático — Ana Lima', null)),
      fecharFilha: nuncaChama('fecharFilha'),
      gravarMarcador: nuncaChama('gravarMarcador'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.match(out.texto, /não está na pauta do PIX de hoje/);
});

test('erro na busca das filhas: não intercepta (segue o fluxo normal)', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: { filhasPix: async () => { throw new Error('conexão recusada'); } },
  });
  assert.strictEqual(out.tratou, false);
  assert.strictEqual(out.texto, undefined);
});

test('texto sem casar detectarCadastroInformado: nem chama filhasPix', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'oi, tudo bem?',
    deps: { filhasPix: nuncaChama('filhasPix') },
  });
  assert.strictEqual(out.tratou, false);
});

// ── FIX ROUND 1 (Important): casamento por PALAVRA INTEIRA, não substring ──────────────────
test('FIX ROUND 1: "ana" não acha "Mariana Costa" por substring — responde fora da pauta, sem escrita', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana no pix automático',
    deps: {
      filhasPix: comPacote(filha('t1', 'PIX automático — Mariana Costa', 'u1:p1')),
      fecharFilha: nuncaChama('fecharFilha'),
      gravarMarcador: nuncaChama('gravarMarcador'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.match(out.texto, /não está na pauta do PIX de hoje/);
});

test('FIX ROUND 1: "Ana Lima" casa com "Ana Paula Lima" (palavra do meio não atrapalha)', async () => {
  const fechadas = [];
  const marcadores = [];
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: comPacote(filha('t1', 'PIX automático — Ana Paula Lima', 'u1:p1')),
      fecharFilha: async (id) => { fechadas.push(id); return true; },
      gravarMarcador: async (arg) => { marcadores.push(arg); return true; },
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.deepStrictEqual(fechadas, ['t1']);
  assert.strictEqual(marcadores.length, 1);
  assert.match(out.texto, /Ana Paula Lima/);
});

// ── I5 (revisão final): só intercepta em grupo que TEM pauta do PIX aberta ─────────────────────
test('I5: grupo SEM pacote PIX aberto — não intercepta (o LLM atende normalmente), sem nenhuma escrita', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g-outro', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: async () => ({ pacotes: 0, filhas: [] }),
      fecharFilha: nuncaChama('fecharFilha'),
      gravarMarcador: nuncaChama('gravarMarcador'),
    },
  });
  assert.strictEqual(out.tratou, false);
  assert.strictEqual(out.texto, undefined);
});

test('I5: grupo COM pacote aberto mas sem filha pendente (todas já baixadas) — responde que o nome não está na pauta de hoje', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: async () => ({ pacotes: 1, filhas: [] }),
      fecharFilha: nuncaChama('fecharFilha'),
      gravarMarcador: nuncaChama('gravarMarcador'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.match(out.texto, /^\*Ana Lima\* não está na pauta do PIX de hoje deste grupo\./);
});

// ── M3 (revisão final): marcador ANTES de fechar a filha ─────────────────────────────────────
test('M3: grava o marcador PIX_CADASTRO ANTES de fechar a filha', async () => {
  const ordem = [];
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: comPacote(filha('t1', 'PIX automático — Ana Lima', 'u1:p1')),
      gravarMarcador: async () => { ordem.push('marcador'); return true; },
      fecharFilha: async () => { ordem.push('fecharFilha'); return true; },
    },
  });
  assert.deepStrictEqual(ordem, ['marcador', 'fecharFilha']);
  assert.strictEqual(out.tratou, true);
});

test('M3: marcador falhou — NÃO fecha a filha e responde "Não consegui registrar agora" (tratou)', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: comPacote(filha('t1', 'PIX automático — Ana Lima', 'u1:p1')),
      gravarMarcador: async () => false,
      fecharFilha: nuncaChama('fecharFilha'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.strictEqual(out.texto, 'Não consegui registrar agora — tenta de novo daqui a pouco.');
});

test('M3: marcador que LANÇA conta como falha — não fecha a filha, mesma resposta', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: comPacote(filha('t1', 'PIX automático — Ana Lima', 'u1:p1')),
      gravarMarcador: async () => { throw new Error('boom'); },
      fecharFilha: nuncaChama('fecharFilha'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.strictEqual(out.texto, 'Não consegui registrar agora — tenta de novo daqui a pouco.');
});

test('M3: marcador gravou mas fechar a filha falhou — responde a mesma linha (tratou), sem prometer baixa', async () => {
  const marcadores = [];
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: comPacote(filha('t1', 'PIX automático — Ana Lima', 'u1:p1')),
      gravarMarcador: async (arg) => { marcadores.push(arg); return true; },
      fecharFilha: async () => false,
    },
  });
  assert.strictEqual(marcadores.length, 1);
  assert.strictEqual(out.tratou, true);
  assert.strictEqual(out.texto, 'Não consegui registrar agora — tenta de novo daqui a pouco.');
});
