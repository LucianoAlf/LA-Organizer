'use strict';

// Detecta um PEDIDO DE RELAY explícito — o usuário mandando o TOM repassar um
// recado a OUTRA pessoa: "avisa o Clayton que já fiz o lembrete", "diga ao João
// que vou atrasar", "fala pra Anne que a reunião mudou".
//
// Causa-raiz (COORD-RESPONSE-STATE-STUCK, casos Daiana/Fefê 11/06): quando o
// collab é recipient de um recado aberto (status='sent'), o engine injeta o
// [COORD_HINT] pressionando o LLM a emitir <<COORDINATION_RESPONSE>>. Numa
// mensagem mista/relay essa pressão faz o LLM malformar um RESPONSE em vez de
// emitir <<COORDINATION_REQUEST>> — o recado embutido é DESCARTADO e, como a
// request fica 'sent', o COORD_HINT re-injeta na PRÓXIMA mensagem → loop de
// "problema técnico" (Fefê: 13:19 e 13:22 ambos malformed; só quebrou às 13:26
// com assunto novo).
//
// Quando este detector casa, o engine TROCA o COORD_HINT por um RELAY_OVERRIDE
// que força a interpretação como REQUEST — "interpreta do zero", sem passar pela
// pressão do parser de RESPONSE.
//
// Narrow de propósito: exige um VERBO de relay + (preposição) + um destinatário +
// um "que" de conteúdo. Perguntas ("Conseguiu avisar ao Clayton?") e respostas
// cruas ("Feito", "Sim") NÃO casam — falta o "que <conteúdo>" depois do nome.

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Verbos imperativos/2ª pessoa de "repassar recado". Deliberadamente SEM
// "conta"/"lembra" (colidem com finanças "conta" e lembrete) e sem "pede".
const RELAY_VERB =
  'avisa|avise|avisar|diga|diz|dizer|fala|fale|falar|comunica|comunique|comunicar|repassa|repasse|repassar|transmite|transmita|transmitir|manda|mande|mandar';

// Preposições/artigos que antecedem o destinatário ("ao Clayton", "pro João").
const PREP = 'para|pra|pro|pros|pras|ao|aos|a|o|os|as|com';

// Tokens que NÃO são nome de destinatário (evita "fala QUE sim", "avisa QUE recebi",
// pronomes "te/me/lhe" do scaffold "pediu pra te avisar").
const STOP = new Set([
  'que', 'sobre', 'pra', 'para', 'isso', 'ele', 'ela', 'eles', 'elas',
  'te', 'me', 'lhe', 'nos', 'vos', 'se', 'voce', 'ai', 'la', 'agora',
  'sim', 'nao', 'recebi', 'ja', 'tudo', 'algo', 'todo', 'todos',
]);

const RELAY_RE = new RegExp(
  `\\b(?:${RELAY_VERB})\\b(?:\\s+(?:${PREP})\\b)?\\s+([a-z][a-z.'-]+)\\b[\\s\\S]{0,80}?\\bque\\b`,
  'i'
);

/**
 * @param {string} text mensagem do usuário (texto cru, sem o scaffold de reply)
 * @returns {{recipientHint:string}|null} truthy quando é relay explícito
 */
function detectExplicitRelayRequest(text) {
  const n = norm(text);
  if (!n) return null;
  const m = n.match(RELAY_RE);
  if (!m) return null;
  const recipient = m[1];
  if (!recipient || recipient.length < 2 || STOP.has(recipient)) return null;
  return { recipientHint: recipient };
}

module.exports = { detectExplicitRelayRequest, _norm: norm };
