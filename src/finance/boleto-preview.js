'use strict';
// Prévia do boleto pré-confirmação. Voz do TOM: mesma pegada da prévia de fatura (sagrada).
function _fmtBR(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }
function _dm(iso) { return /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${iso.slice(8,10)}/${iso.slice(5,7)}` : (iso || '?'); }

const { formatLinhaDigitavel } = require('./boleto-parse');

// R3 (Rose 15/09): o nome era "Luciano" FIXO — o fluxo nasceu pro Alf (17/07) e chamava qualquer
// pessoa assim. Agora vem de quem mandou; sem nome, sem vocativo.
// O código só aparece quando os dígitos verificadores bateram (barcodeOk): número errado = pagamento
// errado, então sem prova vai o aviso, nunca o número.
function _linhaDoCodigo(barcodeOk, linha) {
  if (barcodeOk && linha) return `• Código de barras ✅ conferido:\n\`${formatLinhaDigitavel(linha)}\``;
  if (barcodeOk) return '• Código de barras: ✅ conferido';
  return '• Código de barras: ⚠️ não consegui ler com certeza — confere no boleto';
}
function buildBoletoPreview({ nome, beneficiario, valor, vencimento, barcodeOk, linha }) {
  const codLinha = _linhaDoCodigo(barcodeOk, linha);
  return [
    `🧾 Li um *boleto*${nome ? `, ${nome}` : ''}:`,
    `• *${beneficiario || 'Boleto'}* — R$ ${_fmtBR(valor)}`,
    `• Vence *${_dm(vencimento)}*`,
    codLinha,
    ``,
    `É só esse mês ou *repete todo mês*? E de qual conta você paga?`,
    ``,
    `Respondendo, eu crio a conta a pagar e te lembro no dia com o código pra copiar. 👍`,
  ].join('\n');
}
// R4 (Rose 15/09): 5 DAS numa rajada — só 1 era tratado e os outros sumiam. Com mais de um
// boleto, a resposta lista TODOS, cada um com o seu código (ou o aviso), e NÃO cria conta nenhuma.
function buildListaDeBoletos({ nome, boletos }) {
  const lista = boletos || [];
  const blocos = lista.map((b, i) => [
    `${i + 1}. *${b.beneficiario || 'Boleto'}* — R$ ${_fmtBR(b.valor)} · vence ${_dm(b.vencimento)}`,
    (b.barcodeOk && b.linha) ? `\`${formatLinhaDigitavel(b.linha)}\`` : '⚠️ código não lido com certeza — confere no documento',
  ].join('\n'));
  return [
    `🧾 Li *${lista.length} boletos*${nome ? `, ${nome}` : ''}:`,
    '',
    blocos.join('\n\n'),
    '',
    'Os códigos acima foram conferidos pelos dígitos verificadores — é só copiar. Quer que eu crie as contas a pagar e te lembre no vencimento? Me diz. 👍',
  ].join('\n');
}
module.exports = { buildBoletoPreview, buildListaDeBoletos };
