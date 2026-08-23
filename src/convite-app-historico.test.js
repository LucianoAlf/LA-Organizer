'use strict';
// Contrato: convite de evento disparado PELO APP também entra em conversation_history.
//
// Caso real — Luciano (Alf), 17/08 08:23:54 BRT. O evento "Reunião MKT - NBG!" (19/08 13h) foi
// criado no PWA; o app chamou /internal/event-invites e o convite SAIU no WhatsApp
// (event_participants.notified_at=08:23:54 e marker EVENT_INVITES "2 invites sent"). Só que essa
// rota manda com whatsapp.sendMessage e NÃO grava — então em conversation_history o convite não
// existe. Às 08:30:02 ele respondeu "Sim", o RSVP-bare resolveu certo ("✅ Presença confirmada em
// Reunião MKT - NBG!") e a auditoria, que lê essa tabela, viu só o briefing das 08:13 perguntando
// "quer encaixar alguma pendência hoje?" seguido de "Sim" → abriu dropped_request (5e81c4c6) por
// um comportamento que estava CORRETO.
//
// É a mesma falha do ack da fatura (Rose 09/08, fatura-ack-historico.test.js), no site que sobrou:
// os DOIS caminhos de convite do engine já gravam `[convite de X: Título]` (engine.js, criação de
// evento com attendees e participant-edit); só o caminho do app não gravava. Sem paridade:
//   1. o contexto do TOM é reconstruído de conversation_history — sem o convite ele não sabe que
//      convidou, e um "sim" solto fica sem âncora nenhuma no histórico;
//   2. a auditoria lê a mesma tabela e fabrica dropped_request que não existe.
//
// Teste de CONTRATO no fonte (mesma forma de fatura-ack-historico.test.js). Não substitui teste de
// integração da rota — esse não existe hoje.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const API_SRC = fs.readFileSync(path.join(__dirname, 'internal-api.js'), 'utf8');
const ENGINE_SRC = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');

function fatiar(src, inicio, fim) {
  const i = src.indexOf(inicio);
  assert.ok(i > 0, `âncora de início não encontrada: ${inicio}`);
  const f = src.indexOf(fim, i);
  assert.ok(f > i, `âncora de fim não encontrada: ${fim}`);
  return src.slice(i, f);
}

const ROTA = () => fatiar(
  API_SRC,
  "router.post('/internal/event-invites'",
  '[InternalAPI] event-invites ${eventId}',
);

test('o convite disparado pelo app grava em conversation_history', () => {
  const bloco = ROTA();
  assert.ok(
    bloco.includes('whatsapp.sendMessage('),
    'o fan-out de convite sumiu da rota — âncora do teste desatualizada',
  );
  assert.ok(
    bloco.includes('conversation_history'),
    'a rota /internal/event-invites manda o convite pro usuário e não grava em ' +
    'conversation_history — o TOM esquece que convidou e a auditoria lê "Sim" sem convite antes, ' +
    'abrindo dropped_request que não existe (caso Alf 17/08, finding 5e81c4c6)',
  );
});

test('o app usa a MESMA linha de histórico que o engine ("[convite de X: Título]")', () => {
  // Paridade de forma: o histórico é lido pelo contexto do TOM e pela auditoria. Duas formas
  // diferentes pro mesmo fato fariam o convite do app parecer outra coisa.
  const engineTemLinha = /logConversation\([^)]*`\[convite de \$\{senderName\}: /.test(ENGINE_SRC);
  assert.ok(engineTemLinha, 'o engine deixou de gravar "[convite de ...]" — paridade perdeu a referência');
  assert.ok(
    ROTA().includes('[convite de '),
    'o convite do app grava em conversation_history com forma diferente da do engine',
  );
});
