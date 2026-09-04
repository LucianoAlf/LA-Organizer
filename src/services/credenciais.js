// Unica porta de acesso do TOM a governance_credentials.
// O ESCOPO e decidido no banco pela RPC get_credenciais_para(collaborator_id):
// admin recebe tudo, qualquer outro recebe so nome+url das visivel_tom.
// Nunca montar query direta na tabela aqui.
//
// Cache: SO o escopo publico. O escopo admin traz senha em texto plano —
// manter isso 30min na memoria do processo seria ampliar a exposicao sem
// necessidade, ja que a consulta e pontual.

const CACHE_TTL_MS = 30 * 60 * 1000;

// Cache keyed por collaboratorId. SO entra aqui quem NAO e admin — entao um
// hit ja implica escopo publico, e o resultado admin (que traz senha em texto
// plano) nunca fica residente na memoria do processo.
const _cachePublico = new Map();

function _resetCache() {
  _cachePublico.clear();
}

function _cacheHit(collaboratorId) {
  const hit = _cachePublico.get(collaboratorId);
  if (!hit) return null;
  if (Date.now() - hit.ts >= CACHE_TTL_MS) { _cachePublico.delete(collaboratorId); return null; }
  return hit.creds;
}

async function getCredenciaisPara(collaboratorId) {
  if (!collaboratorId) return { isAdmin: false, creds: [] };

  const cached = _cacheHit(collaboratorId);
  if (cached) return { isAdmin: false, creds: cached };

  try {
    const supabase = require('../supabase/client'); // lazy: evita init no load (testes)
    const { data, error } = await supabase.rpc('get_credenciais_para', { p_collaborator_id: collaboratorId });
    if (error) {
      console.warn('[Credenciais] RPC erro:', error.message);
      return { isAdmin: false, creds: [] };   // fail-closed
    }
    const rows = data || [];
    const isAdmin = rows.length > 0 && rows[0].is_admin === true;
    if (!isAdmin) _cachePublico.set(collaboratorId, { ts: Date.now(), creds: rows });
    return { isAdmin, creds: rows };
  } catch (e) {
    console.warn('[Credenciais] fetch falhou:', e.message);
    return { isAdmin: false, creds: [] };     // fail-closed
  }
}

module.exports = { getCredenciaisPara, _resetCache, CACHE_TTL_MS };
