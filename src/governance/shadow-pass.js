'use strict';
// Orquestra a sombra sobre os findings que o ciclo acabou de fixar/promover. Único ponto que
// APLICA o veredito. reprovado = reabre + barra; inconclusivo/aprovado = anota.
function ymdUtc() { return new Date().toISOString().slice(0, 10); }

async function shadowPass(findings, deps = {}) {
  const { supabase, isReproducible, runShadow, judgeShadow } = deps;
  const out = [];
  for (const f of (findings || [])) {
    try {
      let verdict = 'inconclusivo'; let reason = ''; let evidencia = '';
      const rep = isReproducible(f);
      if (!rep.ok) {
        reason = `não reproduzível: ${rep.motivo}`;
      } else {
        const { transcript, erro } = await runShadow(f, deps);
        if (erro) { reason = `runner: ${erro}`; }
        else {
          const j = await judgeShadow({ finding: f, fixIntent: f.fix_intent, transcript }, deps);
          verdict = j.verdict; reason = j.reason || '';
          evidencia = (transcript.turns || []).map((t) => `«${t.userText}» → «${t.reply}» [${(t.markers || []).join(',')}]`).join(' ; ').slice(0, 500);
        }
      }
      const barrou = verdict === 'reprovado';
      const nota = `[shadow ${ymdUtc()}] ${verdict}: ${reason}${evidencia ? ' | ' + evidencia : ''}`;
      try {
        if (barrou) {
          await supabase.from('tom_audit_findings').update({ status: 'novo', verified_result: null, verified_note: nota }).eq('id', f.id);
        } else {
          await supabase.from('tom_audit_findings').update({ verified_note: nota }).eq('id', f.id);
        }
        await supabase.from('marker_logs').insert({ marker_type: 'SHADOW', result: verdict, reason: reason.slice(0, 120) });
      } catch (_) { /* persistência best-effort; nunca derruba o ciclo */ }
      out.push({ id: f.id, verdict, barrou });
    } catch (e) {
      console.warn('[Shadow] finding pulado:', f.id, e.message);
      out.push({ id: f.id, verdict: 'inconclusivo', barrou: false });
      continue;
    }
  }
  return out;
}

module.exports = { shadowPass };
