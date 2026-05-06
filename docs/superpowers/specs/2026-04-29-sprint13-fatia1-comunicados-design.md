# Spec: MVP Anúncio Segmentado — Sprint 13 Fatia 1
**Data:** 2026-04-29
**Status:** Aprovado — pronto para writing-plans

---

## Contexto

O LA Organizer não tem hoje nenhum canal estruturado de comunicação interna. Avisos são mandados manualmente no WhatsApp pessoal do director, sem rastreio, sem segmentação e sem histórico. Esta fatia entrega o MVP: director e coordinator criam anúncios no PWA ou via TOM (WhatsApp), escolhem o público, e as mensagens são despachadas via WhatsApp em lotes seguros (1 msg/min, anti-ban Meta).

---

## Decisões de design

| # | Decisão | Escolha |
|---|---|---|
| P1 | Interface de criação | TOM (WhatsApp) + PWA — ambos disponíveis no MVP |
| P2 | Segmentação | Unidade · Função/role · Turno · Broadcast geral (todas combinadas) |
| P3 | Permissão de envio | Director + Coordinator — envio direto, sem aprovação no MVP |
| P4 | Agendamento | Imediato ou data/hora futura específica |
| P5 | TOM flow | TOM mostra resumo → "Confirma?" → despacha |
| P6 | Cancelamento | Cancela jobs pendentes + envia retratação para quem já recebeu |
| P7 | PWA location | `/mais` → "Comunicados" (requireRoles: director/coordinator) |
| P8 | Rate limit | 1 msg/min — mesmo cron tick do rituals/dispatcher existente |

---

## Abordagem arquitetural

**DB-first com cron dispatcher** (aprovada)

- Tabelas `announcements` + `announcement_jobs` no Supabase
- Cron estende `rituals/dispatcher.js` com `dispatchAnnouncements(now)` — 1 job por tick
- PWA e TOM escrevem no DB; cron é o único que envia mensagens
- Cancel = setar `status='cancelled'` no DB; cron detecta e para + envia retratação
- Zero dependências novas — padrão idêntico ao dispatcher de checklists

---

## Seção 1: Schema & RLS

### Migration

```sql
-- 1. Tabela de anúncios
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES collaborators(id),
  body text NOT NULL,
  audience jsonb NOT NULL DEFAULT '{}',
  -- audience shape: { unidade?: string[], function_role?: string[], turno?: string[], all?: true }
  -- audience = '{"all": true}' → todos os colaboradores ativos
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at timestamptz,
  -- null = envio imediato (cron despacha no próximo tick)
  cancel_retraction_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_status ON announcements(status, scheduled_at);

-- 2. Jobs de entrega por destinatário
CREATE TABLE IF NOT EXISTS announcement_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES collaborators(id),
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','cancelled')),
  retry_count int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcement_jobs_pending
  ON announcement_jobs(announcement_id, status);
CREATE INDEX idx_announcement_jobs_status_created
  ON announcement_jobs(status, created_at);
```

### RLS

```sql
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_jobs ENABLE ROW LEVEL SECURITY;

-- announcements: director/coordinator leem e escrevem
CREATE POLICY announcements_select ON announcements
  FOR SELECT TO authenticated
  USING (current_collab_role() IN ('director','coordinator'));

CREATE POLICY announcements_write ON announcements
  FOR ALL TO authenticated
  WITH CHECK (current_collab_role() IN ('director','coordinator'));

-- announcement_jobs: somente service role (Node.js) opera — sem exposição direta
-- PWA não acessa announcement_jobs diretamente
```

### ⚠️ Nota de implementação — audience filter

A função que popula `announcement_jobs` no PWA deve filtrar `collaborators` assim:

```ts
// audience = {} → todos
// audience.all = true → todos
// audience.unidade = ['barra'] → WHERE unit IN (...)
// audience.function_role = ['secretary_morning'] → WHERE function_role IN (...)
// audience.turno = ['morning'] → WHERE shift IN (...)
// Combinações são AND entre dimensões, OR dentro de cada dimensão
```

---

## Seção 2: TOM Skill (`skills/comunicados.md`)

### Intenção detectada

Frases que ativam a skill:
- "avisa [público] que..."
- "manda mensagem para [público]..."
- "comunica para [público]..."
- "cancela o comunicado / cancela o último aviso"

### Markers

**Criar anúncio:**
```
<<ANNOUNCEMENT_ACTION>>
action: create
body: <texto do anúncio>
audience: <json>
scheduled_at: <ISO8601 | null>
<<END>>
```

**Cancelar:**
```
<<ANNOUNCEMENT_ACTION>>
action: cancel
announcement_id: <uuid | "latest">
<<END>>
```

### Fluxo de criação via TOM

1. TOM entende o pedido e estrutura `body` + `audience` + `scheduled_at`
2. Resolve a contagem: `SELECT count(*) FROM collaborators WHERE <filtro audience>`
3. Responde com resumo:
   ```
   Vou mandar este comunicado:

   Público: Secretaria · Manhã (3 pessoas)
   Mensagem: "Lembrete: amanhã tem reunião às 9h"
   Envio: imediato

   Confirma?
   ```
