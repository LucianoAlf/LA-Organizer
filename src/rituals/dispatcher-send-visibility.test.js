// src/rituals/dispatcher-send-visibility.test.js
// Rodar: node --test src/rituals/dispatcher-send-visibility.test.js
//
// DISPATCHER-ENVIO-INVISIVEL (Alf 19/08) — "ele tem que saber tudo que ele envia". Medido:
// 30 de 38 whatsapp.sendMessage do dispatcher NÃO gravavam conversation_history. Quem
// respondia a um convite, aviso de reschedule, digest financeiro ou alerta de cartão falava
// com um TOM que não lembrava de ter mandado nada (caso Alf 12:14: respondeu ao lembrete e
// levou resposta errada — ali era outro bug, mas a classe é essa).
//
// A regra da casa passou a ser: envio proativo a COLABORADOR vai por proactiveLink.sendAndLink
// (envia + grava com vínculo). whatsapp.sendMessage cru só é aceito onde NÃO há colaborador:
//   • fallbacks explícitos (fila/job/audiência sem collaborator_id) — 4;
//   • loja do LA Report (telefone sem cadastro) — 1;
//   • sites que gravam o histórico MANUALMENTE logo adiante (legado auditado 19/08) — 8.
//
// Este teste é uma CATRACA de fonte: se um envio cru novo aparecer, ele quebra — e a resposta
// certa é usar sendAndLink, não subir o número. (Mesmo espírito do grep de READERS.)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'dispatcher.js'), 'utf8');
const TETO_SENDMESSAGE_CRU = 12;

test('dispatcher: envio cru não cresce — proativo novo usa sendAndLink', () => {
  const n = (SRC.match(/whatsapp\.sendMessage\(/g) || []).length;
  assert.ok(n <= TETO_SENDMESSAGE_CRU,
    `whatsapp.sendMessage cru subiu para ${n} (teto ${TETO_SENDMESSAGE_CRU}). ` +
    'Envio proativo a colaborador tem que ir por proactiveLink.sendAndLink (grava o histórico).');
});

test('dispatcher: o dreno da outbound_queue grava histórico quando há collaborator_id', () => {
  assert.match(SRC, /sendAndLink\(supabase, \{ phone: row\.phone, content: row\.body, collaboratorId: cid/);
});

test('dispatcher: lembrete de evento leva etiqueta de antecedência quando label é null', () => {
  assert.match(SRC, /leadLabel\(r\.remind_at, ev\.start_at\)/);
});

// COBRANCA-INVISIVEL-AO-RESOLVEDOR (Krissya 05/08): a cobrança de atraso agora grava com
// ref_type='task' via sendAndLink — sem isso o resolverConclusaoDeLembrete fica cego a ela
// e um "Feito" pelado entre N cobranças deixa o LLM chutar a tarefa errada.
test('dispatcher: checkOverdueAlerts linka a cobrança à tarefa (refType task) e não insere histórico à mão', () => {
  assert.match(SRC, /sendAndLink\(supabase, \{ phone: collab\.phone, content: text, collaboratorId: collab\.id, refType: 'task', refId: t\.id \}\)/,
    'a cobrança de atraso precisa ir por sendAndLink com refType task');
  // o insert manual antigo (sem ref) tem que ter saído — senão duplica o histórico
  assert.ok(!/direction: 'outbound',\s*message_type: 'text',\s*content: text,\s*\}\);\s*await logRitualEvent\(collab\.id, 'alerta_atraso'/.test(SRC),
    'o insert manual da cobrança ainda existe — vai duplicar o histórico');
});
