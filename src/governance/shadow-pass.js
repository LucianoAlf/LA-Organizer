'use strict';
// Orquestra a sombra sobre os findings que o ciclo acabou de fixar/promover. Único ponto que
// APLICA o veredito. reprovado = reabre + barra; inconclusivo/aprovado = anota.
function ymdUtc() { return new Date().toISOString().slice(0, 10); }

// marker_logs.result tem CHECK (executed|rejected|skipped|redirected|fallback). O verdict da
// sombra (aprovado|reprovado|inconclusivo) NÃO está nesse conjunto — inserir cru viola o CHECK
// e o insert cai calado no best-effort (prova viva 23/08: 0 markers SHADOW sempre). Mapeia pro
// vocabulário válido e guarda o verdict cru no reason.
const VERDICT_TO_RESULT = { reprovado: 'rejected', aprovado: 'executed', inconclusivo: 'skipped' };

// A nota anterior é a prova do fechamento escrita pelo corretor. A sombra escreve DEPOIS dela.
function anexar(anterior, nova) {
  const a = String(anterior || '').trim();
  return a ? `${a}\n${nova}` : nova;
}

async function shadowPass(findings, deps = {}) {
  const { supabase, isReproducible, runShadow, judgeShadow } = deps;
  const out = [];
  for (const f of (findings || [])) {
    try {
      let verdict = 'inconclusivo'; let reason = ''; let evidencia = ''; let infraError = false;
      const rep = isReproducible(f);
      if (!rep.ok) {
        reason = `não reproduzível: ${rep.motivo}`;
      } else {
        const { transcript, erro } = await runShadow(f, deps);
        if (erro) { reason = `runner: ${erro}`; }
        else {
          const j = await judgeShadow({ finding: f, fixIntent: f.fix_intent, transcript }, deps);
          verdict = j.verdict; reason = j.reason || ''; infraError = !!j.infraError;
          evidencia = (transcript.turns || []).map((t) => `«${t.userText}» → «${t.reply}» [${(t.markers || []).join(',')}]`).join(' ; ').slice(0, 500);
        }
      }
      const barrou = verdict === 'reprovado';
      const nota = `[shadow ${ymdUtc()}] ${verdict}: ${reason}${evidencia ? ' | ' + evidencia : ''}`;
      // A sombra ANEXA ao verified_note, nunca substitui. A nota anterior é a prova do
      // fechamento escrita pelo corretor ({antes, depois}, turno real, commit). Sobrescrever
      // apagou essa prova em 89d9734e (o fix do próprio dia) e 7701ee2f em 02/09: o achado
      // ficou `corrigido` carregando só "inconclusivo: não reproduzível", e quem lê a tabela
      // ou reabre ou para de confiar nela. Reprovado reabre, mas a prova refutada fica junto
      // da refutação — é ela que explica o que o corretor achou que tinha provado.
      const notaFinal = anexar(f.verified_note, nota);
      try {
        if (barrou) {
          await supabase.from('tom_audit_findings').update({ status: 'novo', verified_result: null, verified_note: notaFinal }).eq('id', f.id);
        } else if (!infraError) {
          await supabase.from('tom_audit_findings').update({ verified_note: notaFinal }).eq('id', f.id);
        }
        // infraError: o judge não rodou, então NADA foi aprendido sobre o achado — e o
        // verified_note é onde mora a prova do fechamento. Sobrescrever aqui apaga a prova e
        // deixa "inconclusivo" num achado corrigido: quem abre a tabela reabre o achado, ou
        // para de confiar nela. Foi o que aconteceu com 1193b03b/db8ff165/725c940e em 31/08.
        // A falha continua visível — no marker_logs abaixo e no console.error do gov-runner.
        await supabase.from('marker_logs').insert({ marker_type: 'SHADOW', result: VERDICT_TO_RESULT[verdict] || 'skipped', reason: `${verdict}: ${reason}`.slice(0, 120) });
      } catch (_) { /* persistência best-effort; nunca derruba o ciclo */ }
      out.push({ id: f.id, verdict, barrou, infraError, reason });
    } catch (e) {
      console.warn('[Shadow] finding pulado:', f.id, e.message);
      out.push({ id: f.id, verdict: 'inconclusivo', barrou: false });
      continue;
    }
  }
  return out;
}

module.exports = { shadowPass };
