# Relatórios sob demanda no grupo — B1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** O TOM responde, no chat do grupo, um relatório determinístico e completo (agenda/tarefas/anotações/checklists do grupo) quando alguém pede — montado por código (nunca trunca/inventa).

**Architecture:** Motor por marker `<<GROUP_REPORT>>`. O TOM (group-chat) interpreta o pedido e emite o marker; `group-chat-engine.js` parseia, chama o builder determinístico `group-report-builder.js`, e insere um `group_chat_messages` `kind='report'` (mesmo formato do card de fechamento → o app renderiza e o bridge-out espelha no WhatsApp sem mudança).

**Tech Stack:** Node CJS (`_remote/src`), Supabase (service_role), `node:test`. Deploy por `scp ... tom:/opt/LA-Organizer/...` + `pm2 restart tom`.

**Convenções (LER ANTES):**
- `_remote` **não é git**; NÃO `git commit`. Backend deploy = `scp <arq> tom:/opt/LA-Organizer/<arq>` + `ssh tom "pm2 restart tom"`. O Stop hook commita no fim do turno.
- `src/` não passa por tsc → `node --check <arq>`. Testes puros: `node --test <arq.test.js>`.
- **Sem migration** (feature é só LEITURA).
- Grupo de teste: Financeiro `id=d95f63af-5032-4120-89f2-ca4c49684cbc`.
- Decisão de design: **agenda do grupo = TAREFAS do grupo com `due_date`** (events não é group-scoped). Tudo vem de `tasks` (`assigned_group_id`, `status`, `due_date`, `created_by`, `completed_by`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/services/group-report-builder.js` (criar) | Núcleo: `windowBounds`, `splitTasks`, `dueFlag`, `renderReportHtml` (puras) + `queryGroupTasks`, `queryGroupNotes`, `buildGroupReport` (I/O). |
| `src/services/group-report-builder.test.js` (criar) | Testes puros. |
| `src/services/group-chat-engine.js` (modificar) | Parsear `<<GROUP_REPORT>>` → chamar builder → inserir card `kind='report'`. |
| `src/services/group-chat-prompt.js` (modificar) | Documentar o marker (scope/window + "NUNCA escreva a lista"). |

---

## Task 1: `windowBounds` + `dueFlag` (puras) + testes

**Files:** Create `src/services/group-report-builder.js`; Create `src/services/group-report-builder.test.js`.

- [ ] **Step 1: Escrever os testes que falham**

`src/services/group-report-builder.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { windowBounds, dueFlag } = require('./group-report-builder');

// 12/06/2026 é uma SEXTA. now = 2026-06-12 15:00 BRT = 18:00Z.
const NOW = new Date('2026-06-12T18:00:00Z');

test('windowBounds(mes) = 1º ao último dia do mês em SP', () => {
  const b = windowBounds('mes', NOW);
  assert.equal(b.start, '2026-06-01T00:00:00-03:00');
  assert.equal(b.end, '2026-06-30T23:59:59-03:00');
  assert.equal(b.label, 'junho');
});
test('windowBounds(hoje) = dia local SP (sexta 12/06), não desloca após 21h', () => {
  const lateNight = new Date('2026-06-13T01:00:00Z'); // 22h BRT de 12/06
  const b = windowBounds('hoje', lateNight);
  assert.equal(b.start, '2026-06-12T00:00:00-03:00');
  assert.equal(b.end, '2026-06-12T23:59:59-03:00');
});
test('windowBounds(semana) = segunda a domingo da semana corrente', () => {
  const b = windowBounds('semana', NOW); // sexta 12/06 → semana 08/06 (seg) a 14/06 (dom)
  assert.equal(b.start, '2026-06-08T00:00:00-03:00');
  assert.equal(b.end, '2026-06-14T23:59:59-03:00');
});
test('windowBounds inválido cai em mes', () => {
  assert.equal(windowBounds('xpto', NOW).label, 'junho');
});
test('dueFlag marca atrasada / esta semana / vazio', () => {
  assert.equal(dueFlag('2026-06-10', '2026-06-12'), '🔴 atrasada');
  assert.equal(dueFlag('2026-06-14', '2026-06-12'), '⏰ esta semana');
  assert.equal(dueFlag('2026-07-20', '2026-06-12'), '');
  assert.equal(dueFlag(null, '2026-06-12'), '');
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd _remote && node --test src/services/group-report-builder.test.js
```
Esperado: FAIL (`Cannot find module './group-report-builder'`).

- [ ] **Step 3: Implementar o módulo (puras de data)**

`src/services/group-report-builder.js`:
```js
// src/services/group-report-builder.js
// B1 — Relatórios sob demanda no grupo. Builder DETERMINÍSTICO: o código monta as listas
// exatas; o LLM nunca escreve a lista. Fuso fixo America/Sao_Paulo = UTC-3 (Brasil sem
// horário de verão desde 2019), então usamos offset literal -03:00 (sem toISOString().slice).

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Y-M-D local de São Paulo para um Date.
function spYmd(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date); // 'YYYY-MM-DD'
}

// Soma dias a um 'YYYY-MM-DD' (UTC-safe via meio-dia).
function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Dia da semana (0=Dom..6=Sáb) de um 'YYYY-MM-DD' em SP (usa meio-dia pra não virar o dia).
function weekdayYmd(ymd) {
  return new Date(`${ymd}T12:00:00-03:00`).getUTCDay();
}

// Janela em SP. Retorna { start, end (ISO com -03:00), label }. Default = mes.
function windowBounds(window, now) {
  const today = spYmd(now); // 'YYYY-MM-DD' local SP
  const [y, m] = today.split('-');
  if (window === 'hoje') {
    return { start: `${today}T00:00:00-03:00`, end: `${today}T23:59:59-03:00`, label: 'hoje' };
  }
  if (window === 'semana') {
    const dow = weekdayYmd(today);           // 0=Dom..6=Sáb
    const back = dow === 0 ? 6 : dow - 1;     // dias até a segunda
    const monday = addDaysYmd(today, -back);
    const sunday = addDaysYmd(monday, 6);
    return { start: `${monday}T00:00:00-03:00`, end: `${sunday}T23:59:59-03:00`, label: 'esta semana' };
  }
  // mes (default)
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  const dd = String(lastDay).padStart(2, '0');
  return { start: `${y}-${m}-01T00:00:00-03:00`, end: `${y}-${m}-${dd}T23:59:59-03:00`, label: MESES[Number(m) - 1] };
}

// Marca o prazo de uma tarefa relativo a hoje (YMD): atrasada / esta semana / nada.
function dueFlag(dueYmd, todayYmd) {
  if (!dueYmd) return '';
  if (dueYmd < todayYmd) return '🔴 atrasada';
  if (dueYmd <= addDaysYmd(todayYmd, 7)) return '⏰ esta semana';
  return '';
}

module.exports = { windowBounds, dueFlag, spYmd, addDaysYmd };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd _remote && node --test src/services/group-report-builder.test.js
```
Esperado: PASS (5/5).

---

## Task 2: `splitTasks` + `renderReportHtml` (puras) + testes

**Files:** Modify `src/services/group-report-builder.js`; `src/services/group-report-builder.test.js`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `.test.js`:
```js
const { splitTasks, renderReportHtml } = require('./group-report-builder');

test('splitTasks separa com prazo (ordenado) e sem prazo', () => {
  const tasks = [
    { title: 'B', due_date: '2026-06-20', responsavel: 'Rose' },
    { title: 'A', due_date: '2026-06-10', responsavel: null },
    { title: 'C', due_date: null, responsavel: 'Ana' },
  ];
  const r = splitTasks(tasks);
  assert.deepEqual(r.comPrazo.map((t) => t.title), ['A', 'B']); // ordenado por due_date
  assert.deepEqual(r.semPrazo.map((t) => t.title), ['C']);
});
test('renderReportHtml monta card com h3+emoji e (nada) em seção vazia', () => {
  const html = renderReportHtml({
    groupName: 'Financeiro', windowLabel: 'junho',
    sections: [
      { emoji: '📅', title: 'Agenda', items: ['10/06 — Pagar boleto (Rose)'] },
      { emoji: '📝', title: 'Anotações', items: [] },
    ],
  });
  assert.match(html, /<h3>📅 Agenda/);
  assert.match(html, /<li>10\/06 — Pagar boleto \(Rose\)<\/li>/);
  assert.match(html, /<h3>📝 Anotações/);
  assert.match(html, /\(nada no período\)/);
  assert.ok(!/undefined/.test(html));
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd _remote && node --test src/services/group-report-builder.test.js
```
Esperado: FAIL (`splitTasks is not a function`).

- [ ] **Step 3: Implementar splitTasks + renderReportHtml**

Em `src/services/group-report-builder.js`, antes do `module.exports`, adicionar:
```js
// Separa tarefas em com-prazo (ordenadas por due_date) e sem-prazo.
function splitTasks(tasks) {
  const comPrazo = (tasks || []).filter((t) => t.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const semPrazo = (tasks || []).filter((t) => !t.due_date);
  return { comPrazo, semPrazo };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Card HTML. sections: [{ emoji, title, items: [string] }]. Seção vazia → "(nada no período)".
function renderReportHtml({ groupName, windowLabel, sections }) {
  const blocks = (sections || []).map((s) => {
    const body = (s.items && s.items.length)
      ? `<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
      : `<p>(nada no período)</p>`;
    return `<h3>${s.emoji} ${esc(s.title)}</h3>${body}`;
  }).join('');
  return `<div><h3>📊 Relatório do ${esc(groupName)} — ${esc(windowLabel)}</h3>${blocks}</div>`;
}

module.exports = { windowBounds, dueFlag, spYmd, addDaysYmd, splitTasks, renderReportHtml };
```
(Substitui o `module.exports` anterior — agora exporta tudo.)

- [ ] **Step 4: Rodar e ver passar**

```bash
cd _remote && node --test src/services/group-report-builder.test.js
```
Esperado: PASS (7/7).

---

## Task 3: `queryGroupTasks` + `buildGroupReport` (I/O) + agenda/tarefas

**Files:** Modify `src/services/group-report-builder.js`.

- [ ] **Step 1: Confirmar colunas de `tasks` (nome do responsável)**

MCP `execute_sql` (projeto `cesnbnrynvxvgdhfmaua`):
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='tasks'
  and column_name in ('assigned_group_id','status','due_date','title','created_by','completed_by');
```
Esperado: as 6 colunas. (Responsável = `completed_by` se concluída, senão `created_by`; resolver nome via `collaborators`.)

- [ ] **Step 2: Implementar queryGroupTasks + buildGroupReport**

Em `src/services/group-report-builder.js`, antes do `module.exports`, adicionar:
```js
// Lê TODAS as tarefas abertas do grupo (sem limit que trunque). Resolve nome do responsável.
async function queryGroupTasks(supabase, groupId) {
  const { data } = await supabase.from('tasks')
    .select('id, title, due_date, status, created_by, ' +
            'creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
    .eq('assigned_group_id', groupId).neq('status', 'done')
    .order('due_date', { ascending: true, nullsFirst: false });
  return (data || []).map((t) => ({
    title: t.title,
    due_date: t.due_date,
    responsavel: t.creator?.preferred_name || t.creator?.full_name || null,
  }));
}

// Item de tarefa formatado: "12/06 ⏰ esta semana — Título (Resp)".
function taskLine(t, todayYmd) {
  const d = t.due_date ? `${t.due_date.slice(8, 10)}/${t.due_date.slice(5, 7)}` : '';
  const flag = dueFlag(t.due_date, todayYmd);
  const resp = t.responsavel ? ` (${t.responsavel})` : '';
  return `${[d, flag].filter(Boolean).join(' ')}${d || flag ? ' — ' : ''}${t.title}${resp}`.trim();
}

// Monta o relatório. scope ∈ agenda|tarefas|anotacoes|checklists|tudo. Degrada gracioso.
async function buildGroupReport({ supabase, groupId, scope = 'tudo', window = 'mes', now = new Date() }) {
  const bounds = windowBounds(window, now);
  const todayYmd = spYmd(now);
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', groupId).maybeSingle();
  const groupName = g?.name || 'grupo';

  let tasks = [];
  try { tasks = await queryGroupTasks(supabase, groupId); } catch (e) { console.error('[Report] tasks err:', e.message); }
  const { comPrazo, semPrazo } = splitTasks(tasks);
  // "agenda" = tarefas datadas DENTRO da janela (cronológico).
  const agenda = comPrazo.filter((t) => t.due_date >= bounds.start.slice(0, 10) && t.due_date <= bounds.end.slice(0, 10));

  const sections = [];
  const want = (s) => scope === 'tudo' || scope === s;
  if (want('agenda')) sections.push({ emoji: '📅', title: `Agenda (${bounds.label})`, items: agenda.map((t) => taskLine(t, todayYmd)) });
  if (want('tarefas')) {
    sections.push({ emoji: '✅', title: 'Tarefas com prazo', items: comPrazo.map((t) => taskLine(t, todayYmd)) });
    sections.push({ emoji: '🗓️', title: 'Tarefas sem prazo', items: semPrazo.map((t) => taskLine(t, todayYmd)) });
  }
  if (want('anotacoes')) {
    let notes = [];
    try { notes = await queryGroupNotes(supabase, groupId); } catch (e) { console.error('[Report] notes err:', e.message); }
    sections.push({ emoji: '📝', title: 'Anotações', items: notes });
  }
  if (want('checklists')) {
    let cl = [];
    try { cl = await queryGroupChecklists(supabase, groupId); } catch (e) { console.error('[Report] checklists err:', e.message); }
    sections.push({ emoji: '☑️', title: 'Checklists', items: cl });
  }
  return { html: renderReportHtml({ groupName, windowLabel: bounds.label, sections }) };
}
```

> NOTA: `queryGroupNotes` e `queryGroupChecklists` são implementadas na Task 4. Pra esta task compilar, adicione stubs temporários `async function queryGroupNotes(){return []}` e `async function queryGroupChecklists(){return []}` ANTES de `buildGroupReport` (a Task 4 troca o corpo). Exporte `buildGroupReport, queryGroupTasks, taskLine` no `module.exports`.

- [ ] **Step 3: Confirmar a FK `tasks_created_by_fkey`**

MCP `execute_sql`:
```sql
select conname from pg_constraint
where conrelid='public.tasks'::regclass and contype='f' and conname like '%created_by%';
```
Se o nome for diferente, ajuste o embed `creator:collaborators!<fk>(...)` no Step 2.

- [ ] **Step 4: Syntax + testes (puras seguem passando)**

```bash
cd _remote && node --check src/services/group-report-builder.js && node --test src/services/group-report-builder.test.js
```
Esperado: syntax OK + 7/7 PASS.

---

## Task 4: `queryGroupNotes` + `queryGroupChecklists` (best-effort)

**Files:** Modify `src/services/group-report-builder.js`.

- [ ] **Step 1: Descobrir as tabelas reais de anotações e checklists do grupo**

MCP `execute_sql`:
```sql
select table_name from information_schema.tables
where table_schema='public' and (table_name ilike '%note%' or table_name ilike '%checklist%');
```
E para a tabela de notas encontrada (ex.: `notes`):
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='notes' order by ordinal_position;
```
Objetivo: achar como uma nota/checklist se liga a um grupo (`assigned_group_id`? `group_id`? `share_with`?).

- [ ] **Step 2: Implementar as duas queries (substituir os stubs da Task 3)**

Trocar os stubs por (ajustando o nome de tabela/coluna ao achado no Step 1; se NÃO houver vínculo claro com grupo, manter retornando `[]` — v1 degrada gracioso e entrega agenda+tarefas):
```js
// Anotações do grupo (best-effort): notas ligadas ao grupo. Retorna lista de strings curtas.
async function queryGroupNotes(supabase, groupId) {
  const { data } = await supabase.from('notes')
    .select('title, body, created_at')
    .eq('assigned_group_id', groupId)
    .order('created_at', { ascending: false }).limit(20);
  return (data || []).map((n) => {
    const snippet = String(n.body || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return n.title ? `${n.title}${snippet ? ' — ' + snippet : ''}` : snippet;
  }).filter(Boolean);
}

// Checklists operacionais do grupo (best-effort): progresso X/Y. Retorna lista de strings.
async function queryGroupChecklists(supabase, groupId) {
  const { data } = await supabase.from('checklist_completions')
    .select('id, checklist:checklists(name), done_count, total_count')
    .eq('assigned_group_id', groupId).limit(20);
  return (data || []).map((c) => `${c.checklist?.name || 'Checklist'} — ${c.done_count ?? 0}/${c.total_count ?? 0}`);
}
```
> Se o Step 1 mostrar que NÃO existe vínculo de nota/checklist com grupo, deixe as duas funções retornando `[]` com um comentário `// v1: sem vínculo de grupo no schema — fora do escopo` e siga. Agenda+tarefas são o núcleo.

- [ ] **Step 3: Syntax check**

```bash
cd _remote && node --check src/services/group-report-builder.js
```
Esperado: OK.

---

## Task 5: Wire do marker `<<GROUP_REPORT>>` no engine de grupo

**Files:** Modify `src/services/group-chat-engine.js`.

- [ ] **Step 1: Require do builder no topo**

Junto dos outros require de `src/services/group-chat-engine.js`:
```js
const { buildGroupReport } = require('./group-report-builder');
```

- [ ] **Step 2: Parsear o marker ANTES da inserção do reply de texto**

Em `processGroupChatMessage`, no bloco de parsing de markers (junto aos outros `<<...>>`), adicionar — e estes blocos usam o helper `stripBlock(regex)` que já existe no arquivo:
```js
    // <<GROUP_REPORT>> — relatório determinístico do grupo (B1). O LLM emite só o marker;
    // o código monta a lista exata e insere um card kind='report' separado.
    const reportMatch = reply.match(/<<GROUP_REPORT>>([\s\S]*?)<<END>>/i);
    if (reportMatch) {
      stripBlock(/<<GROUP_REPORT>>[\s\S]*?<<END>>/i);
      let scope = 'tudo', window = 'mes';
      try {
        const p = JSON.parse(reportMatch[1].trim());
        const SCOPES = ['agenda', 'tarefas', 'anotacoes', 'checklists', 'tudo'];
        const WINDOWS = ['hoje', 'semana', 'mes'];
        if (SCOPES.includes(p.scope)) scope = p.scope;
        if (WINDOWS.includes(p.window)) window = p.window;
      } catch (_) { /* default tudo/mes */ }
      try {
        const { html } = await buildGroupReport({ supabase, groupId, scope, window });
        await supabase.from('group_chat_messages').insert({
          group_id: groupId, sender_id: null, role: 'tom', kind: 'report', content: html, channel: 'app',
        });
        actions.push({ kind: 'report', status: 'ok', label: 'Relatório gerado' });
      } catch (e) {
        console.error('[GroupChat] relatório falhou:', e.message);
        actions.push({ kind: 'report', status: 'fail', label: 'Relatório', detail: 'não consegui montar' });
      }
    }
```
(Colocar este bloco junto aos outros parsers de marker, ANTES do trecho que monta `content`/insere o reply de texto em `kind:'text'`.)

- [ ] **Step 3: Syntax + deploy + restart**

```bash
cd _remote
node --check src/services/group-report-builder.js
node --check src/services/group-chat-engine.js
scp src/services/group-report-builder.js tom:/opt/LA-Organizer/src/services/group-report-builder.js
scp src/services/group-chat-engine.js tom:/opt/LA-Organizer/src/services/group-chat-engine.js
ssh tom "pm2 restart tom >/dev/null 2>&1 && echo RESTARTED"
```

---

## Task 6: Documentar o marker no prompt do grupo

**Files:** Modify `src/services/group-chat-prompt.js`.

- [ ] **Step 1: Adicionar a seção do marker**

Em `src/services/group-chat-prompt.js`, na lista de markers disponíveis (perto dos outros `### ...`), adicionar:
```
### Relatório do grupo (sob demanda)
Quando pedirem um resumo/relatório/listagem do que o grupo tem (agenda, tarefas, anotações,
checklists) — num período (hoje/semana/mês) — emita SÓ o marker:
<<GROUP_REPORT>>{"scope":"agenda|tarefas|anotacoes|checklists|tudo","window":"hoje|semana|mes"}<<END>>
- scope pelo pedido (ex.: "resumo da agenda"→agenda; "o que temos / tudo"→tudo). window: hoje/semana/mes (padrão mes).
- NUNCA escreva a lista você mesmo — o sistema monta com dados EXATOS do banco e mostra como card.
  Você só dá UMA linha de abertura ("Aqui o resumo da agenda de junho 👇") e o marker. Sem inventar itens.
```

- [ ] **Step 2: Syntax + deploy + restart**

```bash
cd _remote
node --check src/services/group-chat-prompt.js
scp src/services/group-chat-prompt.js tom:/opt/LA-Organizer/src/services/group-chat-prompt.js
ssh tom "pm2 restart tom >/dev/null 2>&1 && echo RESTARTED"
```

---

## Task 7: Validação E2E + known issue

**Files:** nenhum (validação).

- [ ] **Step 1: E2E no grupo Financeiro**

No chat do grupo (app ou WhatsApp), engajar o TOM e pedir:
1. "fala tom, faz um resumo da agenda do mês" → deve vir um **card** com as tarefas datadas de junho do grupo, em ordem de data, com 🔴/⏰ nos prazos.
2. "lista todas as tarefas em aberto" → card com com-prazo + sem-prazo, **todas** (conferir vs banco que nenhuma falta).
3. "me dá um resumo de tudo" → card com Agenda + Tarefas + Anotações + Checklists.

Conferir no banco que o card foi inserido e o TOM NÃO escreveu a lista na prosa:
```sql
select role, kind, left(content,60) as c, to_char(created_at,'HH24:MI:SS') as t
from group_chat_messages where group_id='d95f63af-5032-4120-89f2-ca4c49684cbc'
order by created_at desc limit 5;
```
Esperado: uma linha `kind='report'` (o card) + a linha de abertura `kind='text'` curta (sem a lista).

- [ ] **Step 2: Conferir a contagem (anti-truncamento)**

Comparar a quantidade de itens no card com o banco:
```sql
select count(*) from tasks where assigned_group_id='d95f63af-5032-4120-89f2-ca4c49684cbc' and status<>'done';
```
O card de "tarefas em aberto" deve listar exatamente esse total (com + sem prazo). Se faltar item → bug no builder, corrigir.

- [ ] **Step 3: Conferir o espelho no WhatsApp**

O card deve aparecer no grupo do WhatsApp como texto formatado (negrito nos títulos, • nos itens) — o `bridge-out`/`htmlToWhatsapp` já cuida disso. Sem ```html, sem bloco corrido.

- [ ] **Step 4: Registrar known issue**

MCP `execute_sql` INSERT em `tom_known_issues` com `codigo='GROUPCHAT-B1-RELATORIOS-ONDEMAND'`, area `'coordination'`, status `'corrigido'`, resumindo: relatório do grupo sob demanda via marker `<<GROUP_REPORT>>` + builder determinístico (lista exata, nunca trunca); agenda=tarefas datadas (events não é group-scoped); janela hoje/semana/mes fuso SP fixo -03:00. Sinal: "TOM pediram resumo do grupo e a lista veio incompleta/truncada / TOM escreveu a lista em vez do card".

---

## Self-Review (autor do plano)

- **Cobertura da spec:** windowBounds+dueFlag (T1) ✓; splitTasks+renderReportHtml (T2) ✓; queryGroupTasks+buildGroupReport+agenda/tarefas (T3) ✓; notes/checklists best-effort (T4) ✓; marker no engine (T5) ✓; doc no prompt (T6) ✓; e2e+anti-truncamento+espelho+known issue (T7) ✓. Anti-confabulação = builder determinístico + regra no prompt (T6). Render card reaproveita kind='report' (app + bridge-out sem mudança). Sem migration (só leitura). ✓
- **Sem placeholders:** todo step de código tem o código completo. Os 2 pontos de "confirmar no banco" (FK do created_by em T3; tabelas de notes/checklists em T4) têm instrução concreta de como confirmar + fallback gracioso (retorna []), não TODO aberto.
- **Consistência de nomes:** `windowBounds(window, now)`, `dueFlag(due, today)`, `splitTasks`, `renderReportHtml({groupName, windowLabel, sections})`, `buildGroupReport({supabase, groupId, scope, window})`, `queryGroupTasks/Notes/Checklists`, marker `<<GROUP_REPORT>>` {scope, window} — idênticos entre tasks. `kind='report'`, `channel='app'` consistentes com group-chat-closing/bridge-out.
