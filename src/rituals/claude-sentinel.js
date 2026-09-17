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
// C4 (17/09, débito real): o alerta de auth saiu 16/09 20:40, se perdeu no meio de outras
// mensagens, e o TOM ficou ~21h degradado no Codex sem ninguém perceber — o "debounce" (avisa
// uma vez e cala pra sempre enquanto o incidente segue aberto) É o defeito. Agora, enquanto o
// incidente de AUTH continua ABERTO (sem recovered_at), a sentinela INSISTE a cada 3h — mas só
// em horário comercial (09h–18h América/São_Paulo; nunca de madrugada/noite, pra não acordar
// ninguém por um problema que já está sinalizado). `alerted_at` passa a guardar o ÚLTIMO alerta
// (reaproveitado — não criamos coluna nova; nada mais no repo lia esse campo com o sentido antigo
// de "primeiro alerta", e a recuperação continua pagando no máximo uma vez porque ela só olha se
// `alerted_at` é truthy, não o VALOR).
//
// O dispatcher é processo EFÊMERO do cron (sem memória entre ticks), então o estado
// (incidente aberto / já alertado) mora no banco: tabela tom_provider_incidents.
//
// Funções puras (decideSentinel / buildSentinelMessage) são testadas isoladas.

'use strict';

// Kinds de erro do claude.js (via classify-claude-exit) que significam LOGIN MORTO.
const AUTH_KINDS = new Set(['exit_auth']);

// C4: janela de re-page — nunca de madrugada/noite. [INÍCIO, FIM) em hora LOCAL São Paulo.
const JANELA_REPAGE_INICIO_H = 9;
const JANELA_REPAGE_FIM_H = 18;

const DEFAULTS = {
  ownerPhone: '5521981278047',   // Alf (dono) — override por TOM_OWNER_ALERT_PHONE
  lookbackMin: 12,               // janela p/ "houve sucesso real do Claude?"
  transientMin: 30,              // só paga instabilidade se durar isso
  repageMin: 180,                // C4: de quanto em quanto tempo a sentinela INSISTE no auth aberto
  reloginCmd: 'ssh -t tom "bash /opt/LA-Organizer/scripts/tom-relogin.sh"',
};

function _cfg(env = {}) {
  return {
    enabled: String(env.TOM_SENTINEL_ENABLED ?? '1') !== '0',
    ownerPhone: env.TOM_OWNER_ALERT_PHONE || DEFAULTS.ownerPhone,
    lookbackMin: Number(env.TOM_SENTINEL_LOOKBACK_MIN) || DEFAULTS.lookbackMin,
    transientMin: Number(env.TOM_SENTINEL_TRANSIENT_MIN) || DEFAULTS.transientMin,
    repageMin: Number(env.TOM_SENTINEL_REPAGE_MIN) || DEFAULTS.repageMin,
    reloginCmd: env.TOM_SENTINEL_RELOGIN_CMD || DEFAULTS.reloginCmd,
  };
}

// ─── DECISÃO (pura) ──────────────────────────────────────────────────────────
// C4: hora local em São Paulo (UTC-3 o ano inteiro — Brasil não tem mais horário de verão desde
// 2019, então não existe salto de DST pra tratar aqui). Determinístico a partir de nowMs: mesmo
// argumento, mesma saída — continua sendo função pura, ainda que use Intl por baixo (mesmo
// espírito de `_hhmm`, mais abaixo, que já faz o mesmo pra formatar a mensagem).
function _horaEmSaoPaulo(nowMs) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date(nowMs));
  return Number(h) % 24; // meia-noite pode vir como "24" dependendo do ICU — normaliza pra 0
}
function _dentroDaJanelaDeRepage(nowMs) {
  const h = _horaEmSaoPaulo(nowMs);
  return h >= JANELA_REPAGE_INICIO_H && h < JANELA_REPAGE_FIM_H;
}
// C4: pode insistir quando (a) está dentro da janela comercial E (b) já passou `repageMs` desde
// o ÚLTIMO alerta (`alerted_at`, reaproveitado como "último", não "primeiro"). Sem `repageMs`
// configurado, FALHA PRA SEGURANÇA (nunca insiste) — melhor calar de menos do que virar spam por
// um caller que esqueceu de configurar o intervalo.
function _podeRepaginar({ openIncident, nowMs, repageMs }) {
  if (!Number.isFinite(repageMs) || repageMs <= 0) return false;
  if (!_dentroDaJanelaDeRepage(nowMs)) return false;
  if (!openIncident.alerted_at) return true; // defensivo: auth aberto mas nunca alertado
  const desdeUltimoMs = nowMs - Date.parse(openIncident.alerted_at);
  return Number.isFinite(desdeUltimoMs) && desdeUltimoMs >= repageMs;
}

