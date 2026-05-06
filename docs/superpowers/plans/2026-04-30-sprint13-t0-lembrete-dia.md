# Sprint 13 — Lembrete no Dia do Evento (T0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar 4ª etapa de notificação de evento: lembrete às 09h BRT no dia do evento, para a mesma audiência da etapa T-1 (unidade ou escola toda).

**Architecture:** Mudança incremental sobre Fatia 2. Uma coluna nova em `school_events` (`notify_day_of boolean DEFAULT true`), um bloco novo em `buildEventAnnouncementsNode` (engine.js) e no helper `buildEventAnnouncements` (types.ts), checkbox nova no `EventoSheet`, chip novo no `AgendaEscolar`, e linha nova na skill TOM. O broadcaster não muda.

**Tech Stack:** Supabase MCP (migration), Node.js (engine.js), React + TypeScript (PWA).

**Spec:** `docs/superpowers/specs/2026-04-30-sprint13-fatia2-t0-lembrete-dia.md`

---

## Codebase Context

**`src/engine.js`** — função `buildEventAnnouncementsNode(ev, now)` (por volta de linha 564). Estrutura atual:
```js
const [y, m, d] = ev.event_date.split('-').map(Number);
const eventDateBR = `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
const timeStr = ev.start_time ? ` às ${ev.start_time.slice(0,5)}` : '';
const suffix = ev.location ? `, ${ev.location}` : '';
const T3 = new Date(Date.UTC(y, m-1, d-3, 12, 0, 0));
const T1 = new Date(Date.UTC(y, m-1, d-1, 12, 0, 0));
// ... if (ev.notify_leadership) { ... }
// ... if (ev.notify_school) { ... }
// ... if (ev.notify_unit) { ... }
return specs;
```

**`src/engine.js`** — função `applySchoolEventAction(collaborator, parsed)`. No branch `create`, faz INSERT em `school_events` com campos `notify_leadership`, `notify_school`, `notify_unit`. Adicionar `notify_day_of`.

**`web/src/types.ts`** — interface `SchoolEvent` com os 3 `notify_*` existentes. Função `buildEventAnnouncements(event, now)` replica a mesma lógica em TypeScript.

**`web/src/components/EventoSheet.tsx`** — 3 estados `notifyLeadership`, `notifySchool`, `notifyUnit`, 3 checkboxes. `canSave` valida `title.trim() && eventDate && hasNotification`. INSERT inclui os 3 `notify_*`.

**`web/src/screens/AgendaEscolar.tsx`** — chips identificados por prefix do body: `'📅 Novo evento:'`, `'📅 Em 3 dias:'`, `'📅 Amanhã:'`.

**`skills/eventos-institucionais.md`** — marker JSON tem `notify_leadership`, `notify_school`, `notify_unit`. Resumo de confirmação tem 3 linhas de plano.

**Supabase project:** `cesnbnrynvxvgdhfmaua`. Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` e `execute_sql`.

---

## File Structure

**Modified:**
- `supabase` — migration nova (via MCP)
- `D:\la-organizer\_remote\src\engine.js` — `buildEventAnnouncementsNode` + `applySchoolEventAction`
- `D:\la-organizer\_remote\web\src\types.ts` — `SchoolEvent` + `buildEventAnnouncements`
- `D:\la-organizer\_remote\web\src\components\EventoSheet.tsx` — estado + checkbox + INSERT
- `D:\la-organizer\_remote\web\src\screens\AgendaEscolar.tsx` — 4º chip
- `D:\la-organizer\_remote\skills\eventos-institucionais.md` — marker + resumo

---

## Task 1: DB Migration

- [ ] **Step 1: Aplicar migration**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` com project_id `cesnbnrynvxvgdhfmaua`, name `sprint13_t0_day_of`:

```sql
ALTER TABLE school_events
  ADD COLUMN IF NOT EXISTS notify_day_of boolean NOT NULL DEFAULT true;
```

- [ ] **Step 2: Verificar**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql`:

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'school_events' AND column_name = 'notify_day_of';
```

Expected: 1 row, `data_type = boolean`, `column_default = true`, `is_nullable = NO`.

---

## Task 2: Engine — `buildEventAnnouncementsNode` + `applySchoolEventAction`

**Files:** Modify `D:\la-organizer\_remote\src\engine.js`

- [ ] **Step 1: Localizar `buildEventAnnouncementsNode` em `engine.js`**

Grep por `buildEventAnnouncementsNode` no arquivo. Encontre o bloco `if (ev.notify_unit)` — a nova etapa vai logo depois dele.

- [ ] **Step 2: Adicionar bloco `notify_day_of` após o bloco `notify_unit`**

Imediatamente após o fechamento do bloco `if (ev.notify_unit) { ... }`, adicione:

```js
  if (ev.notify_day_of) {
    const T0 = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // 09h BRT = 12h UTC
    specs.push({
      body: `📅 Hoje: *${ev.title}* — ${eventDateBR}${timeStr}${suffix}`,
      audience: ev.unit ? { unidade: [ev.unit] } : { all: true },
      scheduled_at: T0 > now ? T0.toISOString() : null,
    });
  }
