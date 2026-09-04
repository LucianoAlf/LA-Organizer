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
      console.warn('[Credenciais] RPC erro:', error && error.message ? error.message : String(error));
      return { isAdmin: false, creds: [] };   // fail-closed
    }
    const rows = data || [];
    const isAdmin = rows.length > 0 && rows[0].is_admin === true;
    if (!isAdmin && rows.length > 0) _cachePublico.set(collaboratorId, { ts: Date.now(), creds: rows });
    return { isAdmin, creds: rows };
  } catch (e) {
    console.warn('[Credenciais] fetch falhou:', e instanceof Error ? e.message : String(e));
    return { isAdmin: false, creds: [] };     // fail-closed
  }
}

function _msgErro(e) {
  if (!e) return 'erro_desconhecido';
  if (typeof e === 'string') return e;
  return e.message ? String(e.message) : String(e);
}

// Escrita. O gate de is_system_admin esta NA RPC — estas funcoes nao decidem
// permissao, so transportam. Nunca lancam: erro vira {ok:false, erro}.
async function upsertCredencial(collaboratorId, dados) {
  if (!collaboratorId || !dados) return { ok: false, id: null, erro: 'parametros_invalidos' };
  try {
    const supabase = require('../supabase/client');
    const { data, error } = await supabase.rpc('upsert_credencial', {
      p_collaborator_id: collaboratorId,
      p_cred_id: dados.id || null,
      p_nome: dados.nome || null,
      p_categoria: dados.categoria || null,
      p_servico: dados.servico || null,
      p_projeto: dados.projeto || null,
      p_url_ref: dados.url_ref || null,
      p_observacoes: dados.observacoes || null,
      // C-2 (review 04/09): no UPDATE a RPC faz `campos = coalesce(p_campos, g.campos)`.
      // `'[]'::jsonb` NAO e null — mandar lista vazia num update parcial ("troca so o
      // link do Canva") APAGAVA login e senha, sem aviso e sem volta. Ausencia vira null
      // e o coalesce preserva o que ja esta la; no INSERT a RPC ja faz
      // coalesce(p_campos, '[]'::jsonb), entao criar sem campo nenhum segue funcionando.
      p_campos: Array.isArray(dados.campos) && dados.campos.length ? dados.campos : null,
    });
    if (error) {
      console.warn('[Credenciais] upsert erro:', _msgErro(error));
      return { ok: false, id: null, erro: _msgErro(error) };
    }
    return { ok: true, id: data || null, erro: null };
  } catch (e) {
    console.warn('[Credenciais] upsert falhou:', _msgErro(e));
    return { ok: false, id: null, erro: _msgErro(e) };
  }
}

async function deleteCredencial(collaboratorId, credId) {
  if (!collaboratorId || !credId) return { ok: false, erro: 'parametros_invalidos' };
  try {
    const supabase = require('../supabase/client');
    const { data, error } = await supabase.rpc('delete_credencial', {
      p_collaborator_id: collaboratorId,
      p_cred_id: credId,
    });
    if (error) {
      console.warn('[Credenciais] delete erro:', _msgErro(error));
      return { ok: false, erro: _msgErro(error) };
    }
    return { ok: data === true, erro: data === true ? null : 'nao_encontrada' };
  } catch (e) {
    console.warn('[Credenciais] delete falhou:', _msgErro(e));
    return { ok: false, erro: _msgErro(e) };
  }
}

module.exports = { getCredenciaisPara, _resetCache, CACHE_TTL_MS, upsertCredencial, deleteCredencial };
