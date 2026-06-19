// src/services/group-chat-tasks.js
// Chat de grupo Fase 2 — applier mínimo de tarefas do POOL do grupo.
// NÃO usa o applyTaskActions do WhatsApp (evita lembretes/cascata no zap).
//
// Anti-duplicação (GROUPCHAT-TASK-DUP-WEEKDAY, 12/06): o LLM reemite `create`
// quando a pessoa CORRIGE/acrescenta algo da tarefa recém-criada ("é dia 15 e não
// 16", "coloca pra Anne também"). Sem dedup, cada mensagem virava uma tarefa nova
// quase-idêntica (3x "Anne separar cheque…"). Aqui: antes de inserir, procuramos no
// pool RECENTE do grupo (24h) uma tarefa de título muito parecido (Jaccard de tokens
// normalizados ≥ THRESHOLD) e, se achar, ATUALIZAMOS no lugar (due_date/remind_at)
// em vez de criar outra. Resolve o caso de correção e o de paráfrase do mesmo pedido.

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // só dedup contra tarefas recentes (mesma conversa)
const SIM_THRESHOLD = 0.7;                    // Jaccard mínimo p/ considerar "mesma tarefa"
const _STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'para', 'pra', 'pro', 'que', 'esse', 'essa', 'esses', 'essas', 'um', 'uma', 'no', 'na', 'em', 'com', 'ao', 'aos', 'à', 'às', 'the']);

// Conjunto de tokens normalizados (minúsculo, sem acento, sem pontuação, sem stopword).
function _titleTokens(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos (diacríticos combinantes)
      .replace(/[^a-z0-9\s]/g, ' ')                      // pontuação → espaço
      .split(/\s+/)
      .filter((w) => w && !_STOPWORDS.has(w))
  );
}

