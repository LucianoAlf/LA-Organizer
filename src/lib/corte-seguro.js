'use strict';
// PERFIL-400-EMOJI-PARTIDO (05/10, caso Juliana). `String#slice` corta em unidades UTF-16: se o
// limite cai no meio de um emoji (par de surrogates), sobra a metade alta solta. O JSON.stringify
// do SDK escreve isso como "\ud83d" e a OpenAI recusa o corpo inteiro com "400 Invalid body: failed
// to parse JSON value" — o perfil da Juliana não atualizou em 03, 04 e 05/10 por causa disso.
// Mesmo orçamento do slice (unidades UTF-16, então o teto de tamanho não muda), mas nunca devolve
// surrogate solto: recua o corte e limpa metade que já tenha vindo partida no próprio texto.
const _SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function cortarSemPartir(s, n) {
  const txt = String(s == null ? '' : s);
  let c = txt.slice(0, n);
  const ult = c.charCodeAt(c.length - 1);
  if (c.length && c.length < txt.length && ult >= 0xD800 && ult <= 0xDBFF) c = c.slice(0, -1);
  return c.replace(_SOLTO, '');
}

module.exports = { cortarSemPartir };
