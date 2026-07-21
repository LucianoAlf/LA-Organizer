// src/rituals/claude-sentinel.js
// SENTINELA DO PROVEDOR DE IA — detecta o Claude (CLI OAuth) CAÍDO e avisa o dono no
// WhatsApp NA HORA, em vez de o TOM rodar horas degradado no Codex sem ninguém ver.
// Incidente 20/06: o refresh token morreu, o Claude deu 401 das 09h às 22h e o TOM
// ficou ~13h no fallback (Codex) — só descoberto por acaso. Esta sentinela mata isso.
//
// Roda a cada tick do dispatcher (~5min). Estratégia barata + cobertura 24/7:
//   1. Houve sucesso REAL do Claude em tom_metrics na janela? → está vivo, NÃO sonda
//      (o tráfego real já prova saúde → zero canário e zero contenção na fila
//       _claudeQueue em horário cheio; respeita AI-TIMEOUT-120S-QUEUE-STALL).
//   2. Senão (silêncio OU Claude falhando) → 1 canário `claude.chat('ping')`:
//        • exit_auth  → login morto (NÃO se cura sozinho) → PAGE imediato + comando de re-login.
//        • transitório (overload/timeout/...) → só PAGE se persistir (>= TRANSIENT_MIN); msg leve.
//        • ok         → se havia incidente aberto, fecha e avisa que VOLTOU.
//
// O dispatcher é processo EFÊMERO do cron (sem memória entre ticks), então o estado
// (incidente aberto / já alertado) mora no banco: tabela tom_provider_incidents.
//
// Funções puras (decideSentinel / buildSentinelMessage) são testadas isoladas.

'use strict';

// Kinds de erro do claude.js (via classify-claude-exit) que significam LOGIN MORTO.
const AUTH_KINDS = new Set(['exit_auth']);

const DEFAULTS = {
  ownerPhone: '5521981278047',   // Alf (dono) — override por TOM_OWNER_ALERT_PHONE
  lookbackMin: 12,               // janela p/ "houve sucesso real do Claude?"
  transientMin: 30,              // só paga instabilidade se durar isso
  reloginCmd: 'ssh -t tom "bash /opt/LA-Organizer/scripts/tom-relogin.sh"',
};

function _cfg(env = {}) {
  return {
    enabled: String(env.TOM_SENTINEL_ENABLED ?? '1') !== '0',
    ownerPhone: env.TOM_OWNER_ALERT_PHONE || DEFAULTS.ownerPhone,
    lookbackMin: Number(env.TOM_SENTINEL_LOOKBACK_MIN) || DEFAULTS.lookbackMin,
    transientMin: Number(env.TOM_SENTINEL_TRANSIENT_MIN) || DEFAULTS.transientMin,
    reloginCmd: env.TOM_SENTINEL_RELOGIN_CMD || DEFAULTS.reloginCmd,
  };
}

// ─── DECISÃO (pura) ──────────────────────────────────────────────────────────
// probe         : { ok:true } | { ok:false, kind:'exit_auth'|'exit_overloaded'|... }
// openIncident  : null | { id, kind:'auth'|'transient', started_at, alerted_at }
// → { action:'noop'|'open'|'escalate'|'page_transient'|'recover', incidentKind?, page, pageType? }
function decideSentinel({ probe, openIncident, nowMs, transientMs } = {}) {
  if (!probe) return { action: 'noop', page: false }; // sem sinal → não age (não inventa queda)
  const ok = !!(probe && probe.ok);
  const kind = probe && probe.kind;
  const isAuth = !ok && AUTH_KINDS.has(kind);
  const isTransient = !ok && !isAuth;

  // Claude OK
  if (ok) {
    if (openIncident) {
      // Só anuncia "voltou" se a queda chegou a ser ALERTADA (blip transitório
      // que abriu+fechou sem page não vira spam de recuperação).
      return { action: 'recover', page: !!openIncident.alerted_at, pageType: 'recover' };
    }
    return { action: 'noop', page: false };
  }

  // Login morto (acionável, não se cura)
  if (isAuth) {
    if (!openIncident) return { action: 'open', incidentKind: 'auth', page: true, pageType: 'auth' };
    if (openIncident.kind === 'transient') return { action: 'escalate', incidentKind: 'auth', page: true, pageType: 'auth' };
    return { action: 'noop', page: false }; // auth já aberto e alertado → debounce
  }

  // Transitório (overload/timeout/5xx/...): se cura sozinho → page só se persistir.
  if (isTransient) {
    if (!openIncident) return { action: 'open', incidentKind: 'transient', page: false };
    if (openIncident.kind === 'auth') return { action: 'noop', page: false }; // já está no estado pior + alertado
    const ageMs = nowMs - Date.parse(openIncident.started_at);
    if (!openIncident.alerted_at && Number.isFinite(ageMs) && ageMs >= transientMs) {
      return { action: 'page_transient', page: true, pageType: 'transient' };
    }
    return { action: 'noop', page: false };
  }

  return { action: 'noop', page: false };
}

// ─── MENSAGEM (pura) ─────────────────────────────────────────────────────────
function _hhmm(iso) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch (_) { return '??:??'; }
}

