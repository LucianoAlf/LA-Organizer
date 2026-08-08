'use strict';

// memory-date-stamp.js — carimba a data de origem em memórias que falam em tempo RELATIVO. PURO.
//
// O PROBLEMA (medido em 08/08)
// `collaborator_memory` guarda frases permanentes, e 33 das 456 contêm "hoje"/"ontem"/"amanhã":
//   "Quintela irá revisar o inventário das unidades amanhã."      (criada 08/08)
//   "Yuri planeja enviar vídeos de cultura para Peterson amanhã." (criada 28/07)
//   "Krissya irá colocar os valores na planilha às 12h39 de hoje."(criada 23/07)
// O prompt do 1:1 (prompts/system.js, buildContext) renderiza isso CRU, sem data nenhuma:
//   • [tipo] Yuri planeja enviar vídeos de cultura para Peterson amanhã.
// Duas semanas depois o TOM continua lendo "amanhã" e resolve pro amanhã de HOJE. É a mesma
// família do auto-envenenamento de data que foi corrigida no chat de GRUPO em 08/08
// (group-chat-prompt.js) — o 1:1 ficou de fora, e é o canal principal, ~30 pessoas.
//
// POR QUE CARIMBAR EM VEZ DE NEUTRALIZAR
// No grupo a fala do TOM é neutralizada porque lá o problema é ele COPIAR a própria data errada.
// Aqui é diferente: a frase é verdadeira, só está órfã de referência. Apagar o "amanhã" perderia
// a informação; datar resolve — "(28/07) …enviar vídeos amanhã" é interpretável e honesto.
// `created_at` já vem no select de system.js (linha ~1676) e só não estava sendo usado.
//
// Só carimba quem PRECISA (7% das memórias). O resto passa intacto, sem poluir o prompt.

// Termos que tornam a frase dependente de QUANDO foi dita. Inclui os relativos de semana,
// que envelhecem igual ("semana que vem" dito em julho não é a semana que vem de agora).
const RELATIVO_RE = new RegExp(
  '(?<![\\p{L}])(hoje|ontem|anteontem|amanh[ãa]|depois\\s+de\\s+amanh[ãa]'
  + '|semana\\s+que\\s+vem|semana\\s+passada|m[êe]s\\s+que\\s+vem|m[êe]s\\s+passado'
  + '|pr[óo]xima\\s+semana|essa\\s+semana|esta\\s+semana)(?![\\p{L}])', 'iu');

function _ddmm(when) {
  if (!when) return null;
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  // Data em BRT — o carimbo é lido por humano e por LLM no fuso de São Paulo.
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const [, mm, dd] = f.split('-');
  return `${dd}/${mm}`;
}

/** A frase depende de quando foi dita? */
function precisaCarimbo(content) {
  return typeof content === 'string' && RELATIVO_RE.test(content);
}

/**
 * Prefixa "(dd/mm)" quando a memória fala em tempo relativo e a data de origem é conhecida.
 * Devolve o conteúdo intacto em qualquer outro caso — sem data válida, não inventa carimbo.
 * @param {string} content     texto da memória
 * @param {string|Date} createdAt  quando foi registrada
 * @returns {string}
 */
function carimbaMemoriaRelativa(content, createdAt) {
  if (typeof content !== 'string' || !content.trim()) return content;
  if (!precisaCarimbo(content)) return content;
  const dm = _ddmm(createdAt);
  if (!dm) return content;                 // sem data confiável → melhor sem carimbo que com carimbo errado
  if (content.trimStart().startsWith(`(${dm})`)) return content;  // idempotente
  return `(${dm}) ${content}`;
}

module.exports = { carimbaMemoriaRelativa, precisaCarimbo, RELATIVO_RE };
