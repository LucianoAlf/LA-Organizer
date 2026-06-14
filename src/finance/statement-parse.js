// src/finance/statement-parse.js — parsers PUROS de fatura/extrato em OFX e CSV.
// Reusa o motor de import de fatura: a saída vira o MESMO `invoice` ({emissor, vencimento, itens})
// que o PDF produz, caindo no Intercept A (preview → lançar). Sem I/O, sem LLM. (Alf 14/06)
//
// OFX é padrão da indústria (SGML ou XML). CSV é variável → detecção tolerante de colunas.

const crypto = require('crypto');

// --- valores: aceita "1.234,56" (BR), "1234.56" (US), "-14.64", "R$ 50,00", "(12,34)" (= negativo) ---
function parseAmount(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }   // (12,34) = -12,34
  if (/-/.test(s)) neg = true;
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // o separador mais à direita é o decimal
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // BR: 1.234,56
    else s = s.replace(/,/g, '');                                        // US: 1,234.56
  } else if (lastComma > -1) {
    // só vírgula: decimal BR se 1-2 dígitos após a última vírgula; senão é milhar
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

// OFX date "20260514" ou "20260514120000[-03:EST]" → "2026-05-14"
function ofxDateToIso(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// pega o valor de uma tag OFX, tolerante a SGML (sem fechamento) e XML (com fechamento)
function ofxTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
}

function parseOfx(text) {
  const t = String(text || '');
  const isCard = /<CREDITCARDMSGSRSV1|<CCSTMTRS|<CCACCTFROM/i.test(t);
  const isBank = /<BANKMSGSRSV1|<STMTRS|<BANKACCTFROM/i.test(t);
  const kind = isCard ? 'card' : (isBank ? 'account' : 'unknown');
  const org = ofxTag(t, 'ORG');
  const periodEnd = ofxDateToIso(ofxTag(t, 'DTEND') || ofxTag(t, 'DTASOF'));
  const transactions = [];
  // cada <STMTTRN> … até </STMTTRN>, próximo <STMTTRN> ou </BANKTRANLIST>
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const blk = m[1];
    const amount = parseAmount(ofxTag(blk, 'TRNAMT'));
    if (!Number.isFinite(amount)) continue;
    transactions.push({
      date: ofxDateToIso(ofxTag(blk, 'DTPOSTED')),
      amount,
      descricao: ofxTag(blk, 'MEMO') || ofxTag(blk, 'NAME') || 'Lançamento',
      trntype: (ofxTag(blk, 'TRNTYPE') || '').toUpperCase(),
      fitid: ofxTag(blk, 'FITID') || null,
    });
  }
  return { kind, org, periodEnd, transactions };
}

function detectDelimiter(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of String(line || '')) if (ch in counts) counts[ch]++;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
}

