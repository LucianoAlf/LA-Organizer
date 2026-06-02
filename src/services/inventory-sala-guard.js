// src/services/inventory-sala-guard.js
//
// Trava DETERMINÍSTICA de sala no cadastro de inventário. O LLM não pode inserir
// numa sala "herdada" do histórico (bug Sala 13, 02/06: foto da Tagima foi pra
// Sala 13 sem o user pedir, puxada da conversa anterior do Condor). Só confirma:
//   (a) há sessão de inventário travada (salaRecentePersistida) que casa, ou
//   (b) o user disse a sala na mensagem atual (texto OU legenda da foto).
// Módulo puro → testável isolado. Consumido no handler <<INVENTORY_ACTION>>.
'use strict';

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * @param {{markerSalaNome?:string, markerSalaId?:string|number, persisted?:{sala_id?:any,sala_nome?:string}|null, inboundText?:string}} args
 * @returns {boolean} true se a sala do cadastro é confirmada (não herdada do histórico)
 */
function salaConfirmada({ markerSalaNome, markerSalaId, persisted, inboundText } = {}) {
  // (a) sessão de inventário travada
  if (persisted) {
    if (markerSalaId && persisted.sala_id && String(markerSalaId) === String(persisted.sala_id)) return true;
    if (markerSalaNome && persisted.sala_nome && norm(markerSalaNome) === norm(persisted.sala_nome)) return true;
    if (!markerSalaNome && !markerSalaId) return true; // marker usa a sala da sessão
  }
  // (b) user disse a sala no turno atual (texto ou legenda da foto)
  const t = norm(inboundText);
  if (markerSalaNome && t) {
    const sn = norm(markerSalaNome);
    if (sn && t.includes(sn)) return true;
    const num = (String(markerSalaNome).match(/\d+/) || [])[0];
    if (num && new RegExp(`sala\\s*${num}\\b`).test(t)) return true;
  }
  return false;
}

module.exports = { salaConfirmada, norm };
