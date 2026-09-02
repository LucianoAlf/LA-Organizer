"use strict";
const { test } = require('node:test');
const assert = require('node:assert');
const { destinoDoLembrete, enviarLembreteDeGrupo } = require('./group-task-reminder');

function fakeSupabase({ group }) {
  const inserts = [];
  return {
    _inserts: inserts,
    from(tbl) {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: group }) }) }),
        insert: async (row) => { inserts.push({ tbl, row }); return { error: null }; },
      };
    },
  };
}

const TAREFA = { id: 't1', assigned_group_id: 'g1', title: 'Assinar contrato — Davi Verás' };
const TEXTO = '⏰ Lembrete: *Assinar contrato — Davi Verás* (grupo)';

test('grupo VINCULADO ao WhatsApp: uma mensagem no grupo, nenhuma DM', async () => {
  const sb = fakeSupabase({ group: { id: 'g1', name: 'Recreio', wa_group_jid: '55@g.us' } });
  let dms = 0;
  const r = await enviarLembreteDeGrupo({
    supabase: sb, task: TAREFA, texto: TEXTO,
    deps: { membros: [{ collaborator_id: 'c1', phone: '21' }, { collaborator_id: 'c2', phone: '22' }],
            sendAndLink: async () => { dms++; } },
  });
  assert.strictEqual(r.destino, 'grupo');
  assert.strictEqual(r.enviados, 1);
  assert.strictEqual(dms, 0, 'grupo vinculado NÃO manda DM');
  const msg = sb._inserts.find((i) => i.tbl === 'group_chat_messages');
  assert.ok(msg, 'gravou a mensagem no chat do grupo');
  assert.strictEqual(msg.row.role, 'tom');
  assert.strictEqual(msg.row.sender_id, null);
  assert.strictEqual(msg.row.content, TEXTO);
});

test('ZERO-REGRESSÃO: grupo SEM WhatsApp mantém o fan-out por DM', async () => {
  const sb = fakeSupabase({ group: { id: 'g1', name: 'Só no app', wa_group_jid: null } });
  const enviadosPara = [];
  const r = await enviarLembreteDeGrupo({
    supabase: sb, task: TAREFA, texto: TEXTO,
    deps: { membros: [{ collaborator_id: 'c1', phone: '21' }, { collaborator_id: 'c2', phone: '22' }],
            sendAndLink: async (_sb, a) => { enviadosPara.push(a.collaboratorId); } },
  });
  assert.strictEqual(r.destino, 'dm');
  assert.strictEqual(r.enviados, 2);
  assert.deepStrictEqual(enviadosPara, ['c1', 'c2']);
  assert.strictEqual(sb._inserts.length, 0, 'não posta no chat de grupo sem vínculo');
});

test('DM respeita quiet hours e não conta quem foi pulado', async () => {
  const sb = fakeSupabase({ group: { id: 'g1', wa_group_jid: null } });
  const r = await enviarLembreteDeGrupo({
    supabase: sb, task: TAREFA, texto: TEXTO,
    deps: {
      membros: [{ collaborator_id: 'c1', phone: '21' }, { collaborator_id: 'c2', phone: '22' }],
      isQuietNow: async (id) => ({ quiet: id === 'c1' }),
      sendAndLink: async () => {},
    },
  });
  assert.strictEqual(r.enviados, 1);
});

// Falha de escrita não pode virar "lembrei": quem chama lê `enviados` pra saber se entregou.
test('insert que falha devolve enviados=0 e o erro', async () => {
  const sb = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { wa_group_jid: '55@g.us' } }) }) }),
      insert: async () => ({ error: { message: 'boom' } }),
    }),
  };
  const r = await enviarLembreteDeGrupo({ supabase: sb, task: TAREFA, texto: TEXTO, deps: {} });
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(r.erro, 'boom');
});

test('destinoDoLembrete: vínculo decide, e ausência de grupo cai em dm', () => {
  assert.strictEqual(destinoDoLembrete({ wa_group_jid: 'x@g.us' }), 'grupo');
  assert.strictEqual(destinoDoLembrete({ wa_group_jid: null }), 'dm');
  assert.strictEqual(destinoDoLembrete(null), 'dm');
});

test('tarefa sem grupo não tenta entregar nada', async () => {
  const r = await enviarLembreteDeGrupo({ supabase: {}, task: { id: 't' }, texto: TEXTO });
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(r.erro, 'sem_grupo');
});
