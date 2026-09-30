'use strict';
// criadas-vs-puladas.js — "criei" só pro que foi CRIADO; o que o dup-guard pulou diz que pulou e
// por quê. PURO. Mesmo padrão de lib/resultado-parcial-por-item.js (achado ae5f4b42).
//
// O CASO (Ana Paula, 1:1, 11/09/2026 00:37 UTC). "Marca todos os dias tom 26/09 27/09 28/09
// 29/09 30/09". O marker trouxe 5 creates ("Semana de provas - Faculdade · 26/09" … "· 30/09");
// os 5 caíram no SELF_RECENT_SKIP contra a tarefa criada 2 min antes (marker_logs TASK_CREATE
// skipped self_recent_skip:existing=440fcc1b ×5) e o ramo conta skip como ok (okCount++,
// "TASK_UPDATE executed ok=5"). A fala que saiu: "✅ Criando nos 5 dias, te lembro às 12h em cada
// um!" — nenhuma tarefa nova existia. Ela voltou 3 min depois: "Ainda não tá aparecendo pra mim".
// (O predicado do skip já foi apertado em 11/09 — prazo diferente = item diferente —, mas o skip
// legítimo continua mudo na fala; é isso que este módulo fecha.)
//
// Dispara quando há item PULADO e a prosa confirma registro (ou está vazia). Faz:
//   1. linha que afirma registro e não se restringe às criadas sai (fica o trecho que não afirma);
//   2. entra o resultado por item: "✅ *X* — criada" / "↩️ Não criei *Y* — já existe *Z* (criada
//      há N min)"; puladas contra a MESMA existente viram uma linha só.
const { hasCompletionClaim, hasOptimisticConfirm } = require('./optimistic-confirm');

const REGISTRO_RE = /(?<![\p{L}])(?:cri(?:ei|ando|ad[oa]s?)|anot(?:ei|ando|ad[oa]s?)|registr(?:ei|ando|ad[oa]s?)|agend(?:ei|ando|ad[oa]s?)|marquei|coloquei|salvei|botei)(?![\p{L}])/iu;
const EMOJI_OK_RE = /[✅☑✔✓]/u;

function _norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*_~]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function _cita(linha, titulo) { const t = _norm(titulo); return !!t && t.length >= 3 && _norm(linha).includes(t); }
function _afirmaRegistro(l) { return hasCompletionClaim(l) || hasOptimisticConfirm(l) || REGISTRO_RE.test(l) || EMOJI_OK_RE.test(l); }
function _junta(xs) { return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`; }
function _idade(min) { return Number.isFinite(min) ? (min < 1 ? 'agora há pouco' : `há ${min} min`) : 'agora há pouco'; }

/**
 * @param {string} prosa  cleanText do LLM (sem o marker)
 * @param {Array<{titulo:string, criada:boolean, existente?:string, idadeMin?:number}>} itens
 * @returns {{fired:boolean, texto:string, criadas:number, puladas:number}}
 */
function relatoCriadasEPuladas(prosa, itens) {
  const lista = (Array.isArray(itens) ? itens : []).filter((i) => i && i.titulo);
  const texto = String(prosa == null ? '' : prosa);
  const criadas = lista.filter((i) => i.criada);
  const puladas = lista.filter((i) => !i.criada);
  const base = { fired: false, texto, criadas: criadas.length, puladas: puladas.length };
  if (!puladas.length) return base;
  const linhas = texto.split('\n');
  // Pulada IGUAL à existente (mesmo título: re-emit do que já foi anotado) — afirmar que ela "está
  // registrada" é verdade; só a pulada DIFERENTE (outro item comido pelo dup-guard) torna a fala falsa.
  // Replay 60d: Arthur 04/08, Ana 16/08 e Krissya 29/09 eram re-emit; Ana 11/09 e Rafinha 17/09 não.
  const igual = (i) => _norm(i.titulo) === _norm(i.existente || i.titulo);
  const diferentes = puladas.filter((i) => !igual(i));
  const verdadeiros = [...criadas, ...puladas.filter(igual)];
  const soDeVerdadeiros = (l) => verdadeiros.some((i) => _cita(l, i.titulo)) && !diferentes.some((i) => _cita(l, i.titulo));
  const falsas = new Set(diferentes.length
    ? linhas.map((l, k) => (l.trim() && _afirmaRegistro(l) && !soDeVerdadeiros(l) ? k : -1)).filter((k) => k >= 0)
    : []);
  // Confirmação (qualquer linha que afirma registro) com item pulado SEMPRE diz o que foi pulado —
  // mesmo quando a linha só nomeia as criadas (ela é verdadeira e fica; o pulado entra no fim).
  const confirma = linhas.some((l) => l.trim() && _afirmaRegistro(l));
  if (!confirma && texto.trim()) return base;

  const bloco = [];
  if (diferentes.length) for (const i of criadas) if (!linhas.some((l, k) => !falsas.has(k) && _cita(l, i.titulo))) bloco.push(`✅ *${i.titulo}* — criada`);
  const porExistente = new Map();
  for (const i of puladas) {
    const k = _norm(i.existente || i.titulo);
    if (!porExistente.has(k)) porExistente.set(k, { existente: i.existente || i.titulo, idadeMin: i.idadeMin, titulos: [] });
    porExistente.get(k).titulos.push(i.titulo);
  }
  for (const g of porExistente.values()) {
    const iguais = g.titulos.every((t) => _norm(t) === _norm(g.existente));
    bloco.push(iguais
      ? `↩️ *${g.existente}* já estava anotada (criada ${_idade(g.idadeMin)}) — não criei de novo.`
      : `↩️ Não criei ${_junta(g.titulos.map((t) => `*${t}*`))} — já existe *${g.existente}* (criada ${_idade(g.idadeMin)}), e eu não duplico.`);
  }
  if (!criadas.length && diferentes.length > 1) bloco.unshift('Nada novo foi criado:');

  const out = [];
  let pos = -1;
  linhas.forEach((l, k) => {
    if (!falsas.has(k)) { out.push(l); return; }
    const sobra = l.split(/\s+[—–]\s+/u).filter((seg) => seg.trim() && !_afirmaRegistro(seg)).join(' — ').trim();
    if (pos < 0) pos = out.length;
    if (sobra) out.push(sobra.charAt(0).toUpperCase() + sobra.slice(1));
  });
  out.splice(pos < 0 ? out.length : pos, 0, ...bloco);
  return { ...base, fired: true, texto: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

module.exports = { relatoCriadasEPuladas };
