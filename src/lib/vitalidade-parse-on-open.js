'use strict';
// vitalidade-parse-on-open.js — as fatias de parse-on-open estão VIVAS?
//
// Contexto (07/09/2026). O auto-resolve de confirmação (engine.js ~10450) só executa
// determinístico quando a intent NASCE com uma alça no payload: `coordination`,
// `batch_complete`, `delegation`, `reschedule`. Cada alça é estagiada por um parser que
// lê a PERGUNTA que o TOM acabou de escrever. Se a prosa do LLM deixa de casar a âncora
// literal do parser, a alça some — e a confirmação volta a cair no LLM em silêncio,
// sem nenhum erro, sem nenhum log. Foi exatamente assim que o Fechamento do dia passou
// meses recusando a palavra "sim" que ele mesmo pedia (commit 69f2c51e).
//
// Este helper mede TRÊS números por fatia, e a DIFERENÇA entre eles é o diagnóstico:
//
//   tema     — perguntas cujo ASSUNTO é daquela fatia (detecção LARGA, por verbo)
//   parser   — dessas, quantas o parser REAL de hoje casa
//   estagiou — quantas de fato nasceram com a chave no payload
//
//   estagiou > 0 e parser == 0 → a fatia estagia por caminho DIRETO (o parser nem é chamado).
//                                Está VIVA; o `parser 0` é artefato do medidor, não achado.
//   tema > 0  e  parser == 0   → ÂNCORA NÃO CASA A PROSA. É achado. (caso do fechamento)
//   parser > 0 e estagiou == 0 → quebra DEPOIS do parser (resolução título→id fail-closed)
//   tema == 0                  → sem oportunidade no período: a fatia dorme, não quebrou.
//
// O terceiro caso é o que impede alarme falso, e não é hipótese: em 07/09 as três fatias
// tinham ZERO estágios em quatro meses, e a leitura ingênua era "estão quebradas". Não
// estavam — TODAS as perguntas medidas eram anteriores ao dia em que os parsers nasceram
// (16/08 e 24/08). Falta de oportunidade não é defeito, e o laudo precisa saber dizer a
// diferença antes de mandar alguém consertar o que não está quebrado.
//
// Puro: recebe as linhas já lidas, não faz I/O.

const { parseCoordinationConfirmQuestion } = require('../coordination/coord-question-parse');
const { parseCompleteConfirmQuestion } = require('../utils/complete-question-parse');
const { parseDelegateConfirmQuestion } = require('../utils/delegate-question-parse');
const { parseRescheduleConfirmQuestion } = require('../tasks/reschedule-question-parse');

// A detecção de TEMA é de propósito mais larga que o parser: ela representa "o TOM estava
// falando disso". O vão entre TEMA e PARSER é o que denuncia a âncora que envelheceu.
const FATIAS_PADRAO = [
  {
    chave: 'coordination',
    nome: 'recado/coordenação',
    tema: /\b(aviso|avisar|recado|mando|mandar|encaminh\w*)\b/i,
    parse: (q) => parseCoordinationConfirmQuestion(q),
  },
  {
    chave: 'batch_complete',
    nome: 'fechamento por pergunta',
    tema: /\bfechamento\b|\bfechar\b|\bconclu\w+\b/i,
    parse: (q) => parseCompleteConfirmQuestion(q),
  },
  {
    chave: 'delegation',
    nome: 'delegação',
    tema: /\bdeleg\w*/i,
    parse: (q) => parseDelegateConfirmQuestion(q),
  },
  {
    chave: 'reschedule',
    nome: 'reagendamento',
    tema: /reagend\w*|remarc\w*|novos?\s+prazos?/i,
    parse: (q, hoje) => parseRescheduleConfirmQuestion(q, { todayYmd: hoje }),
  },
];

/** O parser casou de verdade? Cada um devolve um formato; normaliza sem mentir. */
function _casou(out) {
  if (!out) return false;
  if (Array.isArray(out.titles)) return out.titles.length > 0;
  if (Array.isArray(out.actions)) return out.actions.length > 0;
  if (Array.isArray(out.items)) return out.items.length > 0;
  return true;
}

/**
 * @param {Array<{question_text?:string, payload?:object, asked_at?:string}>} intents
 * @param {{hoje?:string, fatias?:Array}} opts
 * @returns {Array<{chave,nome,tema,parser,estagiou,ultimoEstagio,veredito}>}
 */