function splitCsvLine(line, delim) {
  const out = []; let cur = ''; let q = false;
  const s = String(line || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { if (q && s[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function csvDateToIso(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/); if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/(\d{4})(\d{2})(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { transactions: [] };
  const delim = detectDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => /data|date|valor|amount|value|descri|t[íi]tulo|title|hist|lan[çc]|estabelec/i.test(h));
  const findCol = (...keys) => {
    for (const k of keys) { const i = header.findIndex((h) => h.includes(k)); if (i > -1) return i; }
    return -1;
  };
  const iDate = hasHeader ? findCol('data', 'date') : 0;
  const iDesc = hasHeader ? findCol('descri', 'título', 'titulo', 'title', 'hist', 'lanç', 'lanc', 'estabelec', 'memo') : 1;
  const iAmt = hasHeader ? findCol('valor', 'amount', 'value') : -1;
  const rows = hasHeader ? lines.slice(1) : lines;
  const transactions = [];
  for (const line of rows) {
    const cols = splitCsvLine(line, delim);
    if (cols.length < 2) continue;
    const amount = parseAmount(iAmt > -1 ? cols[iAmt] : cols[cols.length - 1]);
    if (!Number.isFinite(amount)) continue;
    transactions.push({
      date: csvDateToIso(iDate > -1 ? cols[iDate] : cols[0]),
      amount,
      descricao: (iDesc > -1 ? cols[iDesc] : cols[1]) || 'Lançamento',
      trntype: '',
    });
  }
  return { transactions };
}

// "Nubank_2026-06-21.ofx" → "Nubank"
function issuerFromFilename(filename) {
  if (!filename) return null;
  const base = String(filename).replace(/\.[a-z0-9]+$/i, '');
  const first = base.split(/[_\-\s.]+/)[0];
  return first && /[a-zA-ZÀ-ú]/.test(first) ? first : null;
}

// "Nubank_2026-06-21" → "2026-06-21" · "fatura_06-2026" → "2026-06-01"
function competenciaFromFilename(filename) {
  if (!filename) return null;
  const s = String(filename);
  let m = s.match(/(\d{4})[-_]?(\d{2})[-_](\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{4})[-_](\d{2})/); if (m) return `${m[1]}-${m[2]}-01`;
  m = s.match(/(\d{2})[-_](\d{4})/); if (m) return `${m[2]}-${m[1]}-01`;
  return null;
}

// Converte transações parseadas → `invoice` p/ o fluxo de cartão (Intercept A normaliza/filtra depois).
// Despesa = TRNTYPE DEBIT (se houver) OU o sinal dominante (fatura tem mais compras que créditos).
function buildCardInvoiceFromStatement(parsed, filename) {
  const txns = ((parsed && parsed.transactions) || []).filter((t) => Number.isFinite(t.amount) && t.amount !== 0);
  const typed = txns.filter((t) => t.trntype === 'DEBIT' || t.trntype === 'CREDIT');
  let isExpense;
  if (typed.length > 0 && typed.length >= txns.length * 0.5) {
    isExpense = (t) => t.trntype !== 'CREDIT';            // crédito/pagamento fora; resto é despesa
  } else {
    const negCount = txns.filter((t) => t.amount < 0).length;
    const dominNeg = negCount >= txns.length / 2;
    isExpense = (t) => (dominNeg ? t.amount < 0 : t.amount > 0);
  }
  // estorno/devolução/reembolso = crédito que ABATE (valor negativo); despesa = positivo; pagamento de fatura = fora.
  const RE_REFUND = /\bestorn|\bdevolu[çc]|\breembols|\bchargeback/i;
  const itens = txns
    .filter((t) => isExpense(t) || RE_REFUND.test(t.descricao || ''))
    .map((t) => {
      const isRef = !isExpense(t) && RE_REFUND.test(t.descricao || '');
      return {
        descricao: t.descricao,
        valor: isRef ? -Math.abs(t.amount) : Math.abs(t.amount),
        data: t.date, parcela_atual: 1, parcela_total: 1,
        import_ref: t.fitid || null,
      };
    });
  return {
    emissor: issuerFromFilename(filename) || (parsed && parsed.org) || '',
    vencimento: competenciaFromFilename(filename) || (parsed && parsed.periodEnd) || null,
    total: itens.reduce((s, it) => s + it.valor, 0),
    itens,
  };
}

// Orquestrador: decide ofx/csv pela extensão do nome ou pelo conteúdo. Retorna `invoice` (cartão) + meta.
function statementToInvoice({ filename, text }) {
  const name = String(filename || '').toLowerCase();
  const content = String(text || '');
  const looksOfx = /\.ofx$/.test(name) || /<OFX>|OFXHEADER|<STMTTRN>/i.test(content);
  const looksCsv = /\.csv$/.test(name) || (!looksOfx && /[;,]/.test(content.split(/\r?\n/)[0] || ''));
  let parsed, format;
  if (looksOfx) { parsed = parseOfx(content); format = 'ofx'; }
  else if (looksCsv) { parsed = { kind: 'unknown', org: null, periodEnd: null, transactions: parseCsv(content).transactions }; format = 'csv'; }
  else return { ok: false, reason: 'unsupported' };
  if (!parsed.transactions.length) return { ok: false, reason: 'no_transactions', format };
  const invoice = buildCardInvoiceFromStatement(parsed, filename);
  return { ok: true, format, kind: parsed.kind, invoice };
}

// Decodifica o buffer do arquivo respeitando o encoding declarado no header OFX.
// Bancos BR mandam CHARSET:1252 / latin1 (não UTF-8) → acento quebra se ler como utf8. (Alf 14/06)
function decodeBuffer(buf) {
  if (!Buffer.isBuffer(buf)) return String(buf || '');
  const head = buf.toString('latin1', 0, 400).toUpperCase();
  const m = head.match(/CHARSET[:=]\s*"?([\w-]+)/) || head.match(/ENCODING[:=]\s*"?([\w-]+)/);
  const declared = m ? m[1] : '';
  if (/UTF-?8/.test(declared)) return buf.toString('utf8');
  if (/1252|8859|LATIN|ANSI|WINDOWS-12/.test(declared)) return buf.toString('latin1');
  // sem declaração clara: tenta utf8; se vier caractere de replacement (), relê como latin1
  const asUtf = buf.toString('utf8');
  return asUtf.includes('�') ? buf.toString('latin1') : asUtf;
}

// Chave idempotente por item, pra NÃO duplicar quando a mesma fatura é reimportada (Alf/Rose 14/06:
// apagamos lançamento na mão 2×). OFX: FITID (único por transação). Sem FITID (PDF/CSV): hash de
// (cardId|competencia|data|valor|descricao|ocorrência) — a ocorrência distingue 2 compras idênticas
// legítimas no mesmo dia, mas casa quando a mesma fatura é reimportada.
function importKeyFor(it, ctx, occ) {
  if (it && it.import_ref) return `ofx:${(ctx && ctx.cardId) || ''}:${it.import_ref}`;
  const base = [
    ctx.cardId || '', ctx.competencia || '', (it && it.data) || '',
    Number((it && it.valor) || 0).toFixed(2), String((it && it.descricao) || '').toLowerCase().trim(), occ,
  ].join('|');
  return `h:${crypto.createHash('sha1').update(base).digest('hex').slice(0, 24)}`;
}

function buildImportKeys(itens, ctx = {}) {
  const seen = new Map();
  return (itens || []).map((it) => {
    if (it && it.import_ref) return importKeyFor(it, ctx, 1);
    const sig = [(it && it.data) || '', Number((it && it.valor) || 0).toFixed(2), String((it && it.descricao) || '').toLowerCase().trim()].join('|');
    const n = (seen.get(sig) || 0) + 1; seen.set(sig, n);
    return importKeyFor(it, ctx, n);
  });
}

module.exports = {
  parseAmount, ofxDateToIso, ofxTag, parseOfx, detectDelimiter, splitCsvLine, csvDateToIso, parseCsv,
  issuerFromFilename, competenciaFromFilename, buildCardInvoiceFromStatement, statementToInvoice,
  decodeBuffer, buildImportKeys, importKeyFor,
};
