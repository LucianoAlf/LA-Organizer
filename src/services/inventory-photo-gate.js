'use strict';

// INVENTORY-PHOTO-CROSSDOMAIN (audit 24/08) — o webhook guardava TODA imagem recebida no cache de
// foto de inventário (TTL 10min) sem vínculo semântico → um comprovante/nota fotografado virava a
// foto do PRÓXIMO item cadastrado por texto (comprovante → foto de teclado). Este gate é PURO e
// POSITIVO POR PADRÃO: na dúvida captura (o fluxo legítimo de foto de item não pode quebrar); só
// RECUSA a captura em sinais FORTES de documento financeiro (usa a legenda + a análise de visão).
// Deliberadamente não barra "R$"/"pagamento" soltos (uma foto de item pode citar preço).

const FIN_DOC_RE = /\b(?:comprovante|recibo|nota\s+fiscal|boleto|pix|fatura|extrato bancario|extrato|invoice|receipt)\b/i;

/**
 * @param {string} caption     legenda enviada pelo usuário com a imagem
 * @param {string} visionText  descrição automática (análise de visão) da imagem
 * @returns {boolean} true = NÃO é foto de inventário (documento financeiro) → não capturar
 */
function isLikelyNonInventoryImage(caption, visionText) {
  const hay = `${caption || ''}\n${visionText || ''}`;
  if (!hay.trim()) return false; // sem info → captura (default positivo)
  return FIN_DOC_RE.test(hay);
}

module.exports = { isLikelyNonInventoryImage, FIN_DOC_RE };
