# Spec: Sprint 14 Fatia 1 — Tarefas de Eventos (PWA)
**Data:** 2026-05-01
**Status:** Aprovado — pronto para writing-plans

---

## Contexto

Sprint 14 adiciona coordenação operacional a eventos institucionais: tasks de apoio organizadas por setor (logística, técnica, pedagógico, comunicação, produção). A Fatia 1 entrega a fundação: schema DB + tela PWA de detalhe do evento com CRUD de tasks. Sem TOM na Fatia 1 — essa integração fica para Fatia 2.

---

## Decisões de design

| # | Decisão | Escolha |
|---|---|---|
| P1 | Abordagem schema | Estender `tasks` existente (não nova tabela) |
| P2 | Setores | `logistica`, `tecnica`, `pedagogico`, `comunicacao`, `producao` |
| P3 | Status novo | `awaiting_confirmation` adicionado ao CHECK existente |
| P4 | Campo notes | `text NULL` na task (não na tasks_comments) |
| P5 | Support team | `uuid[] NULL` na task |
| P6 | Tela nova | `/mais/eventos/:id` — detalhe do evento com tasks por setor |
| P7 | Escopo Fatia 1 | PWA + DB apenas; sem TOM, sem engine, sem skills |

---

## Seção 1: DB Migration

### Colunas novas em `tasks`

```sql
ALTER TABLE tasks
  ADD COLUMN school_event_id uuid REFERENCES school_events(id) ON DELETE SET NULL,
  ADD COLUMN event_sector text CHECK (event_sector IN ('logistica','tecnica','pedagogico','comunicacao','producao')),
  ADD COLUMN notes text,
  ADD COLUMN support_team uuid[];
```

Todas `NULL` — nenhuma task existente é afetada.

### Status novo

```sql
ALTER TABLE tasks
  DROP CONSTRAINT tasks_status_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('pending','in_progress','done','cancelled','awaiting_confirmation'));
```

**Nota:** O nome exato da constraint existente deve ser verificado antes de dropar — usar `\d tasks` ou `information_schema.table_constraints`.

### Índice

```sql
CREATE INDEX tasks_school_event_id_idx ON tasks(school_event_id)
  WHERE school_event_id IS NOT NULL;
```

---

## Seção 2: Tipos TypeScript (`types.ts`)

Estender a interface `Task` existente com os campos opcionais:

```ts
interface Task {
  // ...campos existentes...
  school_event_id: string | null;
  event_sector: 'logistica' | 'tecnica' | 'pedagogico' | 'comunicacao' | 'producao' | null;
  notes: string | null;
  support_team: string[] | null; // UUIDs
}
```

Adicionar tipo para setor:
```ts
type EventSector = 'logistica' | 'tecnica' | 'pedagogico' | 'comunicacao' | 'producao';

const SECTOR_LABELS: Record<EventSector, string> = {
  logistica: 'Logística',
  tecnica: 'Técnica',
  pedagogico: 'Pedagógico',
  comunicacao: 'Comunicação',
  producao: 'Produção',
};
```

---

## Seção 3: Tela `EventoDetalhe.tsx` (`/mais/eventos/:id`)

### Acesso

Somente coordinator e director. Card do evento em `AgendaEscolar` ganha botão "Tarefas" (visível apenas para esses papéis) que navega para `/mais/eventos/:id`.

### Estrutura da tela

```
[← Voltar]
Título do Evento
17/12/2026 · Unidade Barra · às 09h00

▾ Logística (2)
  ☑ Montar palco        Pedro · 15/12  [editar] [excluir]
  ☐ Confirmar buffet    Ana             [editar] [excluir]
  [+ Adicionar task]

▾ Técnica (1)
  ☐ Testar microfone    Lucas           [editar] [excluir]
  [+ Adicionar task]

▸ Pedagógico (0)
  [+ Adicionar task]

▸ Comunicação (0)
  [+ Adicionar task]

▸ Produção (0)
  [+ Adicionar task]
```

- Setores com tasks abertas por padrão; setores vazios colapsados
- Checkbox: toggle `pending` ↔ `done` (mutation inline)
- `due_date` formatado como `DD/MM`
- `notes` exibido como linha adicional abaixo do título da task (se preenchido)
- `support_team` exibido como avatares/nomes ao lado do responsável principal

### Query principal

```ts
useQuery({
  queryKey: ['event-tasks', eventId],
  queryFn: () =>
    supabase
      .from('tasks')
      .select('*, assigned_collab:assigned_to(id,name), event:school_event_id(title,event_date,start_time,location,unit)')
      .eq('school_event_id', eventId)
      .order('created_at'),
})
```

Support team: `support_team` é array de UUIDs — fazer lookup separado de nomes se necessário (ou exibir apenas contagem).

### TaskSheet (BottomSheet para criar/editar task)

Campos:
- `title` — text input, obrigatório
- `event_sector` — select com os 5 setores
- `assigned_to` — select de colaboradores da unidade do evento
- `due_date` — date input, opcional
- `notes` — textarea, opcional
- `support_team` — multiselect de colaboradores, opcional
- `status` — select: `pending` / `in_progress` / `awaiting_confirmation` (default `pending`; `done`/`cancelled` apenas na edição)

Botão "Salvar" → INSERT ou UPDATE em `tasks` com `school_event_id` preenchido.

### Mutation delete

```ts
useMutation({
  mutationFn: (taskId: string) =>
    supabase.from('tasks').delete().eq('id', taskId),
  onSuccess: () => queryClient.invalidateQueries(['event-tasks', eventId]),
})
```

Confirmação inline antes de excluir (botão vira "Tem certeza?" por 3s).

---

## Seção 4: Navegação

### `App.tsx`

Adicionar rota dentro do bloco autenticado existente:

```tsx
<Route path="mais/eventos/:id" element={<EventoDetalhe />} />
```

### `AgendaEscolar.tsx`

No card do evento, adicionar botão visível para coordinator/director:

```tsx
{(role === 'coordinator' || role === 'director') && (
  <Link to={`/mais/eventos/${ev.id}`} className="...">
    Tarefas
  </Link>
)}
```

---

## Fora de escopo (Fatia 2)

- Auto-geração de tasks pelo TOM ao criar evento (5W2H)
- Mapa de equipe: setor → responsável fixo por evento
- Lembretes automáticos via dispatcher (usando `remind_at` existente)
- Integração com skills/engine do TOM
