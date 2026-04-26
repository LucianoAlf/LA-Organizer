// src/engine.js — Pipeline principal: webhook → identifica colaborador →
// constrói system prompt rico (SOUL+AGENTS+contexto Supabase) → chama Claude.
// Phase 1: Onboarding state machine via marker block + ritual entry point.
const fs = require('fs');
const path = require('path');
const collaboratorService = require('./services/collaborator');
const whatsapp = require('./services/whatsapp');
const ai = require('./ai/provider');
const { buildSystemPrompt, formatMessages } = require('./prompts/system');
const supabase = require('./supabase/client');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

const ONBOARDING_DEFAULTS = {
  briefing_time: '08:00',
  closing_time: '19:00',
  planning_day: 0,
  coaching_intensity: 'normal',
};

function loadSkillFile(name) {
  const p = path.join(SKILLS_DIR, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

function appendOnboardingSection(systemPrompt) {
  const skill = loadSkillFile('onboarding.md');
  return systemPrompt + '\n\n---\n\n### ⚠️ ONBOARDING ATIVO\n' +
    'Esta pessoa NÃO terminou o onboarding (collaborators.onboarding_completed=false).\n' +
    'Conduza o fluxo definido abaixo. Faça UMA pergunta por mensagem. Ao final, quando o colaborador confirmar a recapitulação, emita o marcador `<<ONBOARDING_DONE>>...<<END>>` no formato exato. NÃO emita o marcador antes da confirmação final.\n\n' +
    skill + '\n';
}

function appendRitualSection(systemPrompt) {
  const skill = loadSkillFile('rituais-diarios.md');
  return systemPrompt + '\n\n---\n\n### 🎯 RITUAL EM EXECUÇÃO\n' +
    'A próxima mensagem do usuário é uma diretiva `[RITUAL: ...]` disparada pelo cron. Produza a mensagem do ritual seguindo o formato abaixo. Saída vai direto pro WhatsApp.\n\n' +
    skill + '\n';
}

// Procura o marcador <<ONBOARDING_DONE>>{json}<<END>> na resposta do modelo.
// Retorna { prefs, cleanText } ou null.
function parseOnboardingMarker(text) {
  if (!text) return null;
  const re = /<<ONBOARDING_DONE>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  let json = null;
  try {
    json = JSON.parse(m[1].trim());
  } catch (err) {
    return { malformed: true, cleanText: text.replace(re, '').trim() };
  }
  const prefs = {
    briefing_time: typeof json.briefing_time === 'string' ? json.briefing_time : ONBOARDING_DEFAULTS.briefing_time,
    closing_time: typeof json.closing_time === 'string' ? json.closing_time : ONBOARDING_DEFAULTS.closing_time,
    planning_day: Number.isInteger(json.planning_day) ? json.planning_day : ONBOARDING_DEFAULTS.planning_day,
    coaching_intensity: ['light', 'normal', 'hard'].includes(json.coaching_intensity)
      ? json.coaching_intensity
      : ONBOARDING_DEFAULTS.coaching_intensity,
  };
  // Normaliza HH:MM → HH:MM:SS para coluna time
  prefs.briefing_time = normalizeTime(prefs.briefing_time);
  prefs.closing_time = normalizeTime(prefs.closing_time);
  const cleanText = text.replace(re, '').trim();
  return { prefs, cleanText, malformed: false };
}

function normalizeTime(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  // tenta extrair HH e MM
  const m = s.match(/(\d{1,2})(?::(\d{2}))?/);
  if (m) {
    const hh = String(parseInt(m[1], 10)).padStart(2, '0');
    const mm = (m[2] || '00').padStart(2, '0');
    return `${hh}:${mm}:00`;
  }
  return null;
}

async function persistOnboarding(collaboratorId, prefs) {
  const { error: prefsErr } = await supabase
    .from('user_preferences')
    .upsert({
      collaborator_id: collaboratorId,
      briefing_time: prefs.briefing_time,
      closing_time: prefs.closing_time,
      planning_day: prefs.planning_day,
      coaching_intensity: prefs.coaching_intensity,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'collaborator_id' });
  if (prefsErr) {
    console.error('[Onboarding] Erro ao salvar user_preferences:', prefsErr.message);
    throw prefsErr;
  }
  const { error: collabErr } = await supabase
    .from('collaborators')
    .update({ onboarding_completed: true })
    .eq('id', collaboratorId);
  if (collabErr) {
    console.error('[Onboarding] Erro ao marcar onboarding_completed:', collabErr.message);
    throw collabErr;
  }
  console.log(`[Onboarding] Concluído pra ${collaboratorId}: ${JSON.stringify(prefs)}`);
}

async function processMessage(phone, text, raw = {}) {
  const collab = await collaboratorService.findByPhone(phone);
  if (!collab) {
    await whatsapp.sendMessage(phone, 'Nao te encontrei no sistema. Fala com seu coordenador pra te cadastrar.');
    return;
  }
  console.log('[Engine] Mensagem de', collab.full_name);
  await logConversation(collab.id, 'inbound', text);

  // Constrói o system prompt completo: SOUL.md + AGENTS.md + perfil + memória + preferências + tarefas + notificações.
  let { systemPrompt, ctx } = await buildSystemPrompt(collab);
  console.log(`[Engine] system prompt size: ${systemPrompt.length} chars (memories=${ctx.memories.length}, tasks=${ctx.todayTasks.length}, notifs=${ctx.notifications.length})`);

  const onboardingActive = collab.onboarding_completed === false;
  if (onboardingActive) {
    console.log('[Onboarding] Ativo — anexando skill ao system prompt');
    systemPrompt = appendOnboardingSection(systemPrompt);
  }

  const msgs = formatMessages(ctx.recentMessages, text);
  const response = await ai.chat(systemPrompt, msgs);
  let reply = response.text;

  // Se onboarding ativo, tenta consumir o marcador
  if (onboardingActive) {
    const parsed = parseOnboardingMarker(reply);
    if (parsed && parsed.malformed) {
      console.warn('[Onboarding] WARN: malformed marker, asking again');
      reply = parsed.cleanText || reply;
    } else if (parsed) {
      try {
        await persistOnboarding(collab.id, parsed.prefs);
        reply = parsed.cleanText || 'Configurado! Bora 🎵';
      } catch (err) {
        console.error('[Onboarding] Falha ao persistir:', err.message);
        // segue enviando o texto limpo, conversa continua
        reply = parsed.cleanText || reply;
      }
    }
  }

  await whatsapp.sendMessage(phone, reply);
  await logConversation(collab.id, 'outbound', reply);
}

async function sendRitual(collaboratorId, ritualType) {
  const { data: collab } = await supabase
    .from('collaborators')
    .select('*, user_preferences(*), collaborator_profiles(*)')
    .eq('id', collaboratorId).single();
  if (!collab?.is_active) return;

  let { systemPrompt } = await buildSystemPrompt(collab);
  systemPrompt = appendRitualSection(systemPrompt);
  console.log(`[Engine] ritual=${ritualType} system prompt size: ${systemPrompt.length} chars`);

  const directive = ritualToDirective(ritualType);
  const response = await ai.chat(systemPrompt, [{ role: 'user', content: directive }]);
  await whatsapp.sendMessage(collab.phone, response.text);
  await logConversation(collab.id, 'outbound', response.text);

  const today = todaySaoPaulo();
  await supabase.from('ritual_logs').upsert({
    collaborator_id: collaboratorId,
    ritual_type: ritualType,
    reference_date: today,
    status: 'sent',
    sent_at: new Date().toISOString(),
  }, { onConflict: 'collaborator_id,ritual_type,reference_date' });
  console.log(`[Ritual] ${ritualType} enviado pra ${collab.phone.slice(-4)}`);
  return response.text;
}

function ritualToDirective(type) {
  if (type === 'daily_briefing') return '[RITUAL: briefing_trabalho]';
  if (type === 'daily_closing') return '[RITUAL: fechamento]';
  if (type === 'weekly_planning') return '[RITUAL: planejamento_semanal]';
  return `[RITUAL: ${type}]`;
}

function todaySaoPaulo() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

async function logConversation(collaboratorId, direction, content) {
  await supabase.from('conversation_history').insert({
    collaborator_id: collaboratorId,
    direction,
    message_type: 'text',
    content,
  });
}

module.exports = { processMessage, sendRitual, parseOnboardingMarker, persistOnboarding };
