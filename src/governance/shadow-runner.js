'use strict';
// Runner determinístico da sombra. Encena estado QA descartável, roda o turno real pelo
// engine em modo QA (sendMessage stubado pelo caller de produção; aqui as deps são injetadas),
// captura reply+markers+persistido e LIMPA sempre. Sem modelo.
const FAIXA_QA = /^5500\d{9}$/;

// v1: a fala do usuário sai do evidence ("USUÁRIO: ..."). Cenários mais ricos entram depois.
function derivarCenario(finding) {
  const ev = String((finding && finding.evidence) || '');
  const falas = ev.split('\n').map((l) => l.match(/^\s*USU[ÁA]RIO\s*:\s*(.+)$/i)).filter(Boolean).map((m) => m[1].trim());
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
      turns.push({ userText: t.userText, reply, markers: (mk || []).map((m) => `${m.marker_type}:${m.result}`), persisted: {} });
    }
  } catch (e) {
    erro = String(e.message).slice(0, 120);
  } finally {
    for (const tbl of ['conversation_history', 'marker_logs', 'pending_intents', 'habits', 'tasks']) {
      try { await supabase.from(tbl).delete().eq('collaborator_id', qa.id); } catch (_) { /* best-effort */ }
    }
  }
  return { transcript: { turns }, erro };
}

module.exports = { runShadow, derivarCenario };
