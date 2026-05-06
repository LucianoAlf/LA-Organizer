# Spec: Eventos Institucionais — Sprint 13 Fatia 2
**Data:** 2026-04-29
**Status:** Aprovado — pronto para writing-plans

---

## Contexto

Fatia 1 entregou anúncios avulsos segmentados. Fatia 2 adiciona eventos institucionais da escola (shows, apresentações, reuniões de pais) com plano de comunicação automático em 3 etapas: liderança imediatamente na criação, escola toda 3 dias antes, unidade específica 1 dia antes. O broadcaster da Fatia 1 despacha tudo sem nenhuma alteração — eventos apenas geram anúncios com `scheduled_at` calculado.

---

## Decisões de design

| # | Decisão | Escolha |
|---|---|---|
| P1 | Interface de criação | TOM (WhatsApp) + PWA |
| P2 | Plano de comunicação | Padrão fixo (3 etapas) com opção de desabilitar etapas individuais |
| P3 | Mensagens | Auto-geradas dos dados do evento |
| P4 | PWA location | `/mais` → "Agenda Escolar" (requireRoles: director/coordinator) |
| P5 | Etapa 1 — Liderança | Dispara na criação do evento (imediato) |
| P6 | Evento por unidade | Pode ser restrito a uma unidade; se null = escola toda |
| P7 | Arquitetura | Evento → gera até 3 anúncios em `announcements` com `source_event_id` |

---

## Abordagem arquitetural

**Abordagem 1 — Evento gera Anúncios automaticamente** (aprovada)

Nova tabela `school_events` com dados do evento. Ao salvar, o sistema cria até 3 rows em `announcements` + popula `announcement_jobs`. O broadcaster da Fatia 1 despacha sem nenhum código novo. Campo `source_event_id` em `announcements` distingue gerados por evento dos manuais.

---

## Seção 1: Schema & RLS

### Migration

```sql
-- 1. Tabela de eventos institucionais
CREATE TABLE IF NOT EXISTS school_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  event_date date NOT NULL,
  start_time time,
  location text,
  unit text CHECK (unit IN ('barra','recreio','campo_grande')),
  -- NULL = escola toda
  created_by uuid REFERENCES collaborators(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','cancelled')),
  notify_leadership boolean NOT NULL DEFAULT true,
  notify_school boolean NOT NULL DEFAULT true,
  notify_unit boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_events_date
  ON school_events(event_date, status);

-- 2. Extensão em announcements para rastrear origem
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES school_events(id);

CREATE INDEX IF NOT EXISTS idx_announcements_event
  ON announcements(source_event_id)
  WHERE source_event_id IS NOT NULL;
```

### RLS

```sql
ALTER TABLE school_events ENABLE ROW LEVEL SECURITY;

-- Todos os colaboradores autenticados podem ler (futura tela de consulta)
CREATE POLICY school_events_select ON school_events
  FOR SELECT TO authenticated USING (true);

-- Só director/coordinator criam e editam
CREATE POLICY school_events_write ON school_events
  FOR ALL TO authenticated
  WITH CHECK (current_collab_role() IN ('director','coordinator'));
```

---

## Seção 2: Geração automática de anúncios

### Lógica por etapa

Ao salvar um `school_event` (via PWA ou marker do TOM):

**Etapa 1 — Liderança (`notify_leadership=true`):**
- `audience: { "function_role": ["director","coordinator"] }`
- `body: "📅 Novo evento: *{title}* — {event_date_br}{às HH:MM se houver horário}{, location se houver}"`
- `scheduled_at: null` → despacho imediato

**Etapa 2 — Escola toda (`notify_school=true`):**
- `audience: { "all": true }`
- `body: "📅 Em 3 dias: *{title}* — {event_date_br}{, location se houver}"`
- `scheduled_at: max(now + 1min, event_date − 3 dias às 09:00 BRT)`
  → se evento a < 3 dias: `scheduled_at = null` (envia imediato)

**Etapa 3 — Unidade (`notify_unit=true`):**
- `audience: { "unidade": [unit] }` OU `{ "all": true }` se `unit=null`
- `body: "📅 Amanhã: *{title}* — {event_date_br}{, location se houver}"`
- `scheduled_at: max(now + 1min, event_date − 1 dia às 09:00 BRT)`
  → se evento amanhã ou hoje: `scheduled_at = null` (envia imediato)

### Função auxiliar `buildEventAnnouncements(event, now)`

```ts
// Retorna array de objetos { body, audience, scheduled_at }
// para cada etapa ativa do evento.
// now: Date (para calcular catch-up)
function buildEventAnnouncements(event, now) {
  const announcements = [];
  const eventDateBR = formatDateBR(event.event_date); // ex: "20/12/2026"
  const timeStr = event.start_time ? ` às ${event.start_time.slice(0,5)}` : '';
  const suffix = event.location ? `, ${event.location}` : '';
  const T3 = subtractDays(event.event_date, 3, '09:00', 'America/Sao_Paulo');
  const T1 = subtractDays(event.event_date, 1, '09:00', 'America/Sao_Paulo');
  const immediate = null; // scheduled_at null = cron pick up next tick

  if (event.notify_leadership) {
    announcements.push({
      body: `📅 Novo evento: *${event.title}* — ${eventDateBR}${timeStr}${suffix}`,
      audience: { function_role: ['director', 'coordinator'] },
      scheduled_at: immediate,
    });
  }
  if (event.notify_school) {
    announcements.push({
      body: `📅 Em 3 dias: *${event.title}* — ${eventDateBR}${timeStr}${suffix}`,
      audience: { all: true },
      scheduled_at: T3 > now ? T3.toISOString() : immediate,
    });
  }
  if (event.notify_unit) {
    announcements.push({
      body: `📅 Amanhã: *${event.title}* — ${eventDateBR}${timeStr}${suffix}`,
      audience: event.unit ? { unidade: [event.unit] } : { all: true },
      scheduled_at: T1 > now ? T1.toISOString() : immediate,
    });
  }
  return announcements;
}
```

