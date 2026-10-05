'use strict';
// src/lib/gov-postagem.js — GOV-RELATORIO-DUPLICADO (03–05/10). Quantas falas do TOM no grupo de
// governança, desde o início do ciclo, NÃO saíram pelo postar do runner (= o agente postou por
// script, sem as travas). Uma postagem do runner pode virar mais de uma mensagem (o WhatsApp
// corta texto longo), então o sensor só acusa quando há MAIS falas do que o dobro das postagens
// do runner e o runner postou ao menos uma vez — conservador de propósito: alarme falso aqui
// ensinaria a ignorar o sensor. Pura.
function contarPostagensForaDoRunner(falasNoGrupo, postsDoRunner) {
  const f = Number(falasNoGrupo) || 0;
  const p = Number(postsDoRunner) || 0;
  if (p <= 0) return 0;
  return Math.max(0, f - 2 * p);
}
module.exports = { contarPostagensForaDoRunner };
