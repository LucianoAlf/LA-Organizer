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

// ── FILA-MUDA-NO-GRUPO-DE-OPS (Alf 11/09) ─────────────────────────────────────────────────
// 07:40 o Alf respondeu a fila no grupo de ops SEM chamar o TOM; o vigia descartou como
// "silencio intencional" antes de o canal de ops ver a mensagem. A fila prometia "responde aqui".
const MSG_FILA = { id: 'M1', group_id: 'G1', sender_id: 'C1', kind: 'text', content: '1. aprovo\n2. aprovo\n3. aprovo' };
test('REGRESSAO: comando da fila no grupo de ops chega no engine com a janela fechada', async () => {
  const chamadas = [];
  await processOne(fakeSupabase(), MSG_FILA, { processMessage: async (a) => { chamadas.push(a); }, isOpsChannel: () => true, sendTyping: async () => {} });
  assert.strictEqual(chamadas.length, 1);
});
test('fora do grupo de ops (ou remetente fora da allowlist) o mesmo texto segue o silêncio da janela', async () => {
  const chamadas = [];
  await processOne(fakeSupabase(), MSG_FILA, { processMessage: async (a) => { chamadas.push(a); }, isOpsChannel: () => false, sendTyping: async () => {} });
  assert.strictEqual(chamadas.length, 0);
});
test('no grupo de ops, conversa que não é comando continua exigindo o TOM chamado', async () => {
  const chamadas = [];
  await processOne(fakeSupabase(), { ...MSG_FILA, content: 'bom dia, pessoal' }, { processMessage: async (a) => { chamadas.push(a); }, isOpsChannel: () => true, sendTyping: async () => {} });
  assert.strictEqual(chamadas.length, 0);
});

// ── GRUPO-AUDIO-VIRA-REACAO (auditoria 13/09) ─────────────────────────────────────────────
// O ramo `reacaoSemTexto` nasceu em 02/09 pra o "👀" da Ana Paula: gesto nao e conversa, e com
// a janela aberta o TOM emendava assunto sozinho. Certo — mas o watcher alimenta esse gate com
// `msg.content`, enquanto TODO o resto da linha (vocativo, despedida, comando de ops, engine)
// usa o `text` EFETIVO, que ja inclui a transcricao da midia. Audio e imagem entram com
// `content` NULL: para o gate, um audio de 40 segundos e indistinguivel de uma figurinha.
//
// O ramo e o PRIMEIRO do decideGroupReply, entao ele passa por cima da janela aberta. Medido
// no banco em 13/09, desde o nascimento do ramo: 33 midias de membro com transcricao real e
// sem vocativo, e em 5 delas o TOM tinha acabado de falar (<=8min) — ou seja, a janela estava
// aberta e o gate inverteu o desfecho.
const AUDIO_SEM_CONTENT = { id: 'M1', group_id: 'G1', sender_id: 'C1', kind: 'audio', content: null };
const JANELA_ABERTA = { tom_chat_engaged_at: new Date().toISOString(), wa_group_jid: null };

test('REGRESSAO: audio com transcricao real nao e tratado como reacao (janela aberta)', async () => {
  const chamadas = [];
  await processOne(fakeSupabase({ group: JANELA_ABERTA }), AUDIO_SEM_CONTENT, {
    processMessage: async (a) => { chamadas.push(a); },
    extractMediaText: async () => 'Isso ai a gente nao vai ter nao, e muito antigo',
    sendTyping: async () => {},
  });
  assert.strictEqual(chamadas.length, 1, 'audio falado com a janela aberta e conversa, nao gesto');
});

test('CONTROLE: midia sem texto extraido segue sendo reacao — cala igual', async () => {
  const chamadas = [];
  await processOne(fakeSupabase({ group: JANELA_ABERTA }), { ...AUDIO_SEM_CONTENT, kind: 'image' }, {
    processMessage: async (a) => { chamadas.push(a); },
    extractMediaText: async () => '',
    sendTyping: async () => {},
  });
  assert.strictEqual(chamadas.length, 0, 'figurinha/emoji continua sendo gesto');
});

test('CONTROLE: emoji em texto com a janela aberta continua mudo (o caso Ana Paula 02/09)', async () => {
  const chamadas = [];
  await processOne(fakeSupabase({ group: JANELA_ABERTA }), { ...AUDIO_SEM_CONTENT, kind: 'text', content: '👀' }, {
    processMessage: async (a) => { chamadas.push(a); }, sendTyping: async () => {},
  });
  assert.strictEqual(chamadas.length, 0);
});