4. Coordinator responde "sim" / "confirma" / "pode" → TOM emite marker
5. `engine.js` processa marker: INSERT `announcements` + popula `announcement_jobs`
6. TOM confirma: "Comunicado despachado para 3 pessoas. ✓"

### Fluxo de cancelamento via TOM

1. TOM detecta intenção de cancelar
2. Busca `announcements` mais recente do coordinator com `status IN ('scheduled','sending')`
3. Confirma: "Cancelo o aviso enviado há 5 min para a Secretaria da Manhã. Confirma?"
4. Coordinator confirma → TOM emite marker `action: cancel`
5. `engine.js` seta `announcements.status='cancelled'`; cron faz o resto

---

## Seção 3: Broadcaster (`rituals/dispatcher.js`)

### Função `dispatchAnnouncements(now)`

Chamada a cada tick do cron, após `dispatchChecklists`.

**Lógica:**

```
1. SELECT 1 job WHERE:
     status = 'pending'
     AND announcement.status IN ('scheduled','sending')
     AND (announcement.scheduled_at IS NULL OR announcement.scheduled_at <= now)
   ORDER BY announcement_jobs.created_at ASC

2. Se job encontrado:
   a. sendMessage(job.phone, announcement.body)
   b. Sucesso:
      - job.status = 'sent', job.sent_at = now
      - Se announcement.status = 'scheduled' → 'sending'
      - Se era o último job pending → announcement.status = 'sent'
   c. Falha:
      - job.retry_count++
      - Se retry_count >= 3 → job.status = 'failed'
      - Nunca interrompe o broadcast

3. SELECT announcements WHERE status = 'cancelled'
                          AND cancel_retraction_sent = false
   Para cada um:
   a. UPDATE pending jobs → status = 'cancelled'
   b. Para cada job com status = 'sent':
      sendMessage(phone, "[LA Music] — O comunicado anterior foi cancelado. Por favor, desconsidere.")
   c. announcement.cancel_retraction_sent = true
```

---

## Seção 4: PWA

### Arquivos

```
web/src/
├── screens/
│   └── Comunicados.tsx          # Lista de anúncios (director/coordinator)
└── components/
    └── ComunicadoSheet.tsx      # BottomSheet compositor
```

### `Comunicados.tsx`

- Query: `announcements` ORDER BY `created_at DESC`, limitado a 30
- Cada card:
  - Preview do body (2 linhas)
  - Badge de público (ex: "Secretaria · Manhã", "Todos")
  - Status chip: Agendado · Enviando X/Y · Enviado · Cancelado
  - Botão "Cancelar" se `status IN ('scheduled','sending')`
- FAB `+` → abre `ComunicadoSheet`

### `ComunicadoSheet.tsx`

| Campo | Input | Validação |
|---|---|---|
| Mensagem | textarea | obrigatório, max 1000 chars |
| Público — Unidade | checkboxes: barra, recreio, campo_grande, todas | ao menos 1 dimensão total |
| Público — Função | checkboxes: roles disponíveis | |
| Público — Turno | checkboxes: morning, afternoon, evening, full | |
| Público — Todos | checkbox único (desmarca os outros) | |
| Envio | toggle: Imediato / Agendado | |
| Data/hora | datetime-local (se Agendado) | deve ser > now |

**Ao salvar:**
1. Validar público: SELECT count(*) de collaborators com filtro → se 0, bloquear com "Nenhum colaborador encontrado"
2. `supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator.id })`
3. INSERT `announcements`
4. SELECT collaborators matching audience → INSERT `announcement_jobs` (batch)
5. `invalidateQueries(['comunicados'])`

### `Mais.tsx`

Adicionar item "Comunicados" com `requireRoles: ['director','coordinator']` (padrão idêntico ao item checklists-templates).

---

## Seção 5: Error Handling & Edge Cases

| Cenário | Comportamento |
|---|---|
| Público vazio (filtro não bate nenhum collaborator) | PWA bloqueia com toast "Nenhum colaborador encontrado para este público" |
| Collaborator sem `phone` | Cron pula o job → `status='failed'`, `error='no_phone'` |
| UAZAPI retorna erro | `retry_count++`; máx 3 tentativas; depois `status='failed'`; broadcast continua |
| Cancelamento após todos enviados | `cancel_retraction_sent=true` já → nenhuma ação extra |
| TOM cancela: nenhum anúncio ativo | TOM responde "Não encontrei nenhum comunicado ativo para cancelar" |
| Retratação falha no envio | Loga erro; não retenta — evita loop |
| Agendamento no passado | PWA valida `scheduled_at > now` — bloqueia com toast |
| Role sem permissão tenta salvar | RLS rejeita INSERT → toast "Sem permissão para enviar comunicados" |

---

## Fora de escopo (Fatias 2 e 3)

- Eventos estruturados com plano de comunicação automático por proximidade (Fatia 2)
- Fluxo de aprovação de anúncios (Fatia 3)
- Dashboard de observabilidade — enviados/falhas/cancelados (Fatia 3)
- Histórico de recebimento no PWA para colaboradores comuns
- Notificação push além do WhatsApp
