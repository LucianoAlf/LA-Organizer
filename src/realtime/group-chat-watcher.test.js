'use strict';
// src/realtime/group-chat-watcher.test.js
// =====================================================================================
// GROUPCHAT-SENDER-NULL-DESCARTE-MUDO (auditoria 04/09) — o defeito mais grave do dia.
//
// 13 mensagens de membro entraram com `sender_id` NULL (o remetente do WhatsApp nao casou
// com nenhum colaborador cadastrado) e o watcher fazia `if (!senderCollabId) return;` DEPOIS
// do claim e ANTES do gate de vocativo. Resultado medido: exatamente as mesmas 13 ficaram sem
// `tom_done_at`, e NENHUMA mensagem com remetente valido ficou sem tratamento. A gerente
// Krissya chamou o TOM pelo nome as 11:15 e nunca foi respondida; o TOM, perguntado depois,
// INVENTOU um motivo — porque ele nao tem como saber que foi descartado antes de chegar nele.
//
// A decisao: CONVERSAR nao exige identidade, EXECUTAR exige. Ser ignorada e o pior desfecho
// possivel (nao tem recuperacao: ninguem sabe que houve pedido). Agir em nome de um
// desconhecido e o segundo pior — e esse a gente evita sem calar, cortando so a porta de
// escrita. Os testes abaixo travam as DUAS portas.
// =====================================================================================
const assert = require('node:assert');
const { test } = require('node:test');
const { processOne } = require('./group-chat-watcher');

// ── Stub de supabase: encadeavel, grava tudo o que foi escrito pra o teste conferir. ──
function fakeSupabase({ claimOk = true, group = { tom_chat_engaged_at: null, wa_group_jid: null } } = {}) {
  const escritas = [];
  const make = (tabela) => {
    const st = { tabela, _update: null, _insert: null };
    const api = {
      update(v) { st._update = v; return api; },
      insert(v) { escritas.push({ tabela, op: 'insert', valor: v }); return Promise.resolve({ data: null, error: null }); },
      select() { return api; },
      eq() { return api; },
      is() { return api; },
      gt() { return api; },
      in() { return api; },
      order() { return api; },
      limit() { return Promise.resolve({ data: [], error: null }); },
      maybeSingle() { return Promise.resolve({ data: tabela === 'work_groups' ? group : null, error: null }); },
      then(res, rej) {
        if (st._update) escritas.push({ tabela, op: 'update', valor: st._update });
        return Promise.resolve({ data: [], error: null }).then(res, rej);
      },
    };
    // O claim atomico e `update(...).eq(...).is(...).select('id')` — precisa devolver linha.
    if (tabela === 'group_chat_messages') {
      api.select = () => {
        if (st._update) {
          escritas.push({ tabela, op: 'update', valor: st._update });
          return Promise.resolve({ data: claimOk ? [{ id: 'M1' }] : [], error: null });
        }
        return api;
      };
    }
    return api;
  };
  return { from: make, _escritas: escritas };
}

const MSG_SEM_REMETENTE = { id: 'M1', group_id: 'G1', sender_id: null, kind: 'text', content: 'Tom, me manda a lista de anamneses de hoje' };

test('REGRESSAO: mensagem com sender_id NULL que chama o TOM pelo nome NAO e descartada', async () => {
  const sb = fakeSupabase();
  const chamadas = [];
  await processOne(sb, MSG_SEM_REMETENTE, { processMessage: async (a) => { chamadas.push(a); } });
  assert.equal(chamadas.length, 1, 'o motor precisa ser chamado — silencio aqui e a gerente ignorada');
  assert.equal(chamadas[0].senderCollabId, null, 'sem inventar remetente');
});

test('a porta de EXECUCAO continua fechada: o motor recebe remetenteDesconhecido=true', async () => {
  const sb = fakeSupabase();
  const chamadas = [];
  await processOne(sb, MSG_SEM_REMETENTE, { processMessage: async (a) => { chamadas.push(a); } });
  assert.equal(chamadas[0].remetenteDesconhecido, true, 'quem executa precisa saber que nao sabe quem pediu');
});

test('remetente conhecido segue igual (zero regressao) — executa e nao levanta a flag', async () => {
  const sb = fakeSupabase();
  const chamadas = [];
  await processOne(sb, { ...MSG_SEM_REMETENTE, sender_id: 'C1' }, { processMessage: async (a) => { chamadas.push(a); } });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].senderCollabId, 'C1');
  assert.equal(chamadas[0].remetenteDesconhecido, false);
});

test('o turno tratado marca tom_done_at (senao a varredura de orfa re-dispara pra sempre)', async () => {
  const sb = fakeSupabase();
  await processOne(sb, MSG_SEM_REMETENTE, { processMessage: async () => {} });
  const done = sb._escritas.filter((e) => e.op === 'update' && e.valor && e.valor.tom_done_at);
  assert.ok(done.length >= 1, 'sem tom_done_at a mensagem fica orfa pra sempre');
});

// ── A REGRA NUMERO UM DA CASA: zero por falha nao pode ser igual a zero por saude. ──
test('SENSOR: remetente desconhecido deixa rastro em marker_logs', async () => {
  const sb = fakeSupabase();
  await processOne(sb, MSG_SEM_REMETENTE, { processMessage: async () => {} });
  const logs = sb._escritas.filter((e) => e.tabela === 'marker_logs' && e.op === 'insert');
  assert.equal(logs.length, 1, 'todo descarte/degradacao precisa deixar rastro');
  assert.equal(logs[0].valor.result, 'skipped', 'result so aceita executed|rejected|skipped|fallback');
  assert.match(String(logs[0].valor.reason), /desconhecid/i);
});

test('remetente conhecido NAO polui marker_logs (o sensor mede o sintoma, nao o dia inteiro)', async () => {
  const sb = fakeSupabase();
  await processOne(sb, { ...MSG_SEM_REMETENTE, sender_id: 'C1' }, { processMessage: async () => {} });
  assert.equal(sb._escritas.filter((e) => e.tabela === 'marker_logs').length, 0);
});

test('silencio intencional (janela fechada, ninguem chamou) segue mudo, mas MARCADO', async () => {
  const sb = fakeSupabase();
  const chamadas = [];
  await processOne(sb, { ...MSG_SEM_REMETENTE, content: 'ta bom entao' },
    { processMessage: async (a) => { chamadas.push(a); } });
  assert.equal(chamadas.length, 0, 'sem vocativo e com janela fechada o TOM cala — isso e saude');
  const done = sb._escritas.filter((e) => e.op === 'update' && e.valor && e.valor.tom_done_at);
  assert.ok(done.length >= 1, 'mas o silencio precisa ficar registrado');
});
