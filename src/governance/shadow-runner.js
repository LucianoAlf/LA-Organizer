'use strict';
// Runner determinístico da sombra. Encena estado QA descartável, roda o turno real pelo
// engine em modo QA (sendMessage stubado pelo caller de produção; aqui as deps são injetadas),
// captura reply+markers+persistido e LIMPA sempre. Sem modelo.
const FAIXA_QA = /^5500\d{9}$/;
const { extrairFalasDoUsuario } = require('./shadow-reproducibility');

// v1: a fala do usuário sai do evidence ("USUÁRIO: ..."). Cenários mais ricos entram depois.
// SHADOW-VERDE-VACUO (27/08): NÃO existe mais fallback pro `summary`. Encenar a prosa do auditor
// gerava verde que não exercitava o bug (ver shadow-vacuidade.test.js). Sem fala → cenário vazio,
// e o runner abaixo recusa — o passe vira inconclusivo, nunca aprovado.
// `deps.falas` vem do gate (fala literal do banco, ou do evidence quando o banco nao tem).
// Sem elas, cai no comportamento antigo — nenhum caminho passa a encenar prosa do auditor.
function derivarCenario(finding, falas) {
  const lista = (Array.isArray(falas) && falas.length) ? falas : extrairFalasDoUsuario(finding);
  return { setup: {}, turns: lista.map((userText) => ({ userText })) };
}

// ENCENACAO DE GRUPO (01/09). O caminho 1:1 acima stuba `whatsapp.sendMessage` pra capturar a
// resposta; no grupo o TOM nao "envia", ele POSTA em group_chat_messages e um bridge separado
// leva pro WhatsApp. Entao aqui a resposta e lida da tabela, e o isolamento e OUTRO:
//
// TRAVA DE SAIDA DO GRUPO: o grupo QA tem `wa_group_jid` NULL -- sem jid o bridge nao tem pra
// onde enviar, e nenhuma mensagem de teste alcanca gente de verdade. Isso e propriedade do
// DADO, nao do codigo, entao a sonda CONFERE antes de encenar: se alguem vincular o grupo QA
// ao WhatsApp, ela recusa em vez de arriscar. Falha fechada, como a trava do Replay Lab 1:1.
async function runShadowGrupo(finding, deps) {
  const { supabase, groupEngine, qaGroupName } = deps;
  const nome = qaGroupName || process.env.TOM_QA_GROUP_NAME || '[QA] Financeiro Replay';
  const { data: grupo } = await supabase.from('work_groups')
    .select('id, name, wa_group_jid').eq('name', nome).maybeSingle();
  if (!grupo) return { transcript: { turns: [] }, erro: `grupo QA "${nome}" inexistente` };
  if (grupo.wa_group_jid) {
    return { transcript: { turns: [] }, erro: 'grupo QA esta VINCULADO ao WhatsApp (wa_group_jid) — recusado pra nao vazar mensagem de teste' };
  }
  const { data: qa } = await supabase.from('collaborators').select('id, phone').eq('phone', deps.qaPhone).maybeSingle();
  if (!qa) return { transcript: { turns: [] }, erro: 'perfil QA inexistente' };
  const cenario = derivarCenario(finding, deps.falas);
  if (!cenario.turns.length) {
    return { transcript: { turns: [] }, erro: 'sem fala literal do usuário (resumo do finding não é fala)' };
  }
  const turns = [];
  let erro = null;
  try {
    for (const t of cenario.turns) {
      const t0 = Date.now();
      await groupEngine.processGroupChatMessage({
        supabase, groupId: grupo.id, senderCollabId: qa.id, text: t.userText,
      });
      const { data: msgs } = await supabase.from('group_chat_messages')
        .select('role, content, created_at').eq('group_id', grupo.id)
        .gte('created_at', new Date(t0 - 1500).toISOString()).order('created_at');
      const reply = (msgs || []).filter((m) => m.role === 'tom').map((m) => String(m.content || '')).join(' | ');
      const { data: tksT } = await supabase.from('tasks').select('id, title, status')
        .eq('assigned_group_id', grupo.id).gte('updated_at', new Date(t0 - 1500).toISOString());
      turns.push({
        userText: t.userText,
        reply,
        markers: [],
        persisted: { tarefas_grupo: (tksT || []).map((x) => `${x.title}[${x.status}]`) },
      });
    }
  } catch (e) {
    erro = String(e.message).slice(0, 120);
  } finally {
    const del = async (fn) => { try { await fn(); } catch (_) { /* best-effort */ } };
    await del(() => supabase.from('group_chat_messages').delete().eq('group_id', grupo.id));
    await del(() => supabase.from('tasks').delete().eq('assigned_group_id', grupo.id));
    await del(() => supabase.from('group_chat_pending_confirms').delete().eq('group_id', grupo.id));
  }
  return { transcript: { turns }, erro };
}