// Similaridade de Jaccard entre dois conjuntos de tokens (0..1).
function titleSimilarity(a, b) {
  const A = a instanceof Set ? a : _titleTokens(a);
  const B = b instanceof Set ? b : _titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Dado os candidatos casados por título (mãe-instância e/ou molde recorrente),
// retorna a INSTÂNCIA a operar — NUNCA o molde (recurrence_rule != null). Cancelar
// ou concluir o molde mata a série inteira: o materializador (materializeAll) pula
// molde cancelado/concluído, então nunca mais regenera (caso Conciliação de Cartões/
// Rose 17/06). Rotina sempre mira a instância visível; parar a série é ação à parte.
function pickInstanceTarget(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const instances = list.filter((r) => r && r.recurrence_rule == null);
  return instances[0] || null;
}

// Dado candidatos por título, acha o MOLDE da série (recurrence_rule != null). Pura.
// Usado por ENCERRAR SÉRIE (ação deliberada): aí sim a gente quer o molde, não a instância.
function resolveSeriesTemplate(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.find((r) => r && r.recurrence_rule != null) || null;
}

// ── Dedup de PACOTE (anti-churn do <<TASK_GROUP>>) ──────────────────────────────
// O LLM reemite `create` quando a pessoa "ajusta" um pacote que já existe ("coloca a
// Anne também", "muda o lembrete"). Sem dedup, cada reemissão criava uma GERAÇÃO inteira
// nova (3x "Conciliação de Cartões" no banco — caso Rose). Estes helpers (puros) deixam o
// engine MERGEAR só os itens novos no pacote visível em vez de duplicar.

// Pacote-mãe ativo mais parecido (>= threshold) com o título novo, ou null.
function findDuplicatePackage(mothers, newTitle, threshold = SIM_THRESHOLD) {
  const tok = _titleTokens(newTitle);
  if (!tok.size) return null;
  let best = null, bestSim = 0;
  for (const m of mothers || []) {
    const sim = titleSimilarity(tok, _titleTokens(m && m.title));
    if (sim > bestSim) { bestSim = sim; best = m; }
  }
  return bestSim >= threshold ? best : null;
}

// Resolve a INSTÂNCIA visível onde mergear: match já-instância → ela mesma; molde
// recorrente → instância ativa do ciclo corrente (menor due_date); pacote simples → ele.
function resolveVisibleInstance(mothers, dup) {
  if (!dup) return null;
  // template da série: o próprio (se for molde) ou o pai (se for instância).
  const tplId = dup.recurrence_rule ? dup.id : dup.recurrence_parent_id;
  if (!tplId) return dup; // pacote simples (não-recorrente)
  // SEMPRE o ciclo corrente (menor due_date) — determinístico, não depende de qual
  // mãe o findDuplicatePackage casou (template ou instância de qualquer mês).
  const insts = (mothers || []).filter((m) => m && m.recurrence_parent_id === tplId);
  insts.sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  return insts[0] || dup; // edge: molde sem instância materializada
}

// Subtarefas do create que NÃO existem como filha (por título parecido) — evita
// re-adicionar cartões que já estão no pacote.
function filterNewSubtasks(existingChildTitles, subtasks, threshold = SIM_THRESHOLD) {
  const existing = (existingChildTitles || []).map((t) => _titleTokens(t));
  return (subtasks || []).filter((s) => {
    const tok = _titleTokens(s && s.title);
    if (!tok.size) return false;
    return !existing.some((et) => titleSimilarity(tok, et) >= threshold);
  });
}

async function applyGroupChatTaskActions({ supabase, groupId, senderCollabId, actions }) {
  const created = [];
  const updated = [];
  const completed = [];
  const cancelled = [];
  const failed = [];

  // Candidatas a dedup: pool recente (24h) não-concluído do grupo. Falha → sem dedup
  // (degrada pra inserir; nunca lança). Inclui as criadas DENTRO deste mesmo batch.
  let candidates = [];
  try {
    const sinceISO = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const { data } = await supabase
      .from('tasks')
      .select('id, title, due_date')
      .eq('assigned_group_id', groupId)
      .neq('status', 'done')
      .gte('created_at', sinceISO);
    candidates = (data || []).map((t) => ({ id: t.id, title: t.title, due_date: t.due_date, tokens: _titleTokens(t.title) }));
  } catch (_) { candidates = []; }

  function findDuplicate(title) {
    const tok = _titleTokens(title);
    let best = null, bestSim = 0;
    for (const c of candidates) {
      const sim = titleSimilarity(tok, c.tokens);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    return bestSim >= SIM_THRESHOLD ? best : null;
  }

  for (const a of actions || []) {
    try {
      if (a.action === 'create') {
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }

        const wantsDue = typeof a.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.due_date) ? a.due_date : null;
        let remindISO = null;
        if (typeof a.remind_at === 'string' && a.remind_at.trim()) {
          const d = new Date(a.remind_at.trim());
          if (!Number.isNaN(d.getTime())) remindISO = d.toISOString();
        }
        const recur = (typeof a.recurrence_rule === 'string' && a.recurrence_rule.trim())
          ? a.recurrence_rule.trim().replace(/^RRULE:/i, '') : null;

        // ── Dedup: já existe tarefa quase-igual recente? Atualiza no lugar. ──
        const dup = findDuplicate(title);
        // (A) Recorrente: correção do mesmo assunto recente ("ajusta o lembrete dos Depósitos")
        // ATUALIZA a RRULE/due/remind da série existente e re-materializa, em vez de criar
        // outra série quase-idêntica (caso Rose 12/06). Caso GROUPCHAT-TASK-DUP-WEEKDAY estendido.
        if (dup && recur) {
          const patch = { recurrence_rule: recur };
          if (wantsDue) patch.due_date = wantsDue;
          if (remindISO) patch.remind_at = remindISO;
          const { data: upd } = await supabase.from('tasks').update(patch).eq('id', dup.id).select('id, title').maybeSingle();
          if (upd) {
            try {
              // limpa instâncias futuras não-concluídas e re-materializa com a regra nova.
              const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
              await supabase.from('tasks').update({ status: 'cancelled' })
                .eq('recurrence_parent_id', dup.id).neq('status', 'done').gte('due_date', todayYmd);
              const { materializeSeries } = require('./recurrence-engine');
              const { data: full } = await supabase.from('tasks').select('*').eq('id', dup.id).maybeSingle();
              if (full && full.recurrence_rule) await materializeSeries('tasks', full);
            } catch (e) { console.warn('[GroupChat] re-materialize:', e.message); }
            updated.push({ ...upd, changed: patch });
            continue;
          }
        }
        if (dup && !recur) {
          const patch = {};
          if (wantsDue && wantsDue !== dup.due_date) patch.due_date = wantsDue;
          if (remindISO) patch.remind_at = remindISO;
          if (Object.keys(patch).length) {
            const { data: upd } = await supabase.from('tasks').update(patch).eq('id', dup.id).select('id, title').maybeSingle();
            if (upd) { dup.due_date = wantsDue || dup.due_date; updated.push({ ...upd, changed: patch }); continue; }
          }
          // Nada novo a mudar (mesmo assunto, sem campo diferente) → trata como já-feito, sem dup.
          updated.push({ id: dup.id, title: dup.title, changed: {} });
          continue;
        }

        const row = { title, assigned_group_id: groupId, created_by: senderCollabId, status: 'pending' };
        if (wantsDue) row.due_date = wantsDue;
        // Lembrete agendado ("me lembra segunda…"): grava remind_at (o cron de deadlines
        // dispara o aviso quando remind_at <= now e ainda não foi enviado).
        if (remindISO) row.remind_at = remindISO;
        // Recorrência (Sprint 4): armazena a RRULE e materializa as instâncias logo após.
        if (recur) row.recurrence_rule = recur;

        const { data, error } = await supabase.from('tasks').insert(row).select('id, title').single();
        if (error) { failed.push({ action: a, why: error.message }); continue; }
        if (recur && data?.id) {
          try {
            const { materializeSeries } = require('./recurrence-engine');
            const { data: fullTpl } = await supabase.from('tasks').select('*').eq('id', data.id).maybeSingle();
            if (fullTpl) await materializeSeries('tasks', fullTpl);
          } catch (e) { console.warn('[GroupChat] materialize recorrência falhou:', e.message); }
        }
        created.push(data);
        // Entra como candidata pra dedup das próximas ações deste mesmo batch.
        if (data?.id) candidates.push({ id: data.id, title, due_date: wantsDue, tokens: _titleTokens(title) });
      } else if (a.action === 'complete') {
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        // Resolve por título dentro do pool do grupo, ainda não concluída.
        // Protege a série: conclui a INSTÂNCIA visível, NUNCA o molde recorrente
        // (concluir o molde mata a série — materializeAll não regenera molde done).
        const { data: found } = await supabase
          .from('tasks')
          .select('id, title, recurrence_rule')
          .eq('assigned_group_id', groupId)
          .neq('status', 'done')
          .ilike('title', title)
          .order('due_date', { ascending: true })
          .limit(5);
        const target = pickInstanceTarget(found);
        if (!target) { failed.push({ action: a, why: 'not_found_in_pool' }); continue; }
        // Anti-corrida: só marca se ainda não estava done.
        const patch = { status: 'done', completed_at: new Date().toISOString(), completed_by: senderCollabId };
        const { data: upd } = await supabase
          .from('tasks')
          .update(patch)
          .eq('id', target.id)
          .neq('status', 'done')
          .select('id, title');
        if (!upd || !upd.length) { failed.push({ action: a, why: 'race_lost' }); continue; }
        completed.push(target);
      } else if (a.action === 'cancel') {
        // TOM cancela tarefa do grupo a pedido. Alf LIBEROU (15/06) remover tarefa ANTIGA também
        // (antes só <24h). Escopo de segurança que PERMANECE: só tarefa do GRUPO (NUNCA pessoal) e
        // ainda aberta. Mãe de grupo → cancela as filhas. Cancel é soft (status=cancelled, reversível).
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        const { data: hit } = await supabase
          .from('tasks')
          .select('id, title, is_group, recurrence_rule')
          .eq('assigned_group_id', groupId)
          .neq('status', 'done')
          .neq('status', 'cancelled')
          .ilike('title', title)
          .order('created_at', { ascending: false })
          .limit(5);
        // Protege a série recorrente: cancela a INSTÂNCIA visível, NUNCA o molde.
        // Cancelar o template mata a série inteira — materializeAll pula molde
        // cancelado, então nunca mais regenera (caso Conciliação de Cartões/Rose 17/06).
        const target = pickInstanceTarget(hit);
        if (!target) { failed.push({ action: a, why: 'not_found_in_group' }); continue; }
        await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', target.id);
        if (target.is_group) {
          await supabase.from('tasks').update({ status: 'cancelled' }).eq('parent_task_id', target.id).neq('status', 'done');
        }
        cancelled.push({ id: target.id, title: target.title });
      } else if (a.action === 'reschedule') {
        // Editar PRAZO/lembrete de tarefa do grupo. Mira a INSTÂNCIA visível (nunca o molde).
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        const nd = typeof a.new_due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.new_due_date) ? a.new_due_date : null;
        let nr = null;
        if (typeof a.new_remind_at === 'string' && a.new_remind_at.trim()) {
          const d = new Date(a.new_remind_at.trim()); if (!Number.isNaN(d.getTime())) nr = d.toISOString();
        }
        if (!nd && !nr) { failed.push({ action: a, why: 'reschedule_no_date' }); continue; }
        const { data: found } = await supabase.from('tasks')
          .select('id, title, recurrence_rule').eq('assigned_group_id', groupId)
          .neq('status', 'done').neq('status', 'cancelled').ilike('title', title)
          .order('due_date', { ascending: true }).limit(5);
        const target = pickInstanceTarget(found);
        if (!target) { failed.push({ action: a, why: 'not_found_in_pool' }); continue; }
        const patch = {}; if (nd) patch.due_date = nd; if (nr) patch.remind_at = nr;
        const { data: upd } = await supabase.from('tasks').update(patch).eq('id', target.id).select('id, title').maybeSingle();
        if (upd) updated.push({ ...upd, changed: patch });
        else failed.push({ action: a, why: 'race_lost' });
      } else {
        failed.push({ action: a, why: 'unsupported_action' });
      }
    } catch (err) {
      failed.push({ action: a, why: err.message });
    }
  }

  return { created, updated, completed, cancelled, failed };
}

