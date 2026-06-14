// src/finance/invoice-import.js — lógica PURA de import de fatura (sem I/O).
const BLOCK_RE = /\[FATURA_JSON\]\s*([\s\S]*?)\s*\[\/FATURA_JSON\]/i;

function parseInvoiceBlock(text) {
  if (!text || typeof text !== 'string') return { found: false, cleanText: text || '' };
  const m = BLOCK_RE.exec(text);
  if (!m) return { found: false, cleanText: text };
  const cleanText = text.replace(BLOCK_RE, '').trim();
  let json;
  try { json = JSON.parse(m[1].trim()); }
  catch { return { found: false, malformed: true, cleanText }; }
  if (!json || !Array.isArray(json.itens)) return { found: false, malformed: true, cleanText };
  return {
    found: true,
    cleanText,
    invoice: {
      emissor: String(json.emissor || '').trim(),
      vencimento: json.vencimento || null,
      total: Number(json.total) || 0,
      itens: normalizeItems(json.itens),
    },
  };
}

function normalizeItems(itens) {
  if (!Array.isArray(itens)) return [];
  return itens
    .map((it) => ({
      descricao: String(it.descricao || it.description || 'Compra').trim(),
      valor: Number(it.valor) || 0,
      data: it.data || it.date || null,
      parcela_atual: Number(it.parcela_atual) || 1,
      parcela_total: Number(it.parcela_total) || 1,
    }))
    .filter((it) => it.valor > 0);
}

function brl(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildInvoicePreview({ emissor, vencimento, total, cardName, itens, dupWarning }) {
  const head = `📄 *Fatura ${emissor || ''}*${vencimento ? ` · vence ${vencimento.slice(8, 10)}/${vencimento.slice(5, 7)}` : ''}`;
  const linhas = itens.map((it, i) => {
    const parc = it.parcela_total > 1 ? ` · ${it.parcela_atual}/${it.parcela_total}` : '';
    const dia = it.data ? `${it.data.slice(8, 10)}/${it.data.slice(5, 7)} · ` : '';
    return `${i + 1}. ${dia}${it.descricao} · R$ ${brl(it.valor)}${parc} · ${it.categoria || 'outros'}`;
  });
  const somaItens = itens.reduce((s, it) => s + Number(it.valor), 0);
  const partes = [
    head, '', linhas.join('\n'), '',
    `Total: R$ ${brl(total || somaItens)} · ${itens.length} lançamentos`,
  ];
  if (dupWarning) partes.push('', dupWarning);
  partes.push('', `Lanço essas compras no *${cardName}*? Responde *lançar*, *anotações* (só salvar) ou *cancelar*.`);
  return partes.join('\n');
}

const RE_COMMIT_FIN = /\b(lan[çc]ar?|lan[çc]a|pode lan[çc]ar|manda|confirmo?|confirma|isso|pode ser|sim|ok|beleza)\b/i;
const RE_ANOTAR = /\b(anota[çc][õo]es?|anota|s[óo] salva|salva.*anota|guarda.*anota|nota)\b/i;
const RE_CANCEL = /\b(cancela|cancelar|n[ãa]o|esquece|para)(?![a-zA-ZÀ-ú])|deixa pra l[áa]/i;

function detectInvoiceReply(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  if (RE_CANCEL.test(t) && !RE_COMMIT_FIN.test(t)) return 'cancel';
  if (RE_ANOTAR.test(t)) return 'commit_anotacoes';
  if (RE_COMMIT_FIN.test(t)) return 'commit_financeiro';
  return null;
}

// Heurística: a mensagem é uma FATURA colada como TEXTO (não PDF)? (Rose 14/06)
// Conservador: precisa de cara de fatura (header) + vários itens com valor. Lista de gastos
// crus (sem header de fatura) NÃO casa — segue no fluxo normal de markers.
function looksLikeInvoiceText(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  if (t.length < 80) return false; // fatura tem corpo; msg curta não é
  const hasHeader = /\bfatura\b/.test(t) || (/\bvencimento\b/.test(t) && /\btotal\b/.test(t)) || /compras?\s*:/.test(t);
  if (!hasHeader) return false;
  // vários valores monetários (R$ 1.234,56 / 136,28 / R$ 30) → corpo de fatura, não menção solta
  const valueMatches = text.match(/\d{1,3}(?:\.\d{3})*,\d{2}|R\$\s*\d/gi) || [];
  return valueMatches.length >= 4;
}

module.exports = { parseInvoiceBlock, normalizeItems, buildInvoicePreview, detectInvoiceReply, looksLikeInvoiceText };
