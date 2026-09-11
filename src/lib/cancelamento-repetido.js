'use strict';
// cancelamento-repetido.js — CANCELAR-O-QUE-ACABOU-DE-FECHAR (triagem 11/09 — 8500f1dd, e74b37dd).
//
// O cancelamento por título só procurava tarefa ABERTA. Dois casos reais:
//   • Ana 13/07 09:06 — o TOM cancelou "Reunião ADM" às 09:06:20; no mesmo segundo ela mandou
//     "Reunião ADM" solto, o TOM tentou cancelar de novo, não achou (já estava cancelada) e
//     respondeu "não consegui registrar agora. Me passa de novo?" sobre algo feito 1s antes.
//   • Ana Paula 17/08 09:01 — "Pode excluir essa tarefa" foi lido como "sim" a "confirma que já
//     foi feito?" e a tarefa virou CONCLUÍDA; 3 min depois "Apenas exclui a tarefa tom" → "Não
//     achei essa tarefa pra cancelar", porque ela já não estava aberta.
// PURO: recebe a tarefa FECHADA mais recente que casou o pedido (o engine busca, só do dono) e
// decide. Janela curta de propósito: o que fechou há minutos é o mesmo assunto da conversa; o
// que fechou ontem não se reabre por um "cancela" solto.
function decidirCancelamentoDeFechada(tarefa, agoraMs, janelaMin = 15) {
  if (!tarefa || !['done', 'cancelled'].includes(tarefa.status)) return null;
  const quando = Date.parse(tarefa.updated_at);
  if (!Number.isFinite(quando)) return null;
  if (agoraMs - quando > janelaMin * 60000) return null;
  if (quando - agoraMs > 60000) return null; // relógio torto: não decide
  return tarefa.status === 'cancelled' ? 'ja_cancelada' : 'cancelar_concluida';
}

module.exports = { decidirCancelamentoDeFechada };
