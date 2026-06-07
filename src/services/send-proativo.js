// src/services/send-proativo.js
//
// CHOKEPOINT de envio PROATIVO. Use SEMPRE isto para qualquer mensagem que o
// TOM INICIA (rituais, lembretes, cobranças, scorecards, escalações). O silêncio
// (quiet hours por contexto) fica embutido aqui — é impossível esquecer o gate.
//
// Respostas REATIVAS (engine.js / webhook.js respondendo a uma mensagem do
// usuário) continuam usando whatsapp.sendMessage direto — resposta a uma fala
// do humano NUNCA é silenciada.
//
// Regra cravada pela trava scripts/check-quiet-gates.js: nenhum envio proativo
// em src/rituals/ pode chamar whatsapp.sendMessage sem um gate de silêncio
// (isQuietNow OU sendProativo) — senão o deploy é bloqueado.

'use strict';

const whatsapp = require('./whatsapp');
const { isQuietNow, nowBrtParts } = require('./quiet-hours');

/**
 * Envia uma mensagem proativa respeitando o silêncio do destinatário.
 *
 * @param {string|object} collabOrId  collaborator_id (UUID, preferível — busca
 *   canônica infalível no banco) ou objeto user_preferences/colaborador.
 * @param {string} phone  número E.164 do destinatário.
 * @param {string} texto  corpo da mensagem.
 * @param {object} [opts]
 * @param {'work'|'personal'} [opts.context='work']  qual janela de silêncio aplicar.
 * @param {{hour:number,minute:number,dow:number}} [opts.now]  override do "agora" BRT (testes).
 * @param {string} [opts.label]  rótulo p/ log de defer.
 * @returns {Promise<{enviado:boolean, deferido:boolean, motivo:string|null}>}
 *   enviado=false & deferido=true → estava em silêncio; o CALLER deve NÃO marcar
 *   como enviado (idempotência) para reentregar fora da janela no próximo tick.
 */
async function sendProativo(collabOrId, phone, texto, opts = {}) {
  const context = opts.context === 'personal' ? 'personal' : 'work';
  const now = opts.now || nowBrtParts();

  const q = await isQuietNow(collabOrId, now, context);
  if (q.quiet) {
    if (opts.label) {
      console.log(`[sendProativo] defer ${opts.label} — quiet (${q.reason})`);
    }
    return { enviado: false, deferido: true, motivo: q.reason };
  }

  if (!phone) return { enviado: false, deferido: false, motivo: 'sem_phone' };

  await whatsapp.sendMessage(phone, texto);
  return { enviado: true, deferido: false, motivo: null };
}

module.exports = { sendProativo };
