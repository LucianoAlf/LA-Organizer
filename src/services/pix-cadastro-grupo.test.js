'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tratarCadastroInformadoNoGrupo } = require('./pix-cadastro-grupo');

const filha = (id, title, pagador_chave) => ({ id, title, pagador_chave });
const nuncaChama = (nome) => async () => { throw new Error(`${nome} não deveria ser chamado`); };

test('1 filha casando: dá baixa, grava marcador com a chave (sem cortar) e responde o texto de sucesso', async () => {
  const fechadas = [];
  const marcadores = [];
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: async () => [filha('t1', 'PIX automático — Ana Lima (Rafa)', 'u1:p1')],
      fecharFilha: async (id) => { fechadas.push(id); return true; },
      gravarMarcador: async (arg) => { marcadores.push(arg); },
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.deepStrictEqual(fechadas, ['t1']);
  assert.strictEqual(marcadores.length, 1);
  assert.strictEqual(marcadores[0].collaboratorId, 'c1');
  assert.strictEqual(marcadores[0].pagadorChave, 'u1:p1');
  assert.match(out.texto, /Ana Lima/);
});

test('0 filhas casando: responde que não achou, sem nenhuma escrita', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: async () => [filha('t1', 'PIX automático — Bruno Sá', 'u1:p2')],
      fecharFilha: nuncaChama('fecharFilha'),
      gravarMarcador: nuncaChama('gravarMarcador'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.match(out.texto, /Não achei/);
});

test('2+ filhas casando: responde ambíguo, sem nenhuma escrita', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana no pix automático',
    deps: {
      filhasPix: async () => [
        filha('t1', 'PIX automático — Ana Lima', 'u1:p1'),
        filha('t2', 'PIX automático — Ana Souza', 'u1:p2'),
      ],
      fecharFilha: nuncaChama('fecharFilha'),
      gravarMarcador: nuncaChama('gravarMarcador'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.match(out.texto, /mais de um/);
  assert.match(out.texto, /Ana Lima/);
  assert.match(out.texto, /Ana Souza/);
});

test('filha sem vínculo (pagador_chave nulo) não pode ser baixada: trata como não achei', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: async () => [filha('t1', 'PIX automático — Ana Lima', null)],
      fecharFilha: nuncaChama('fecharFilha'),
      gravarMarcador: nuncaChama('gravarMarcador'),
    },
  });
  assert.strictEqual(out.tratou, true);
  assert.match(out.texto, /Não achei/);
});

test('erro na busca das filhas: não intercepta (segue o fluxo normal)', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: { filhasPix: async () => { throw new Error('conexão recusada'); } },
  });
  assert.strictEqual(out.tratou, false);
  assert.strictEqual(out.texto, undefined);
});

test('falha ao dar baixa (fecharFilha devolve false): não intercepta, não grava marcador', async () => {
  const marcadores = [];
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'cadastrei a Ana Lima no pix automático',
    deps: {
      filhasPix: async () => [filha('t1', 'PIX automático — Ana Lima', 'u1:p1')],
      fecharFilha: async () => false,
      gravarMarcador: async (arg) => { marcadores.push(arg); },
    },
  });
  assert.strictEqual(out.tratou, false);
  assert.strictEqual(marcadores.length, 0);
});

test('texto sem casar detectarCadastroInformado: nem chama filhasPix', async () => {
  const out = await tratarCadastroInformadoNoGrupo({
    groupId: 'g1', senderCollabId: 'c1', text: 'oi, tudo bem?',
    deps: { filhasPix: nuncaChama('filhasPix') },
  });
  assert.strictEqual(out.tratou, false);
});
