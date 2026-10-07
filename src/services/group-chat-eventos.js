'use strict';

// EVENTO-NO-GRUPO-HONESTO (07/10, aprovado pelo Alf). O chat de grupo chamava applyEventActions e
// empurrava `status: 'ok'` pra TODO evento, sem ler o resultado — evento barrado (duplicata,
// conflito, categoria inexistente) aparecia no card como marcado. E rodava sem confirmação
// nenhuma (semIntentDeConfirmacao), então conflito/passado ou sumiam calados ou passavam direto.
//
// Agora: um evento por vez, e o card diz o que aconteceu de verdade — criado / segurado pra
// confirmar / falhou (com o motivo). Segurado (início no passado ou conflito, mesma regra do 1:1 —
// lib/confirmacao-evento.js) vira a MESMA pergunta única ("Antes de marcar X: • bate com Y …
// Marco assim mesmo?") e a pendência vai pro mecanismo que o grupo JÁ tem pra isso:
// group_chat_pending_confirms (por grupo + remetente, expira em 10 min, pré-passo determinístico
// antes do LLM, decideConfirm do group-notes). Só o "sim" do MESMO remetente cria; o delete com
// retorno antes de criar garante que dois "sim" não criam duas vezes.
//
// O evento já marcado pelo engine vai em `payload` (jsonb, coluna criada em 07/10 com aval do Alf —
// migrations/20261007_group_chat_pending_confirms_payload.sql); `summary` fica só com o
// texto humano (título), como nas outras ops. As flags de confirmação nascem no engine e nunca do
// texto do grupo.

const OP = 'create_event';
const TTL_MS = 10 * 60 * 1000;

function _detalheDaFalha(engine, payload) {
  if (!payload) return 'não consegui salvar';
  if (payload.type === 'dup_event') {
    const c = (payload.conflicts || [])[0];
    return c ? `já existe um compromisso parecido: ${c.title}` : 'já existe um compromisso parecido';
  }
  if (payload.type === 'ambiguous_recipient') return 'tem mais de uma pessoa com esse nome — me diz qual';
  return 'não consegui salvar';
}

function montarPayload(eventos, itens) {
  return { v: 1, events: eventos, itens };
}

function lerPayload(payload) {
  return (payload && payload.v === 1 && Array.isArray(payload.events) && Array.isArray(payload.itens)) ? payload : null;
}

// Aplica os EVENT_CREATE do grupo e devolve as ações do card (uma por evento), com a verdade.
async function aplicarEventosDoGrupo({ supabase, engine, collab, groupId, senderCollabId, events }) {
  const { perguntaDeConfirmacao } = require('../lib/confirmacao-evento');
  const actions = [];
  const segurados = [];
  for (const ev of (events || [])) {
    const label = (ev && ev.title) || 'compromisso';
    let r;
    try {
      // suppressNotify: NUNCA dispara zap (regra do chat de grupo). confirmacaoPeloChamador: o
      // engine segura mas não abre o intent do 1:1 — a pergunta é feita aqui, no grupo.
      r = await engine.applyEventActions(collab, [ev], { suppressNotify: true, confirmacaoPeloChamador: true });
    } catch (e) {
      console.error('[GroupChat] evento err:', e.message);
      actions.push({ kind: 'event', status: 'fail', verbo: 'create', label, detail: 'não consegui salvar' });
      continue;
    }
    const avisos = (r && r.avisosConvidados) || [];
    if (r && r.okCount > 0) {
      const partes = [];
      if (ev.recurrence_rule) partes.push('recorrente');
      if (avisos.length) partes.push(avisos.map((l) => l.replace(/^⚠️\s*/u, '')).join(' · '));
      actions.push({ kind: 'event', status: 'ok', label, detail: partes.join(' · ') });
    } else if (r && Array.isArray(r.segurados) && r.segurados.length) {
      segurados.push(...r.segurados);
    } else {
      actions.push({ kind: 'event', status: 'fail', verbo: 'create', label, detail: _detalheDaFalha(engine, r && r.integrityPayload) });
    }
  }
  if (segurados.length) {
    const itens = segurados.map((s) => s.item);
    const pergunta = perguntaDeConfirmacao(itens);
    const expires = new Date(Date.now() + TTL_MS).toISOString();
    const titulo = itens.map((i) => i.titulo).join(', ');
    const { error } = await supabase.from('group_chat_pending_confirms').upsert({
      group_id: groupId, sender_collab_id: senderCollabId, op: OP, target_id: null,
      summary: titulo.slice(0, 200), payload: montarPayload(segurados.map((s) => s.evento), itens), expires_at: expires,
    }, { onConflict: 'group_id,sender_collab_id,op' });
    if (error) {
      // Sem a pendência gravada o "sim" não acharia nada: falha honesta em vez de pergunta morta.
      console.error('[GroupChat] pendência de evento não gravou:', error.message);
      for (const i of itens) actions.push({ kind: 'event', status: 'fail', verbo: 'create', label: i.titulo, detail: 'não consegui segurar pra confirmar — me manda de novo' });
    } else {
      actions.push({ kind: 'event', status: 'pending', label: titulo, detail: '❓ confirma pra eu marcar', pergunta });
      console.log(`[GroupChat] evento SEGURADO p/ confirmação grupo=${groupId} remetente=${String(senderCollabId).slice(0, 8)}: "${titulo}"`);
    }
  }
  return actions;
}

