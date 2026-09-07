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
// RAW-CEGO-NO-GRUPO (medido 07/09). O caminho 1:1 grava `{actions, fails}` no raw desde
// 08/07 (TASKUPDATE-REJECTED-RAW-NULL, caso Leo) — sem isso "all_failed:2" nao diz QUAIS
// alvos falharam nem por que. O caminho de GRUPO nunca ganhou isso: as duas rejeicoes mais
// recentes do acervo (04/09 e 07/09) sao `all_failed:N grupo` com raw NULL, e uma delas e o
// incidente da Krissya — quando fui investigar, o banco nao tinha nada e eu precisei garimpar
// log de motor. Mecanismo que existe numa porta e nao na outra, de novo.
//
// Ironia util: o grupo tem informacao MELHOR que o 1:1 e a jogava fora. O
// applyGroupChatTaskActions devolve `failed: [{action, why}]` com codigo legivel por maquina
// ('not_found_in_pool', 'race_lost', 'title_missing'), enquanto no 1:1 o `fails` e prosa.
// Mesmo SLOT, mesmo sentido (por que falhou), um dialeto so pro auditor.
//
// @param {Array<{action,why}>} [falhas] — quando vier, vira raw_excerpt. Nunca lanca: raw
// que quebra a serializacao nao pode derrubar o registro que ele deveria enriquecer.
const RAW_MAX = 500;   // paridade com o truncamento do logMarker do 1:1

function marcadorDeConfirmacao({ tipo, ok, total, via, falhas }) {
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
    raw_excerpt: _raw(falhas),
  };
}

// Monta o raw no dialeto do 1:1: { actions:[...], fails:[...] }. Sem falhas -> null (nao
// inventa objeto vazio, que seria indistinguivel de "falhou e nao sei por que").
function _raw(falhas) {
  if (!Array.isArray(falhas) || !falhas.length) return null;
  try {
    const s = JSON.stringify({
      actions: falhas.map((f) => (f && f.action) || null).filter(Boolean),
      fails: falhas.map((f) => (f && f.why) || null).filter(Boolean),
    });
    return s.length > RAW_MAX ? s.slice(0, RAW_MAX) : s;
  } catch (_) { return null; }
}

module.exports = { marcadorDeConfirmacao };
