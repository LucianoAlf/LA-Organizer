'use strict';
// decisao-prazo-alvo.js — qual tarefa o gestor está decidindo no TASK_UPDATE extension_decision.
//
// O [id=xxxxxxxx] que o gestor vê ("📥 Pedidos de prazo aguardando sua decisão", prompts/system.js)
// é o reference_id da notificação deadline_extension_request endereçada A ELE. Então o alvo sai
// dessas notificações — não de uma busca global em tasks:
//  - sem janela de data: pedido de prazo é de tarefa vencida, e vencida há > 60 dias sumia
//    (mesma raiz do caso Peterson, bf173ead / lib/janela-short-id);
//  - escopo = pedidos feitos a quem decide (antes: tasks de TODO MUNDO, limit 500 sem ordem —
//    4.243 elegíveis em 30/09, o banco devolvia 500 quaisquer);
//  - prefixo que cai em 2+ tarefas → 'ambiguo' (o caller pergunta; antes pegava o 1º).
// Pendentes (status pending/sent — o mesmo filtro do prompt) têm prioridade; se nenhum pendente
// casa, aceita pedido já decidido (o gestor corrigindo: "na verdade aprova até dia 10").
// Puro, sem I/O, nunca lança. `notifs` deve vir do mais recente pro mais antigo.

const { matchRowsByShortId } = require('../services/short-id-match');

const STATUS_PENDENTE = ['pending', 'sent'];

function _casar(notifs, shortId) {
  const rows = notifs.map((n) => ({ id: String(n.reference_id), _n: n }));
  const porTarefa = new Map();
  for (const h of matchRowsByShortId(rows, shortId)) {
    if (!porTarefa.has(h.id)) porTarefa.set(h.id, h._n); // 1ª = mais recente
  }
  return porTarefa;
}

/**
 * @param {Array<{id:string, reference_id:string, status:string, created_at?:string}>} notifs
 * @param {string} shortId
 * @returns {{status:'ok', taskId:string, notifId:string, pendente:boolean}
 *          |{status:'ambiguo', taskIds:string[]}|{status:'nao_achou'}}
 */
function resolverAlvoDecisaoPrazo(notifs, shortId) {
  if (!shortId || !Array.isArray(notifs)) return { status: 'nao_achou' };
  const lista = notifs.filter((x) => x && x.reference_id);
  let pendente = true;
  let m = _casar(lista.filter((x) => STATUS_PENDENTE.includes(x.status)), shortId);
  if (m.size === 0) {
    pendente = false;
    m = _casar(lista, shortId);
  }
  if (m.size === 0) return { status: 'nao_achou' };
  if (m.size > 1) return { status: 'ambiguo', taskIds: [...m.keys()] };
  const [[taskId, notif]] = [...m.entries()];
  return { status: 'ok', taskId, notifId: notif.id, pendente };
}

module.exports = { resolverAlvoDecisaoPrazo, STATUS_PENDENTE };
