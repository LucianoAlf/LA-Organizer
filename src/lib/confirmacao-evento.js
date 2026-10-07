'use strict';

// CONFIRMACAO-DE-EVENTO (07/10) — uma pergunta só, um "sim" só, pra tudo que segura a criação ou a
// remarcação de um compromisso no TOM.
//
// O defeito. O conflito de horário "leve" (temporal_soft) perguntava "Crio assim mesmo, ou prefere
// ajustar?" e NÃO guardava nada: o "sim" voltava pro LLM, que re-emitia o mesmo EVENT_CREATE, que
// batia no mesmo conflito e perguntava de novo — pra sempre. O "forte" (temporal_hard) nem
// perguntava ("Não dá pra criar como está"), embora a regra de desenho (Sprint 18, A2) fosse
// "bloqueia até confirmação explícita". Com o conflito passando a contar os eventos em que a pessoa
// é PARTICIPANTE (941e7ff7, caso Alf 06/10), isso dispara bem mais — virou risco de regressão.
//
// A raiz é a mesma do início-no-passado (0720b3e5): confirmação que não guarda a AÇÃO só pode pedir
// ao LLM pra repetir, e a repetição bate na mesma trava. Agora o ENGINE guarda a ação barrada
// (evento a criar ou remarcação) no intent event_create_confirm já marcada com as flags do que a
// pessoa está confirmando; o "sim" executa pelo resume determinístico; "não"/"outro horário" volta
// pro LLM. Passado + conflito no mesmo item viram UMA pergunta listando os dois, e as duas flags
// vão juntas — um "sim" cobre tudo.
//
// As flags são privilégio do engine (mesmo princípio do bypass_integrity, Luciano 02/07): vindas do
// JSON do modelo, saem no parse.

const { FLAG_CONFIRMADO: FLAG_PASSADO, inicioJaPassou, rotuloInicio } = require('./evento-no-passado');

const FLAG_CONFLITO = '_conflito_confirmado';
const FUSO = 'America/Sao_Paulo';

function descartarFlagsDoModelo(item) {
  if (item && typeof item === 'object') {
    delete item[FLAG_PASSADO];
    delete item[FLAG_CONFLITO];
  }
  return item;
}

// O que ainda falta a pessoa confirmar neste item. `conflitos` = o que o detector achou; o que já
// foi confirmado (flag) não volta a perguntar.
function pendencias({ item, startIso, conflitos, agoraMs = Date.now() }) {
  const passado = !!(item && item[FLAG_PASSADO] !== true && inicioJaPassou(startIso, agoraMs));
  const conf = (item && item[FLAG_CONFLITO] === true) ? [] : (conflitos || []);
  return { passado, conflitos: conf, segurar: passado || conf.length > 0 };
}

function marcarConfirmado(item) {
  return { ...item, [FLAG_PASSADO]: true, [FLAG_CONFLITO]: true };
}

const _hora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false });
const _faixa = (s, f) => `${_hora.format(new Date(s))}–${_hora.format(new Date(f))}`;

function _linhaConflito(c) {
  const local = c.reason === 'presencial_diff_location' && c.location_text ? `, em ${String(c.location_text).slice(0, 60)}` : '';
  return `• bate com *${String(c.title || '').slice(0, 80)}* (${_faixa(c.start_at, c.end_at)}${local})`;
}

// itens: [{ acao: 'criar'|'remarcar', titulo, start_at, end_at, passado, conflitos }]
function perguntaDeConfirmacao(itens) {
  const lista = (itens || []).filter((i) => i && i.start_at && (i.passado || (i.conflitos && i.conflitos.length)));
  if (!lista.length) return '';
  const blocos = lista.map((i) => {
    const quando = `${rotuloInicio(i.start_at)}${i.end_at ? `–${_hora.format(new Date(i.end_at))}` : ''}`;
    const cab = i.acao === 'remarcar'
      ? `Antes de remarcar *${String(i.titulo || '').slice(0, 80)}* pra ${quando}:`
      : `Antes de marcar *${String(i.titulo || '').slice(0, 80)}* (${quando}):`;
    const linhas = [];
    if (i.passado) linhas.push('• esse horário já passou');
    for (const c of (i.conflitos || []).slice(0, 3)) linhas.push(_linhaConflito(c));
    return `${cab}\n${linhas.join('\n')}`;
  });
  const fecho = lista.length === 1
    ? (lista[0].acao === 'remarcar' ? 'Remarco assim mesmo? Se preferir outro horário, me diz qual.' : 'Marco assim mesmo? Se preferir outro horário, me diz qual.')
    : 'Sigo assim mesmo com todos? Se algum for em outro horário, me diz qual.';
  return `${blocos.join('\n\n')}\n\n${fecho}`;
}

module.exports = {
  FLAG_PASSADO,
  FLAG_CONFLITO,
  descartarFlagsDoModelo,
  pendencias,
  marcarConfirmado,
  perguntaDeConfirmacao,
};
