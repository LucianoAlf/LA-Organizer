# Parte 2 do Grupo-CRUD — Tarefas: Plano de Implementação

> Executar inline (TDD). Steps `- [ ]`. Spec: `docs/superpowers/specs/2026-06-19-grupo-tarefas-crud-tom.md`.

**Goal:** Reagendar tarefa + encerrar/religar série recorrente (encerrar = confirma+reversível) + aterrar o "Em aberto" do card na tabela viva.

**Architecture:** reschedule reusa `<<TASK_UPDATE>>` (estende o applier do grupo); ciclo de série = marker novo `<<TASK_SERIES>>` (group-only, parseado no engine do grupo); confirmação reusa `group_chat_pending_confirms` (op `end_series`) + pré-passo. Zero migration, zero toque em engine.js/materializeAll.

---

## Task 1: Funções de série + reschedule em `group-chat-tasks.js` (TDD)
**Files:** Modify `src/services/group-chat-tasks.js`; Test `src/services/group-chat-tasks.test.js`.

- [ ] **Step 1: Testes que falham** — `resolveSeriesTemplate`, reschedule no applier.

```js
// resolveSeriesTemplate(rows): retorna o MOLDE (recurrence_rule != null); senão null
// applyGroupChatTaskActions reschedule: muda due/remind da INSTÂNCIA; not_found_in_pool
```

- [ ] **Step 2: Rodar → FAIL.** `cd /d/la-organizer/_remote && node --test src/services/group-chat-tasks.test.js`

- [ ] **Step 3: Implementar**

```js
// Dado candidatos por título, acha o MOLDE da série (recurrence_rule != null).
function resolveSeriesTemplate(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.find((r) => r && r.recurrence_rule != null) || null;
}

// endSeries: cancela molde + instâncias não-done (corrente+futuras). Reversível (soft).
async function endSeries({ supabase, templateId }) {
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', templateId);
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('recurrence_parent_id', templateId).neq('status', 'done');
  return { ended: true, id: templateId };
}

// reviveSeries: reativa o molde cancelado + re-materializa (NÃO é materializeAll).
async function reviveSeries({ supabase, groupId, title }) {
  const { data: hit } = await supabase.from('tasks')
    .select('id, title, recurrence_rule, status').eq('assigned_group_id', groupId)
    .not('recurrence_rule', 'is', null).eq('status', 'cancelled').ilike('title', String(title || '').trim())
    .order('created_at', { ascending: false }).limit(5);
  const tpl = (hit || [])[0];
  if (!tpl) return { revived: false, reason: 'not_found' };
  await supabase.from('tasks').update({ status: 'pending' }).eq('id', tpl.id);
  try {
    const { materializeSeries } = require('./recurrence-engine');
    const { data: full } = await supabase.from('tasks').select('*').eq('id', tpl.id).maybeSingle();
    if (full && full.recurrence_rule) await materializeSeries('tasks', full);
  } catch (e) { console.warn('[GroupChat] revive re-materialize:', e.message); }
  return { revived: true, id: tpl.id, title: tpl.title };
}
```

No `applyGroupChatTaskActions`, antes do `else { unsupported_action }`, adicionar ramo reschedule:
```js
} else if (a.action === 'reschedule') {
  const title = (a.title || '').trim();
  if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
  const nd = typeof a.new_due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.new_due_date) ? a.new_due_date : null;
  let nr = null;
  if (typeof a.new_remind_at === 'string' && a.new_remind_at.trim()) {
    const d = new Date(a.new_remind_at.trim()); if (!Number.isNaN(d.getTime())) nr = d.toISOString();
  }
  if (!nd && !nr) { failed.push({ action: a, why: 'title_missing' }); continue; }
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
}
```
Exportar `resolveSeriesTemplate, endSeries, reviveSeries`.

- [ ] **Step 4: Rodar → PASS** + `node --check src/services/group-chat-tasks.js`.

---

## Task 2: Marker `<<TASK_SERIES>>` + pré-passo em `group-chat-engine.js`
**Files:** Modify `src/services/group-chat-engine.js`.

- [ ] **Step 1: Estender o pré-passo de confirmação** (Parte 1) p/ tratar `op:'end_series'`.

No bloco do pré-passo, trocar o filtro `.eq('op','delete_note')` por `.in('op', ['delete_note','end_series'])` e, no `verdict==='execute'`, ramificar por `pend.op`:
```js
if (verdict === 'execute') {
  if (pend.op === 'end_series') {
    await groupTasks.endSeries({ supabase, templateId: pend.target_id });
    await supabase.from('group_chat_pending_confirms').delete().eq('id', pend.id);
    return await postTomText(supabase, groupId, `Encerrei a série *${pend.summary}* — não gera mais tarefa nova. Pra voltar é só pedir "religa a série ${pend.summary}". ✅`);
  }
  // ... (delete_note como na Parte 1)
}
```
(`groupTasks` = `require('./group-chat-tasks')` no topo — já importado parcialmente; garantir `endSeries`.)

