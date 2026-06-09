// Resolve um colaborador por nome coloquial, desambiguando homônimos
// (ex.: "Dai" pedagógica vs "Daiana" Farmer) por QUEM FALA: o domínio do
// requester (unit + função), que é CONFIÁVEL — vem do phone. NÃO usa o assunto
// da mensagem (vocabulário é compartilhado: "aluno" tanto é pedagógico quanto
// "aluno atrasou no Recreio" → puxaria errado). Sem lado claro → pergunta.
// Spec: docs/superpowers/specs/2026-05-30-desambiguacao-homonimos-design.md

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function firstToken(s) { return stripDiacritics(s).split(/\s+/)[0]; }

// Fatia K — PT-BR: o LLM costuma emitir o destinatário com artigo/preposição
// ("o Alf", "pro Alf", "pra Dai", "para o Rafinha", "ao Hugo"). Esses prefixos viram
// o token líder e quebram o match (união vazia → not_found). Removemos só prefixos de
// FALA (o/a/os/as + pro/pra/ao + "para o/a") — NUNCA partículas de sobrenome
// (do/da/dos/das), pra não tocar "Daiana da Silva". Só remove se sobrar conteúdo.
const LEADING_ARTICLE_RE = /^(?:para\s+(?:o|a|os|as)\s+|pros?\s+|pras?\s+|aos?\s+|[oa]s?\s+)/;
function stripLeadingArticle(normalized) {
  const stripped = String(normalized || '').replace(LEADING_ARTICLE_RE, '').trim();
  return stripped.length ? stripped : normalized;
}

// Tokens de domínio de uma pessoa, derivados dos campos existentes.
// function_role (farmer/pedagogico/...), pedagogical_role → pedagogico,
// unit ≠ all → unit:<unit>. É o vocabulário que casa requester ↔ candidato.
function domainOf(collab) {
  const tags = new Set();
  if (!collab) return tags;
  if (collab.function_role) tags.add(stripDiacritics(collab.function_role));
  if (collab.pedagogical_role) tags.add('pedagogico');
  const unit = stripDiacritics(collab.unit || '');
  if (unit && unit !== 'all') tags.add('unit:' + unit);
  return tags;
}

// Retorna { exact: collab|null, union: collab[] }.
function gatherCandidates(name, rows) {
  const result = { exact: null, union: [] };
  const norm = stripLeadingArticle(stripDiacritics(name));
  if (!norm) return result;
  const first = norm.split(/\s+/)[0];

  // 1) Qualificador explícito (multi-token: "Dai Recreio", "Dai Ped") → match exato
  //    da string completa em full_name|preferred|alias ganha precedência.
  //    Nome cru de 1 token NUNCA entra aqui — vai pra união, pra o homônimo ser
  //    detectado mesmo quando o nome cru É o full_name de alguém (ex.: "Dai").
  if (/\s/.test(norm)) {
    const exactMatches = rows.filter(c => {
      const fn = stripDiacritics(c.full_name || '');
      const pn = stripDiacritics(c.preferred_name || '');
      const als = Array.isArray(c.aliases) ? c.aliases : [];
      return fn === norm || (pn && pn === norm) || als.some(a => stripDiacritics(a) === norm);
    });
    if (exactMatches.length === 1) { result.exact = exactMatches[0]; return result; }
  }

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

  // 3) Fallback prefixo BIDIRECIONAL, só se a união veio vazia — não cria ambiguidade
  //    nova no caminho comum. Casa apelido ↔ nome formal em full_name|preferred|aliases:
  //    - legado (digitado é prefixo do cadastro): "Leo"→"Leonardo", "Dai"→"Daiana". Sem guarda.
  //    - inverso (cadastro é prefixo do digitado): "Fabíola"→"Fabi", "Gabriela"→"Gabi". Só
  //      quando o token cadastrado tem ≥ MIN_REVERSE chars, pra um apelido curto ("Ana", "Al")
  //      não engolir um nome mais longo por engano. Apelidos de 1-3 letras → cadastrar alias.
  if (result.union.length === 0) {
    const MIN_REVERSE = 4;
    for (const c of rows) {
      const cTokens = [
        firstToken(c.full_name || ''),
        firstToken(c.preferred_name || ''),
        ...(Array.isArray(c.aliases) ? c.aliases.map((a) => firstToken(a)) : []),
      ].filter(Boolean);
      const hit = cTokens.some((t) =>
        t.startsWith(first) // legado: digitado é prefixo do cadastro
        || (first.startsWith(t) && t.length >= MIN_REVERSE), // inverso: cadastro é prefixo do digitado
      );
      if (hit) add(c);
    }
  }
  return result;
}

// Candidato compartilha algum token de domínio com o requester?
function requesterMatches(candidate, reqDomain) {
  const dom = domainOf(candidate);
  for (const t of reqDomain) if (dom.has(t)) return true;
  return false;
}

// Desambigua SÓ por quem-fala. Localização (unit) é o discriminador mais forte:
// quem é da mesma unidade que um candidato "dono" dessa unidade ganha de quem
// casa só por função (ex.: professor do Recreio → Daiana, dona do Recreio, e não
// a Dai-ped cross-unidade). Se nem unit nem função isolam um único → pergunta.
function disambiguate(candidates, { requester } = {}) {
  if (!candidates || candidates.length === 0) return { status: 'not_found' };
  if (candidates.length === 1) return { status: 'resolved', collaborator: candidates[0] };
  const reqDomain = domainOf(requester);
  if (!reqDomain.size) return { status: 'ambiguous', candidates };

  // 1) Match por unidade específica (unit:*) — localização ganha de função.
  const reqUnits = [...reqDomain].filter(t => t.startsWith('unit:'));
  if (reqUnits.length) {
    const unitHits = candidates.filter(c => {
      const dom = domainOf(c);
      return reqUnits.some(u => dom.has(u));
    });
    if (unitHits.length === 1) return { status: 'resolved', collaborator: unitHits[0] };
  }

  // 2) Senão, match por qualquer token de domínio (função/pedagogico).
  const hits = candidates.filter(c => requesterMatches(c, reqDomain));
  if (hits.length === 1) return { status: 'resolved', collaborator: hits[0] };
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
  return `Tem ${list} — é qual?`;
}

// fetchActive: () => Promise<rows[]> (colaboradores ativos com campos de domínio).
async function resolveCollaboratorByName(name, { requester = null, fetchActive } = {}) {
  const rows = await fetchActive();
  if (!rows || !rows.length) return { status: 'not_found' };
  const { exact, union } = gatherCandidates(name, rows);
  if (exact) return { status: 'resolved', collaborator: exact };
  return disambiguate(union, { requester });
}

module.exports = {
  stripDiacritics, domainOf, gatherCandidates, disambiguate,
  firstName, domainLabel, buildAmbiguityQuestion, resolveCollaboratorByName,
};
