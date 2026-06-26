'use strict';
// verbatim-note.js — puro (testável, sem I/O). Resolve o corpo VERBATIM de uma nota:
// quando o usuário manda guardar um conteúdo que JÁ EXISTE (colado na mensagem ou numa
// mensagem anterior), o corpo da ficha tem que ser o TEXTO-FONTE ORIGINAL INTEIRO — não a
// reescrita do LLM (que trunca em texto longo; caso fechamento financeiro do Alf 24/06).
// Spec: docs/superpowers/specs/2026-06-26-salvar-nota-verbatim-design.md

// Normaliza SÓ pra comparação (não pra exibir): minúsculas, sem acento, sem pontuação/emoji.
function normalizeForMatch(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  const n = normalizeForMatch(s);
  return n ? n.split(' ').filter(Boolean) : [];
}

// Fração dos tokens de `body` presentes em `source` (0..1). Como o body do LLM é ~uma cópia
// (subconjunto) da fonte, a contenção fica alta quando ele estava copiando aquela fonte.
function containmentRatio(body, source) {
  const b = tokens(body);
  if (!b.length) return 0;
  const srcSet = new Set(tokens(source));
  if (!srcSet.size) return 0;
  let hit = 0;
  for (const t of b) if (srcSet.has(t)) hit++;
  return hit / b.length;
}

// Escolhe o candidato-fonte que o LLM estava copiando (maior contenção ≥ threshold).
// candidates: array de string OU {text}. Ignora candidatos curtos (ruído).
function pickVerbatimSource(llmBody, candidates, opts = {}) {
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.6;
  const minLen = typeof opts.minLen === 'number' ? opts.minLen : 40;
  let best = null;
  (Array.isArray(candidates) ? candidates : []).forEach((cand, index) => {
    const text = typeof cand === 'string' ? cand : (cand && cand.text) || '';
    if (!text || text.trim().length < minLen) return;
    const score = containmentRatio(llmBody, text);
    if (score >= threshold && (!best || score > best.score)) best = { text, score, index };
  });
  return best;
}

const CMD_WORDS = /(salva|salvar|guarda|guardar|anota|anotar|registra|registrar)/i;
const CMD_EXTRA = /com o nome|por favor|nas? (minhas? )?anota/i;
// Sinal de que a linha é CONTEÚDO (não comando): número, valor, bullet, seta.
const CONTENT_SIGNAL = /[\d•→←]|R\$/;

function isPureCommandLine(line) {
  const l = line.trim();
  if (!l) return false;
  if (l.length > 70) return false;       // linha longa = provavelmente conteúdo
  if (CONTENT_SIGNAL.test(l)) return false; // tem número/valor/bullet → conteúdo
  return CMD_WORDS.test(l) || CMD_EXTRA.test(l);
}

// "Tom, salva isso com o nome X: <conteúdo>" → "<conteúdo>" (corta o prefixo de comando até ":").
function stripLeadingCmdPrefix(line) {
  const idx = line.indexOf(':');
  if (idx > 0 && idx < 90) {
    const head = line.slice(0, idx);
    if (CMD_WORDS.test(head) && !CONTENT_SIGNAL.test(head)) return line.slice(idx + 1).trim();
  }
  return line;
}

// Remove linhas de COMANDO de salvar das BORDAS (topo/fim). NUNCA toca o meio — conteúdo é sagrado.
function stripSaveCommand(text) {
  let lines = String(text || '').split('\n');
  while (lines.length && (lines[0].trim() === '' || isPureCommandLine(lines[0]))) lines.shift();
  if (lines.length) lines[0] = stripLeadingCmdPrefix(lines[0]);
  while (lines.length && (lines[lines.length - 1].trim() === '' || isPureCommandLine(lines[lines.length - 1]))) lines.pop();
  return lines.join('\n').trim();
}

module.exports = { normalizeForMatch, containmentRatio, pickVerbatimSource, stripSaveCommand };
