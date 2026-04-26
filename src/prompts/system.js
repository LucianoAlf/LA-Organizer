function buildSystemPrompt(ctx) {
  const { soul, memories, todayTasks, activeProjects, skill, collaborator } = ctx;
  const prefs = collaborator.user_preferences;
  const parts = [soul];
  parts.push('\n---\n## Regras\n- Respostas curtas (max 3 paragrafos). Uma pergunta por vez.\n- Pessoal e sagrado. Nunca expor pra hierarquia.\n- Responda SEMPRE em portugues brasileiro informal.');
  parts.push(`\n---\n## Quem voce esta atendendo\n**Nome:** ${collaborator.full_name}\n**Role:** ${collaborator.role}${collaborator.function_title?' — '+collaborator.function_title:''}\n**Intensidade:** ${prefs?.coaching_intensity||'normal'}`);
  if (memories.length) { parts.push('\n---\n## O que eu sei sobre essa pessoa'); memories.forEach(m=>parts.push(`- [${m.memory_type}] ${m.content}`)); }
  parts.push(`\n---\n## Hoje (${new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})})`);
  if (todayTasks.length) { parts.push('\n### Tarefas do dia'); todayTasks.forEach(t=>parts.push(`- ${t.status==='overdue'?'🔴':t.status==='done'?'✅':'○'} Q${t.eisenhower_quadrant||'?'} ${t.title} (${t.due_date})`)); }
  if (activeProjects.length) { parts.push('\n### Projetos ativos'); activeProjects.forEach(p=>parts.push(`- ${p.name} (${p.progress_percent}%) — prazo: ${p.end_date}`)); }
  if (skill) parts.push('\n---\n## SKILL ATIVA\n'+skill);
  return parts.join('\n');
}
function formatMessages(recent, current) {
  const msgs = recent.map(m=>({ role: m.direction==='inbound'?'user':'assistant', content: m.content }));
  msgs.push({ role: 'user', content: current });
  return msgs;
}
module.exports = { buildSystemPrompt, formatMessages };
