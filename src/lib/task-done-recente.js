'use strict';
// task-done-recente.js — o irmão do COORD-HONESTY na superfície de TAREFAS. PURO.
//
// TASK-HONESTY-NEGA-BAIXA-FEITA (Kailane 12/08 19:21). Literal do banco:
//   19:21:00  Kailane: "todas as tarefas que estavam pendentes já estavam concluidas a mt tempo"
//   19:21:17  (engine conclui as 3 tarefas — completed_at no banco prova)
//   19:21:23  TOM: "✅ Dei baixa nas 3 pendências: Vanessa Cunha, alunos da primeira aula..."
//   19:21:26  Kailane: "pode finalizar"
//   19:21:42  TOM: "não consegui finalizar por aqui — me manda de novo quais pendências quer fechar?"
//
// Não havia o que finalizar: estava tudo feito havia 25 segundos, pelo próprio TOM. A frase não
// é template — é o LLM obedecendo o markerRule do ramo `!hasConcrete`, que afirma o ABSOLUTO
// "você NÃO consegue executar isso agora" e manda pedir repetição.
//
// É o mesmo defeito que o COORD-HONESTY-NEGA-ENVIO-FEITO (Leo 05/08, corrigido 10/08): a
// evidência do guard sustenta apenas "não há payload NESTE turno", mas a fala afirma o absoluto.
// Lá o fato do banco que faltava era `coordination_requests.status=sent`; aqui é
// `tasks.completed_at`. Mesma família, superfície diferente — o lado sem irmão.
//
// O QUE ESTA REGRA NÃO FAZ: afirmar que o pedido atual já foi atendido. Isso seria chutar alvo,
// que é o perigo original do ramo proibitivo (caso Conciliação/Rose 10/06). Ela só entrega o
// FATO ao LLM e o proíbe de negar categoricamente — a proibição de emitir marker segue intacta.

const JANELA_PADRAO_MIN = 10;

/**
 * Filtra o que foi concluído na janela. PURA: recebe as linhas já lidas do banco.
 * @param {Array<{title:string, completed_at:string}>} tarefas
 * @param {Date|number} agora
 * @param {{janelaMin?: number}} [opts]
 */
function concluidasRecentes(tarefas, agora, opts = {}) {
  const janelaMs = (Number(opts.janelaMin) || JANELA_PADRAO_MIN) * 60_000;
  const t0 = agora instanceof Date ? agora.getTime() : Number(agora);
  if (!Array.isArray(tarefas) || !Number.isFinite(t0)) return [];
  return tarefas
    .filter((t) => {
      if (!t || typeof t.title !== 'string' || !t.title.trim()) return false;
      const ms = Date.parse(t.completed_at);
      return Number.isFinite(ms) && ms <= t0 && (t0 - ms) <= janelaMs;
    })
    .map((t) => t.title.trim());
}

/**
 * Ajusta a instrução de marker quando há conclusão recente. Devolve a regra original intacta
 * quando não há nada recente — o caminho comum não muda em nada.
 */
function regraComConclusaoRecente(regraBase, titulos) {
  const base = String(regraBase || '');
  const lista = Array.isArray(titulos) ? titulos.filter((t) => typeof t === 'string' && t.trim()) : [];
  if (!lista.length) return base;

  // Máximo 3 títulos: a instrução vai no prompt de um turno de WhatsApp, e a lista longa rouba
  // atenção do que importa (a proibição de negar). O total continua dito.
  const mostra = lista.slice(0, 3).map((t) => `"${t}"`).join(', ');
  const resto = lista.length > 3 ? ` e mais ${lista.length - 3}` : '';
  return `${base}\n\nATENÇÃO — FATO DO BANCO: você JÁ concluiu ${lista.length} tarefa(s) desta pessoa nos últimos minutos: ${mostra}${resto}. `
    + 'Se o pedido dela for sobre esses itens, é PROIBIDO dizer que não conseguiu ou pedir pra repetir — isso negaria um trabalho que você acabou de fazer. '
    + 'Confirme em uma linha o que já está concluído. Só peça os detalhes se o pedido for claramente sobre OUTRA coisa.';
}

module.exports = { concluidasRecentes, regraComConclusaoRecente, JANELA_PADRAO_MIN };
