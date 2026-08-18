#!/usr/bin/env node
// scripts/prova-folga-dnd.js
// Prova comportamental do FOLGA-DND-ROUTING (audit 18/08, Dai): uma folga DE HOJE declarada
// pelo próprio colaborador tem que virar DND até o fim do dia — senão os rituais da noite
// cobram na folga. Roda o LLM REAL (engine.processMessage) e mede o efeito no BANCO.
//
//   ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/prova-folga-dnd.js"
//
// APROVA se, após a mensagem de folga: (a) marker_logs tem DND_SET, e (b) do_not_disturb_until
// fica setado para HOJE (futuro, ≤24h). ANTI-VACUIDADE: mede um controle ("bom dia, tudo certo?")
// que NÃO é folga e NÃO pode gerar DND.
//
// SEGURANÇA: remetente é o perfil descartável de QA (faixa 5500…), runInTurn({qa:true}) suprime
// envio, limpeza fail-closed no finally (zera DND + apaga histórico/markers do QA).

const supabase = require('../src/supabase/client');
const turnClaim = require('../src/services/turn-claim');
const engine = require('../src/engine');

const QA_PHONE = (process.env.TOM_QA_PHONES || '5500000000001').split(',')[0].trim();
const RUN = `qa-folga-${Date.now()}`;

async function senderQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name, phone').eq('phone', QA_PHONE).maybeSingle();
  if (!data) throw new Error(`perfil QA ${QA_PHONE} não existe`);
  if (!/^5500\d{9}$/.test(String(data.phone || '').replace(/\D/g, ''))) throw new Error('remetente fora da faixa de QA');
  return data;
}

async function limparDnd(sender) {
  if (!sender || !/^5500/.test(String(sender.phone || '').replace(/\D/g, ''))) return; // fail-closed
  await supabase.from('user_preferences')
    .update({ do_not_disturb_until: null, do_not_disturb_reason: null })
    .eq('collaborator_id', sender.id);
  await supabase.from('conversation_history').delete().eq('collaborator_id', sender.id);
  await supabase.from('marker_logs').delete().eq('collaborator_id', sender.id);
}

async function rodar(sender, fala, tag) {
  await limparDnd(sender); // parte de estado limpo
  await turnClaim.runInTurn({ waMessageId: `${RUN}-${tag}`, qa: true, runId: RUN }, async () => {
    try {
      await engine.processMessage(sender.phone, fala, {});
    } catch (e) {
      if (!/destino proibido em replay|status=none/i.test(String(e && e.message))) throw e;
    }
  });
  const { data: prefs } = await supabase.from('user_preferences')
    .select('do_not_disturb_until, do_not_disturb_reason').eq('collaborator_id', sender.id).maybeSingle();
  const { data: mk } = await supabase.from('marker_logs')
    .select('marker_type, result, reason').eq('collaborator_id', sender.id)
    .order('created_at', { ascending: false }).limit(12);
  const tipos = (mk || []).map((m) => m.marker_type);
  const until = prefs && prefs.do_not_disturb_until ? Date.parse(prefs.do_not_disturb_until) : null;
  const now = Date.now();
  // "hoje" comparado em BRT (VPS roda em UTC; o DND é 23:59-03:00) — data-calendário São Paulo.
  const brtDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return {
    dndMarker: tipos.includes('DND_SET'),
    dndAtivo: !!(until && until > now && until <= now + 24 * 60 * 60 * 1000),
    dndHoje: !!(until && until > now && brtDate(until) === brtDate(now)),
    until: prefs && prefs.do_not_disturb_until,
    reason: prefs && prefs.do_not_disturb_reason,
    markers: tipos,
  };
}

(async () => {
  const sender = await senderQA();
  console.log('=== PROVA COMPORTAMENTAL: folga de hoje → DND até o fim do dia ===');
  console.log(`remetente: ${sender.full_name} (${sender.phone})\n`);

  let reprovou = false;
  let rFolga = null; let rControle = null;
  try {
    rFolga = await rodar(sender, 'Oi Tom, hoje eu estou de folga, mas amanhã eu te passo tudo', 'folga');
    console.log(`  [folga]    DND_SET=${rFolga.dndMarker} · dndAtivo=${rFolga.dndAtivo} · dndHoje=${rFolga.dndHoje} · until=${rFolga.until} · reason=${JSON.stringify(rFolga.reason)}`);
    console.log(`             markers=${JSON.stringify(rFolga.markers)}`);
    rControle = await rodar(sender, 'Bom dia, Tom! Tudo certo por aí?', 'controle');
    console.log(`  [controle] DND_SET=${rControle.dndMarker} · dndAtivo=${rControle.dndAtivo} (esperado false)`);
  } catch (e) {
    reprovou = true; console.log(`  ERRO: ${e.message}`);
  } finally {
    try { await limparDnd(sender); } catch (e) { console.log(`  (limpeza falhou: ${e.message})`); }
    turnClaim.limparEvidenciasQA && turnClaim.limparEvidenciasQA();
  }

  const okFolga = rFolga && rFolga.dndMarker && rFolga.dndAtivo && rFolga.dndHoje;
  const okControle = rControle && !rControle.dndAtivo && !rControle.dndMarker;
  if (!okFolga) { reprovou = true; console.log('\n  ✗ folga NÃO gerou DND até hoje (emissão do marker falhou).'); }
  if (!okControle) { reprovou = true; console.log('\n  ✗ controle gerou DND — falso-positivo (vacuidade).'); }

  console.log(reprovou ? '\n=== REPROVADO ===' : '\n=== APROVADO (folga→DND hoje · controle não dispara) ===');
  process.exit(reprovou ? 1 : 0);
})().catch((e) => { console.error('erro fatal:', e); process.exit(1); });