async function runShadow(finding, deps = {}) {
  const { supabase, engine, whatsapp, turnClaim, qaPhone } = deps;
  if (!FAIXA_QA.test(String(qaPhone || ''))) return { transcript: { turns: [] }, erro: 'qaPhone fora da faixa' };
  // Finding de GRUPO encena pelo caminho de grupo — o 1:1 abaixo nao alcanca esse codigo.
  if (finding && finding.group_id) {
    if (!deps.groupEngine) return { transcript: { turns: [] }, erro: 'groupEngine não injetado' };
    return runShadowGrupo(finding, deps);
  }
  const { data: qa } = await supabase.from('collaborators').select('id, phone').eq('phone', qaPhone).maybeSingle();
  if (!qa) return { transcript: { turns: [] }, erro: 'perfil QA inexistente' };
  const cenario = derivarCenario(finding, deps.falas);
  // 2ª trava (o gate isReproducible é a 1ª): nunca encenar sem a fala real do usuário.
  if (!cenario.turns.length) {
    return { transcript: { turns: [] }, erro: 'sem fala literal do usuário (resumo do finding não é fala)' };
  }
  const turns = [];
  let erro = null;
  try {
    for (const t of cenario.turns) {
      const t0 = Date.now();
      let reply = '';
      const origSend = whatsapp.sendMessage;
      whatsapp.sendMessage = async (_p, m) => { reply += (reply ? ' | ' : '') + String(m); return { key: { id: 'shadow' } }; };
      try {
        await turnClaim.runInTurn({ waMessageId: 'shadow-' + t0, qa: true, runId: 'shadow-' + t0 }, async () => {
          try { await engine.processMessage(qa.phone, t.userText, {}); }
          catch (e) { if (!/destino proibido|status=none/i.test(String(e && e.message))) throw e; }
        });
      } finally { whatsapp.sendMessage = origSend; }
      const { data: mk } = await supabase.from('marker_logs').select('marker_type, result')
        .eq('collaborator_id', qa.id).gte('created_at', new Date(t0 - 1500).toISOString());
      const { data: habsT } = await supabase.from('habits').select('id, name, frequency')
        .eq('collaborator_id', qa.id).gte('created_at', new Date(t0 - 1500).toISOString());
      const { data: tksT } = await supabase.from('tasks').select('id, title, recurrence_rule')
        .eq('assigned_to', qa.id).gte('created_at', new Date(t0 - 1500).toISOString());
      const persisted = {
        habitos: (habsT || []).map((h) => `${h.name}[${h.frequency}]`),
        tarefas_novas: (tksT || []).map((t2) => t2.title),
        tarefas_recorrentes: (tksT || []).filter((t2) => t2.recurrence_rule).map((t2) => t2.title),
      };
      turns.push({ userText: t.userText, reply, markers: (mk || []).map((m) => `${m.marker_type}:${m.result}`), persisted });
    }
  } catch (e) {
    erro = String(e.message).slice(0, 120);
  } finally {
    const del = async (fn) => { try { await fn(); } catch (_) { /* best-effort */ } };
    // habit_reminders primeiro (por habit_id dos hábitos QA), senão vira órfão
    try {
      const { data: hq } = await supabase.from('habits').select('id').eq('collaborator_id', qa.id);
      const hids = (hq || []).map((h) => h.id);
      if (hids.length) await del(() => supabase.from('habit_reminders').delete().in('habit_id', hids));
    } catch (_) { /* best-effort */ }
    await del(() => supabase.from('habits').delete().eq('collaborator_id', qa.id));
    await del(() => supabase.from('tasks').delete().eq('assigned_to', qa.id));
    for (const tbl of ['conversation_history', 'marker_logs', 'pending_intents']) {
      await del(() => supabase.from(tbl).delete().eq('collaborator_id', qa.id));
    }
  }
  return { transcript: { turns }, erro };
}

module.exports = { runShadow, runShadowGrupo, derivarCenario };
