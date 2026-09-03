'use strict';
// src/utils/confirm-marker.js
// ──────────────────────────────────────────────────────────────────────
// CONFIRM-EXEC-SEM-LOG (Jhonatan 02/09, achado alto nº2 nascido da mesma raiz).
//
// Os executores DETERMINÍSTICOS de confirmação escrevem direto na tabela e retornam cedo — sem
// passar por applyTaskActions, que é quem grava em marker_logs. Resultado: a ação BOA não deixa
// rastro nenhum.
//
// E isso não é aleatório: esses caminhos rodam SEMPRE depois de uma tentativa do LLM que já foi
// registrada. A sequência real do caso Jhonatan:
//
//   19:40:56  TASK_UPDATE/rejected  all_failed:6     (LLM, com id truncado do prompt)
//   19:42:01  TASK_UPDATE/rejected  all_failed:6
//   19:42:45  TASK_UPDATE/rejected  all_failed:6
//   19:42:59  as 6 tarefas FECHAM de verdade         ← nenhuma linha em marker_logs
//   19:43:32  REACT/executed ❤️
//
// O auditor lê a última palavra sobre TASK_UPDATE ("rejected"), vê o TOM dizendo "✅ Concluí" e
// classifica como confabulação. Duas vezes já custaram um achado alto cada. A ação estava certa;
// o registro é que faltava — e zero por FALHA lido igual a zero por SAÚDE é a doença que este
// projeto persegue desde o começo.
//
// Puro de propósito: o engine é uma função gigante e não dá teste. Aqui dá.

// Vocabulário IGUAL ao que applyTaskActions já grava ("ok=N fail=M"), senão o auditor precisaria
// aprender um segundo dialeto pra ler a mesma coisa.
function marcadorDeConfirmacao({ tipo, ok, total, via }) {
  const n = Number(ok) || 0;
  const t = Number(total) || 0;
  const falhou = Math.max(0, t - n);
  const markerType = tipo === 'event' ? 'EVENT_UPDATE' : 'TASK_UPDATE';
  const sufixo = via ? ` ${via}` : '';
  return {
    marker_type: markerType,
    // 'executed' quando ALGO foi escrito. Parcial conta como executado e o número diz o resto —
    // era o que o auditor precisava pra não ler o parcial como mentira inteira.
    result: n > 0 ? 'executed' : 'rejected',
    reason: n > 0 ? `ok=${n} fail=${falhou}${sufixo}` : `all_failed:${t || 1}${sufixo}`,
  };
}

module.exports = { marcadorDeConfirmacao };