```

A variável `T0` usa as variáveis locais `y`, `m`, `d`, `eventDateBR`, `timeStr`, `suffix` já declaradas no topo da função — não redeclare.

- [ ] **Step 3: Localizar `applySchoolEventAction` create branch**

Grep por `notify_unit` dentro de `applySchoolEventAction`. Encontre o objeto de INSERT em `school_events` que já tem `notify_leadership`, `notify_school`, `notify_unit`. Adicione `notify_day_of: parsed.notify_day_of ?? true` ao mesmo objeto:

```js
// No INSERT de school_events — adicionar ao objeto existente:
notify_day_of: parsed.notify_day_of ?? true,
```

Não altere nenhum outro campo do INSERT.

- [ ] **Step 4: Verificar estaticamente**

Leia as linhas modificadas de `engine.js`. Confirme:
- O bloco `notify_day_of` em `buildEventAnnouncementsNode` usa `d` (não `d-1`, não `d-3`) para calcular `T0`
- `T0 > now ? T0.toISOString() : null` — catch-up correto
- `applySchoolEventAction` inclui `notify_day_of` no INSERT

---

## Task 3: PWA — types.ts + EventoSheet + AgendaEscolar

**Files:**
- Modify: `D:\la-organizer\_remote\web\src\types.ts`
- Modify: `D:\la-organizer\_remote\web\src\components\EventoSheet.tsx`
- Modify: `D:\la-organizer\_remote\web\src\screens\AgendaEscolar.tsx`

### types.ts

- [ ] **Step 1: Adicionar `notify_day_of` à interface `SchoolEvent`**

Encontre a interface `SchoolEvent` em `types.ts`. Adicione o campo após `notify_unit`:

```ts
notify_day_of: boolean;
```

- [ ] **Step 2: Adicionar 4ª etapa em `buildEventAnnouncements`**

Encontre a função `buildEventAnnouncements(event, now)`. Após o bloco `if (event.notify_unit)`, adicione:

```ts
if (event.notify_day_of) {
  const T0 = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  announcements.push({
    body: `📅 Hoje: *${event.title}* — ${eventDateBR}${timeStr}${suffix}`,
    audience: event.unit ? { unidade: [event.unit] } : { all: true },
    scheduled_at: T0 > now ? T0.toISOString() : null,
  });
}
```

Confirme que `y`, `m`, `d`, `eventDateBR`, `timeStr`, `suffix` já estão declarados no escopo da função (igual às outras etapas).

### EventoSheet.tsx

- [ ] **Step 3: Adicionar estado `notifyDayOf`**

Encontre os estados `notifyLeadership`, `notifySchool`, `notifyUnit`. Logo após `notifyUnit`, adicione:

```tsx
const [notifyDayOf, setNotifyDayOf] = useState(true);
```

- [ ] **Step 4: Adicionar checkbox no JSX**

Encontre o grupo de 3 checkboxes (notifyLeadership, notifySchool, notifyUnit). Logo após o último, adicione:

```tsx
<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={notifyDayOf}
    onChange={e => setNotifyDayOf(e.target.checked)}
    className="focus-ring"
  />
  <span className="text-body-sm">Notif. No dia (09h)</span>
</label>
```

- [ ] **Step 5: Atualizar `canSave` e `mutationFn`**

`canSave`: encontre a variável `hasNotification` (ou equivalente). Ela deve incluir `notifyDayOf` no OR:

```ts
const hasNotification = notifyLeadership || notifySchool || notifyUnit || notifyDayOf;
```

`mutationFn`: no INSERT de `school_events`, adicione `notify_day_of: notifyDayOf` ao objeto:

```ts
notify_day_of: notifyDayOf,
```

Encontre onde `notify_unit: notifyUnit` está e adicione logo abaixo.

### AgendaEscolar.tsx

- [ ] **Step 6: Adicionar 4º chip**

Encontre o array de steps/chips que usa prefixes como `'📅 Novo evento:'`, `'📅 Em 3 dias:'`, `'📅 Amanhã:'`. Adicione o 4º elemento:

```ts
{ label: 'No dia', prefix: '📅 Hoje:' }
```

A lógica de matching usa `ann.body.startsWith(step.prefix)` (ou `includes` / `startsWith` — verifique o padrão existente e replique exatamente).

### Build

- [ ] **Step 7: Build da PWA**

```
cd D:\la-organizer\_remote\web && npm run build
```

Expected: build sem erros de TypeScript. Se `SchoolEvent.notify_day_of` causar erro em algum consumer, adicione o campo lá também (segue o mesmo padrão dos outros `notify_*`).

---

## Task 4: TOM Skill + Deploy + Validação

**Files:**
- Modify: `D:\la-organizer\_remote\skills\eventos-institucionais.md`

### TOM Skill

- [ ] **Step 1: Localizar marker de criação em `eventos-institucionais.md`**

Encontre o bloco de exemplo do marker `<<SCHOOL_EVENT_ACTION>>` com `"action": "create"`. Adicione `"notify_day_of": true` após `"notify_unit"`:

```json
{
  "action": "create",
  "title": "...",
  "event_date": "...",
  "start_time": "...",
  "unit": "...",
  "location": null,
  "notify_leadership": true,
  "notify_school": true,
  "notify_unit": true,
  "notify_day_of": true
}
```

- [ ] **Step 2: Atualizar o resumo de confirmação**

Encontre o bloco de exemplo do resumo mostrado ao usuário antes de confirmar:

```
Plano:
  ✓ Liderança — agora
  ✓ Escola toda — 17/12 às 9h
  ✓ Unidade Barra — 19/12 às 9h
