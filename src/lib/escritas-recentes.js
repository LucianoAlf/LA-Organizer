'use strict';
// escritas-recentes.js — REAFIRMACAO-SO-OLHA-TAREFA (Alf, 09/09/2026 19:19).
//
// O TOM criou o EVENTO "Mentoria de IA — Leonardo da Br[Ai]n" às 19:19:03. Vinte e três
// segundos depois, no turno seguinte, o Alf mandou o print do convite e o TOM respondeu
// "esse é o comprovante da Mentoria — e tá batendo certinho com o que já ficou na agenda".
//
// Aquilo era REAFIRMAÇÃO de uma escrita que acabara de acontecer. Mas o guard leu como promessa
// sem lastro, o auto-retry disparou, e nasceu uma TAREFA duplicando o evento — sem `due_time`,
// por isso ela aparecia na agenda sem horário na frente enquanto o compromisso ao lado tinha.
// O dono do produto olhou e perguntou por que o padrão estava diferente.
//
// A rede que existe pra isso — `restatesRecentWrite` (optimistic-confirm.js, 19/08) — funciona.
// O que ela não faz é ENXERGAR: as duas consultas que a alimentam (engine ~14720 e ~14986) leem
// `from('tasks')` e nada mais. Evento criado há segundos é invisível pra ela, então reafirmar um
// evento nunca conta como reafirmação.
//
// É o mesmo formato dos outros três consertos de hoje: o mecanismo certo existia, e faltava
// estar ligado numa das portas. Aqui o custo não é só alarme falso — é DADO DUPLICADO, que a
// pessoa tem de limpar à mão.
//
// Medido: um caso em 90 dias. Raro, e caro quando acontece.

/**
 * Junta escritas recentes de tarefa e de evento no formato que `restatesRecentWrite` espera.
 * O campo de tempo dos eventos é `start_at` — reafirmar evento cita data/hora, igual ao lembrete
 * (foi por isso que `remind_at` entrou junto do título em 24/08, caso Rafinha).
 */
function unificaEscritas(tarefas, eventos) {
  const out = [];
  for (const t of (Array.isArray(tarefas) ? tarefas : [])) {
    if (t && t.title) out.push({ title: t.title, remind_at: t.remind_at || null });
  }
  for (const e of (Array.isArray(eventos) ? eventos : [])) {
    if (e && e.title) out.push({ title: e.title, remind_at: e.start_at || e.remind_at || null });
  }
  return out;
}

/**
 * Tarefas E eventos que este colaborador escreveu desde `desdeIso`.
 * Degrada sozinha: se uma das consultas falhar, devolve o que a outra trouxe — a rede fica
 * menos sensível, nunca quebra o turno.
 */
async function buscarEscritasRecentes(supabase, collabId, desdeIso) {
  const [rt, re] = await Promise.all([
    supabase.from('tasks').select('title,remind_at')
      .or(`assigned_to.eq.${collabId},created_by.eq.${collabId}`)
      .gte('updated_at', desdeIso)
      .order('updated_at', { ascending: false }).limit(20)
      .then((r) => r.data || [], () => []),
    supabase.from('events').select('title,start_at')
      .or(`collaborator_id.eq.${collabId},created_by.eq.${collabId}`)
      .gte('updated_at', desdeIso)
      .order('updated_at', { ascending: false }).limit(20)
      .then((r) => r.data || [], () => []),
  ]);
  return unificaEscritas(rt, re);
}

module.exports = { unificaEscritas, buscarEscritasRecentes };