- [ ] **Step 2: Parsear `<<TASK_SERIES>>`** (ao lado do TASK_GROUP/GROUP_NOTE):
```js
const tsMatch = reply.match(/<<TASK_SERIES>>([\s\S]*?)<<END>>/i);
if (tsMatch) {
  stripBlock(/<<TASK_SERIES>>[\s\S]*?<<END>>/i);
  let p = null; try { p = JSON.parse(tsMatch[1].trim()); } catch (_) { p = null; }
  if (!p || (p.action !== 'end' && p.action !== 'revive')) {
    actions.push({ kind: 'task', status: 'fail', label: 'Série', detail: 'marker malformado' });
  } else if (p.action === 'end') {
    const { data: hit } = await supabase.from('tasks').select('id, title, recurrence_rule, recurrence_parent_id')
      .eq('assigned_group_id', groupId).neq('status', 'cancelled').ilike('title', String(p.title || '').trim()).limit(5);
    const tpl = groupTasks.resolveSeriesTemplate(hit) || (hit || []).map((r) => r.recurrence_parent_id).filter(Boolean)[0];
    let templateId = groupTasks.resolveSeriesTemplate(hit)?.id;
    if (!templateId) { const pid = (hit || []).find((r) => r.recurrence_parent_id)?.recurrence_parent_id; templateId = pid || null; }
    if (!templateId) { actions.push({ kind: 'task', status: 'fail', label: p.title || 'Série', detail: 'não achei essa série recorrente' }); }
    else {
      const { data: t } = await supabase.from('tasks').select('id, title').eq('id', templateId).maybeSingle();
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await supabase.from('group_chat_pending_confirms').upsert({ group_id: groupId, sender_collab_id: senderCollabId, op: 'end_series', target_id: templateId, summary: (t && t.title) || p.title, expires_at: expires }, { onConflict: 'group_id,sender_collab_id,op' });
      actions.push({ kind: 'task', status: 'pending', label: (t && t.title) || p.title, detail: '❓ confirmar encerramento da série' });
    }
  } else {
    const r = await groupTasks.reviveSeries({ supabase, groupId, title: p.title });
    actions.push({ kind: 'task', status: r.revived ? 'ok' : 'fail', label: p.title, detail: r.revived ? '♻️ série religada' : 'não achei essa série na lixeira' });
  }
}
```

- [ ] **Step 3: Fallback de prosa do pending** — em `buildTomContent`, o fallback de confirmação (Parte 1) já cobre `status:'pending'`; ajustar o texto p/ ser genérico (ficha OU série): se o label/detail indica série, perguntar pelo encerramento. (Manter simples: detalhe já diz "confirmar encerramento da série".)

- [ ] **Step 4: `node --check src/services/group-chat-engine.js`.**

---

## Task 3: Aterrar "Em aberto" em `group-chat-closing.js`
**Files:** Modify `src/services/group-chat-closing.js`.

- [ ] **Step 1:** após gerar `cardHtml` (resumo da IA), buscar tarefas vivas e anexar bloco determinístico:
```js
const { queryGroupTasks } = require('./group-report-builder');
let openBlock = '';
try {
  const tasks = await queryGroupTasks(supabase, group.id);
  if (tasks.length) {
    const items = tasks.slice(0, 12).map((t) => {
      const d = t.due_date ? `${t.due_date.slice(8,10)}/${t.due_date.slice(5,7)} — ` : '';
      return `<li>${d}${(t.title || '').replace(/[<>&]/g, '')}${t.responsavel ? ' ('+t.responsavel+')' : ''}</li>`;
    }).join('');
    openBlock = `<h3>✅ Em aberto (tarefas do grupo)</h3><ul>${items}</ul>`;
  } else { openBlock = `<h3>✅ Em aberto</h3><p>Nenhuma tarefa aberta no grupo.</p>`; }
} catch (e) { console.error('[closing] open tasks:', e.message); }
```
E no `systemPrompt` do card, trocar a instrução do bloco "Em aberto" para: **NÃO** gerar lista de tarefas no "Em aberto" (o sistema anexa a lista real); a IA só faz o "Resumo da sessão" + pendências conversacionais. Inserir `openBlock` no HTML final (antes da `<p>` de "Quer transformar…", via replace ou concatenação).

- [ ] **Step 2: `node --check`.**

---

## Task 4: Prompt em `group-chat-prompt.js`
- [ ] Documentar: reagendar tarefa do grupo = `<<TASK_UPDATE>>{"action":"reschedule","title":"<exato>","new_due_date":"YYYY-MM-DD"}` (ou new_remind_at). Encerrar/religar série = `<<TASK_SERIES>>{"action":"end"|"revive","title":"<série>"}` — `end` PERGUNTA confirmação; `revive` é direto. Distinguir "cancelar 1 tarefa" (TASK_UPDATE cancel) de "encerrar a SÉRIE" (TASK_SERIES end). `node --check`.

---

## Task 5: Deploy + smoke + registro
- [ ] Regressão: `node --test` nos 6 arquivos de group-chat/notes/report → verde.
- [ ] Deploy `scp` (group-chat-tasks/engine/closing/prompt) + `pm2 restart`. Log limpo.
- [ ] Smoke ao vivo (grupo scratch, série descartável): criar tarefa recorrente → `TASK_SERIES end` (via função) → conferir molde+futuras cancelled → `revive` → conferir re-materializado → limpar.
- [ ] Known issue `GROUPCHAT-TASKS-CRUD` + `GROUPCHAT-CLOSING-EMABERTO-CONFAB`. Memórias + task #224.
