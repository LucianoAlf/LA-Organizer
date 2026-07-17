'use strict';
// PIX: detecta/valida "copia e cola" (BR Code EMV) e extrai chave de texto. Paralelo do
// boleto-parse. A validação é a trava: o BR Code tem CRC16 no fim — copia-e-cola adulterado
// reprova. Chave crua (email/CPF/telefone/aleatória) não tem verificador → guarda como veio.
// NUNCA remover espaços INTERNOS: o BR Code os tem no nome do recebedor; strip quebra o CRC
// (bug pego no de-risk 17/07). Só tira quebra de linha + trim.

function _clean(text) { return String(text || '').replace(/[\r\n]+/g, '').trim(); }

function looksLikePixCopiaECola(text) {
  const s = _clean(text);
  return (/000201/.test(s) && /6304[0-9A-Fa-f]{4}/.test(s)) || /BR\.GOV\.BCB\.PIX/i.test(s);
}

function extractPixCopiaECola(text) {
  const m = _clean(text).match(/000201.*?6304[0-9A-Fa-f]{4}/);
  return m ? m[0] : null;
}

// CRC16-CCITT (poly 0x1021, init 0xFFFF) sobre o payload até e incluindo '6304'.
function _crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function validatePixBRCode(payload) {
  const s = _clean(payload);
  const m = s.match(/^(.*6304)([0-9A-Fa-f]{4})$/);
  if (!m) return { valid: false };
  return { valid: _crc16(m[1]) === m[2].toUpperCase() };
}

const RE_PIX_TRIGGER = /\bchave\s*pix\b|\bpix\s*[ée:]\b|\bpix\b[^\n]*\b[ée]\b/i;
function extractPixKeyFromText(text) {
  const t = String(text || '');
  if (!RE_PIX_TRIGGER.test(t)) return null;
  const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) return email[0];
  const uuid = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const fone = t.match(/\+?55\d{10,11}/);
  if (fone) return fone[0];
  const doc = t.match(/\b\d{11}\b|\b\d{14}\b/);
  if (doc) return doc[0];
  return null;
}

module.exports = { looksLikePixCopiaECola, extractPixCopiaECola, validatePixBRCode, extractPixKeyFromText };
