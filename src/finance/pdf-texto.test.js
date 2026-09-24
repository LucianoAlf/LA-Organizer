'use strict';
// PDF de verdade (montado à mão, fonte Helvetica) com a linha do DAS impressa COM HÍFEN — prova a
// ponta a ponta: pdftotext lê o texto e o parser acha a linha validada.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { textoDoPdf } = require('./pdf-texto');
const P = require('./boleto-parse');

function pdfCom(linhas) {
  const conteudo = ['BT', '/F1 10 Tf', '40 800 Td', '14 TL', ...linhas.map((l) => `(${l.replace(/[()\\]/g, '')}) '`), 'ET'].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(conteudo)} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let s = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(s)); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(s);
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}
let temBinario = true;
try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch (_) { temBinario = false; }

// mesma construção independente do boleto-das.test.js
function mod11(n) { let s = 0; let w = 2; for (let i = n.length - 1; i >= 0; i--) { s += Number(n[i]) * w; w = w === 9 ? 2 : w + 1; } const r = s % 11; return (r === 0 || r === 1) ? 0 : 11 - r; }
const barras = `8580${'00000040145'}0328${'2625885507435'}000000000000`.slice(0, 44);
const blocos = [0, 1, 2, 3].map((i) => barras.slice(i * 11, i * 11 + 11));
const DIGITOS = blocos.map((b) => b + mod11(b)).join('');
const IMPRESSA = blocos.map((b) => `${b}-${mod11(b)}`).join(' ');

test('PDF real com a linha do DAS (hífen) -> pdftotext lê e o parser acha a linha VALIDADA', { skip: !temBinario }, async () => {
  const buf = pdfCom(['Documento de Arrecadacao do Simples Nacional', 'Numero do Documento 07.17.26258.8550743-5', IMPRESSA, 'Pagar este documento ate 30/09/2026']);
  const txt = await textoDoPdf(buf);
  assert.ok(txt.includes('Simples Nacional'));
  assert.deepStrictEqual(P.extractLinhasValidas(txt), [DIGITOS]);
});

test('lixo, vazio ou binário ausente -> "" (nunca lança)', async () => {
  assert.strictEqual(await textoDoPdf(Buffer.from('não sou pdf')), '');
  assert.strictEqual(await textoDoPdf(null), '');
  assert.strictEqual(await textoDoPdf(Buffer.from('%PDF-1.4'), { bin: '/nao/existe/pdftotext' }), '');
});
