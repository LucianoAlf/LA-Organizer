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

async function applyGroupChatTaskActions({ supabase, groupId, senderCollabId, actions }) {
  const created = [];
  const updated = [];
  const completed = [];
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
        // (recorrente NUNCA entra no dedup-update: materialização é caminho próprio.)
        const dup = recur ? null : findDuplicate(title);
        if (dup) {
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
        const { data: found } = await supabase
          .from('tasks')
          .select('id, title')
          .eq('assigned_group_id', groupId)
          .neq('status', 'done')
          .ilike('title', title)
          .limit(1);
        const target = (found || [])[0];
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
      } else {
        failed.push({ action: a, why: 'unsupported_action' });
      }
    } catch (err) {
      failed.push({ action: a, why: err.message });
    }
  }

  return { created, updated, completed, failed };
}

module.exports = { applyGroupChatTaskActions, titleSimilarity };