// Pré-passo (antes do LLM): "sim"/"não" seco do MESMO remetente resolve a pendência de evento.
// Devolve { texto } quando tratou, ou null (segue o fluxo normal).
async function resolverConfirmacaoDeEvento({ supabase, engine, groupId, senderCollabId, text, decideConfirm }) {
  if (!senderCollabId) return null;
  const { data: pend } = await supabase.from('group_chat_pending_confirms')
    .select('*').eq('group_id', groupId).eq('sender_collab_id', senderCollabId).eq('op', OP)
    .gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!pend) return null;
  const verdict = decideConfirm(pend, text);
  if (verdict === 'ignore') return null;
  // Consome ANTES de agir e só age se ESTE turno consumiu: dois "sim" seguidos não criam duas vezes.
  const { data: consumidos } = await supabase.from('group_chat_pending_confirms')
    .delete().eq('id', pend.id).select('id');
  if (!consumidos || !consumidos.length) return null;
  const dados = lerPayload(pend.payload);
  const titulo = dados ? dados.itens.map((i) => i.titulo).join(', ') : (pend.summary || 'o compromisso');
  if (verdict === 'cancel') return { texto: `Ok, não marquei *${titulo}*. Se for em outro horário, me diz qual. 👍` };
  if (!dados) return { texto: '_Perdi o compromisso que tava esperando confirmação — me manda de novo?_' };
  const { data: collab } = await supabase.from('collaborators').select('*').eq('id', senderCollabId).maybeSingle();
  if (!collab) return { texto: '_Não consegui marcar agora — me manda de novo?_' };
  const r = await engine.applyEventActions(collab, dados.events, { suppressNotify: true, confirmacaoPeloChamador: true });
  const { anexarConflitosAoTexto } = require('../lib/agenda-conflitos');
  let texto;
  if (r && r.okCount > 0 && !r.failCount) texto = r.okCount === 1 ? `✅ Marquei *${titulo}*.` : `✅ Marquei os ${r.okCount} compromissos.`;
  else if (r && r.okCount > 0) texto = `Marquei ${r.okCount}, mas ${r.failCount} não ${r.failCount === 1 ? 'entrou' : 'entraram'}. Me manda de novo o que faltou?`;
  else texto = `_Não consegui marcar *${titulo}* agora — ${_detalheDaFalha(engine, r && r.integrityPayload)}._`;
  if (r && r.avisosConvidados && r.avisosConvidados.length) texto = anexarConflitosAoTexto(texto, r.avisosConvidados);
  return { texto, okCount: (r && r.okCount) || 0 };
}

module.exports = { OP, aplicarEventosDoGrupo, resolverConfirmacaoDeEvento, montarPayload, lerPayload };