function vitalidadeDasFatias(intents, opts = {}) {
  const linhas = Array.isArray(intents) ? intents : [];
  const hoje = opts.hoje || new Date().toISOString().slice(0, 10);
  const fatias = opts.fatias || FATIAS_PADRAO;

  return fatias.map((f) => {
    let tema = 0;
    let parser = 0;
    let estagiou = 0;
    let ultimoEstagio = null;

    for (const r of linhas) {
      const q = String((r && r.question_text) || '');
      const pl = (r && r.payload) || {};
      const temChave = Object.prototype.hasOwnProperty.call(pl, f.chave);
      if (temChave) {
        estagiou++;
        const t = r.asked_at || null;
        if (t && (!ultimoEstagio || t > ultimoEstagio)) ultimoEstagio = t;
      }
      if (!q || !f.tema.test(q)) continue;
      tema++;
      // Parser quebrado NUNCA derruba a medição: um throw viraria laudo em branco, e
      // laudo em branco é lido como saúde. Conta como "não casou" e segue.
      let out = null;
      try { out = f.parse(q, hoje); } catch (_) { out = null; }
      if (_casou(out)) parser++;
    }

    let veredito;
    if (tema === 0 && estagiou === 0) veredito = 'sem_oportunidade';
    // ESTAGIOU manda em PARSER. Nem toda fatia passa pelo parser pra estagiar: o ramo A2 do
    // fechamento em lote resolve os ids na hora e escreve payload.batch_complete direto, e o
    // rótulo que ele grava em question_text ("Confirmar fechamento em lote: …") não é a frase
    // que o parser ancora (essa vai pro usuário, no reply). Com estágio recente, `parser 0` é
    // artefato do medidor — a alça está chegando. Sem esta linha o laudo mandou investigar uma
    // âncora intacta em 07/09, 11/09 e 12/09.
    else if (estagiou > 0 && parser === 0) veredito = 'viva_sem_parser';
    else if (tema > 0 && parser === 0) veredito = 'ancora_nao_casa';
    else if (parser > 0 && estagiou === 0) veredito = 'quebra_depois_do_parser';
    else veredito = 'viva';

    return { chave: f.chave, nome: f.nome, tema, parser, estagiou, ultimoEstagio, veredito };
  });
}

const _EXPLICA = {
  ancora_nao_casa: 'o TOM falou disso e o parser nao casou NENHUMA vez — a ancora literal '
    + 'envelheceu em relacao a prosa que o LLM escreve. E achado: investigue a ancora.',
  quebra_depois_do_parser: 'o parser casou mas nada foi estagiado — o furo esta DEPOIS dele '
    + '(tipicamente a resolucao titulo->id, que e fail-closed e pode estar fechada sempre).',
  sem_oportunidade: 'nao houve pergunta desse assunto no periodo. A fatia dorme; isso NAO e '
    + 'defeito e NAO deve virar achado.',
};

/** O bloco que entra no pedido do agente. Sem fatia doente, devolve string vazia. */
function blocoDoLaudo(vits) {
  const linhas = Array.isArray(vits) ? vits : [];
  if (!linhas.length) return '';
  const doentes = linhas.filter((v) => v.veredito !== 'viva' && v.veredito !== 'viva_sem_parser');
  if (!doentes.length) return '';

  const corpo = doentes.map((v) => `- ${v.nome} (${v.chave}): tema ${v.tema} · parser casou `
    + `${v.parser} · estagiou ${v.estagiou} · ultimo estagio: ${v.ultimoEstagio ? String(v.ultimoEstagio).slice(0, 10) : 'NUNCA'}`
    + `\n  ${_EXPLICA[v.veredito] || v.veredito}`).join('\n');

  return `\n\nVITALIDADE DAS FATIAS DE PARSE-ON-OPEN (a confirmacao so executa sozinha quando a
intent NASCE com alca no payload; a alca vem de um parser que le a pergunta do TOM):
${corpo}
Antes de abrir achado por qualquer uma destas, RESPONDA a pergunta que separa alarme de
defeito: e falta de oportunidade, ou a ancora deixou de casar a prosa? Confira a data em
que o parser NASCEU (git log --diff-filter=A no arquivo dele): pergunta ANTERIOR ao
nascimento nao prova nada. Foi esse passo que evitou um alarme falso em 07/09.`;
}

module.exports = { vitalidadeDasFatias, blocoDoLaudo, FATIAS_PADRAO };
