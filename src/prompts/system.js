// src/prompts/system.js — Carrega SOUL.md + AGENTS.md + contexto Supabase
// Constrói o system prompt rico do TOM antes de cada chamada ao Claude.
const fs = require('fs');
const path = require('path');
const supabase = require('../supabase/client');

const SOUL_DIR = path.join(__dirname, '..', '..', 'soul');

// Cache de arquivos do disco — invalidado por restart do PM2.
let _soul = null;
let _agents = null;
let _skillMemory = null;
let _skillProject = null;

function loadSoul() {
  if (_soul === null) {
    _soul = fs.readFileSync(path.join(SOUL_DIR, 'SOUL.md'), 'utf-8');
  }
  return _soul;
}

function loadAgents() {
  if (_agents === null) {
    const p = path.join(SOUL_DIR, 'AGENTS.md');
    _agents = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  }
  return _agents;
}

let _skillChecklist = null;

function loadAlwaysOnSkills() {
  if (_skillMemory === null) {
    const p = path.join(__dirname, '..', '..', 'skills', 'gestao-memoria.md');
    _skillMemory = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  }
  if (_skillProject === null) {
    const p = path.join(__dirname, '..', '..', 'skills', 'cadastro-projeto-5w2h.md');
    _skillProject = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  }
  if (_skillChecklist === null) {
    const p = path.join(__dirname, '..', '..', 'skills', 'checklist-tarefas.md');
    _skillChecklist = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  }
  return { memory: _skillMemory, project: _skillProject, checklist: _skillChecklist };
}

function loadSkill(name) {
  if (!name) return null;
  const p = path.join(__dirname, '..', '..', 'skills', name + '.md');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

// "Hoje" em America/Sao_Paulo — formato YYYY-MM-DD.
function todaySaoPaulo() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(now); // en-CA já entrega YYYY-MM-DD
}

function fmtTime(t) {
  if (!t) return '—';
  // time vem como "HH:MM:SS" — corta os segundos.
  return String(t).slice(0, 5);
}

function nonEmpty(s) {
  return s !== null && s !== undefined && String(s).trim() !== '';
}

/**
 * Busca o contexto completo do colaborador no Supabase.
 * Retorna um objeto com profile, memories, prefs, tasks, projects, notifications, recentMessages.
 */
async function fetchCollaboratorContext(collaborator) {
  const id = collaborator.id;
  const today = todaySaoPaulo();

  const [
    profileRes,
    memoriesRes,
    prefsRes,
    tasksRes,
    projectsRes,
    notificationsRes,
    historyRes,
  ] = await Promise.all([
    supabase.from('collaborator_profiles').select('*').eq('collaborator_id', id).maybeSingle(),
    supabase.from('collaborator_memory')
      .select('memory_type, content, importance, created_at')
      .eq('collaborator_id', id).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(20),
    supabase.from('user_preferences').select('*').eq('collaborator_id', id).maybeSingle(),
    supabase.from('tasks')
      .select('id, title, status, priority, eisenhower_quadrant, due_date, project_id, projects(name)')
      .eq('assigned_to', id).eq('due_date', today).neq('status', 'done')
      .order('eisenhower_quadrant', { ascending: true, nullsFirst: false }),
    supabase.from('project_members').select('project_id').eq('collaborator_id', id),
    supabase.from('notifications')
      .select('notification_type, title, body, created_at')
      .eq('collaborator_id', id).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('conversation_history')
      .select('direction, content, created_at')
      .eq('collaborator_id', id)
      .order('created_at', { ascending: false }).limit(20),
  ]);

  // Resolver projetos ativos
  let activeProjects = [];
  const memberRows = projectsRes.data || [];
  if (memberRows.length) {
    const ids = memberRows.map(m => m.project_id);
    const { data } = await supabase.from('projects')
      .select('name, status, progress_percent, end_date')
      .in('id', ids).in('status', ['planning', 'active']);
    activeProjects = data || [];
  }

  return {
    profile: profileRes.data || null,
    memories: memoriesRes.data || [],
    prefs: prefsRes.data || null,
    todayTasks: tasksRes.data || [],
    activeProjects,
    notifications: notificationsRes.data || [],
    recentMessages: (historyRes.data || []).reverse(),
    todayDate: today,
  };
}

/**
 * Compose the full system prompt: SOUL + AGENTS + contexto da pessoa.
 */
