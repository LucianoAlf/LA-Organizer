'use strict';
// evento-por-titulo.js — EVENT-UPDATE-POR-TITULO (triagem 11/09 — caf078f2).
//
// Peterson 22/07, "bora dar baixa em tudo do evento": o TOM emitiu
// <<EVENT_UPDATE>>[{"action":"complete","title":"Reunião online de briefing do evento — professores"}]
// sem id; o validador só aceitava id e o bloco caiu como schema_invalid — o evento ficou aberto e
// o TOM seguiu como se tivesse fechado. 3 das 24 recusas de EVENT_UPDATE desde junho eram isso.
//
// PURO: recebe os eventos do DONO (o engine busca) e escolhe UM. Regras:
//   • molde de série, fechado ou cancelado não conta;
//   • título igual (sem acento/caixa) vence; senão, o que contém o pedido (ou é contido nele);
//   • títulos DIFERENTES que batem → ambíguo (o engine pergunta qual), nunca chuta;
//   • o MESMO título repetido (ocorrências de série): complete → o último que já começou;
//     cancel/reschedule → o próximo que ainda não começou.
function _n(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function escolherEventoPorTitulo(titulo, eventos, agoraMs, acao) {
  const alvo = _n(titulo);
  if (alvo.length < 4) return { evento: null };
  const vivos = (Array.isArray(eventos) ? eventos : []).filter((e) => e
    && !['done', 'cancelled'].includes(e.status)
    && !(e.recurrence_rule != null && e.recurrence_parent_id == null));
  let cands = vivos.filter((e) => _n(e.title) === alvo);
  if (!cands.length) {
    cands = vivos.filter((e) => {
      const t = _n(e.title);
      return t.length >= 4 && (t.includes(alvo) || alvo.includes(t));
    });
  }
  if (!cands.length) return { evento: null };
  if (cands.length === 1) return { evento: cands[0] };
  if (new Set(cands.map((e) => _n(e.title))).size > 1) return { evento: null, ambiguo: cands };
  const ts = (e) => Date.parse(e.start_at);
  const passados = cands.filter((e) => ts(e) <= agoraMs).sort((a, b) => ts(b) - ts(a));
  const futuros = cands.filter((e) => ts(e) > agoraMs).sort((a, b) => ts(a) - ts(b));
  const e = acao === 'complete' ? (passados[0] || futuros[0]) : (futuros[0] || passados[0]);
  return { evento: e || null };
}

module.exports = { escolherEventoPorTitulo };
