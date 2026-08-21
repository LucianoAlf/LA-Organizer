'use strict';
// nomeia-falhas.js — LOTE-PARCIAL-NAO-DIZ-QUAIS (Yuri 14/08, Dai 17/08).
//
// O caminho all-failed (failCount>0 && okCount===0) já nomeia o alvo via falaDoQueTentou.
// O PARCIAL (okCount>0 && failCount>0) caía no genérico "_Registrei X de Y. Algumas falharam
// — me chama se algo ficar faltando._": honesto na CONTA, mudo no QUE. O Yuri mandou 10 itens
// (3 "em andamento" = ack sem ação, 7 acionáveis), o TOM registrou 4 e 3 falharam SEM NOME —
// a pessoa não sabe o que reenviar. Este helper nomeia o subconjunto que falhou (qualquer tipo
// de ação, inclusive create), usando os títulos que o próprio marker trouxe. Não adivinha por
// que falhou — só diz QUAIS, que é o que destrava o reenvio. Cai em null quando não há nada
// aferível (aí o caller mantém a fala de contagem — nunca inventa nome).

const MAX = 4;
const MAX_CHARS = 48;
const _corta = (s) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…` : s);

// Rótulo aferível de uma ação: o título (create/complete/update por título) ou, na falta,
// um id curto. Sem nenhum dos dois, a ação não é nomeável.
function _rotulo(a) {
  if (!a || typeof a !== 'object') return null;
  if (typeof a.title === 'string' && a.title.trim()) return _corta(a.title.trim());
  if (typeof a.id === 'string' && a.id.trim()) return `#${a.id.trim().slice(0, 8)}`;
  return null;
}

/**
 * Nomeia as ações que falharam. Retorna a cláusula "*A*, *B* +2" ou null se nada é aferível.
 * @param {Array<object>} falharam ações que falharam (do retorno de applyTaskActions)
 * @returns {string|null}
 */
function nomeiaFalhas(falharam) {
  const lista = Array.isArray(falharam) ? falharam : [];
  const rotulos = [];
  for (const a of lista) {
    const r = _rotulo(a);
    if (r && !rotulos.includes(r)) rotulos.push(r);
  }
  if (!rotulos.length) return null;
  const mostra = rotulos.slice(0, MAX).map((t) => `*${t}*`).join(', ');
  const resto = rotulos.length > MAX ? ` +${rotulos.length - MAX}` : '';
  return `${mostra}${resto}`;
}

// A fala completa do parcial. `total` = okCount+failCount (as acionáveis, não os acks).
function falaParcial(okCount, total, falharam) {
  const nomes = nomeiaFalhas(falharam);
  const cab = `_⚠️ Registrei ${okCount} de ${total}.`;
  return nomes
    ? `${cab} Não entraram: ${nomes} — me manda esses de novo._`
    : `${cab} Algumas falharam — me chama se algo ficar faltando._`;
}

module.exports = { nomeiaFalhas, falaParcial };