function composeSystemPrompt(collaborator, ctx) {
  const parts = [];
  parts.push(loadSoul());
  const agents = loadAgents();
  if (agents) {
    parts.push('\n\n---\n\n');
    parts.push(agents);
  }

  const skills = loadAlwaysOnSkills();
  if (skills.memory) {
    parts.push('\n\n---\n\n### 🧠 SKILL ATIVA: gestao-memoria (sempre ligada)\n');
    parts.push(skills.memory);
  }
  if (skills.project) {
    parts.push('\n\n---\n\n### 📁 SKILL ATIVA: cadastro-projeto-5w2h (use quando o gatilho aparecer)\n');
    parts.push(skills.project);
  }
  if (skills.checklist) {
    parts.push('\n\n---\n\n### 📋 SKILL ATIVA: checklist-tarefas (use quando o usuário fechar/reagendar/criar tarefa)\n');
    parts.push(skills.checklist);
  }

  parts.push('\n\n---\n\n## Contexto da pessoa que está falando com você AGORA\n');
  parts.push(`Nome: ${collaborator.full_name}\n`);
  parts.push(`Phone: ${collaborator.phone}\n`);
  const role = collaborator.role || '—';
  const fn = collaborator.function_title ? ` (${collaborator.function_title})` : '';
  parts.push(`Role: ${role}${fn}\n`);
  if (collaborator.unit) parts.push(`Unidade: ${collaborator.unit}\n`);

  // Perfil aprendido
  const p = ctx.profile;
  if (p) {
    const fields = [
      ['Estilo de comunicação', p.communication_style],
      ['Padrão de resposta', p.response_pattern],
      ['Melhor abordagem de coaching', p.best_coaching_approach],
      ['Pontos fortes', p.strengths],
      ['Áreas de desenvolvimento', p.growth_areas],
      ['Contexto pessoal', p.personal_context],
      ['Vocabulário', p.vocabulary_notes],
      ['Maturidade', p.maturity_level],
      ['Notas adicionais', p.profile_notes],
    ].filter(([, v]) => nonEmpty(v));
    if (fields.length) {
      parts.push('\n### Perfil aprendido\n');
      for (const [k, v] of fields) parts.push(`- **${k}:** ${v}\n`);
      if (p.total_interactions != null) parts.push(`- Total de interações: ${p.total_interactions}\n`);
      if (p.completion_rate_30d != null) parts.push(`- Taxa de conclusão (30d): ${p.completion_rate_30d}\n`);
    }
  }

  // Memória
  parts.push('\n### Memória relevante (top 20, mais recente primeiro)\n');
  if (!ctx.memories.length) {
    parts.push('Nenhuma memória registrada ainda.\n');
  } else {
    for (const m of ctx.memories) {
      parts.push(`- [${m.memory_type || 'geral'}] ${m.content} (importance: ${m.importance || '—'})\n`);
    }
  }

  // Preferências
  const pr = ctx.prefs;
  parts.push('\n### Preferências\n');
  if (!pr) {
    parts.push('Sem preferências configuradas — usar defaults.\n');
  } else {
    parts.push(`- Briefing pessoal: ${fmtTime(pr.personal_briefing_time)}\n`);
    parts.push(`- Briefing trabalho: ${fmtTime(pr.briefing_time)}\n`);
    parts.push(`- Fechamento: ${fmtTime(pr.closing_time)}\n`);
    parts.push(`- Intensidade da cobrança: ${pr.coaching_intensity || 'normal'}\n`);
    parts.push(`- Máx tarefas por dia: ${pr.max_daily_tasks || 3}\n`);
    parts.push(`- Timezone: ${pr.timezone || 'America/Sao_Paulo'}\n`);
  }

  // Tarefas do dia (com short-id de 8 chars — Claude usa SÓ pra emitir markers,
  // NUNCA expõe ao usuário. O engine resolve o prefixo pra UUID completo).
  parts.push(`\n### Tarefas do dia (${ctx.todayTasks.length})\n`);
  if (!ctx.todayTasks.length) {
    parts.push('Sem tarefas pra hoje.\n');
  } else {
    let i = 1;
    for (const t of ctx.todayTasks) {
      const proj = t.projects?.name || 'Sem projeto';
      const prio = t.priority || (t.eisenhower_quadrant ? `Q${t.eisenhower_quadrant}` : '—');
      const shortId = (t.id || '').slice(0, 8);
      parts.push(`${i}. [id=${shortId}] [${prio}] ${t.title} — ${proj} (status: ${t.status})\n`);
      i++;
    }
    parts.push('\n_Os `[id=...]` acima são internos — use-os SOMENTE em markers `<<TASK_UPDATE>>`. NUNCA mostre IDs ao usuário._\n');
  }

  // Projetos ativos
  if (ctx.activeProjects.length) {
    parts.push('\n### Projetos ativos\n');
    for (const pj of ctx.activeProjects) {
      parts.push(`- ${pj.name} — ${pj.progress_percent ?? 0}% (prazo: ${pj.end_date || '—'})\n`);
    }
  }

  // Notificações
  parts.push('\n### Notificações pendentes\n');
  if (!ctx.notifications.length) {
    parts.push('Nenhuma.\n');
  } else {
    for (const n of ctx.notifications) {
      parts.push(`- [${n.notification_type || 'geral'}] ${n.title}${n.body ? ' — ' + n.body : ''}\n`);
    }
  }

  parts.push('\n---\n\n');
  parts.push(`Agora responda à mensagem do(a) ${collaborator.full_name} seguindo as regras do AGENTS.md e a personalidade do SOUL.md. Se for primeira mensagem ou onboarding incompleto, segue o fluxo de onboarding. Responda SEMPRE em português brasileiro informal, curto, com no máximo 3 parágrafos e uma pergunta por vez.\n`);

  return parts.join('');
}

/**
 * Função pública: constrói o system prompt completo a partir do collaborator.
 * Faz as queries no Supabase e retorna { systemPrompt, ctx }.
 */
async function buildSystemPrompt(collaborator) {
  const ctx = await fetchCollaboratorContext(collaborator);
  const systemPrompt = composeSystemPrompt(collaborator, ctx);
  return { systemPrompt, ctx };
}

/**
 * Formata o histórico recente + mensagem atual como messages[] estilo OpenAI.
 */
function formatMessages(recent, currentText) {
  const msgs = (recent || []).map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content,
  }));
  msgs.push({ role: 'user', content: currentText });
  return msgs;
}

module.exports = { buildSystemPrompt, formatMessages, composeSystemPrompt, fetchCollaboratorContext };
