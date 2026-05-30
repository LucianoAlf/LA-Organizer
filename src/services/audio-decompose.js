// Pré-passada de extração para áudios longos. Chama claude.chat com prompt
// minúsculo (sem skills) só pra listar as demandas distintas. Resultado vira
// uma reescrita estruturada do texto que vai pro pipeline normal.
let _claude = require('../ai/claude');

const MIN_CHARS = Number(process.env.TOM_DECOMPOSE_MIN_CHARS) || 400;
const INTENT_REGEX = /\b(e|tamb[ée]m|outra coisa|ah|por favor|preciso|quero|marca|cria|agenda|cobra|manda|avisa|lembra)\b/gi;
const MIN_INTENT_HITS = 3;
const MIN_SENTENCES = 4;
const AUDIO_PREFIX_RE = /^\[áudio transcrito\]/i;

const EXTRACTOR_SYSTEM = `Você é um extrator. Sua ÚNICA tarefa é listar as demandas distintas do colaborador.
Regras:
- Uma demanda por linha, prefixada com número.
- Use as PALAVRAS DO COLABORADOR (verbatim curto), sem parafrasear.
- NÃO execute nada, NÃO emita markers, NÃO responda nada além da lista.
- Se houver só uma demanda, retorne uma linha só.
- Se for fala social/divagação sem demanda, retorne string vazia.`;

function shouldDecompose(text) {
  if (!AUDIO_PREFIX_RE.test(text)) return { ok: false, reason: 'not_audio' };
  if (text.length < MIN_CHARS) return { ok: false, reason: 'too_short' };
  const intentHits = (text.match(INTENT_REGEX) || []).length;
  const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim().length > 3).length;
  if (intentHits < MIN_INTENT_HITS && sentenceCount < MIN_SENTENCES) {
    return { ok: false, reason: 'low_intent_density' };
  }
  return { ok: true };
}

function parseList(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('\n')
    .map(l => l.replace(/^\s*[\d]+[\.\)\-:]\s*/, '').trim())
    .filter(l => l.length >= 3);
}

async function decomposeIfLarge(text) {
  const t0 = Date.now();
  const gate = shouldDecompose(text);
  if (!gate.ok) {
    return { decomposed: false, items: [], rewrittenText: null, reason: gate.reason, latencyMs: 0 };
  }
  try {
    const r = await _claude.chat(EXTRACTOR_SYSTEM, [{ role: 'user', content: text }], 600);
    const items = parseList(r.text);
    if (items.length === 0) {
      return { decomposed: false, items: [], rewrittenText: null, reason: 'extractor_empty', latencyMs: Date.now() - t0 };
    }
    const enumerated = items.map((it, i) => `${i + 1}. ${it}`).join('\n');
    const rewrittenText =
      text +
      `\n\n>>> Demandas detectadas pelo decompositor (processe TODAS, uma por uma):\n` +
      enumerated;
    return { decomposed: true, items, rewrittenText, reason: null, latencyMs: Date.now() - t0 };
  } catch (err) {
    console.warn(`[Decompose] extractor falhou kind=${err.kind || 'unknown'} msg=${err.message.slice(0, 120)}`);
    return { decomposed: false, items: [], rewrittenText: null, reason: 'extractor_failed', latencyMs: Date.now() - t0 };
  }
}

function _setClaudeForTests(stub) { _claude = stub; }

module.exports = { decomposeIfLarge, shouldDecompose, _setClaudeForTests };
