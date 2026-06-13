// smoke-fatura-pdf.js — valida extração COMPLETA de fatura grande pelo Gemini (não trunca no item ~30).
// Uso na VPS: cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-fatura-pdf.js
const fs = require('fs');
const N = 45;
let body = 'BT /F1 10 Tf 20 ' + (N * 18 + 10) + ' Td\n';
for (let i = 1; i <= N; i++) {
  const dia = String((i % 27) + 1).padStart(2, '0');
  const ln = i + '. ' + dia + '/05 Loja' + i + ' R$ ' + (i * 7.13).toFixed(2) + (i % 3 === 0 ? ' Parcela 2/5' : ' a vista');
  body += '(' + ln + ') Tj 0 -18 Td\n';
}
body += 'ET';
const objs = [
  '<</Type/Catalog/Pages 2 0 R>>',
  '<</Type/Pages/Kids[3 0 R]/Count 1>>',
  '<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 ' + (N * 18 + 40) + ']/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
  null,
  '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
];
objs[3] = '<</Length ' + body.length + '>>\nstream\n' + body + '\nendstream';
let pdf = '%PDF-1.4\n';
const offs = [];
objs.forEach((o, i) => { offs[i] = Buffer.byteLength(pdf, 'latin1'); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
const xs = Buffer.byteLength(pdf, 'latin1');
pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
offs.forEach(o => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
pdf += 'trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xs + '\n%%EOF';
fs.writeFileSync('/tmp/fatura45.pdf', Buffer.from(pdf, 'latin1'));
console.log('[smoke] PDF gerado:', N, 'linhas,', Buffer.byteLength(pdf, 'latin1'), 'bytes');
(async () => {
  const gemini = require('/opt/LA-Organizer/src/services/gemini.js');
  const buf = fs.readFileSync('/tmp/fatura45.pdf');
  const r = await gemini.analyzeMedia(buf, 'application/pdf', 'fatura teste grande');
  const txt = r.text || r.error || '';
  const got = (txt.match(/Loja\s*\d+/gi) || []).length;
  console.log('[smoke] ok=' + r.ok + ' chars=' + txt.length + ' ocorrencias_Loja=' + got
    + ' temLoja30=' + /Loja\s*30\b/i.test(txt) + ' temLoja45=' + /Loja\s*45\b/i.test(txt));
  console.log('[smoke] FIM:', txt.slice(-160).replace(/\n/g, ' '));
})();
