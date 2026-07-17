'use strict';
// Prévia do boleto pré-confirmação. Voz do TOM: mesma pegada da prévia de fatura (sagrada).
function _fmtBR(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }
function _dm(iso) { return /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${iso.slice(8,10)}/${iso.slice(5,7)}` : (iso || '?'); }

function buildBoletoPreview({ beneficiario, valor, vencimento, barcodeOk }) {
  const codLinha = barcodeOk
    ? '• Código de barras: ✅ conferido'
    : '• Código de barras: ⚠️ não consegui ler com certeza — confere no boleto';
  return [
    `🧾 Li um *boleto*, Luciano:`,
    `• *${beneficiario || 'Boleto'}* — R$ ${_fmtBR(valor)}`,
    `• Vence *${_dm(vencimento)}*`,
    codLinha,
    ``,
    `É só esse mês ou *repete todo mês*? E de qual conta você paga?`,
    ``,
    `Respondendo, eu crio a conta a pagar e te lembro no dia com o código pra copiar. 👍`,
  ].join('\n');
}
module.exports = { buildBoletoPreview };
