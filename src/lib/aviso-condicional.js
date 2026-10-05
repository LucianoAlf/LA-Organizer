'use strict';
// aviso-condicional.js — "te aviso quando <evento>" não é afirmação de escrita, QUANDO o aviso existe.
//
// O CASO (Rafinha 03/10 15:13 UTC, marker_logs CHOKEPOINT confab:unknown). Ela abriu a obra do teto
// (tarefa c2a87b2f, awaiting_confirmation) e mandou "Avisa agora não tom". O TOM respondeu certo:
//   "Boa, deixo quieto então — só te aviso quando o Luciano aprovar a obra do teto. 👍"
// e a porta de baixo (enforceNoMarkerHonesty) trocou tudo por "Na real não consegui registrar isso
// agora", porque o PLANNING_CLAIM_RE de optimistic-confirm.js casa "te aviso quando". Aviso FUTURO
// condicionado a um evento externo não afirma que nada foi gravado — afirma que um aviso VAI sair.
//
// MAS naquele dia a promessa era FALSA: o pedido de aprovação nunca chegava a ninguém
// (APROVACAO-DE-TAREFA-NAO-CHEGAVA, auditoria 05/10 — corrigido em services/aprovacao-tarefa.js).
// Então o veto só vale com LASTRO no sistema: um pedido de aprovação aberto em que a pessoa é a
// SOLICITANTE (é ela que recebe o ✅/❌ quando o aprovador responde) ou um recado de coordenação dela
// esperando resposta (o TOM devolve a resposta). Sem lastro a trava segue acusando: prometer aviso
// que nada vai disparar é a mesma confabulação.
//
// Desvio consciente da spec de 05/10: "tarefa awaiting_confirmation criada por ela nos últimos 7 dias"
// NÃO conta sozinha como lastro. As 15 do backlog estão nesse estado sem nenhum pedido aberto — o
// aviso não sairia. Depois do conserto, toda tarefa nova com aprovador tem a pendência com
// requester_id, que é o que a consulta lê.
//
// optimistic-confirm.js está em parada e não é tocado: este veto entra na porta `reportedState`, que
// só desarma a camada FORTE e continua freada por markerAttempted. PURO, menos buscarLastroDeAviso
// (supabase injetado; nunca lança — erro vira "sem lastro", a trava continua valendo).
const { hasCompletionClaim } = require('./optimistic-confirm');

// "te aviso / aviso / te falo / te chamo / te dou um toque|retorno" + "quando / assim que / logo que / se"
// + o resto da oração (até ponto, exclamação, interrogação ou quebra de linha). JS: `\b` falha
// depois de letra acentuada — fronteiras por lookaround de \p{L}.
const AVISO_CONDICIONAL_RE = /(?<![\p{L}])(?:(?:s[óo]|eu|a[ií])\s+)?(?:te\s+(?:aviso|falo|chamo|dou\s+(?:um\s+)?(?:toque|retorno))|aviso(?:\s+voc[êe])?)\s+(?:quando|assim\s+que|logo\s+que|se)(?![\p{L}])[^.!?\n]*/giu;

// Escrita afirmada pelo TOM — nunca lavada pelo aviso ao lado (mesma família de veto-pergunta.js).
const TOM_ESCREVEU_RE = /(?<![\p{L}])(?:criei|registrei|anotei|agendei|marquei|salvei|lancei|cadastrei|atualizei|adicionei|conclu[íi]|finalizei|fechei|coloquei|cancelei|apaguei|mandei|enviei|avisei|pedi|dei\s+baixa)(?![\p{L}])/iu;

const _semAviso = (s) => String(s).replace(new RegExp(AVISO_CONDICIONAL_RE.source, AVISO_CONDICIONAL_RE.flags), ' ');

// A fala só é acusada por causa do aviso condicional: toda linha que a trava FORTE acusa traz o
// aviso e deixa de ser acusada sem ele; e o TOM não afirma escrita em lugar nenhum.
function soAvisoCondicional(reply) {
  const r = String(reply == null ? '' : reply);
  if (!r.trim()) return false;
  const acusadas = r.split('\n').filter((l) => l.trim() && hasCompletionClaim(l));
  if (!acusadas.length) return false;
  if (TOM_ESCREVEU_RE.test(_semAviso(r))) return false;
  return acusadas.every((l) => {
    const sem = _semAviso(l);
    return sem !== l && !hasCompletionClaim(sem);
  });
}

function liberaAvisoCondicional(reply, { lastro = false } = {}) {
  return !!lastro && soAvisoCondicional(reply);
}

const JANELA_DIAS = 7; // mesma vida do approval_pending (approvals.APPROVAL_EXPIRY_DAYS)

async function buscarLastroDeAviso(supabase, collaboratorId, { agora = Date.now() } = {}) {
  if (!supabase || !collaboratorId) return false;
  const desde = new Date(agora - JANELA_DIAS * 864e5).toISOString();
  try {
    const { data: ap, error: apErr } = await supabase.from('pending_intents')
      .select('id')
      .eq('kind', 'approval_pending')
      .is('resolved_at', null)
      .eq('payload->>requester_id', collaboratorId)
      .gte('asked_at', desde)
      .limit(1);
    if (!apErr && Array.isArray(ap) && ap.length) return true;
    const { data: co, error: coErr } = await supabase.from('coordination_requests')
      .select('id')
      .eq('requester_id', collaboratorId)
      .in('status', ['pending', 'sent'])
      .eq('expects_response', true)
      .gte('created_at', desde)
      .limit(1);
    return !coErr && Array.isArray(co) && co.length > 0;
  } catch (e) {
    console.warn('[AvisoCondicional] lastro err (segue acusando):', e.message);
    return false;
  }
}

module.exports = { soAvisoCondicional, liberaAvisoCondicional, buscarLastroDeAviso, AVISO_CONDICIONAL_RE };
