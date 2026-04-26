// src/engine.js — Pipeline principal: webhook → identifica colaborador →
// constrói system prompt rico (SOUL+AGENTS+contexto Supabase) → chama Claude.
const collaboratorService = require('./services/collaborator');
const whatsapp = require('./services/whatsapp');
const ai = require('./ai/provider');
const { buildSystemPrompt, formatMessages } = require('./prompts/system');
const supabase = require('./supabase/client');

async function processMessage(phone, text, raw = {}) {
  const collab = await collaboratorService.findByPhone(phone);
  if (!collab) {
    await whatsapp.sendMessage(phone, 'Nao te encontrei no sistema. Fala com seu coordenador pra te cadastrar.');
    return;
  }
  console.log('[Engine] Mensagem de', collab.full_name);
  await logConversation(collab.id, 'inbound', text);

  // Constrói o system prompt completo: SOUL.md + AGENTS.md + perfil + memória + preferências + tarefas + notificações.
  const { systemPrompt, ctx } = await buildSystemPrompt(collab);
  console.log(`[Engine] system prompt size: ${systemPrompt.length} chars (memories=${ctx.memories.length}, tasks=${ctx.todayTasks.length}, notifs=${ctx.notifications.length})`);

  const msgs = formatMessages(ctx.recentMessages, text);
  const response = await ai.chat(systemPrompt, msgs);
  await whatsapp.sendMessage(phone, response.text);
  await logConversation(collab.id, 'outbound', response.text);
}

async function sendRitual(collaboratorId, ritualType) {
  const { data: collab } = await supabase
    .from('collaborators')
    .select('*, user_preferences(*), collaborator_profiles(*)')
    .eq('id', collaboratorId).single();
  if (!collab?.is_active) return;

  const { systemPrompt } = await buildSystemPrompt(collab);
  console.log(`[Engine] ritual=${ritualType} system prompt size: ${systemPrompt.length} chars`);

  const instruction = getRitualInstruction(ritualType, collab);
  const response = await ai.chat(systemPrompt, [{ role: 'user', content: instruction }]);
  await whatsapp.sendMessage(collab.phone, response.text);
  await logConversation(collab.id, 'outbound', response.text);

  const today = new Date().toISOString().split('T')[0];
  await supabase.from('ritual_logs').upsert({
    collaborator_id: collaboratorId,
    ritual_type: ritualType,
    reference_date: today,
    status: 'sent',
    sent_at: new Date().toISOString(),
  }, { onConflict: 'collaborator_id,ritual_type,reference_date' });
}

function getRitualInstruction(type, collab) {
  const name = collab.full_name.split(' ')[0];
  const p = collab.user_preferences;
  if (type === 'daily_briefing') return `Gere o briefing de trabalho do dia pra ${name}. Liste as top ${p?.max_daily_tasks || 3} tarefas priorizadas por Eisenhower. Intensidade: ${p?.coaching_intensity || 'normal'}.`;
  if (type === 'daily_closing') return `Gere o fechamento do dia pra ${name}. Pergunte quais tarefas foram feitas e se surgiu demanda nova.`;
  if (type === 'weekly_planning') return `Gere o planejamento semanal pra ${name}. Mostre pendencias e pergunte quais sao as entregas da semana.`;
  return `Ola ${name}, como posso te ajudar?`;
}

async function logConversation(collaboratorId, direction, content) {
  await supabase.from('conversation_history').insert({
    collaborator_id: collaboratorId,
    direction,
    message_type: 'text',
    content,
  });
}

module.exports = { processMessage, sendRitual };
