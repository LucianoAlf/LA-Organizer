'use strict';
// user-confirmation.js — classificação PURA de "sim/não" curto do usuário em resposta
// a uma pergunta de confirmação do TOM. Retorna 'yes' | 'no' | null.
//
// Extraído de pending-intents.js (que faz `require('../supabase/client')`, VPS-only →
// quebra local) pra ficar testável isolado com `node --test`. Comportamento IDÊNTICO
// ao original + o fix do "s" abaixo.
//
// CONFIRM-SHORTYES-S-UNRECOGNIZED (Clayton 09/07): "S" (abreviação de "sim") não casava
// o YES_RE (só "sim"/"sm") → detectUserConfirmation=null → o handler determinístico do
// batch_complete (engine.js:9548, exige 'yes') não disparava → o "S" caía no LLM, que
// re-emitia complete → batchCompleteNeedsConfirm re-disparava → LOOP "Confirma? / S /
// Confirma?". Fix: `s+\b` reconhece "s"/"ss"/"sss". Gated pelo contexto (só há confirmação
// quando há intent aberta) → risco de falso-positivo mínimo; `\b` barra "saldo"/"sexta".

// CONFIRM-ELONGATION-BLIND (Vitoria 27/07) — alongar letra é a forma NORMAL de escrever
// no WhatsApp, e QUALQUER alongamento zerava a detecção: "Siim", "okk", "beleeza", "issso"
// e até "Nãoo" davam null. No caso medido, a intent com batch_complete[9] estava aberta e
// os 9 short-ids resolviam 9/9 — só o "Siim" impediu o executor determinístico de rodar;
// o LLM re-emitiu, o guard A2 re-perguntou, e as 9 tarefas seguiram `pending` por 12 dias.
//
// Duas variantes porque colapsar sempre até 1 letra QUEBRA tokens de dupla legítima
// ("issso" → "iso" não casaria `isso`, mas → "isso" casa). Aplicadas em CASCATA e só
// quando a leitura literal deu null: nenhum resultado existente muda de valor, então é
// zero-regressão por construção — o colapso só transforma "não reconheci" em resposta.
const collapseTo2 = (t) => t.replace(/(\p{L})\1{2,}/gu, '$1$1');
const collapseTo1 = (t) => t.replace(/(\p{L})\1+/gu, '$1');

function detectUserConfirmation(userText, opts = {}) {
  if (typeof userText !== 'string') return null;
  const t = userText.toLowerCase().trim();
  if (!t || t.length > 200) return null;  // só pegamos respostas curtas
  // Literal primeiro; só depois as formas desalongadas (ver collapseTo2/collapseTo1).
  for (const cand of [t, collapseTo2(t), collapseTo1(t)]) {
    const r = classify(cand, opts);
    if (r) return r;
  }
  return null;
}