### Cancelamento de evento

1. `school_events.status = 'cancelled'`
2. Buscar todos os `announcements` com `source_event_id = event.id` e `status IN ('scheduled','sending')`
3. Setar `status = 'cancelled'` em cada um
4. O `handleCancellations` do broadcaster envia retratações para os já despachados

---

## Seção 3: TOM Skill (`skills/eventos-institucionais.md`)

### Intenções que ativam

- "agenda um evento / show / apresentação / reunião..."
- "cria um evento para..."
- "cancela o evento / o último evento"

### Fluxo de criação via TOM

1. TOM entende: `title`, `event_date` (ISO8601), `start_time` (opcional), `unit` (nullable), `location` (opcional)
2. Infere etapas do plano (todas ativas por default; desabilita se usuário pedir)
3. Mostra resumo com datas calculadas:
   ```
   Evento: Show de Fim de Ano
   Data: 20/12/2026 às 19h
   Unidade: Barra
   Plano:
     ✓ Liderança — agora
     ✓ Escola toda — 17/12 às 9h
     ✓ Unidade Barra — 19/12 às 9h
   Confirma?
   ```
4. Após confirmação emite marker

### Marker criar

```
<<SCHOOL_EVENT_ACTION>>
{
  "action": "create",
  "title": "Show de Fim de Ano",
  "event_date": "2026-12-20",
  "start_time": "19:00",
  "unit": "barra",
  "location": null,
  "notify_leadership": true,
  "notify_school": true,
  "notify_unit": true
}
<<END>>
```

### Marker cancelar

```
<<SCHOOL_EVENT_ACTION>>
{"action": "cancel", "event_id": "latest"}
<<END>>
```

### `engine.js` — `applySchoolEventAction(collaborator, parsed)`

- `action=create`: INSERT `school_events` → `buildEventAnnouncements` → para cada anúncio: INSERT `announcements` + INSERT `announcement_jobs` (recipientes filtrados por audience)
- `action=cancel`: UPDATE `school_events.status='cancelled'` + UPDATE `announcements.status='cancelled'` WHERE `source_event_id=event_id`

---

## Seção 4: PWA

### Arquivos

```
web/src/
├── screens/
│   └── AgendaEscolar.tsx        # lista de eventos institucionais
└── components/
    └── EventoSheet.tsx          # criar/editar evento + selecionar etapas
```

### `AgendaEscolar.tsx`

- Query: `school_events` ORDER BY `event_date ASC`, somente `status=active` (toggle "Mostrar cancelados")
- Join: `announcements` por `source_event_id` para mostrar status das etapas
- Cada card:
  - Título + data + horário + unidade badge
  - 3 chips de etapa: "Liderança ✓" / "Escola 📅 17/12" / "Unidade 📅 19/12" (ou "—" se desabilitado)
  - Botão "Cancelar evento" se `status=active`
- FAB `+` → abre `EventoSheet`

### `EventoSheet.tsx`

| Campo | Input | Validação |
|---|---|---|
| Título | text | obrigatório |
| Data | date | obrigatório |
| Horário | time | opcional |
| Unidade | select: barra / recreio / campo_grande / Escola toda | obrigatório |
| Local | text | opcional |
| Notif. Liderança | checkbox (default ✓) | |
| Notif. Escola toda | checkbox (default ✓) | |
| Notif. Unidade | checkbox (default ✓) | |

Validação: ao menos 1 notificação ativa.

Ao salvar:
1. `supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator.id })`
2. INSERT `school_events` → retorna `event.id`
3. `buildEventAnnouncements(event, new Date())` → para cada entry:
   a. INSERT `announcements` com `source_event_id = event.id`
   b. SELECT recipients por audience
   c. INSERT `announcement_jobs`
4. `invalidateQueries(['agenda-escolar'])`

### `Mais.tsx`

Adicionar item:
```ts
{ to: '/mais/agenda-escolar', label: 'Agenda Escolar', hint: 'Eventos e comunicações', requireRoles: ['director', 'coordinator'] }
```

---

## Seção 5: Error Handling & Edge Cases

| Cenário | Comportamento |
|---|---|
| Data no passado | PWA permite (registro histórico); aviso visual mas não bloqueia |
| Evento criado < 3 dias antes | Etapa "Escola" dispara imediatamente (catch-up) |
| Evento criado < 1 dia antes | Etapas "Escola" e "Unidade" disparam imediatamente |
| Evento criado no dia | Todas as etapas ativas disparam imediatamente |
| Unidade sem colaboradores | Anúncio criado sem jobs → broadcaster conclui com `status=sent` automaticamente |
| Evento cancelado | `status='cancelled'` + cancel announcements linkados → broadcaster envia retratações |
| TOM: nenhum evento ativo para cancelar | Responde "Não encontrei nenhum evento ativo para cancelar" |
| Todas etapas desabilitadas | PWA bloqueia com "Selecione ao menos uma etapa de notificação" |
| `notify_unit=true` + `unit=null` | Etapa Unidade usa `{ all: true }` como fallback |
| Announcements insert parcial falha | Compensating delete do `school_events` row (mesmo padrão Fatia 1) |

---

## Fora de escopo (Fatia 3)

- Aprovação de eventos por director antes de gerar notificações
- Dashboard de observabilidade de envios por evento
- Edição de evento após criação (apenas cancel disponível no MVP)
- Notificações para colaboradores via PWA (push) além do WhatsApp
