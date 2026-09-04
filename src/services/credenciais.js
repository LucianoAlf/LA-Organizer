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

// Marcador que substitui o conteudo da inbound. Explicito de proposito: quem ler o
// historico depois tem de saber que ali houve mensagem, e que ela foi apagada de caso
// pensado — nao que o turno nao existiu.
const MARCA_INBOUND_CREDENCIAL = '[credencial recebida — conteúdo não registrado]';

// Apaga o conteudo da linha inbound do turno que carregou credencial.
//
// POR QUE ISTO EXISTE: a outra defesa (redigir-segredo.js) tenta reconhecer a FORMA do
// segredo em texto livre — espaco de entrada ilimitado, e em onze rodadas seguidas a
// suite ficou verde e a revisao achou vazamento novo no caminho principal. Aqui a aposta
// e outra: quando o modelo emite <<CREDENCIAL_ACTION>>, o engine SABE que o turno
// carregou credencial, sem precisar reconhecer nada. Deterministico, e cobre o caso que
// mais importa (cadastro real, inclusive por print) mesmo que o redator erre.
//
// Os DOIS campos: `logConversation` extrai a analise de imagem/PDF pro
// `media_extracted_text` (bloco MEDIA-IMG-CONTEXT-LOST), entao um print de senha deixa
// DUAS copias na mesma linha. Limpar so o `content` deixaria a outra de pe.
//
// NUNCA lanca: devolve { ok, erro }. E o {error} do client Supabase e checado — ele NAO
// lanca em falha de update (mesma armadilha do supersede em openIntent).
async function apagarInboundDeCredencial(collaboratorId, waMessageId) {
  if (!collaboratorId) return { ok: false, erro: 'parametros_invalidos' };
  const _cid = String(collaboratorId).slice(0, 8);
  try {
    const supabase = require('../supabase/client');
    let alvoId = null;

    // Sem o id do WhatsApp (midia sem stanzaID, payload incompleto), o alvo e a inbound
    // MAIS RECENTE deste colaborador — que e a deste turno, ja gravada antes da chamada
    // do modelo. Precisa de select antes do update: o client nao aceita order/limit em
    // update, e um update sem alvo unico apagaria o historico inteiro da pessoa.
    if (!waMessageId) {
      const { data, error } = await supabase
        .from('conversation_history')
        .select('id')
        .eq('collaborator_id', collaboratorId)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) {
        console.warn(`[Credenciais] apagarInbound: falha ao achar a inbound collab=${_cid}:`, _msgErro(error));
        return { ok: false, erro: _msgErro(error) };
      }
      alvoId = data && data[0] && data[0].id;
      if (!alvoId) {
        console.warn(`[Credenciais] apagarInbound: nenhuma inbound encontrada collab=${_cid} — segredo pode ter ficado no historico`);
        return { ok: false, erro: 'inbound_nao_encontrada' };
      }
    }

    let q = supabase
      .from('conversation_history')
      .update({ content: MARCA_INBOUND_CREDENCIAL, media_extracted_text: null })
      .eq('collaborator_id', collaboratorId)
      .eq('direction', 'inbound');
    q = waMessageId ? q.eq('whatsapp_message_id', waMessageId) : q.eq('id', alvoId);
    const { error } = await q;
    if (error) {
      console.warn(`[Credenciais] apagarInbound: UPDATE falhou collab=${_cid} wa=${waMessageId || '-'} alvo=${alvoId || '-'}:`, _msgErro(error));
      return { ok: false, erro: _msgErro(error) };
    }
    return { ok: true, erro: null };
  } catch (e) {
    console.warn(`[Credenciais] apagarInbound: excecao collab=${_cid} wa=${waMessageId || '-'}:`, _msgErro(e));
    return { ok: false, erro: _msgErro(e) };
  }
}

module.exports = {
  getCredenciaisPara,
  _resetCache,
  CACHE_TTL_MS,
  upsertCredencial,
  deleteCredencial,
  apagarInboundDeCredencial,
  MARCA_INBOUND_CREDENCIAL,
};
