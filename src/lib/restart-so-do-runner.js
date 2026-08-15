'use strict';
// src/lib/restart-so-do-runner.js
// GOVAGENT-RESTART-CONTRADICAO-NO-GRUPO — quem fala de restart é o gov-runner, e só ele.
//
// O INCIDENTE (13/08 e de novo 15/08): o relatório do agente dizia
//   "*Não reiniciei o TOM* — o restart é do gov-runner."
// e um segundo depois o próprio runner postava
//   "♻️ TOM reiniciado, o fix está no ar (...)"
// As duas falas entram no grupo como role='tom'. Quem lê vê o TOM se contradizendo, e o
// auditor abriu achado de confabulação em cima disso (c4a74feb).
//
// Nenhuma das duas é mentira — são emissores diferentes. Mas o dono não enxerga emissor,
// enxerga uma voz só: "se tá reiniciando, deixa só o que é a verdade" (Alf, 15/08).
//
// A regra do protocolo já proibia AFIRMAR restart (ETAPA 7, nascida de 09/08: o agente
// escreveu que reiniciou e o processo tinha 12h de uptime). O agente obedeceu e escreveu a
// NEGAÇÃO — que a regra não previa, e que é justamente a metade que colide. Prosa de LLM não
// é garantia: a trava fica aqui, determinística, no mesmo chokepoint de `postar`.
//
// CIRÚRGICO: derruba só a fala em 1ª PESSOA sobre reiniciar ("reiniciei", "não reiniciei",
// "vou reiniciar"). A linha do runner é impessoal ("TOM reiniciado", "restart aplicado") e
// PRECISA sobreviver — ela é a única prova de entrega que o grupo recebe, e some junto se a
// regra for "apagar tudo que fala de restart". Ver claim-entrega.js, mesma família.

// 1ª pessoa do singular, com ou sem negação, do verbo reiniciar/restartar — a frase inteira,
// da borda até o fim da sentença. `[^.\n!?]*` para não comer o parágrafo seguinte.
const FALA_DE_RESTART = /(^|[\n.!?—-]\s*)\**\s*(?:não|nao)?\s*(?:reinici(?:ei|arei|o)|vou\s+reiniciar|dei\s+restart|restartei)\b[^.\n!?]*[.!?]?\**/gi;

/**
 * Tira do texto do AGENTE qualquer afirmação própria sobre restart. Pura.
 * @param {string} texto relatório a publicar
 * @returns {{texto:string, removeu:boolean, trechos:string[]}}
 */
function tirarFalaDeRestart(texto) {
  if (typeof texto !== 'string' || !texto) {
    return { texto: typeof texto === 'string' ? texto : '', removeu: false, trechos: [] };
  }
  const trechos = [];
  const limpo = texto.replace(FALA_DE_RESTART, (m, borda) => {
    trechos.push(m.trim());
    return borda && /^\n/.test(borda) ? borda : (borda || '');
  });
  if (!trechos.length) return { texto, removeu: false, trechos: [] };
  // Sobra de pontuação/espaço onde a frase saiu. Não mexe em quebra de parágrafo.
  const arrumado = limpo
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([\n])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { texto: arrumado, removeu: true, trechos };
}

module.exports = { tirarFalaDeRestart };
