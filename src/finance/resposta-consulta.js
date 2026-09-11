'use strict';
// resposta-consulta.js — CONSULTA-REPETE-PAINEL (triagem 11/09 — 07591221, 724688d2, 72f7e752).
//
// Rose 11/08, 00:44–00:53 BRT, com a IA principal em limite de uso (provider reserva): ela
// perguntou "qual é a diferença? o que está duplicado?", depois "a gente tava falando da fatura
// do LATAM PASS", depois "vc não tem acesso ao LA Organizer?" — e recebeu o MESMO painel da
// fatura, idêntico, nas três. O reserva emitia <<FINANCE_ACTION>> query_invoice pra pergunta, e
// o engine (Bug 3: "o engine é a fonte da confirmação") descarta a prosa do LLM e manda o painel.
//
// A regra do Bug 3 fica: o PRIMEIRO painel sai do banco, não da prosa (é o que protege número
// inventado). O que muda é o painel REPETIDO: igual a um que a pessoa recebeu nos últimos
// minutos não sai de novo. No lugar vai a prosa do LLM (a resposta à pergunta, se houver) ou uma
// pergunta honesta. PURO: quem busca os outbound recentes é o engine.
const _n = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function montarRespostaDeConsulta({ textoDoTom, paineis, recentes } = {}) {
  const lista = (Array.isArray(paineis) ? paineis : []).filter((p) => _n(p));
  const ja = new Set((Array.isArray(recentes) ? recentes : []).map(_n).filter(Boolean));
  const novos = lista.filter((p) => !ja.has(_n(p)));
  const repetidos = lista.length - novos.length;
  if (novos.length) return { texto: novos.join('\n\n'), repetidos };
  const prosa = _n(textoDoTom).length >= 40 ? String(textoDoTom).trim() : '';
  return {
    texto: prosa || 'Esse é o mesmo painel que te mandei agora há pouco — o que você quer saber dele?',
    repetidos,
  };
}

module.exports = { montarRespostaDeConsulta };