function classify(t, opts = {}) {
  const _nWords = t.split(/\s+/).length;

  // PENDING-COMPLETE-EATS-OTHER-ACTION (Ana Paula 17/08 09:01 BRT) — sob allowDone a pergunta
  // pendente é SEMPRE "confirma que já foi feito?". A Ana respondeu "Pode excluir essa tarefa":
  // o "pode" casa o YES_RE, 4 palavras passam o F5, e o pedido de EXCLUIR virou confirmação de
  // CONCLUSÃO. Como o executor é determinístico, saiu "✅ ... concluído." sem marker nenhum e
  // sem passar pelo chokepoint de confabulação (que só roda no caminho do LLM).
  // O afirmador abre a frase, mas o VERBO dela é de outra ação — isso é pedido novo, não "sim".
  // Devolver null manda o turno pro LLM, que roteia a ação certa. Gated em allowDone: sem intent
  // de conclusão aberta nada muda. Fica DEPOIS do NO_RE pra não mexer em negativa.
  // Sem `\b` final: em JS `\b` é ASCII e "excluí" termina em vogal acentuada (mesma lição do
  // COMPLETION_END em optimistic-confirm.js) — o boundary nunca fecharia.
  const OUTRA_ACAO_RE = /\b(?:exclu[ií]|apag|delet|remov|cancel|reagend|remarc|adia|deleg)\w*(?![\p{L}])/u;
  const _outraAcao = !!opts.allowDone && OUTRA_ACAO_RE.test(t);

  // BATCH-CONFIRM-LONGPHRASE (Daiana 22/06): confirmação AFIRMATIVA que abre com afirmador
  // inequívoco ("Sim, por favor. Pode fechar as 6 tarefas") é clara mesmo com cortesia/objeto.
  // Aceita até 12 palavras DESDE QUE não haja ressalva/negação. A NEGAÇÃO segue restrita a
  // ≤4 palavras (preserva F5/ALVO-FUTURO, caso Ana). Sem isso, a confirmação longa caía no LLM
  // e o executeBatchComplete determinístico nunca disparava (all_failed sob fallback).
  const STRONG_YES_OPEN = /^(sim|isso|claro|perfeito|exato|confirmo|confirmad[oa]|beleza|blz|okay|ok|t[áa]|bora)\b/;
  const RESSALVA = /\b(n[aã]o|nao|nunca|jamais|mas|por[ée]m|depois|amanh[ãa]|espera|aguarda)\b|deixa\s+pra|s[óo]\s+que/;
  if (_nWords > 4 && _nWords <= 12 && STRONG_YES_OPEN.test(t) && !RESSALVA.test(t) && !_outraAcao) return 'yes';

  // BATCH-CONFIRM-IMPERATIVE-NUM (Rose/2088 28/06): com intent de complete/batch ABERTA
  // (allowDone), uma confirmação por CONCLUSÃO mais longa — "1 e 2 já foram feitas",
  // "conclui as 3 que já fiz" — também confirma, desde que sem ressalva/negação. Gated em
  // allowDone: SEM intent aberta NÃO entra (p/ "finalizei o projeto ontem" solto não
  // auto-concluir). Negação F5/Ana segue restrita a ≤4 palavras abaixo.
  const DONE_ANYWHERE = /\b(conclu[ií]|finaliz(?:ei|ou|ad[oa])|feit[oa]s?|fiz|prontas?|terminei|resolvi|fechei|encerr[ei])/;
  // HESITA: fala QUEBRADA/correção ("Conclui .. esqueci de colocar aqui") tem done-verb mas
  // NÃO é confirmação — reticências/"esqueci"/"pera"/"aliás" = segunda intenção. Exclui.
  const HESITA = /\besqueci\b|\besquece\b|\bpera[íi]?\b|\bperai\b|\bal[ií]as\b|\.\./;
  if (opts.allowDone && _nWords > 4 && _nWords <= 12 && DONE_ANYWHERE.test(t) && !RESSALVA.test(t) && !HESITA.test(t) && !_outraAcao) return 'yes';

  // F5 (ALVO-FUTURO, auditoria 09/06) — confirmação/negação só em resposta ESSENCIALMENTE
  // curta (≤4 palavras). "Não foi a ADM, foi a de hoje, de governança" começa com "não"
  // mas é CONTEÚDO — negava às cegas uma intent não-relacionada (caso Ana 227b8689).
  if (_nWords > 4) return null;

  // Negativas primeiro (mais específicas pra evitar falso positivo)
  const NO_RE = /^(n[aã]o\b|nao\b|deixa\s+pra\s+l[aá]|esquece|cancela|n[aã]o\s+precisa|desconsidera|ainda\s+n[aã]o)/;
  if (NO_RE.test(t)) return 'no';

  // Pedido de OUTRA ação não confirma conclusão (ver PENDING-COMPLETE-EATS-OTHER-ACTION acima).
  if (_outraAcao) return null;

  // Afirmativas
  // `s+\b` (CONFIRM-SHORTYES-S-UNRECOGNIZED): "s"/"ss"/"sss" = sim abreviado (caso Clayton).
  // `\b` barra "saldo"/"sexta" (após os "s" vem letra = sem boundary). Antes só "sim"/"sm".
  // `t[áa](?=$|[\s.,!?;:)])` (CONFIRM-SHORTYES-TA-ACCENT-BOUNDARY): "tá" isolado não casava
  // `t[áa]\b` porque `\b` em JS é ASCII e "á" não é word-char (lição audit 28/06). O lookahead
  // ASCII-safe casa "tá" antes de fim/espaço/pontuação; "tabela"/"tarde" (letra depois) não vaza.
  const YES_RE = /^(sim\b|s[i]m\b|s+\b|ok\b|okay\b|pode\b|cria\b|cri[ae]m?\b|manda\b|manda\s+ver|fechou\b|fechado\b|beleza\b|blz\b|isso\b|isso\s+mesmo|claro\b|t[áa](?=$|[\s.,!?;:)])|t[áa]\s+certo|vai\b(?!\s+dar)|vai\s+(?:criando|criar|fazendo)|bora\b|perfeito\b|exato\b|confirmad[oa]\b|confirmo\b|confirma\b|confirmar\b|confirmei\b|👍)/;
  if (YES_RE.test(t)) return 'yes';
  // "vai criando aí"
  if (/vai\s+criando\s+a[íi]?/i.test(t)) return 'yes';
  // GUARD-CONFIRM-LOOP (Matheus 10/06): vocabulário de CONCLUSÃO ("já conclui",
  // "já foi feito", "feito", "fiz") — SÓ quando o chamador indica intent ancorada
  // de complete (opts.allowDone): a pergunta foi "confirma que já foi feito?" e
  // essas são as respostas literais. NUNCA entra no YES genérico — "feito" solto
  // confirmaria intent não-relacionada (família de risco do "aprovado"/APROVACAO-SEM-FUNIL).
  if (opts.allowDone) {
    // CONFIRM-QUANTIFIER-BLIND (Yuri 28/07): o DONE_RE é ancorado em `^`, então o verbo de
    // conclusão precisava vir PRIMEIRO — "já fiz todas" casava, "Todas feitas" não. E
    // "todas feitas" é a resposta mais natural a "das suas 3 coisas: 1… 2… 3… fez?".
    // QUANT entra como prefixo OPCIONAL (nada que casava antes deixa de casar) e os
    // particípios ganham plural, que só existe junto do quantificador ("feitas", "prontas").
    const QUANT = String.raw`(?:tudo|todas|todos|toda|tds|td)\s+(?:as?\s+)?(?:\d+\s+)?`;
    const DONE_RE = new RegExp(String.raw`^(?:${QUANT})?(j[áa]\s+)?(foi\s+|t[áa]\s+|est[áa]\s+)?(conclu[ií](?:d[oa]s?)?|fiz\b|feit[oa]s?\b|finalizei|finalizad[oa]s?|terminei|terminad[oa]s?|pront[oa]s?\b|resolvi\b|resolvid[oa]s?|fechei\b)`);
    if (DONE_RE.test(t)) return 'yes';
    // "todas já foram" / "tudo foi" — auxiliar SOZINHO só confirma atrás do quantificador,
    // senão "foi ele" viraria confirmação.
    if (new RegExp(String.raw`^(?:${QUANT})(j[áa]\s+)?(?:foram|foi)\b`).test(t)) return 'yes';
    // CONFIRM-AUX-FOI-BLIND (Jhonatan 02/09 19:41 BRT): sem o quantificador o auxiliar
    // pelado dava null — "Foi" é a resposta mais curta possível a "já foi feito?", e o
    // null mandou o turno pro LLM, que re-emitiu complete e fez o A2 re-perguntar. Três
    // voltas da MESMA pergunta (3× TASK_UPDATE rejected all_failed:6) até ele escrever
    // "Confirmado". O QUANT existia pra barrar "foi ele"; exigir que o auxiliar FECHE a
    // frase barra igual, sem obrigar o quantificador. Aditivo à linha acima (que segue
    // valendo pra "todas foram feitas ontem", onde a frase continua): só converte null
    // em 'yes', nenhum resultado existente muda.
    if (/^(j[áa]\s+)?(?:foram|foi)(?:\s+(?:sim|mesmo|tudo|tod[oa]s))?\s*[.!]*$/.test(t)) return 'yes';
  }
  return null;
}

module.exports = { detectUserConfirmation };
