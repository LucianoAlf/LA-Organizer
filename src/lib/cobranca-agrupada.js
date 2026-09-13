'use strict';
// cobranca-agrupada.js — COBRANCA-EM-RAJADA (Vitoria 12/09 16:00, auditoria cruzada 13/09).
//
// Ela recebeu SEIS cobranças em treze segundos. Nenhuma era falsa — são 6 tarefas distintas, cada
// uma com seu claim e seu follow-up —, mas chegam como enxurrada, e enxurrada ensina a ignorar.
//
// A partir de 3, uma mensagem só com a lista. Abaixo disso segue individual, porque aí o
// reply-quote ancora a resposta na tarefa certa (COBRANCA-INVISIVEL-AO-RESOLVEDOR, Krissya 05/08) —
// com 6 mensagens o "Feito" pelado já era ambíguo de qualquer jeito, e o rastro por tarefa continua
// vivo no pending_followups (o prompt entrega id e título de cada uma). PURO.

const LIMITE_COBRANCA_AGRUPADA = 3;
const TETO_LINHAS = 8;

const _dias = (n) => (n === 1 ? '1 dia' : `${n} dias`);

/** Ordena da mais antiga pra mais nova, empate pelo título (estável entre execuções). */
function ordenarPorAtraso(itens) {
  return [...(itens || [])].filter(Boolean).sort((a, b) => {
    const d = (Number(b.dias) || 0) - (Number(a.dias) || 0);
    return d !== 0 ? d : String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function textoCobrancaAgrupada(itens) {
  const lista = ordenarPorAtraso(itens);
  if (lista.length < LIMITE_COBRANCA_AGRUPADA) return '';
  const linhas = lista.slice(0, TETO_LINHAS).map((i) => `• *${i.title}* — ${_dias(Number(i.dias) || 0)}`);
  const sobra = lista.length - linhas.length;
  if (sobra > 0) linhas.push(`• _e mais ${sobra}_`);
  return [
    `🚨 *${lista.length} tarefas atrasadas* — da mais antiga pra mais nova:`,
    '',
    ...linhas,
    '',
    'Me responde citando o nome da que você fechou que eu dou baixa. Se alguma não é mais sua, me diz também.',
  ].join('\n');
}

module.exports = { LIMITE_COBRANCA_AGRUPADA, TETO_LINHAS, textoCobrancaAgrupada, ordenarPorAtraso };
