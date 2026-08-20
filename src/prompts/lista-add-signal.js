'use strict';
// lista-add-signal.js — LISTA-TRABALHO-ROUTING-AUDIO (Rafinha 17/08, re-audit 20/08).
//
// O fix de 18/08 (skill-lista-trabalho-routing) faz "coloca no checklist telão de LED"
// carregar `listas-pessoais`. Passa no próprio teste — mas o teste usa a frase LIMPA. Em
// produção a mensagem de áudio chega com "[áudio transcrito] " na frente, e o pickSkill
// tem um short-circuit `tratamento-audio` (priority 1.4) que retorna ANTES do roteador de
// listas (priority 4.9). Resultado: TODO pedido de lista por áudio ainda cai no beco
// ("não consegui registrar isso agora"). Mesmo padrão que o `inProjectFlow` já trata —
// roteador de alto valor roda ANTES do áudio pra não ser sequestrado.
//
// Este módulo isola o sinal de ADIÇÃO EXPLÍCITA a lista/checklist (as DUAS regras
// topic-independentes e de alta precisão do 4.9), pra ser reusado nos dois pontos sem
// divergir por regex (a lição do [[feedback_varrer_readers_por_grep]] vale pra TEXTO).
// FORA de propósito: `listsActionRe && listsTopicRe` (depende de tópico) e `listsMarkDoneRe`
// (depende do histórico recente) — esses não são "adição explícita" e continuam no 4.9.

const AUDIO_PREFIX_RE = /^\s*\[[aá]udio transcrito\]\s*/i;

// "minha lista de mercado/viagem/…": lista pessoal nomeada por tópico.
const LISTS_EXPLICIT_RE = /\b(?:minha\s+)?lista\s+(?:de|do|da|pra)\s+(?:mercado|supermercado|farm[aá]cia|rem[eé]dios?|viagem|compras?|presentes?)/i;
// Adição EXPLÍCITA: verbo de acréscimo + direcional + o substantivo "lista/checklist/listagem".
// NÃO casa "manda/reenvia a lista" (verbo de ENVIO = consulta de agenda, não adição).
const LISTS_ADD_TO_RE = /\b(coloca|acrescent[ao]|adicion[ao]|p[oõ]e|bota|inclui|escreve|anota)\b[^.!?]{0,30}?\b(?:n[oa]|em|pra|para)\s+(?:essa\s+|nessa\s+|minha\s+|meu\s+|a\s+|o\s+|uma\s+)?(?:check\s?list|lista(?:gem)?)\b/i;

/** Tira o prefixo de transcrição de áudio, se houver. */
function stripAudioPrefix(text) {
  return String(text == null ? '' : text).replace(AUDIO_PREFIX_RE, '');
}

/**
 * A fala é uma ADIÇÃO EXPLÍCITA a uma lista/checklist? Robusto ao prefixo de áudio.
 * @param {string} text  fala do usuário (com ou sem "[áudio transcrito]")
 * @returns {boolean}
 */
function isExplicitListAdd(text) {
  const t = stripAudioPrefix(text);
  if (!t) return false;
  return LISTS_EXPLICIT_RE.test(t) || LISTS_ADD_TO_RE.test(t);
}

module.exports = { isExplicitListAdd, stripAudioPrefix, LISTS_EXPLICIT_RE, LISTS_ADD_TO_RE, AUDIO_PREFIX_RE };
