'use strict';
// Rose 15/09 21:16 — 5 DAS do Simples Nacional em PDF. O TOM chamou ela de "Luciano", disse que
// não leu o código de barras, tratou 1 dos 5 e criou conta sem ela pedir. Em 08/07 (foto de boleto
// bancário) ele lia. Raízes cobertas aqui:
//   R1 o DAS imprime a linha COM HÍFEN ("85800000004-0 …") e o extrator só aceitava dígito/ponto/
//      espaço — mesmo o modelo lendo certo ("copie EXATAMENTE como impressa"), a linha era jogada fora;
//   R2 o código vinha só do modelo; agora vem do TEXTO do PDF (pdftotext) e é provado pelos DVs;
//   R3 nome "Luciano" fixo no texto (o fluxo nasceu pro Alf, 17/07);
//   R4 rajada de vários boletos: 1 tratado, o resto sumia;
//   R5 o valor de arrecadação lia um dígito verificador no meio (parseBoletoValor).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./boleto-parse');
const { buildBoletoPreview, buildListaDeBoletos } = require('./boleto-preview');

// ── gerador INDEPENDENTE de linha de arrecadação válida (não usa o validador do código) ─────
function mod10(n) { let s = 0; let w = 2; for (let i = n.length - 1; i >= 0; i--) { let p = Number(n[i]) * w; if (p > 9) p -= 9; s += p; w = w === 2 ? 1 : 2; } const r = s % 10; return r === 0 ? 0 : 10 - r; }
function mod11(n) { let s = 0; let w = 2; for (let i = n.length - 1; i >= 0; i--) { s += Number(n[i]) * w; w = w === 9 ? 2 : w + 1; } const r = s % 11; return (r === 0 || r === 1) ? 0 : 11 - r; }
function linhaArrecadacao(valorCentavos, idValor = '8') {
  const valor = String(valorCentavos).padStart(11, '0');
  const barras = `8${'5'}${idValor}0${valor}0328${'2625885507435'}${'000000000000'}`.slice(0, 44);
  const dv = idValor === '6' || idValor === '7' ? mod10 : mod11;
  const blocos = [0, 1, 2, 3].map((i) => barras.slice(i * 11, i * 11 + 11));
  return { digitos: blocos.map((b) => b + dv(b)).join(''), impressa: blocos.map((b) => `${b}-${dv(b)}`).join(' ') };
}
const DAS = linhaArrecadacao(40145);         // R$ 401,45, mod11 (id 8)
const DAS2 = linhaArrecadacao(57782, '6');   // R$ 577,82, mod10 (id 6)

test('gerador de controle: as linhas de DAS são válidas pelo validador do código', () => {
  assert.strictEqual(P.validateLinhaDigitavel(DAS.digitos).valid, true);
  assert.strictEqual(P.validateLinhaDigitavel(DAS2.digitos).valid, true);
});

// R1
test('R1: linha de DAS impressa COM HÍFEN é extraída (antes voltava null)', () => {
  assert.strictEqual(P.extractLinhaDigitavel(DAS.impressa), DAS.digitos);
  assert.strictEqual(P.extractLinhaDigitavel(`Pague até 30/09/2026\n${DAS.impressa}\nValor: 401,45`), DAS.digitos);
});
test('R1: a linha bancária de sempre continua igual (HDI)', () => {
  assert.strictEqual(P.extractLinhaDigitavel('03399.74503 10900.009274 72059.001015 6 15130000099593'), '03399745031090000927472059001015615130000099593');
});

// R2
test('R2: extractLinhasValidas acha TODAS as linhas válidas do texto e ignora as inválidas', () => {
  const adulterada = DAS.digitos.slice(0, 20) + ((Number(DAS.digitos[20]) + 1) % 10) + DAS.digitos.slice(21);
  const txt = [
    'Documento de Arrecadação do Simples Nacional',
    'Número do Documento 07.17.26258.8550743-5    CNPJ 19.672.908/0001-70',
    DAS.impressa,
    `outra: ${adulterada}`,
    DAS2.impressa,
  ].join('\n');
  assert.deepStrictEqual(P.extractLinhasValidas(txt), [DAS.digitos, DAS2.digitos]);
});
test('R2: número de documento, CNPJ e datas nunca viram linha', () => {
  assert.deepStrictEqual(P.extractLinhasValidas('Número do Documento 07.17.26258.8550743-5 CNPJ 19.672.908/0001-70 Vencimento 30/09/2026'), []);
  assert.deepStrictEqual(P.extractLinhasValidas(''), []);
  assert.deepStrictEqual(P.extractLinhasValidas(null), []);
});