// Encerra a SÉRIE (ação deliberada, à parte da rotina): cancela o molde + as instâncias
// não-done (corrente + futuras). Reversível (soft) via reviveSeries. Done preservado (histórico).
// Molde cancelado → materializeAll (Balde A) já pula molde cancelado, então PARA de gerar.
async function endSeries({ supabase, templateId }) {
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', templateId);
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('recurrence_parent_id', templateId).neq('status', 'done');
  return { ended: true, id: templateId };
}

// Religa a série: reativa o molde CANCELADO (por título) + re-materializa (materializeSeries,
// NÃO materializeAll — mesmo helper do dedup-recur). Inverso do endSeries. Direto (constructivo).
async function reviveSeries({ supabase, groupId, title }) {
  const { data: hit } = await supabase.from('tasks')
    .select('id, title, recurrence_rule, status').eq('assigned_group_id', groupId)
    .eq('status', 'cancelled').ilike('title', String(title || '').trim())
    .order('created_at', { ascending: false }).limit(5);
  const tpl = (hit || []).find((r) => r && r.recurrence_rule != null);
  if (!tpl) return { revived: false, reason: 'not_found' };
  await supabase.from('tasks').update({ status: 'pending' }).eq('id', tpl.id);
  try {
    const { materializeSeries } = require('./recurrence-engine');
    const { data: full } = await supabase.from('tasks').select('*').eq('id', tpl.id).maybeSingle();
    if (full && full.recurrence_rule) await materializeSeries('tasks', full);
  } catch (e) { console.warn('[GroupChat] revive re-materialize:', e.message); }
  return { revived: true, id: tpl.id, title: tpl.title };
}

module.exports = {
  applyGroupChatTaskActions, titleSimilarity, pickInstanceTarget,
  findDuplicatePackage, resolveVisibleInstance, filterNewSubtasks,
  resolveSeriesTemplate, endSeries, reviveSeries,
};
