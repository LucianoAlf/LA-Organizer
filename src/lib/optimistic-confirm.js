'use strict';

// AUDIT-OPTIMISTIC-CONFIRM (12/06) — sanitizador pós-marker unificado.
//
// Problema: o LLM gera a frase de sucesso ("✅ Criado!", "fechei todas as
// pendências") ANTES de saber o resultado real, e o engine appenda o erro/parcial
// depois → contradição intra-mensagem. Esta função roda nos ramos de FALHA/PARCIAL
// (e nos blocks de IntegrityCheck) e rebaixa/remove a frase otimista de acordo com
// o resultado REAL (vindo de okCount/failCount no engine, nunca adivinhado do texto).
//
// outcome:
//   'failed'  — nada persistiu  → remove toda confirmação otimista.
//   'partial' — parte persistiu → rebaixa totalizador absoluto ("todas"→"a maioria")
//               e remove confirmações puras sem quantificador.
//   qualquer outro valor → no-op (defensivo; sucesso real nunca passa por aqui).

// ✅ ☑ ✔ 🆗 🎉 👍 🙌 — emojis que sinalizam "feito".
const SUCCESS_EMOJI_RE = /[✅☑✔\u{1F197}\u{1F389}\u{1F44D}\u{1F64C}]/u;
const SUCCESS_EMOJI_GLOBAL = /[✅☑✔\u{1F197}\u{1F389}\u{1F44D}\u{1F64C}]️?\s?/gu;

// Markup de início de linha (negrito/itálico/bullet/citação) a ignorar.
const LEADING_MARKUP = /^[\s*_~>•\-–—"']+/;

// Verbos de CONCLUSÃO (particípio ou 1ª pessoa do passado) + estados "pronto/feito".
// Inclui o prefixo opcional "tá/está". NÃO inclui presente/futuro/gerúndio
// ("crio", "vou criar", "criando") — isso é intenção, não conclusão.
const COMPLETION_CORE =
  '(?:t[aá]|est[aá]\\s+)?' +
  '(?:criad[oa]s?|criei|registrad[oa]s?|registrei|anotad[oa]s?|anotei|' +
  'agendad[oa]s?|agendei|marcad[oa]s?|marquei|salvad[oa]s?|salv[oa]s?|salvei|' +
  'guardad[oa]s?|guardei|reagendad[oa]s?|reagendei|atualizad[oa]s?|atualizei|' +
  'conclu[ií]d[oa]s?|conclu[ií]|fechad[oa]s?|fechei|resolvid[oa]s?|resolvi|' +
  'finalizad[oa]s?|finalizei|encerrad[oa]s?|encerrei|movid[oa]s?|movi|' +
  'cancelad[oa]s?|cancelei|pront[oa]|prontinh[oa]|feit[oa])\\b';

const COMPLETION_ANCHORED = new RegExp('^[\\s*_~>•\\-–—"\']*' + COMPLETION_CORE, 'i');
const COMPLETION_ANYWHERE = new RegExp('\\b' + COMPLETION_CORE, 'i');

// Totalizador absoluto.
const TOTALIZER_RE = /\b(todas|todos|tudo)\b/i;

// Confirmações de recorrência ("você recebe o lembrete", "todo dia 5").
const RECUR_RE = /(voc[êe]\s+recebe\s+o\s+lembrete|^todo\s+dia\s+\d+)/i;

function _stripLeadingEmoji(line) {
  return String(line).replace(SUCCESS_EMOJI_GLOBAL, '').replace(LEADING_MARKUP, '').trimStart();
}

// Uma linha é "otimista" quando afirma que a ação foi concluída.
function _isOptimisticLine(line) {
  const t = String(line).trim();
  if (!t) return false;
  if (SUCCESS_EMOJI_RE.test(t)) return true;
  if (RECUR_RE.test(t)) return true;
  const noEmoji = _stripLeadingEmoji(t);
  if (COMPLETION_ANCHORED.test(noEmoji)) return true;
  // "Todos os itens registrados" — totalizador + verbo de conclusão em qualquer
  // posição. Sem o totalizador NÃO casa (evita stripar menção a estado alheio,
  // ex.: "Comprar enfeite já tava marcado").
  if (TOTALIZER_RE.test(t) && COMPLETION_ANYWHERE.test(t)) return true;
  return false;
}

function _downgradeTotalizers(line) {
  const cap = (m, repl) => (m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase())
    ? repl.charAt(0).toUpperCase() + repl.slice(1)
    : repl;
  return String(line)
    .replace(/\btodas as\b/gi, (m) => cap(m, 'a maioria das'))
    .replace(/\btodos os\b/gi, (m) => cap(m, 'a maioria dos'))
    .replace(/\btodas\b/gi, (m) => cap(m, 'a maioria'))
    .replace(/\btodos\b/gi, (m) => cap(m, 'a maioria'))
    .replace(/\btudo\b/gi, (m) => cap(m, 'a maior parte'));
}

function hasOptimisticConfirm(text) {
  if (!text) return false;
  return String(text).split('\n').some(_isOptimisticLine);
}

function sanitizeOptimisticConfirm(text, outcome) {
  if (!text) return '';
  if (outcome !== 'failed' && outcome !== 'partial') return String(text);

  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) { out.push(line); continue; }
    if (!_isOptimisticLine(line)) { out.push(line); continue; }

    if (outcome === 'failed') {
      // Nada persistiu → a confirmação é falsa: remove a linha inteira.
      continue;
    }

    // outcome === 'partial': remove o emoji de sucesso e rebaixa o totalizador.
    const noEmoji = line.replace(SUCCESS_EMOJI_GLOBAL, '').replace(/^\s+/, '');
    if (TOTALIZER_RE.test(noEmoji)) {
      out.push(_downgradeTotalizers(noEmoji).replace(/\s+$/, ''));
    } else if (COMPLETION_ANCHORED.test(_stripLeadingEmoji(noEmoji))) {
      // Confirmação pura ("✅ Criado!") sem quantificador → o rodapé do engine
      // ("Registrei N de M") carrega a verdade; remove a linha.
      continue;
    } else {
      // Emoji era decoração de uma frase neutra → mantém só o texto.
      out.push(noEmoji.replace(/\s+$/, ''));
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { sanitizeOptimisticConfirm, hasOptimisticConfirm };
