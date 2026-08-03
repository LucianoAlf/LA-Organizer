'use strict';
// route-decision.js — decide QUEM responde um inbound: TOM v1 (legado) ou TOM v2 (Hermes).
//
// Por que existe (auditoria de viabilidade, 03/08): dois agentes no MESMO número de
// WhatsApp, sem dono definido por mensagem, respondem duas vezes e podem executar a mesma
// ação duas vezes. O router resolve isso ANTES de qualquer LLM — a rota é um fato, não
// uma interpretação.
//
// Esta função é PURA de propósito. O adapter lê o ledger (tom_message_ownership /
// tom_flow_ownership) e entrega os fatos prontos; aqui não há I/O, relógio nem aleatório.
// Assim a regra de roteamento é testável exaustivamente — e ela é produção crítica: um
// erro aqui não degrada uma resposta, duplica uma execução.
//
// PRINCÍPIOS
// 1. O legado é o default. Só vai pro v2 o que é INEQUIVOCAMENTE do v2. Na dúvida, v1.
// 2. Citação (quote) manda mais que fluxo aberto, porque a citação identifica a ENTIDADE,
//    e quem pode mutar uma entidade é o dono dela. Roteando pelo fluxo, o v2 receberia
//    uma citação de entidade v1 que ele não pode tocar. O conflito é REGISTRADO como
//    telemetria — não muda a rota, mas não pode ficar invisível.
// 3. Fechar o canário impede ABRIR fluxo novo no v2; nunca sequestra fluxo em andamento.
//    Rollback que rouba a conversa no meio faz a resposta cair num runtime que não sabe
//    da operação — que é justamente o estado que este router existe para evitar.
//
// LIMITE CONHECIDO (fatia 1): roteamento por ENTIDADE só é decidível quando há quote ou
// fluxo aberto. "Conclui a tarefa X" em texto livre exige interpretação — e interpretar
// aqui seria colocar um LLM antes do router, invertendo o desenho. Por isso, na fatia 1,
// texto livre vai sempre para o v1. Ver a spec, seção "Contraponto 1".

const OWNERS = new Set(['v1', 'v2']);

const ROUTE_REASONS = {
  QUOTE_V1: 'quote_v1',
  QUOTE_V2: 'quote_v2',
  OPEN_FLOW_V1: 'open_flow_v1',
  OPEN_FLOW_V2: 'open_flow_v2',
  DEFAULT_V1: 'default_v1',
};

// Fases em que um fluxo ainda prende a conversa. 'retired' já não prende nada.
const HOLDING_PHASES = new Set(['canary', 'draining']);

/** Só 'v1'/'v2' exatos contam. Qualquer outra coisa é ruído e não roteia ninguém. */
function normOwner(v) {
  return typeof v === 'string' && OWNERS.has(v) ? v : null;
}

/**
 * @param {object} facts fatos já lidos do ledger pelo adapter
 * @param {'v1'|'v2'|null} facts.quotedOwner dono da mensagem citada
 * @param {'v1'|'v2'|null} facts.flowOwner dono do fluxo aberto para este chat
 * @param {'canary'|'draining'|'retired'|null} facts.flowPhase fase do fluxo aberto
 * @param {boolean} facts.canaryOpen o canário aceita ABRIR fluxo novo?
 * @returns {{owner:'v1'|'v2', reason:string, conflict?:string}}
 */
function decideRoute(facts) {
  const f = (facts && typeof facts === 'object') ? facts : {};
  const quoted = normOwner(f.quotedOwner);
  const flowRaw = normOwner(f.flowOwner);
  // fluxo só prende se estiver numa fase que prende. Sem fase declarada, assume 'canary'
  // (fluxo aberto pelo adapter sem fase é fluxo vivo) — 'retired' solta.
  const flow = flowRaw && HOLDING_PHASES.has(f.flowPhase == null ? 'canary' : f.flowPhase)
    ? flowRaw : null;

  // conflito = os dois sinais existem e discordam. Registrado sempre, decida quem decidir.
  const conflict = (quoted && flow && quoted !== flow)
    ? `quote_${quoted}_over_open_flow_${flow}` : null;
  const out = (owner, reason) => (conflict ? { owner, reason, conflict } : { owner, reason });

  // 1) citação: o sinal mais específico que existe.
  if (quoted === 'v1') return out('v1', ROUTE_REASONS.QUOTE_V1);
  if (quoted === 'v2') return out('v2', ROUTE_REASONS.QUOTE_V2);

  // 2) fluxo aberto: a conversa continua com quem começou (inclusive em drenagem).
  if (flow === 'v2') return out('v2', ROUTE_REASONS.OPEN_FLOW_V2);
  if (flow === 'v1') return out('v1', ROUTE_REASONS.OPEN_FLOW_V1);

  // 3) resto: legado. Abrir fluxo novo no v2 é decisão de quem CRIA a entidade do canário,
  //    não deste router — aqui não há sinal suficiente para isso sem interpretar texto.
  return out('v1', ROUTE_REASONS.DEFAULT_V1);
}

module.exports = { decideRoute, ROUTE_REASONS, OWNERS };
