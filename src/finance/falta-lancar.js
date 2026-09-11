'use strict';
// falta-lancar.js — FALTA-LANCAR-DA-FATURA (Rose 14/07 — finding 9151a290).
//
// Fatura de 62 itens aguardando "lançar". Rose: "tem alguns lançamentos lá já, tem que ver o que já tem
// p/ não duplicar" e "discrimina pra mim o que falta lançar da fatura" — o TOM respondeu as duas vezes
// com o resumo do cartão (query_invoice). A comparação existia só DENTRO do commit (import_key: o
// "lançar" pula o que já veio de fatura), e ninguém mostrava antes. Aqui: o que já está lançado pela
// fatura (o lançar pula), o que bate valor+data com lançamento feito à mão (o lançar NÃO pula — aviso
// honesto), e o que falta. PURO.

const JANELA_DIAS = 3;

/** A fala pede pra VER o que falta / o que já tem, sem mandar lançar? */
function pedeOQueFalta(texto) {
  const t = String(texto || '').toLowerCase();
  return /\bo\s+que\s+(?:falta|faltam|ainda\s+falta)\b|\bquais?\s+(?:falta|faltam)\b|\bj[áa]\s+(?:tem|t[áa]|est[áa]o?|foi|foram)\s+lan[çc]ad|\bo\s+que\s+j[áa]\s+(?:tem|foi|lancei|lan[çc]ou)\b|\bn[ãa]o\s+duplicar\b|\bdiscrimin/.test(t);
}

const _ms = (ymd) => Date.parse(`${String(ymd || '').slice(0, 10)}T12:00:00Z`);

/**
 * @param {Array<{data,descricao,valor}>} itens            itens da fatura (payload)
 * @param {Array<string|null>} chaves                     buildImportKeys(itens, …) — mesma ordem
 * @param {Set<string>} chavesExistentes                  import_keys já gravadas
 * @param {Array<{amount,transaction_date,import_key?}>} lancadosDoCartao  lançamentos do cartão na janela
 */
function faltaLancar(itens, chaves, chavesExistentes, lancadosDoCartao) {
  const lista = Array.isArray(itens) ? itens : [];
  const livres = (Array.isArray(lancadosDoCartao) ? lancadosDoCartao : []).filter((l) => !l.import_key).map((l) => ({ ...l, usado: false }));
  const out = { total: lista.length, pelaFatura: 0, porValor: [], faltam: [] };
  lista.forEach((it, i) => {
    const k = chaves && chaves[i];
    if (k && chavesExistentes && chavesExistentes.has(k)) { out.pelaFatura++; return; }
    const v = Number(it.valor).toFixed(2);
    const par = livres.find((l) => !l.usado && Number(l.amount).toFixed(2) === v
      && Math.abs(_ms(l.transaction_date) - _ms(it.data)) <= JANELA_DIAS * 86400e3);
    if (par) { par.usado = true; out.porValor.push(it); return; }
    out.faltam.push(it);
  });
  return out;
}

const _brl = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const _dm = (ymd) => { const d = String(ymd || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—'; };
const MAX_LINHAS = 20;

function textoFaltaLancar(r, nomeFatura) {
  const cab = `📋 *${nomeFatura || 'Fatura'}* — ${r.total} itens: *${r.pelaFatura} já lançados pela fatura*${r.porValor.length ? `, *${r.porValor.length} parecem lançados à mão*` : ''} e *faltam ${r.faltam.length}*.`;
  const linhas = r.faltam.slice(0, MAX_LINHAS).map((it, i) => `${i + 1}. ${_dm(it.data)} · ${it.descricao} · ${_brl(it.valor)}`);
  const mais = r.faltam.length > MAX_LINHAS ? `\n…e mais ${r.faltam.length - MAX_LINHAS}.` : '';
  const aviso = r.porValor.length
    ? `\n\n⚠️ ${r.porValor.length === 1 ? 'Esse que parece lançado à mão (mesmo valor e data)' : `Os ${r.porValor.length} que parecem lançados à mão (mesmo valor e data)`} o *lançar* NÃO pula — só pula o que já veio de fatura. Se quiser, lança e depois apaga a duplicata no app.`
    : '';
  const fim = r.faltam.length
    ? `\n\nResponde *lançar* que eu lanço — os ${r.pelaFatura} que já vieram de fatura eu pulo.`
    : (r.porValor.length ? '' : '\n\nTá tudo lançado — não precisa lançar de novo. 👍');
  return `${cab}${linhas.length ? `\n\n${linhas.join('\n')}${mais}` : ''}${aviso}${fim}`;
}

module.exports = { pedeOQueFalta, faltaLancar, textoFaltaLancar };
