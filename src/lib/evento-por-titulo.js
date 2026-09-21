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

function _casam(alvo, lista) {
  const exatos = lista.filter((e) => _n(e.title) === alvo);
  if (exatos.length) return exatos;
  return lista.filter((e) => {
    const t = _n(e.title);
    return t.length >= 4 && (t.includes(alvo) || alvo.includes(t));
  });
}

function escolherEventoPorTitulo(titulo, eventos, agoraMs, acao) {
  const alvo = _n(titulo);
  if (alvo.length < 4) return { evento: null };
  const todos = (Array.isArray(eventos) ? eventos : []).filter((e) => e);
  const vivos = todos.filter((e) => !['done', 'cancelled'].includes(e.status)
    && !(e.recurrence_rule != null && e.recurrence_parent_id == null));
  const cands = _casam(alvo, vivos);
  if (!cands.length) {
    // EVENT-CANCEL-SERIE-JA-ENCERRADA (Ana Paula 21/09 06:40 BRT). O cancel de série executou
    // (ok=1) e o LLM re-emitiu o mesmo marker 15s depois. Como cancelado sai do `vivos` ANTES
    // do casamento, o re-emit vinha como `{evento:null}` e o engine dizia "Não achei o evento
    // — me diz o nome certinho?": uma afirmação FALSA sobre o estado (o evento existe e já
    // está exatamente no estado pedido). Ela desistiu achando que o pedido tinha falhado.
    // Só `cancel`→`cancelled`: é a única forma medida (2 de 2 recusas em 90 dias).
    if (acao === 'cancel' && _casam(alvo, todos.filter((e) => e.status === 'cancelled')).length) {
      return { evento: null, jaNoEstado: 'cancelled' };
    }
    return { evento: null };
  }
  if (cands.length === 1) return { evento: cands[0] };
  if (new Set(cands.map((e) => _n(e.title))).size > 1) return { evento: null, ambiguo: cands };
  const ts = (e) => Date.parse(e.start_at);
  const passados = cands.filter((e) => ts(e) <= agoraMs).sort((a, b) => ts(b) - ts(a));
  const futuros = cands.filter((e) => ts(e) > agoraMs).sort((a, b) => ts(a) - ts(b));
  const e = acao === 'complete' ? (passados[0] || futuros[0]) : (futuros[0] || passados[0]);
  return { evento: e || null };
}

module.exports = { escolherEventoPorTitulo };
