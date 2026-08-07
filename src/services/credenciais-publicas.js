// Links de sistemas do time — única porta de acesso ao dado.
// Lê via RPC get_credenciais_publicas(), que expõe SOMENTE nome e url_ref de linhas
// marcadas visivel_tom=true. Nunca montar query direta em governance_credentials
// aqui: o contrato de colunas mora no schema (migration 20260807_team_links_rpc).

const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache = { ts: 0, links: [] };

function _resetCache(opts = {}) {
  _cache = { ts: 0, links: opts.keepData ? _cache.links : [] };
}

async function getCredenciaisPublicas() {
  if (_cache.links.length && (Date.now() - _cache.ts) < CACHE_TTL_MS) {
    return _cache.links;
  }
  try {
    const supabase = require('../supabase/client'); // lazy: evita init no load (testes)
    const { data, error } = await supabase.rpc('get_credenciais_publicas');
    if (error) {
      console.warn('[CredenciaisPublicas] RPC erro:', error.message);
      return _cache.links; // stale (ou [] se nunca populou)
    }
    const links = (data || []).filter(l => l && l.nome && l.url_ref);
    _cache = { ts: Date.now(), links };
    return links;
  } catch (e) {
    console.warn('[CredenciaisPublicas] fetch falhou:', e.message);
    return _cache.links; // nunca lança — link não pode derrubar a mensagem
  }
}

module.exports = { getCredenciaisPublicas, _resetCache, CACHE_TTL_MS };
