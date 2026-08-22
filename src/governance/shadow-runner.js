'use strict';
// Runner determinístico da sombra. Encena estado QA descartável, roda o turno real pelo
// engine em modo QA (sendMessage stubado pelo caller de produção; aqui as deps são injetadas),
// captura reply+markers+persistido e LIMPA sempre. Sem modelo.
const FAIXA_QA = /^5500\d{9}$/;

// v1: a fala do usuário sai do evidence ("USUÁRIO: ..."). Cenários mais ricos entram depois.
function derivarCenario(finding) {
  const ev = String((finding && finding.evidence) || '');
  const falas = ev.split('\n').map((l) => l.match(/^\s*(?:USU[ÁA]RIO|Pessoa)\s*:\s*(.+)$/i)).filter(Boolean).map((m) => m[1].trim());
  const turns = (falas.length ? falas : [String((finding && finding.summary) || '').slice(0, 200)]).map((userText) => ({ userText }));
  return { setup: {}, turns };
}

async function runShadow(finding, deps = {}) {
  const { supabase, engine, whatsapp, turnClaim, qaPhone } = deps;
  if (!FAIXA_QA.test(String(qaPhone || ''))) return { transcript: { turns: [] }, erro: 'qaPhone fora da faixa' };
  const { data: qa } = await supabase.from('collaborators').select('id, phone').eq('phone', qaPhone).maybeSingle();
  if (!qa) return { transcript: { turns: [] }, erro: 'perfil QA inexistente' };
  const cenario = derivarCenario(finding);
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

module.exports = { runShadow, derivarCenario };
