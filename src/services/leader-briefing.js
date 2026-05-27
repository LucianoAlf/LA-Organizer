// src/services/leader-briefing.js — Sprint 29.2
//
// Monta briefing pré-1:1 pro director. Texto DETERMINÍSTICO (sem LLM) — toda
// a info vem direto do banco (tasks, events, leader_timeline) pra evitar
// alucinação. Usado pelo watcher pre-1on1-watcher 30min antes do evento.
//
// Formato canônico:
//   *Briefing pré-1:1 com {Nome}* — {role}
//   📋 Pendências do time dele: abertas / atrasadas / travadas 3+
//   ⚠️ Travadas (top 3 com 3+ cobranças)
//   🤝 Compromissos abertos da última 1:1 (top 3)
//   🗓️ Última 1:1 (resumo + dias atrás)
//   🔍 Padrões últimos 30 dias (bottlenecks)
//   ✅ Recados: tasks fechadas pelo líder na última semana

const supabase = require('./../supabase/client');
const timeline = require('./leader-timeline');

async function buildLeaderBriefing(leaderId) {
  if (!leaderId) return null;

  const { data: leader } = await supabase
    .from('collaborators')
    .select('id, full_name, preferred_name, role, function_title, function_role')
    .eq('id', leaderId)
    .maybeSingle();
  if (!leader) return null;

  const displayName = leader.preferred_name || (leader.full_name || '').split(' ')[0];
  const roleLabel = leader.function_title || _roleLabel(leader.role) || leader.function_role || '';

  // === Métricas operacionais (tasks do líder) ===
  const today = new Date().toISOString().slice(0, 10);
  const { data: openTasks } = await supabase
    .from('tasks')
    .select('id, title, due_date, status, coordination_request_count')
    .eq('assigned_to', leaderId)
    .eq('data_classification', 'real')
    .in('status', ['pending', 'in_progress', 'awaiting_confirmation'])
    .order('due_date', { ascending: true })
    .limit(50);

  const open = openTasks || [];
  const overdue = open.filter(t => t.due_date && t.due_date < today);
  const stuck = open.filter(t => (t.coordination_request_count || 0) >= 3);

  // === Tasks fechadas pelo líder na última semana (vitórias) ===
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: closedRecent } = await supabase
    .from('tasks')
    .select('id, title, completed_at')
    .eq('assigned_to', leaderId)
    .eq('status', 'done')
    .gte('completed_at', weekAgo)
    .order('completed_at', { ascending: false })
    .limit(5);

  // === Timeline ===
  const [last1on1, openCommitments, recentEvents] = await Promise.all([
    timeline.getLast1on1(leaderId),
    timeline.getOpenCommitments(leaderId),
    timeline.getRecent(leaderId, { limit: 30, sinceDays: 30 }),
  ]);

  // === Monta texto ===
  const lines = [];
  lines.push(`*Briefing pré-1:1 com ${displayName}*${roleLabel ? ` — ${roleLabel}` : ''}`);
  lines.push('');

  lines.push(`📋 *Pendências do time dele:*`);
  lines.push(`• Abertas: *${open.length}* • Atrasadas: *${overdue.length}* • Travadas (3+ cobranças): *${stuck.length}*`);

  if (stuck.length > 0) {
    lines.push('');
    lines.push(`⚠️ *Travadas (pra confrontar):*`);
    for (const t of stuck.slice(0, 3)) {
      lines.push(`• ${String(t.title).slice(0, 60)} _(cobrada ${t.coordination_request_count}x)_`);
    }
  }

  if (openCommitments.length > 0) {
    lines.push('');
    lines.push(`🤝 *Compromissos abertos da última 1:1:*`);
    for (const c of openCommitments.slice(0, 3)) {
      const summary = c.event_data?.summary || c.event_data?.key || '(sem descrição)';
      const when = _humanDate(c.occurred_at);
      lines.push(`• ${String(summary).slice(0, 80)} _(de ${when})_`);
    }
  }

  lines.push('');
  if (last1on1) {
    const days = Math.max(0, Math.round((Date.now() - new Date(last1on1.occurred_at).getTime()) / 86400000));
    const summary = last1on1.event_data?.summary || '(sem resumo registrado)';
    lines.push(`🗓️ *Última 1:1:* ${days === 0 ? 'hoje' : days === 1 ? 'ontem' : `${days} dias atrás`}`);
    if (summary && summary !== '(sem resumo registrado)') {
      lines.push(`_${String(summary).slice(0, 200)}_`);
    }
  } else {
    lines.push(`🆕 *Primeira 1:1* — sem histórico anterior.`);
  }

  // Bottlenecks detectados
  const bottlenecks = recentEvents.filter(e => e.event_type === 'bottleneck_detected').slice(0, 3);
  if (bottlenecks.length > 0) {
    lines.push('');
    lines.push(`🔍 *Padrões últimos 30 dias:*`);
    for (const b of bottlenecks) {
      const desc = b.event_data?.summary || b.event_data?.pattern || '(padrão sem descrição)';
      lines.push(`• ${String(desc).slice(0, 100)}`);
    }
  }

  // Vitórias recentes
  if ((closedRecent || []).length > 0) {
    lines.push('');
    lines.push(`✅ *Fechou na última semana (${closedRecent.length}):*`);
    for (const t of closedRecent.slice(0, 3)) {
      lines.push(`• ${String(t.title).slice(0, 60)}`);
    }
    if (closedRecent.length > 3) lines.push(`_+${closedRecent.length - 3} outras_`);
  }

  return lines.join('\n');
}

function _roleLabel(role) {
  const map = {
    director: 'Diretor', manager: 'Gerente',
    coordinator: 'Coordenador', collaborator: 'Colaborador',
  };
  return map[role] || role;
}

function _humanDate(iso) {
  if (!iso) return '?';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch { return '?'; }
}

module.exports = { buildLeaderBriefing };
