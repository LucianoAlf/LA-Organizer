// Resolve um colaborador por nome coloquial, desambiguando homônimos
// (ex.: "Dai" pedagógica vs "Daiana" Farmer) por contexto: domínio do
// requester (CONFIÁVEL — vem do phone) + assunto da mensagem (SOFT — texto do
// LLM, usado só para escolher entre candidatos do banco, nunca como identidade).
// Spec: docs/superpowers/specs/2026-05-30-desambiguacao-homonimos-design.md

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function firstToken(s) { return stripDiacritics(s).split(/\s+/)[0]; }

// Keywords → token de domínio. Mesmo vocabulário que domainOf() emite.
const PED_KEYWORDS = ['aluno', 'aluna', 'turma', 'professor', 'prof', 'aula', 'matricula', 'pedagog', 'ensaio', 'repertorio', 'licao', 'prova', 'nota', 'responsavel', 'encarregado'];
const FARM_KEYWORDS = ['estoque', 'loja', 'lojinha', 'produto', 'inventario', 'farm', 'venda', 'caixa', 'mercadoria', 'reposicao', 'etiqueta', 'prateleira'];

function domainOf(collab) {
  const tags = new Set();
  if (!collab) return tags;
  if (collab.function_role) tags.add(stripDiacritics(collab.function_role));
  if (collab.pedagogical_role) tags.add('pedagogico');
  const unit = stripDiacritics(collab.unit || '');
  if (unit && unit !== 'all') tags.add('unit:' + unit);
  return tags;
}

function subjectDomainTokens(subject) {
  const tags = new Set();
  const s = stripDiacritics(subject);
  if (!s) return tags;
  for (const k of PED_KEYWORDS) if (s.includes(k)) { tags.add('pedagogico'); break; }
  for (const k of FARM_KEYWORDS) if (s.includes(k)) { tags.add('farmer'); break; }
  if (s.includes('recreio')) { tags.add('farmer'); tags.add('unit:recreio'); }
  return tags;
}

// Retorna { exact: collab|null, union: collab[] }.
function gatherCandidates(name, rows) {
  const result = { exact: null, union: [] };
  const norm = stripDiacritics(name);
  if (!norm) return result;
  const first = norm.split(/\s+/)[0];

  // 1) Match exato da string completa (full_name|preferred|alias) → qualificador.
  const exactMatches = rows.filter(c => {
    const fn = stripDiacritics(c.full_name || '');
    const pn = stripDiacritics(c.preferred_name || '');
    const als = Array.isArray(c.aliases) ? c.aliases : [];
    return fn === norm || (pn && pn === norm) || als.some(a => stripDiacritics(a) === norm);
  });
  if (exactMatches.length === 1) { result.exact = exactMatches[0]; return result; }

  // 2) União de tiers de token: full_name[0] ∪ preferred ∪ alias[0].
  const seen = new Set();
  const add = (c) => { if (!seen.has(c.id)) { seen.add(c.id); result.union.push(c); } };
  for (const c of rows) {
    if (firstToken(c.full_name || '') === first) { add(c); continue; }
    const pn = stripDiacritics(c.preferred_name || '');
    if (pn && (pn === first || pn.split(/\s+/)[0] === first)) { add(c); continue; }
    const als = Array.isArray(c.aliases) ? c.aliases : [];
    if (als.some(a => firstToken(a) === first)) { add(c); continue; }
  }

  // 3) Fallback prefixo (legado) só se a união veio vazia — não cria ambiguidade nova.
  if (result.union.length === 0) {
    for (const c of rows) if (stripDiacritics(c.full_name || '').startsWith(first)) add(c);
  }
  return result;
}

function scoreCandidate(c, subjTokens, reqDomain) {
  const dom = domainOf(c);
  let subjHits = 0;
  for (const t of subjTokens) if (dom.has(t)) subjHits++;
  let reqHit = 0;
  for (const t of reqDomain) if (dom.has(t)) { reqHit = 1; break; }
  return subjHits * 2 + reqHit; // assunto ("o quê") pesa mais que requester ("quem")
}

function disambiguate(candidates, { requester, subject } = {}) {
  if (!candidates || candidates.length === 0) return { status: 'not_found' };
  if (candidates.length === 1) return { status: 'resolved', collaborator: candidates[0] };
  const subjTokens = subjectDomainTokens(subject);
  const reqDomain = domainOf(requester);
  const scored = candidates.map(c => ({ c, score: scoreCandidate(c, subjTokens, reqDomain) }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tiedTop = scored.filter(s => s.score === top.score);
  if (top.score > 0 && tiedTop.length === 1) return { status: 'resolved', collaborator: top.c };
  return { status: 'ambiguous', candidates };
}

function firstName(collab) {
  return (collab.preferred_name || collab.full_name || '').split(/\s+/)[0];
}
function domainLabel(collab) {
  if (collab.pedagogical_role || stripDiacritics(collab.function_role || '') === 'pedagogico') return 'Pedagógico';
  const unit = (collab.unit || '').trim();
  if (unit && unit.toLowerCase() !== 'all') return unit.charAt(0).toUpperCase() + unit.slice(1);
  if (collab.function_role) return collab.function_role.charAt(0).toUpperCase() + collab.function_role.slice(1);
  return collab.full_name;
}
function buildAmbiguityQuestion(candidates) {
  const parts = candidates.map(c => `*${firstName(c)}* do ${domainLabel(c)}`);
  const list = parts.length === 2
    ? `${parts[0]} e ${parts[1]}`
    : parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
  return `Tem ${list} — é qual delas?`;
}

// fetchActive: () => Promise<rows[]> (colaboradores ativos com campos de domínio).
async function resolveCollaboratorByName(name, { requester = null, subject = null, fetchActive } = {}) {
  const rows = await fetchActive();
  if (!rows || !rows.length) return { status: 'not_found' };
  const { exact, union } = gatherCandidates(name, rows);
  if (exact) return { status: 'resolved', collaborator: exact };
  return disambiguate(union, { requester, subject });
}

module.exports = {
  stripDiacritics, domainOf, subjectDomainTokens, gatherCandidates,
  scoreCandidate, disambiguate, firstName, domainLabel, buildAmbiguityQuestion,
  resolveCollaboratorByName,
};