```

Adicione a 4ª linha:

```
  ✓ No dia — 20/12 às 9h
```

- [ ] **Step 3: Adicionar regra de inferência**

No skill, adicione uma linha de regra (no estilo das outras): TOM infere `notify_day_of: true` por padrão. Só emite `notify_day_of: false` se o usuário pedir explicitamente (ex: "sem lembrete no dia").

### Deploy

- [ ] **Step 4: Sincronizar arquivos modificados com a VPS**

```bash
scp -i ~/.ssh/tom_vps D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp -i ~/.ssh/tom_vps D:/la-organizer/_remote/skills/eventos-institucionais.md tom:/opt/LA-Organizer/skills/eventos-institucionais.md
```

- [ ] **Step 5: Sincronizar PWA built**

```bash
scp -i ~/.ssh/tom_vps -r D:/la-organizer/_remote/web/dist/. tom:/opt/LA-Organizer/web/dist/
```

- [ ] **Step 6: Reiniciar pm2**

```bash
ssh -i ~/.ssh/tom_vps tom "pm2 restart tom && pm2 restart la-organizer-web && pm2 status"
```

Expected: ambos `online`.

### Validação E2E

- [ ] **Step 7: Verificar coluna no banco**

```sql
SELECT notify_day_of, count(*) FROM school_events GROUP BY notify_day_of;
```

Expected: todos os eventos existentes têm `notify_day_of = true` (por causa do `DEFAULT true`).

- [ ] **Step 8: Testar criação de evento via SQL**

Encontre um coordinator UUID:
```sql
SELECT id FROM collaborators WHERE role = 'coordinator' LIMIT 1;
```

Inserir evento de teste:
```sql
INSERT INTO school_events (title, event_date, unit, notify_leadership, notify_school, notify_unit, notify_day_of, created_by)
VALUES ('Teste T0 dia', CURRENT_DATE + 5, 'barra', true, true, true, true, '<COORD-UUID>')
RETURNING id, event_date, notify_day_of;
```

Verificar que `buildEventAnnouncementsNode` seria chamado com `notify_day_of = true`:
- O evento foi criado com todos os 4 `notify_*` ativos ✅
- Cleanup: `DELETE FROM announcements WHERE body LIKE '%Teste T0 dia%'; DELETE FROM school_events WHERE title = 'Teste T0 dia';`

- [ ] **Step 9: Confirmar 4º chip no PWA**

Abra `/mais/agenda-escolar` no browser. Se houver um evento ativo, abra o card e verifique que aparece o chip "No dia" ao lado de "Liderança", "Escola" e "Unidade".

Se não houver evento ativo, crie um via PWA (EventoSheet) e verifique que:
- O checkbox "Notif. No dia (09h)" aparece marcado por default
- Após salvar, o card mostra o 4º chip

---

## Self-Review

**Spec coverage:**
- ✅ DB migration: `notify_day_of boolean NOT NULL DEFAULT true` (Task 1)
- ✅ `buildEventAnnouncementsNode` — bloco T0 (Task 2)
- ✅ `applySchoolEventAction` INSERT — `notify_day_of` (Task 2)
- ✅ `SchoolEvent` interface — campo (Task 3)
- ✅ `buildEventAnnouncements` TypeScript — bloco T0 (Task 3)
- ✅ `EventoSheet` — estado + checkbox + canSave + mutationFn (Task 3)
- ✅ `AgendaEscolar` — 4º chip com prefix `'📅 Hoje:'` (Task 3)
- ✅ `eventos-institucionais.md` — marker + resumo + regra (Task 4)
- ✅ Deploy + validação (Task 4)

**No placeholders.**

**Type consistency:** `notify_day_of` é `boolean` em todos os lugares (DB, SchoolEvent interface, estado React, INSERT payload).

**Note:** Este projeto não tem git local — sem `git commit`. Artefatos vão direto para a VPS via scp no Task 4.
