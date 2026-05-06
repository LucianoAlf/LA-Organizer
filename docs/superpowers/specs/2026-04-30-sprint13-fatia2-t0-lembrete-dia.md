# Spec: Lembrete no Dia do Evento (T0) — Sprint 13 Fatia 2 Quick Win
**Data:** 2026-04-30
**Status:** Aprovado — pronto para writing-plans

---

## Contexto

Fatia 2 entregou 3 etapas de notificação para eventos institucionais: liderança (imediato), escola toda (T-3), unidade (T-1). Faltou a 4ª etapa: lembrete no dia do evento (T0, 09h BRT). Esta spec adiciona essa etapa de forma cirúrgica — sem novas telas, sem novas tabelas além de uma coluna em `school_events`.

---

## Decisões de design

| # | Decisão | Escolha |
|---|---|---|
| P1 | Audiência T0 | Mesma da etapa T-1: unit se definida, `{ all: true }` se não |
| P2 | Default | `notify_day_of = true` (consistente com as outras 3 etapas) |
| P3 | Horário | 09h BRT = 12h UTC |
| P4 | Catch-up | Se evento é hoje ou passado → `scheduled_at = null` (disparo imediato) |
| P5 | Mensagem | `📅 Hoje: *{title}* — {event_date_br}{timeStr}{suffix}` |

---

## Seção 1: DB Migration

```sql
ALTER TABLE school_events
  ADD COLUMN IF NOT EXISTS notify_day_of boolean NOT NULL DEFAULT true;
```

Sem novo índice necessário — a query de listagem de eventos já existe e usa índice em `event_date`.

---

## Seção 2: Engine — `buildEventAnnouncementsNode`

Adicionar 4ª etapa em `engine.js` dentro de `buildEventAnnouncementsNode(ev, now)`, após o bloco `notify_unit`:

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

Onde `y`, `m`, `d` são extraídos de `ev.event_date` (formato `YYYY-MM-DD`) igual às etapas T-3 e T-1 já existentes.

### `applySchoolEventAction` (create path)

Adicionar `notify_day_of: parsed.notify_day_of ?? true` no INSERT de `school_events`.

---

## Seção 3: PWA

### `types.ts` — `buildEventAnnouncements`

Adicionar 4ª etapa em `buildEventAnnouncements(event, now)`:

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

### `SchoolEvent` interface

Adicionar campo:
```ts
notify_day_of: boolean;
```

### `EventoSheet.tsx`

Adicionar checkbox após `notify_unit`:

```tsx
<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={notifyDayOf}
    onChange={e => setNotifyDayOf(e.target.checked)}
  />
  <span className="text-body-sm">Notif. No dia (09h)</span>
</label>
```

Estado: `const [notifyDayOf, setNotifyDayOf] = useState(true)`

Validação `canSave`: ao menos 1 notificação ativa (incluindo `notifyDayOf`).

No `mutationFn`, incluir `notify_day_of: notifyDayOf` no INSERT de `school_events`.

### `AgendaEscolar.tsx`

Adicionar 4º chip de etapa. O body prefix para identificar o anúncio T0 é `'📅 Hoje:'`.

```tsx
{ label: 'No dia', prefix: '📅 Hoje:' }
```

Adicionar ao array de steps existente junto com `'📅 Novo evento:'`, `'📅 Em 3 dias:'`, `'📅 Amanhã:'`.

---

## Seção 4: TOM Skill (`skills/eventos-institucionais.md`)

### Marker criar — adicionar campo

```json
{
  "action": "create",
  "title": "...",
  "event_date": "...",
  "notify_leadership": true,
  "notify_school": true,
  "notify_unit": true,
  "notify_day_of": true
}
```

### Resumo de confirmação — adicionar linha

```
Plano:
  ✓ Liderança — agora
  ✓ Escola toda — 17/12 às 9h
  ✓ Unidade Barra — 19/12 às 9h
  ✓ No dia — 20/12 às 9h
```

TOM deve inferir `notify_day_of: true` por default, e desabilitar somente se o usuário pedir explicitamente.

---

## Fora de escopo

- Audiência configurável separada para T0 (YAGNI)
- Horário configurável por etapa
- Edição de evento após criação (continua só cancel)
