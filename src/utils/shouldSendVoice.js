// src/utils/shouldSendVoice.js — Sprint 28
// ──────────────────────────────────────────────────────────────────────
// Matriz de decisão: TOM deve responder por áudio agora?
//
// Filosofia: áudio é ocasional e celebratório, NUNCA operacional.
// Mira ~5% das interações totais. Cap diário de 3 áudios por user.
//
// Gates (em ordem):
//   1. Feature flag global TOM_VOICE_ENABLED=true
//   2. Whitelist por phone (TOM_VOICE_ALLOWLIST CSV, vazio = todos)
//   3. Cap diário (voice_message_log)
//   4. NUNCA quando: relay, operacional (TASK_UPDATE/EVENT), cobrança,
//      DND on, mensagem de erro
//   5. SEMPRE quando: user pediu explícito ("manda áudio")
//   6. PROBABILÍSTICO: celebração (70%), áudio curto afetivo (50%),
//      ritual matinal segunda-feira (40%)

const VOICE_DAILY_CAP = 10;

function shouldSendVoice(collab, userText, replyText, context = {}) {
  // ---- Gates ----
  const enabled = String(process.env.TOM_VOICE_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { send: false, reason: 'feature_disabled' };

  const allowlist = String(process.env.TOM_VOICE_ALLOWLIST || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const phoneClean = String(collab.phone || '').replace(/\D/g, '');
  if (allowlist.length > 0 && !allowlist.some(a => a.replace(/\D/g, '') === phoneClean)) {
    return { send: false, reason: 'not_in_allowlist' };
  }

  const reply = String(replyText || '');
  const user = String(userText || '').toLowerCase();

  // Pedido explícito vem ANTES do opt-out (caso Rose 10/06): voice_enabled=false
  // significa "nunca áudio ESPONTÂNEO", mas se a pessoa PEDIU áudio neste turno,
  // atende — equivale funcionalmente a "me pergunta antes de mandar áudio".
  const userAskedVoice = /\b(responde\s+por\s+[aá]udio|manda\s+um\s+[aá]udio|me\s+manda\s+(?:um\s+)?[aá]udio|fala\s+pra\s+mim|com\s+a\s+sua\s+voz|gostaria\s+de\s+ouvir)\b/i.test(user);

  // Sprint VoiceToggle: opt-out individual. Quando a pessoa desliga (via PWA
  // Configurações ou comando "para de mandar áudio"), TOM passa a responder
  // só por texto — exceto pedido explícito acima.
  if (collab && collab.voice_enabled === false && !userAskedVoice) {
    return { send: false, reason: 'user_opt_out' };
  }

  if ((context.voiceCountToday || 0) >= VOICE_DAILY_CAP) {
    return { send: false, reason: 'daily_cap_reached' };
  }

  // ---- NUNCA ----

  // Resposta vazia ou muito curta (<10 chars) — não vira áudio
  const cleanReply = reply.replace(/<<[^>]*>>[\s\S]*?<<END>>/g, '').replace(/<<[^>]*>>/g, '').trim();
  if (cleanReply.length < 10) return { send: false, reason: 'reply_too_short' };
  // Resposta muito longa — texto fica melhor pra ler
  if (cleanReply.length > 600) return { send: false, reason: 'reply_too_long' };

  // Tem marker operacional → texto fica registrado
  if (/<<(TASK_UPDATE|TASK_TO_HABIT|EVENT_CREATE|EVENT_UPDATE|COORDINATION_REQUEST|PROJECT_CREATE|PROJECT_APPROVE|PROJECT_REJECT|ANNOUNCEMENT|HABIT_ACTION|INVENTORY_ACTION|CHECKPOINT_BATCH|WEEKLY_PLAN|DND_SET|PREFS_UPDATE|SCHOOL_EVENT_ACTION|MEMORY_SAVE|SHOP_ACTION|CHECKLIST_ACTION)>>/i.test(reply)) {
    return { send: false, reason: 'has_operational_marker' };
  }

  // Relay (recado pra outra pessoa) — texto puro
  if (context.isRelay) return { send: false, reason: 'is_relay' };

  // Cobrança / lembrete / prazo — texto fica registrado pra consulta
  if (/\b(lembra|lembrete|prazo|cobr|atras|venc|deadline)\b/i.test(reply)) {
    return { send: false, reason: 'reminder_or_overdue' };
  }

  // Erro / pedido de clarificação
  if (/\b(n[aã]o\s+entendi|n[aã]o\s+consegui|tive\s+um\s+problema|erro|tenta\s+de\s+novo|reformula|pode\s+repetir)\b/i.test(reply)) {
    return { send: false, reason: 'error_or_clarification' };
  }

  // User pediu silêncio / DND
  if (context.userInDND) return { send: false, reason: 'user_in_dnd' };

  // ---- SEMPRE ----

  // User pediu explícito (regex computada lá em cima, antes do opt-out)
  if (userAskedVoice) {
    return { send: true, reason: 'user_requested', prob: 1.0 };
  }

  // ---- PROBABILÍSTICO ----

  // Celebração — VOICE-CELEBRATION-FP (caso Rose 10/06): "parabéns" de passagem numa
  // resposta biográfica disparava áudio às 00:59. Agora exige DOIS sinais no reply
  // (palavra de conquista + emoji de festa) e NUNCA dispara quando o user fez uma
  // pergunta informativa (resposta a pergunta = informação, não celebração).
  const celebWordRe = /\b(parab[eé]ns|incr[ií]vel|arrasou|mandou\s+bem|que\s+show|que\s+demais|sensacional|fechou|bateu\s+a\s+meta|conseguiu|vit[oó]ria|conquistou)\b/i;
  const celebEmojiRe = /🎉|🏆|🚀|🔥|🥳|👏/;
  const userAskedInfo = /\?\s*$/.test(user.trim()) || /^(o\s+que|que|quem|qual|quais|quando|onde|como|por\s*qu[eê]|cad[eê])\b/i.test(user.trim());
  if (celebWordRe.test(reply) && celebEmojiRe.test(reply) && !userAskedInfo) {
    if (Math.random() < 0.7) return { send: true, reason: 'celebration', prob: 0.7 };
    return { send: false, reason: 'celebration_dice_lost' };
  }

  // User mandou áudio curto e afetivo — reciprocidade
  if (context.isAudioMessage && cleanReply.length < 150) {
    if (Math.random() < 0.5) return { send: true, reason: 'audio_reciprocity', prob: 0.5 };
    return { send: false, reason: 'reciprocity_dice_lost' };
  }

  // Ritual matinal de briefing pessoal — só segunda, 40% chance
  if (context.isRitual && /briefing/i.test(String(context.ritualType || ''))) {
    const isMonday = new Date().getDay() === 1; // 0=domingo
    if (isMonday && Math.random() < 0.4) {
      return { send: true, reason: 'monday_briefing', prob: 0.4 };
    }
    return { send: false, reason: 'ritual_not_monday_or_dice' };
  }

  return { send: false, reason: 'no_trigger_matched' };
}

module.exports = { shouldSendVoice, VOICE_DAILY_CAP };