// probe         : { ok:true } | { ok:false, kind:'exit_auth'|'exit_overloaded'|... }
// openIncident  : null | { id, kind:'auth'|'transient', started_at, alerted_at }
// → { action:'noop'|'open'|'escalate'|'page_transient'|'repage'|'recover', incidentKind?, page, pageType? }
function decideSentinel({ probe, openIncident, nowMs, transientMs, repageMs } = {}) {
  if (!probe) return { action: 'noop', page: false }; // sem sinal → não age (não inventa queda)
  const ok = !!(probe && probe.ok);
  const kind = probe && probe.kind;
  const isAuth = !ok && AUTH_KINDS.has(kind);
  const isTransient = !ok && !isAuth;

  // Claude OK
  if (ok) {
    if (openIncident) {
      // Só anuncia "voltou" se a queda chegou a ser ALERTADA (blip transitório
      // que abriu+fechou sem page não vira spam de recuperação). `alerted_at` pode ter sido
      // reescrito várias vezes pelo re-page (C4) — a checagem é de PRESENÇA, não de valor, então
      // a recuperação continua pagando no máximo uma vez.
      return { action: 'recover', page: !!openIncident.alerted_at, pageType: 'recover' };
    }
    return { action: 'noop', page: false };
  }

  // Login morto (acionável, não se cura)
  if (isAuth) {
    if (!openIncident) return { action: 'open', incidentKind: 'auth', page: true, pageType: 'auth' };
    if (openIncident.kind === 'transient') return { action: 'escalate', incidentKind: 'auth', page: true, pageType: 'auth' };
    // C4: auth já aberto — em vez de calar pra sempre, insiste a cada `repageMs`, só em horário
    // comercial. Fora da janela ou ainda dentro do prazo → noop (debounce continua existindo,
    // só não é mais eterno).
    if (_podeRepaginar({ openIncident, nowMs, repageMs })) return { action: 'repage', page: true, pageType: 'auth' };
    return { action: 'noop', page: false };
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

// C4: quantas horas inteiras já se passaram entre sinceIso e nowIso — null se não der pra medir
// (falta um dos dois, ou data inválida). Usado pra dizer "já se vão Xh" na mensagem de auth.
function _horasDesde(sinceIso, nowIso) {
  if (!sinceIso || !nowIso) return null;
  const ms = new Date(nowIso).getTime() - new Date(sinceIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / 3600000);
}

function buildSentinelMessage({ pageType, sinceIso, reloginCmd, nowIso } = {}) {
  if (pageType === 'auth') {
    const h = _horasDesde(sinceIso, nowIso);
    const duracao = h ? ` (já se vão ${h}h)` : '';
    return [
      '🔴 *TOM — Claude caiu (login)*',
      `Desde ~${_hhmm(sinceIso)}${duracao} o Claude tá recusando autenticação. O TOM continua respondendo, mas *degradado no Codex* (fallback).`,
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
  const decision = decideSentinel({ probe, openIncident, nowMs, transientMs: cfg.transientMin * 60000, repageMs: cfg.repageMin * 60000 });

  // 5) Efeitos (banco + WhatsApp). Isolados — falha aqui só loga.
  try {
    if (decision.action === 'open') {
      await supabase.from('tom_provider_incidents').insert({
        provider: 'claude', kind: decision.incidentKind,
        started_at: nowIso, alerted_at: decision.page ? nowIso : null,
        last_probe_kind: probe.kind || null,
      });
      if (decision.page) await _page(sendMessage, cfg, { pageType: decision.pageType, sinceIso: nowIso, nowIso });
    } else if (decision.action === 'escalate') {
      await supabase.from('tom_provider_incidents')
        .update({ kind: 'auth', alerted_at: nowIso, last_probe_kind: probe.kind || null })
        .eq('id', openIncident.id);
      await _page(sendMessage, cfg, { pageType: 'auth', sinceIso: openIncident.started_at, nowIso });
    } else if (decision.action === 'page_transient') {
      await supabase.from('tom_provider_incidents')
        .update({ alerted_at: nowIso, last_probe_kind: probe.kind || null })
        .eq('id', openIncident.id);
      await _page(sendMessage, cfg, { pageType: 'transient', sinceIso: openIncident.started_at, nowIso });
    } else if (decision.action === 'repage') {
      // C4: insiste — reaproveita `alerted_at` como "último alerta" (não abre coluna nova).
      await supabase.from('tom_provider_incidents')
        .update({ alerted_at: nowIso, last_probe_kind: probe.kind || null })
        .eq('id', openIncident.id);
      await _page(sendMessage, cfg, { pageType: 'auth', sinceIso: openIncident.started_at, nowIso });
    } else if (decision.action === 'recover') {
      await supabase.from('tom_provider_incidents')
        .update({ recovered_at: nowIso, recovery_alerted_at: decision.page ? nowIso : null })
        .eq('id', openIncident.id);
      if (decision.page) await _page(sendMessage, cfg, { pageType: 'recover', sinceIso: nowIso, nowIso });
    }
  } catch (e) {
    console.error('[Sentinel] aplicar decisão falhou:', e.message);
  }

  console.log(`[Sentinel] probe=${probe.ok ? 'ok' : 'FAIL:' + probe.kind}(${probe.via}) incident=${openIncident ? openIncident.kind : 'none'} → action=${decision.action}${decision.page ? ' (page)' : ''}`);
  return { probe, decision };
}

async function _page(sendMessage, cfg, { pageType, sinceIso, nowIso }) {
  const msg = buildSentinelMessage({ pageType, sinceIso, reloginCmd: cfg.reloginCmd, nowIso });
  try { await sendMessage(cfg.ownerPhone, msg); }
  catch (e) { console.error('[Sentinel] envio do alerta falhou:', e.message); }
}

module.exports = { runClaudeSentinel, decideSentinel, buildSentinelMessage, AUTH_KINDS, _cfg };
