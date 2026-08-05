// src/services/turn-claim.js
// Fronteira de SAÍDA do turno: nenhum outbound de um turno claimado nasce fora do dono
// vencedor da lease.
//
// POR QUE CONTEXTO IMPLÍCITO E NÃO UM HELPER EXPLÍCITO
// O engine tem 82 chamadas de whatsapp.sendMessage para o remetente do turno e mais 24
// para terceiros — respostas, early-returns de ramo, avisos. Trocar 106 call sites por um
// helper depende de não esquecer nenhum, e o esquecido não dá erro: ele só manda a
// mensagem fora do contrato, em silêncio. Isso é exatamente o modo de falha que esta
// fatia existe para eliminar.
//
// Com AsyncLocalStorage o turno é aberto UMA vez no webhook e todo envio que aconteça
// dentro dele é coberto por construção — inclusive os ramos que ninguém mapeou e os que
// forem escritos amanhã. Rituais e proativos rodam fora do turno: passam direto, sem
// consultar o banco, que é o recorte correto (não são resposta a inbound).
//
// FAIL-OPEN, igual ao claim de entrada: só UMA coisa impede o envio — o banco dizer, com
// recibo, que a posse não é mais deste worker. Banco fora, sem recibo, sem turno, sem
// lease: envia. Não enviar por engano deixa a pessoa sem resposta.
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

// ctx: { waMessageId, leaseToken, operationId }
function runInTurn(ctx, fn) {
  return als.run(ctx || {}, fn);
}

// Entra no turno para o RESTO da execução atual, sem exigir um callback.
// Existe por um motivo concreto: no webhook, os fallbacks de mídia ("não consegui baixar
// o áudio", "esse PDF tem senha") respondem ANTES de a mensagem chegar na fila. Envolver
// as ~300 linhas do handler num callback só para abrir o turno seria reindentar o
// caminho de entrada inteiro — muito diff, muito risco, nenhum ganho sobre isto.
function enterTurn(ctx) {
  als.enterWith(ctx || {});
}

function currentTurn() {
  const s = als.getStore();
  return s && s.waMessageId ? s : null;
}

function decideSend({ turn = null, leaseOk = undefined, error = null } = {}) {
  if (!turn || !turn.waMessageId || !turn.leaseToken) {
    return { send: true, reason: 'sem_claim', degraded: false };
  }
  if (error) {
    const detail = (error && (error.message || error.details)) || String(error);
    return { send: true, reason: 'assert_indisponivel', degraded: true, detail: String(detail).slice(0, 120) };
  }
  if (leaseOk === true) return { send: true, reason: 'lease_ok', degraded: false };
  // false é recibo EXPLÍCITO: a linha existe e não é mais deste worker (dono trocado,
  // status concluído ou lease vencida). Só aqui o TOM cala.
  if (leaseOk === false) return { send: false, reason: 'lease_perdida', degraded: false };
  return { send: true, reason: 'sem_recibo', degraded: true };
}

// Roda ANTES de cada envio. Fora de turno não toca no banco.
async function beforeSend({ supabase } = {}) {
  const turn = currentTurn();
  if (!turn || !turn.leaseToken) return decideSend({ turn: null });
  let leaseOk;
  let error = null;
  try {
    const res = await supabase.rpc('tom_route_assert_lease', {
      p_wa_message_id: turn.waMessageId,
      p_owner: 'v1',
      p_lease_token: turn.leaseToken,
    });
    if (res && res.error) error = res.error;
    else leaseOk = res && typeof res.data === 'boolean' ? res.data : null;
  } catch (e) {
    error = e;
  }
  return decideSend({ turn, leaseOk, error });
}

// Roda DEPOIS do envio, já entregue. Amarra o outbound à operação e à lease do turno —
// quando há turno. Fora dele, registra sem operação (é proativo/ritual, dono nenhum).
// Nunca lança: a mensagem já saiu, e falha aqui é contabilidade.
async function afterSend({ supabase, sentId, phone = null, collaboratorId = null } = {}) {
  if (!sentId) return { ok: false, code: 'no_wa_id' };
  const turn = currentTurn();
  try {
    const { recordOutboundV1 } = require('./outbound-record');
    return await recordOutboundV1({
      supabase, waMessageId: sentId, phone, collaboratorId,
      operationId: turn ? turn.operationId : null,
      leaseToken: turn ? turn.leaseToken : null,
    });
  } catch (e) {
    return { ok: false, code: 'db_error', detail: String(e.message || e).slice(0, 120) };
  }
}

// =====================================================================================
// TRAVA DE SAÍDA DO REPLAY LAB — a mais crítica do laboratório.
//
// A primeira versão da spec suprimia o envio quando o DESTINO já era um perfil de QA.
// Isso deixava passar o caso perigoso: durante um replay, o TOM decide avisar um
// TERCEIRO (delegação, "avisa a Gabi", notificação de coordenação). Esse destino não
// está na lista de QA — a trava não agiria e a mensagem chegaria numa PESSOA REAL.
// E "recado a terceiro não encaminhado" é um dos padrões que o laboratório existe para
// testar: vazaria por construção, no primeiro cenário que importasse.
//
// Por isso a trava é sobre o MODO, não sobre o destino. Em replay, só a faixa reservada
// pode receber; qualquer outro destino é falha fechada, com evidência.
//
// GUARDA DUPLA: exige estar na lista E na faixa reservada. Se alguém puser um telefone
// de gente em TOM_QA_PHONES, a faixa segura — uma trava só não basta quando o custo do
// erro é mandar mensagem para o time inteiro.
// =====================================================================================

// DDD 00 não existe no Brasil: nenhum número real cai aqui.
const FAIXA_QA = /^5500\d{9}$/;

function _soDigitos(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

function decideDestinoQA({ turn = null, phone = null, listaQA = [] } = {}) {
  // Fora de replay o comportamento de produção não muda em nada.
  if (!turn || turn.qa !== true) {
    return { permitido: true, suprimir: false, abortar: false, motivo: 'sem_replay' };
  }
  const num = _soDigitos(phone);
  const lista = (listaQA || []).map(_soDigitos).filter(Boolean);
  const naLista = num && lista.includes(num);
  const naFaixa = FAIXA_QA.test(num);
  if (naLista && naFaixa) {
    return { permitido: false, suprimir: true, abortar: false, motivo: 'qa_suprimido', numero: num };
  }
  // Tudo o mais — terceiro real, número vazio, lista mal configurada — é falha fechada.
  return {
    permitido: false, suprimir: false, abortar: true, motivo: 'destino_proibido',
    numero: num || '(vazio)',
    detalhe: !num ? 'sem destino' : (!naFaixa ? 'fora da faixa reservada' : 'fora da lista QA'),
  };
}

module.exports = { runInTurn, enterTurn, currentTurn, decideSend, beforeSend, afterSend,
  decideDestinoQA, FAIXA_QA };