// R5
test('R5: valor da arrecadação sai dos 11 dígitos do código de barras, sem o DV no meio', () => {
  assert.strictEqual(P.parseBoletoValor(DAS.digitos), 401.45);
  assert.strictEqual(P.parseBoletoValor(DAS2.digitos), 577.82);
  assert.strictEqual(P.parseBoletoValor('03399745031090000927472059001015615130000099593'), 995.93);
});

// R3
test('R3: a prévia chama a PESSOA pelo nome dela — nunca "Luciano" fixo', () => {
  const msg = buildBoletoPreview({ nome: 'Rose', beneficiario: 'Simples Nacional', valor: 401.45, vencimento: '2026-09-30', barcodeOk: true, linha: DAS.digitos });
  assert.match(msg, /Li um \*boleto\*, Rose:/);
  assert.ok(!/Luciano/.test(msg));
  const semNome = buildBoletoPreview({ beneficiario: 'X', valor: 1, vencimento: '2026-09-30', barcodeOk: false });
  assert.match(semNome, /Li um \*boleto\*:/);
});
test('prévia com código conferido MOSTRA o código pra copiar', () => {
  const msg = buildBoletoPreview({ nome: 'Rose', beneficiario: 'Simples Nacional', valor: 401.45, vencimento: '2026-09-30', barcodeOk: true, linha: DAS.digitos });
  assert.ok(msg.includes('`' + P.formatLinhaDigitavel(DAS.digitos) + '`'));
});
test('prévia sem código conferido NUNCA mostra número (pagamento errado é pior)', () => {
  const msg = buildBoletoPreview({ nome: 'Rose', beneficiario: 'X', valor: 1, vencimento: '2026-09-30', barcodeOk: false, linha: DAS.digitos });
  assert.ok(!msg.includes(P.formatLinhaDigitavel(DAS.digitos)));
  assert.match(msg, /confere no boleto/);
});

// R4
test('R4: lista de vários boletos traz TODOS, cada um com o seu código (ou o aviso), sem criar nada', () => {
  const msg = buildListaDeBoletos({ nome: 'Rose', boletos: [
    { beneficiario: 'Simples Nacional — L A LTDA', valor: 401.45, vencimento: '2026-09-30', linha: DAS.digitos, barcodeOk: true },
    { beneficiario: 'Simples Nacional — KIDS', valor: 577.82, vencimento: '2026-09-30', linha: DAS2.digitos, barcodeOk: true },
    { beneficiario: 'Simples Nacional — CG', valor: 138.29, vencimento: '2026-09-30', linha: null, barcodeOk: false },
  ] });
  assert.match(msg, /Li \*3 boletos\*, Rose/);
  assert.ok(msg.includes(P.formatLinhaDigitavel(DAS.digitos)));
  assert.ok(msg.includes(P.formatLinhaDigitavel(DAS2.digitos)));
  assert.match(msg, /3\. \*Simples Nacional — CG\* — R\$ 138,29 · vence 30\/09\n⚠️/);
  assert.ok(!/Criei|criei/.test(msg), 'lista não cria conta nenhuma');
});

// ── ligação ─────────────────────────────────────────────────────────────────────────────────
const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const webhook = fs.readFileSync(path.join(__dirname, '..', 'webhook.js'), 'utf8');
test('engine: trata TODOS os [BOLETO_JSON] da rajada e passa o nome de quem mandou', () => {
  assert.match(engine, /matchAll\(\/\\\[BOLETO_JSON\\\]/);
  assert.ok(engine.includes('if (_bTodos.length > 1) {'), 'com mais de um boleto a resposta é a LISTA');
  assert.match(engine, /buildListaDeBoletos\(\{ nome: _nomeBoleto/);
  assert.match(engine, /buildBoletoPreview\(\{\s*nome: _nomeBoleto/);
});
test('engine: as mensagens do fluxo de boleto entram no histórico da conversa', () => {
  const i = engine.indexOf('// === Intercept BOLETO');
  const trecho = engine.slice(i, i + 6000);
  assert.ok((trecho.match(/logConversation\(collab\.id, 'outbound'/g) || []).length >= 2);
});
test('webhook: o código vem do TEXTO do PDF (provado por DV) e basta pra rota de boleto', () => {
  assert.match(webhook, /extractLinhasValidas\(await textoDoPdf\(buf\)\)/);
  assert.match(webhook, /linhasDoPdf\.length > 0 \|\|/);
});
