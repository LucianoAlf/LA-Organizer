// Redacao deterministica de valores sensiveis em texto livre.
//
// POR QUE NA ENTRADA, e nao no ponto de gravacao: engine.js grava os 200
// primeiros chars da mensagem em marker_logs.reason quando o TOM deixa de
// emitir marker para uma mensagem acionavel; o check actionable_no_marker le
// esse campo e o relatorio das 7h o transmite por WhatsApp. Redigir so no
// conversation_history deixaria esse caminho aberto.
//
// DETERMINISTICO de proposito: nao depende de o modelo reconhecer que a
// mensagem tem credencial. O reconhecimento do modelo falha exatamente no
// cenario em que o vazamento acontece.

const MASCARA = '***';

// Rotulos que indicam segredo. Ancorado no inicio da linha ou apos separador,
// para nao casar no meio de palavra.
const ROTULOS = 'senha|password|pwd|passwd|token|api[ _-]?key|chave|secret|segredo';

// <rotulo> <sep> <valor>  — valor e o resto da linha, e precisa existir.
const RE_ROTULO_VALOR = new RegExp(
  `(^|[\\n\\r]|[\\s(\\[])((?:${ROTULOS}))\\s*(:|=|\\s)[ \\t]*([^\\n\\r]+)`,
  'gi'
);

function redigirSegredos(texto) {
  if (!texto || typeof texto !== 'string') return { texto: '', achou: false };
  let achou = false;
  const out = texto.replace(RE_ROTULO_VALOR, (m, pre, rotulo, sep, valor) => {
    const v = String(valor).trim();
    // Pergunta ("qual a senha do chatwoot?") nao tem valor a redigir.
    if (!v || /^[?!.]/.test(v) || /\?$/.test(v)) return m;
    achou = true;
    const sepOut = sep === ' ' ? ' ' : `${sep} `;
    return `${pre}${rotulo}${sepOut}${MASCARA}`;
  });
  return { texto: out, achou };
}

module.exports = { redigirSegredos, MASCARA };
