'use strict';
// v1 conservador: só aceita turno curto encenável. Na dúvida, ok:false (a sombra não
// finge cobrir cron/grupo/multi-turno — esses caem no gate determinístico via inconclusivo).
const CATS_OK = new Set(['confabulation', 'dropped_request']);
// Sinais de cenário caro/irreproduzível no texto do finding.
const MULTITURNO_RE = /fatura|parte\s*[1-9]|cruzamento|cobran[çc]a|lote|todos os dias|parcial|em lote|menu.*dup|reply-quote/i;

// SHADOW-VERDE-VACUO (27/08): a fala LITERAL do usuário é o eixo do replay — sem ela não há
// caminho quebrado pra repetir. O `summary` é prosa do AUDITOR sobre o bug; encenar isso faz o
// TOM conversar SOBRE o defeito e o juiz aprovar um turno vazio. Chokepoint único: o gate e o
// runner extraem a fala pela MESMA função, então não dá pra um aceitar o que o outro recusa.
// O `[carimbo]` opcional é obrigatório aqui: a evidência real vem como
// "[14/08 (sex) 19:56] USUÁRIO: Confirma" (fix AUDIT-RELATIVE-DATE-BLIND, 02/08). Sem tolerá-lo,
// o rótulo nunca casa e findings que TÊM a fala do usuário são recusados como se não tivessem —
// a mesma armadilha que já tinha cegado o pickProbe em 19/08. Só no INÍCIO da linha: colchete no
// meio do texto é conteúdo ("manda o [relatório] hoje").
const FALA_RE = /^\s*(?:\[[^\]]*\]\s*)?(?:USU[ÁA]RIO|Pessoa)\s*:\s*(.+)$/i;
function extrairFalasDoUsuario(finding) {
  return String((finding && finding.evidence) || '')
    .split('\n')
    .map((l) => l.match(FALA_RE))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((s) => s.length > 0);
}

function isReproducible(finding) {
  const f = finding || {};
  // GRUPO LIBERADO (01/09). O gate recusava TODO finding de grupo desde 22/08 e nunca foi
  // tocado -- so que o Replay Lab TEM grupo desde 13/08 ([QA] Financeiro Replay, wa_group_jid
  // NULL). Consequencia medida: os bugs que mais doem (Rose, digest, data) sao de grupo, entao
  // a sonda nao verificava NENHUM deles e os achados saiam 'inconclusivo' por construcao --
  // o laboratorio existia, o robo e que nao sabia usar. As demais travas continuam iguais:
  // categoria, cenario multi-turno e fala LITERAL do usuario valem para grupo tambem.
  if (!CATS_OK.has(f.category)) return { ok: false, motivo: `categoria ${f.category || '?'} fora do escopo v1` };
  const txt = String(f.evidence || f.summary || '').trim();
  if (!txt) return { ok: false, motivo: 'sem evidência aferível' };
  if (MULTITURNO_RE.test(txt)) return { ok: false, motivo: 'cenário cron/multi-turno' };
  if (!extrairFalasDoUsuario(f).length) {
    return { ok: false, motivo: 'sem fala literal do usuário no evidence (resumo do finding NÃO é fala)' };
  }
  return { ok: true, motivo: 'turno curto encenável' };
}


// ── A FALA VEM DO BANCO, NAO DO RESUMO (03/09) ────────────────────────────────────────────
// O `evidence` e prosa do auditor e PARAFRASEIA. Em 08/08 ele dizia USUARIO: "Confirmado" e o
// literal em conversation_history era "Siim" — detectUserConfirmation devolvia yes pro primeiro
// e null pro segundo, e essa diferenca era o bug inteiro. Encenar parafrase testa outro caminho.
const JANELA_MIN = 15;   // lado a lado com o incidente; conversa de horas antes e outro assunto
const TETO_FALAS = 3;    // o bug mora nos ultimos turnos; encenar 20 e caro e ruidoso

function _instante(f) {
  return (f && (f.incident_at || f.occurred_at || f.last_seen || f.created_at)) || null;
}

// Fail-closed e MUDO por desenho: sem supabase, sem instante ou com erro de leitura devolve []
// e quem chama cai no evidence. O que NAO pode e devolver fala inventada.
async function falasDoIncidente({ supabase, finding, janelaMin = JANELA_MIN, teto = TETO_FALAS } = {}) {
  const f = finding || {};
  const quando = _instante(f);
  if (!supabase || !quando) return [];
  const fim = new Date(quando).getTime();
  if (!Number.isFinite(fim)) return [];
  const ini = new Date(fim - janelaMin * 60 * 1000).toISOString();
  const ate = new Date(fim + 60 * 1000).toISOString(); // 1min de folga: o carimbo do finding e do fim do turno
  try {
    if (f.group_id) {
      const { data, error } = await supabase.from('group_chat_messages')
        .select('content, created_at, role').eq('group_id', f.group_id).eq('role', 'member')
        .gte('created_at', ini).lte('created_at', ate)
        .order('created_at', { ascending: true }).limit(30);
      if (error) return [];
      return (data || []).map((m) => String(m.content || '').trim()).filter(Boolean).slice(-teto);
    }
    if (!f.collaborator_id) return [];
    const { data, error } = await supabase.from('conversation_history')
      .select('content, created_at, direction').eq('collaborator_id', f.collaborator_id)
      .eq('direction', 'inbound')
      .gte('created_at', ini).lte('created_at', ate)
      .order('created_at', { ascending: true }).limit(30);
    if (error) return [];
    return (data || []).map((m) => String(m.content || '').trim()).filter(Boolean).slice(-teto);
  } catch (_) {
    return [];
  }
}

// CHOKEPOINT UNICO: o gate e o runner resolvem a fala pela MESMA funcao. Se um aceitasse o que o
// outro recusa, voltaria o buraco de 19/08 (o gate aprovava e o runner encenava vazio).
async function resolverFalas({ supabase, finding }) {
  const doBanco = await falasDoIncidente({ supabase, finding });
  if (doBanco.length) return { falas: doBanco, fonte: 'conversation_history' };
  const doEvidence = extrairFalasDoUsuario(finding);
  return doEvidence.length
    ? { falas: doEvidence, fonte: 'evidence' }
    : { falas: [], fonte: null };
}

// Versao async do gate: mesmas travas de categoria e multi-turno; so a trava da FALA passa a
// consultar o banco antes de recusar. `isReproducible` sincrono fica exportado e intacto.
async function avaliarReprodutibilidade({ supabase, finding }) {
  const f = finding || {};
  if (!CATS_OK.has(f.category)) return { ok: false, motivo: `categoria ${f.category || '?'} fora do escopo v1`, falas: [] };
  const txt = String(f.evidence || f.summary || '').trim();
  if (!txt) return { ok: false, motivo: 'sem evidência aferível', falas: [] };
  if (MULTITURNO_RE.test(txt)) return { ok: false, motivo: 'cenário cron/multi-turno', falas: [] };
  const { falas, fonte } = await resolverFalas({ supabase, finding: f });
  if (!falas.length) {
    return { ok: false, motivo: 'sem fala literal do usuário (nem no evidence, nem na conversa da janela)', falas: [] };
  }
  return { ok: true, motivo: `turno curto encenável (fala do ${fonte})`, falas, fonte };
}

module.exports = {
  isReproducible, extrairFalasDoUsuario,
  falasDoIncidente, resolverFalas, avaliarReprodutibilidade, JANELA_MIN, TETO_FALAS,
};
