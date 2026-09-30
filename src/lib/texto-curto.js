'use strict';
// texto-curto.js — corta texto pra caber numa linha de WhatsApp SEM partir palavra.
// O relatório das 07h cortava num número fixo de letras e saía "prendendo a p", "Usuário
// confirmo" (Alf, 30/09: "está vindo bagunçado"). Corte no último espaço antes do limite + "…".
function cortarNaPalavra(texto, max) {
  const s = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const bruto = s.slice(0, max);
  const esp = bruto.lastIndexOf(' ');
  const base = esp > max * 0.4 ? bruto.slice(0, esp) : bruto;
  return `${base.trimEnd()}…`;
}

module.exports = { cortarNaPalavra };
