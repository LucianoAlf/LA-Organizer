'use strict';
// Texto do PDF pela camada de texto (poppler `pdftotext`), sem modelo nenhum.
// Rose 15/09: o código de barras do DAS vinha só do Gemini, com a ordem "na dúvida devolve vazio",
// e 5 PDFs iguais caíram em 3 rotas diferentes (boleto, fatura de cartão, texto cru). Documento
// digital (DAS, DARF, boleto de banco) TEM a linha digitável como texto: lê-la daqui e provar pelos
// dígitos verificadores é determinístico. PDF escaneado (sem texto) devolve '' e segue o caminho
// antigo. Nunca lança: falha = ''.
const { execFile } = require('child_process');

function textoDoPdf(buf, { timeoutMs = 8000, bin = process.env.PDFTOTEXT_BIN || 'pdftotext' } = {}) {
  return new Promise((resolve) => {
    if (!buf || !buf.length) { resolve(''); return; }
    try {
      const child = execFile(bin, ['-layout', '-q', '-', '-'],
        { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8' },
        (err, out) => resolve(err ? '' : String(out || '')));
      child.stdin.on('error', () => { /* binário ausente: o callback já devolve '' */ });
      child.stdin.end(buf);
    } catch (_) { resolve(''); }
  });
}

module.exports = { textoDoPdf };