function buildSentinelMessage({ pageType, sinceIso, reloginCmd } = {}) {
  if (pageType === 'auth') {
    return [
      '🔴 *TOM — Claude caiu (login)*',
      `Desde ~${_hhmm(sinceIso)} o Claude tá recusando autenticação. O TOM continua respondendo, mas *degradado no Codex* (fallback).`,
      '',
      'Pra voltar ao normal é só re-logar (o script faz backup + verifica sozinho):',
      reloginCmd || DEFAULTS.reloginCmd,
      '(se já estiver dentro do box: bash /opt/LA-Organizer/scripts/tom-relogin.sh)',
    ].join('\n');
  }
  if (pageType === 'transient') {
    return [
      '🟠 *TOM — Claude instável*',
      `O Claude tá falhando (sobrecarga/timeout) desde ~${_hhmm(sinceIso)} e o TOM tá no Codex. Costuma voltar sozinho — te aviso quando normalizar. Se quiser forçar, é o mesmo re-login.`,
    ].join('\n');
  }
  // recover
  return [
    '🟢 *TOM — Claude voltou*',
    'Autenticação OK de novo. O TOM saiu do Codex e voltou pro Claude. 👍',
  ].join('\n');
}

// ─── ORQUESTRADOR (I/O) ──────────────────────────────────────────────────────
// deps: { supabase, claudeChat, sendMessage }. claudeChat = claude.chat (lança em falha,
// com err.kind classificado por classify-claude-exit). NUNCA propaga erro pra cima
// (o tick do dispatcher não pode quebrar por causa da sentinela).
async function runClaudeSentinel({ supabase, claudeChat, sendMessage, now = new Date(), env = process.env } = {}) {
  const cfg = _cfg(env);
  if (!cfg.enabled) return { skipped: 'disabled' };
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  // 1) Estado: incidente aberto do Claude (recovered_at null).
  let openIncident = null;
  try {
    const { data } = await supabase.from('tom_provider_incidents')
      .select('id, kind, started_at, alerted_at')
      .eq('provider', 'claude').is('recovered_at', null)
      .order('started_at', { ascending: false }).limit(1);
    openIncident = (data || [])[0] || null;
  } catch (e) {
    console.error('[Sentinel] load incident falhou:', e.message);
    return { error: 'load_incident' };
  }

  // 2) Tráfego REAL recente prova saúde → não sonda (zero contenção em horário cheio).
  let probe;
  let recentClaudeOk = false;
  try {
    const sinceIso = new Date(nowMs - cfg.lookbackMin * 60000).toISOString();
    const { count } = await supabase.from('tom_metrics')
      .select('id', { count: 'exact', head: true })
      .gte('ts', sinceIso).eq('provider_used', 'claude');
    recentClaudeOk = (count || 0) > 0;
  } catch (_) { /* sem métricas → cai pro canário */ }

  if (recentClaudeOk) {
    probe = { ok: true, via: 'metrics' };
  } else {
    // 3) Canário real (só em silêncio ou suspeita). claude.chat lança em falha.
    try {
      await claudeChat('Você é um teste de saúde do sistema. Responda apenas: ok', [{ role: 'user', content: 'ping' }]);
      probe = { ok: true, via: 'canary' };
    } catch (e) {
      probe = { ok: false, kind: e && e.kind ? e.kind : 'unknown', via: 'canary' };
    }
  }

  // 4) Decisão pura.
  const decision = decideSentinel({ probe, openIncident, nowMs, transientMs: cfg.transientMin * 60000 });

  // 5) Efeitos (banco + WhatsApp). Isolados — falha aqui só loga.
  try {
    if (decision.action === 'open') {
      await supabase.from('tom_provider_incidents').insert({
        provider: 'claude', kind: decision.incidentKind,
        started_at: nowIso, alerted_at: decision.page ? nowIso : null,
        last_probe_kind: probe.kind || null,
      });
      if (decision.page) await _page(sendMessage, cfg, { pageType: decision.pageType, sinceIso: nowIso });
    } else if (decision.action === 'escalate') {
      await supabase.from('tom_provider_incidents')
        .update({ kind: 'auth', alerted_at: nowIso, last_probe_kind: probe.kind || null })
        .eq('id', openIncident.id);
      await _page(sendMessage, cfg, { pageType: 'auth', sinceIso: openIncident.started_at });
    } else if (decision.action === 'page_transient') {
      await supabase.from('tom_provider_incidents')
        .update({ alerted_at: nowIso, last_probe_kind: probe.kind || null })
        .eq('id', openIncident.id);
      await _page(sendMessage, cfg, { pageType: 'transient', sinceIso: openIncident.started_at });
    } else if (decision.action === 'recover') {
      await supabase.from('tom_provider_incidents')
        .update({ recovered_at: nowIso, recovery_alerted_at: decision.page ? nowIso : null })
        .eq('id', openIncident.id);
      if (decision.page) await _page(sendMessage, cfg, { pageType: 'recover', sinceIso: nowIso });
    }
  } catch (e) {
    console.error('[Sentinel] aplicar decisão falhou:', e.message);
  }

  console.log(`[Sentinel] probe=${probe.ok ? 'ok' : 'FAIL:' + probe.kind}(${probe.via}) incident=${openIncident ? openIncident.kind : 'none'} → action=${decision.action}${decision.page ? ' (page)' : ''}`);
  return { probe, decision };
}

async function _page(sendMessage, cfg, { pageType, sinceIso }) {
  const msg = buildSentinelMessage({ pageType, sinceIso, reloginCmd: cfg.reloginCmd });
  try { await sendMessage(cfg.ownerPhone, msg); }
  catch (e) { console.error('[Sentinel] envio do alerta falhou:', e.message); }
}

module.exports = { runClaudeSentinel, decideSentinel, buildSentinelMessage, AUTH_KINDS, _cfg };
