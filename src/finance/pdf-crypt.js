// src/finance/pdf-crypt.js — PDF protegido por senha: detecção + extração da senha (PURO) e
// decrypt via qpdf (I/O). O Gemini não abre PDF encriptado; a gente tira a senha antes. (Rose 14/06)
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// PDF está protegido por senha? Encriptado tem o dicionário /Encrypt (ausente em PDF aberto). PURO.
function isEncryptedPdf(buffer) {
  if (!buffer || !buffer.length) return false;
  if (!/^%PDF/.test(buffer.slice(0, 5).toString('latin1'))) return false;
  return buffer.includes(Buffer.from('/Encrypt'));
}

// Extrai a senha de um texto: "Senha: 147640", "a senha é X", ou a própria msg curta (token). PURO.
function extractPassword(text) {
  if (!text) return null;
  const t = String(text).trim();
  const m = /(?:senha|password|pwd|pass|c[óo]digo)\s*(?:é|e|:|=|->|-)?\s*([^\s]{3,40})/i.exec(t);
  if (m) return m[1].replace(/[.,;:)]+$/, '');
  // mensagem curta sem espaço com cara de token (4–40 chars alfanum/símbolos comuns de senha)
  if (/^[A-Za-z0-9@#$%&*._+-]{4,40}$/.test(t)) return t;
  return null;
}

// Decifra o PDF com a senha via qpdf. Retorna { ok:true, buffer } ou { ok:false, reason }. I/O.
function decryptPdf(buffer, senha) {
  return new Promise((resolve) => {
    if (!buffer || !buffer.length) return resolve({ ok: false, reason: 'empty_input' });
    if (!senha) return resolve({ ok: false, reason: 'no_password' });
    const tmp = os.tmpdir();
    const id = crypto.randomBytes(6).toString('hex');
    const inF = path.join(tmp, `pdfdec-in-${id}.pdf`);
    const outF = path.join(tmp, `pdfdec-out-${id}.pdf`);
    try { fs.writeFileSync(inF, buffer); } catch (e) { return resolve({ ok: false, reason: 'write_fail' }); }
    const cleanup = () => { try { fs.unlinkSync(inF); } catch (_) {} try { fs.unlinkSync(outF); } catch (_) {} };
    // qpdf exit: 0 ok, 3 warnings (ainda gera o out), 2 erro (senha errada → sem out).
    execFile('qpdf', [`--password=${senha}`, '--decrypt', inF, outF], { timeout: 20000 }, () => {
      let result;
      try {
        if (fs.existsSync(outF)) {
          const out = fs.readFileSync(outF);
          result = out && out.length ? { ok: true, buffer: out } : { ok: false, reason: 'empty_output' };
        } else {
          result = { ok: false, reason: 'wrong_password' };
        }
      } catch (e) { result = { ok: false, reason: 'read_fail' }; }
      cleanup();
      resolve(result);
    });
  });
}

module.exports = { isEncryptedPdf, extractPassword, decryptPdf };
