// src/services/note-dedup.js — dedup determinística de NOTA pessoal (provider-agnóstica).
// Espelha o dedup de tarefa: dup exige título-similar E overlap-de-corpo (um sinal só
// não basta — "Reunião 12/06" vs "19/06" têm título similar mas corpos distintos).
'use strict';
const { jaroWinkler, normalizeForSim } = require('./text-similarity');

const TITLE_MIN = 0.85;   // limiar de similaridade de título (tunável)
const BODY_MIN = 0.40;    // limiar de overlap de corpo (tunável)

// tokens significativos do corpo (mantém dígitos: "5kg", "12" distinguem notas)
function bodyTokens(s) {
  return new Set(
    String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter((w) => w.length >= 3),
  );
}

function overlapCoefficient(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  return inter / Math.min(aSet.size, bSet.size); // tolerante a diferença de tamanho
}

function scoreNoteSimilarity(cand, existing) {
  const titleSim = jaroWinkler(normalizeForSim(cand.title || ''), normalizeForSim(existing.title || ''));
  const bodyOverlap = overlapCoefficient(bodyTokens(cand.body), bodyTokens(existing.body));
  return { titleSim, bodyOverlap };
}

function isProbableDuplicate(cand, existing) {
  const { titleSim, bodyOverlap } = scoreNoteSimilarity(cand, existing);
  return titleSim >= TITLE_MIN && bodyOverlap >= BODY_MIN;
}

async function findDuplicateNote(supabase, collaboratorId, cand) {
  const { data } = await supabase.from('notes')
    .select('id, title, body')
    .eq('collaborator_id', collaboratorId)
    .eq('archived', false)
    .order('updated_at', { ascending: false })
    .limit(50);
  let best = null;
  for (const n of (data || [])) {
    if (!isProbableDuplicate(cand, n)) continue;
    const s = scoreNoteSimilarity(cand, n);
    if (!best || s.titleSim > best.titleSim) best = { note: n, ...s };
  }
  return best;
}

module.exports = { scoreNoteSimilarity, isProbableDuplicate, findDuplicateNote, TITLE_MIN, BODY_MIN };
