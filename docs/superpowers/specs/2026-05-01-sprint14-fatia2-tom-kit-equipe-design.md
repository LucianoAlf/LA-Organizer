# Spec: Sprint 14 Fatia 2 — TOM Kit, Mapa de Equipe e Lembretes
**Data:** 2026-05-01
**Status:** Aprovado — pronto para writing-plans

---

## Contexto

Fatia 1 entregou o schema base (tasks com `school_event_id`, `event_sector`, `notes`, `support_team`) e a tela PWA de gerenciamento de tasks por setor. Fatia 2 fecha o ciclo: quando um evento é criado via TOM, o engine auto-gera um kit de tasks baseado no tipo de evento, atribuindo cada task ao responsável de setor cadastrado no mapa de equipe. O dispatcher dispara lembretes WhatsApp T-1 para tasks pendentes.

---

## Decisões de design

| # | Decisão | Escolha |
|---|---|---|
| P1 | Armazenamento do kit | Hardcoded em `engine.js` (não em banco) |
| P2 | Tipos de evento | 8 tipos → 5 famílias de kit |
| P3 | Prazo das tasks | Todas `due_date = event_date` |
| P4 | Mapa de equipe | Tabela `event_team_map` (unit + sector → collaborator) |
| P5 | Escopo do mapa | Por unidade (não por evento) |
| P6 | Lembrete | T-1 único (dia anterior à due_date, 09h BRT) |
| P7 | Deduplicação lembrete | Nova coluna `reminded_at` em `tasks` |
| P8 | Fallback sem mapa | `assigned_to = created_by` (criador do evento) |
| P9 | Evento sem `event_type` | Nenhum kit gerado (nullable) |

---

## Seção 1: DB Migration

### Coluna `event_type` em `school_events`

```sql
ALTER TABLE school_events
  ADD COLUMN IF NOT EXISTS event_type text
    CHECK (event_type IN ('show','recital','workshop','treinamento','oficinas','reuniao','formatura','evento'));
```

Nullable — eventos sem `event_type` não geram kit.

### Tabela `event_team_map`

```sql
CREATE TABLE event_team_map (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  unit          text    NOT NULL CHECK (unit IN ('barra','recreio','campo_grande')),
  sector        text    NOT NULL CHECK (sector IN ('logistica','tecnica','pedagogico','comunicacao','producao')),
  collaborator_id uuid  NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit, sector)
);

CREATE INDEX event_team_map_unit_idx ON event_team_map(unit);
```

RLS:
```sql
ALTER TABLE event_team_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_team_map_read ON event_team_map
  FOR SELECT USING (current_collab_role() IN ('coordinator','director'));

CREATE POLICY event_team_map_write ON event_team_map
  FOR ALL USING (current_collab_role() IN ('coordinator','director'));
```

### Coluna `reminded_at` em `tasks`

```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
```

---

## Seção 2: Kits de tasks (hardcoded em `engine.js`)

Mapeamento tipo → família:
```js
const TYPE_TO_FAMILY = {
  show: 'performance', recital: 'performance',
  workshop: 'aprendizagem', treinamento: 'aprendizagem', oficinas: 'aprendizagem',
  reuniao: 'reuniao',
  formatura: 'formatura',
  evento: 'evento',
};
```

Kits (objeto `EVENT_TASK_KITS`):

```js
const EVENT_TASK_KITS = {
  performance: [
    { title: 'Confirmar local e montagem do espaço',       sector: 'logistica'   },
    { title: 'Organizar lista de presença e convites',     sector: 'logistica'   },
    { title: 'Testar equipamentos de som e iluminação',    sector: 'tecnica'     },
    { title: 'Preparar roteiro técnico do evento',         sector: 'tecnica'     },
    { title: 'Realizar ensaio geral com alunos',           sector: 'pedagogico'  },
    { title: 'Confirmar repertório e ordem de apresentação', sector: 'pedagogico'},
    { title: 'Divulgar evento (redes sociais e WhatsApp)', sector: 'comunicacao' },
    { title: 'Enviar convites para responsáveis',          sector: 'comunicacao' },
    { title: 'Decoração e ambientação do espaço',          sector: 'producao'    },
  ],
  aprendizagem: [
    { title: 'Confirmar sala e número de vagas',           sector: 'logistica'   },
    { title: 'Preparar materiais e impressões',            sector: 'logistica'   },
    { title: 'Verificar equipamentos audiovisuais',        sector: 'tecnica'     },
    { title: 'Finalizar conteúdo e apostilas',             sector: 'pedagogico'  },
    { title: 'Preparar dinâmica e exercícios práticos',    sector: 'pedagogico'  },
    { title: 'Confirmar inscrições e presenças',           sector: 'comunicacao' },
  ],
  reuniao: [
    { title: 'Confirmar sala e presença dos participantes', sector: 'logistica'  },
    { title: 'Preparar pauta da reunião',                  sector: 'pedagogico'  },
    { title: 'Registrar ata durante a reunião',            sector: 'pedagogico'  },
    { title: 'Convocar participantes com antecedência',    sector: 'comunicacao' },
  ],
  formatura: [
    { title: 'Confirmar local e estrutura do espaço',      sector: 'logistica'   },
    { title: 'Organizar lista de convidados e ingressos',  sector: 'logistica'   },
    { title: 'Testar som, filmagem e fotografia',          sector: 'tecnica'     },
    { title: 'Realizar ensaio da cerimônia com formandos', sector: 'pedagogico'  },
    { title: 'Preparar diplomas e certificados',           sector: 'pedagogico'  },
    { title: 'Enviar convites e confirmar presenças',      sector: 'comunicacao' },
    { title: 'Decoração e montagem do espaço',             sector: 'producao'    },
    { title: 'Organizar homenagens e momentos especiais',  sector: 'producao'    },
  ],
  evento: [
    { title: 'Confirmar local e estrutura',                sector: 'logistica'   },
    { title: 'Verificar equipamentos necessários',         sector: 'tecnica'     },
    { title: 'Preparar conteúdo e programação',            sector: 'pedagogico'  },
    { title: 'Divulgar e confirmar participantes',         sector: 'comunicacao' },
    { title: 'Preparar ambientação do espaço',             sector: 'producao'    },
  ],
};
```

---

## Seção 3: Engine — `applySchoolEventAction`

### Novo campo no parser

`parseSchoolEventAction` já extrai `notify_*` e demais campos. Adicionar `event_type` ao objeto parsed.

### Geração do kit em `applySchoolEventAction` (create path)

Após INSERT do evento, se `parsed.event_type` não for nulo:

```js
async function buildEventTaskKit(eventId, eventDate, eventType, unit, createdBy, supabase) {
  const family = TYPE_TO_FAMILY[eventType];
  if (!family) return;

  const kit = EVENT_TASK_KITS[family];
  if (!kit?.length) return;

  // Buscar mapa de equipe da unidade
  let teamMap = {};
  if (unit) {
    const { data: mapRows } = await supabase
      .from('event_team_map')
      .select('sector, collaborator_id')
      .eq('unit', unit);
    for (const row of mapRows ?? []) {
      teamMap[row.sector] = row.collaborator_id;
    }
  }

  const tasks = kit.map(item => ({
    title: item.title,
    assigned_to: teamMap[item.sector] ?? createdBy,
    created_by: createdBy,
    due_date: eventDate,
    remind_at: new Date(new Date(eventDate + 'T12:00:00Z').getTime() - 24 * 60 * 60 * 1000).toISOString(), // T-1 09h BRT
    status: 'pending',
    source: 'system',
    context: 'work',
    priority: 'medium',
    school_event_id: eventId,
    event_sector: item.sector,
  }));

  const { error } = await supabase.from('tasks').insert(tasks);
  return error;
}
```

`source: 'system'` já existe no CHECK da tabela `tasks`.

Chamada em `applySchoolEventAction`:
```js
if (parsed.event_type) {
  const kitError = await buildEventTaskKit(ev.id, parsed.event_date, parsed.event_type, parsed.unit ?? null, collaborator.id, supabase);
  if (kitError) {
    // Log mas não falha a criação do evento — kit é best-effort
    console.error('[applySchoolEventAction] kit error:', kitError.message);
  }
}
```

Kit é **best-effort**: falha no kit não cancela o evento.

---

## Seção 4: Dispatcher — bloco de lembretes

**Arquivo:** `src/rituals/dispatcher.js`

Novo bloco `remindEventTasks()` chamado antes de `dispatchAnnouncements`:

```js
async function remindEventTasks() {
  const now = new Date();
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, school_event_id, collaborators!assigned_to(phone, full_name), school_events!school_event_id(title)')
    .not('school_event_id', 'is', null)
    .in('status', ['pending', 'in_progress'])
    .lte('remind_at', now.toISOString())
    .is('reminded_at', null);

  if (error || !tasks?.length) return;

  for (const task of tasks) {
    const phone = task.collaborators?.phone;
    if (!phone) continue;
    const name = task.collaborators?.full_name?.split(' ')[0] ?? '';
    const eventTitle = task.school_events?.title ?? 'evento';
    const msg = `⏰ Lembrete: *${task.title}* para o evento *${eventTitle}* é amanhã. Tudo certo da sua parte?`;
    await sendWhatsApp(phone, msg);
    await supabase.from('tasks').update({ reminded_at: now.toISOString() }).eq('id', task.id);
  }
}
```

A função `sendWhatsApp` já existe no dispatcher (usada por `dispatchAnnouncements`).

---

## Seção 5: TOM Skill — `eventos-institucionais.md`

### Marker create — adicionar `event_type`

```json
{
  "action": "create",
  "title": "...",
  "event_date": "...",
  "start_time": "...",
  "unit": "...",
  "location": null,
  "event_type": "show",
  "notify_leadership": true,
  "notify_school": true,
  "notify_unit": true,
  "notify_day_of": true
}
```

Valores válidos: `show`, `recital`, `workshop`, `treinamento`, `oficinas`, `reuniao`, `formatura`, `evento`. TOM infere pelo contexto. Se não for possível inferir, pergunta ao coordinator.

### Resumo de confirmação

```
Plano:
  ✓ Liderança — agora
  ✓ Escola toda — 17/12 às 9h
  ✓ Unidade Barra — 19/12 às 9h
  ✓ No dia — 20/12 às 9h
  ✓ Kit de tarefas — 9 tasks (performance) para a equipe da Barra
```

### Regra de inferência de `event_type`

TOM deve inferir `event_type` pelo título/descrição do evento:
- "show", "apresentação", "concerto", "recital" → tipo correspondente
- "workshop", "treinamento", "oficina" → tipo correspondente
- "reunião", "reuniao" → `reuniao`
- "formatura", "cerimônia de conclusão" → `formatura`
- Qualquer outro evento → `evento`

Se `event_type` for `null` no marker, nenhum kit é gerado.

---

## Seção 6: PWA — Tela "Configurar equipe"

### Rota

`/mais/agenda-escolar/equipe` — acessível via botão "Equipe" na tela `AgendaEscolar`, visível apenas para coordinator/director.

### Estrutura da tela

```
Equipe por Setor

[Barra]  [Recreio]  [Campo Grande]   ← tabs por unidade

Logística      [select → colaborador]
Técnica        [select → colaborador]
Pedagógico     [select → colaborador]
Comunicação    [select → colaborador]
Produção       [select → colaborador]

[Salvar]
```

- Tabs por unidade (3 tabs, uma por vez)
- 5 rows, uma por setor, cada uma com select de colaboradores ativos
- Opção vazia = "Sem responsável fixo" (fallback para criador do evento)
- Salvar: upsert em `event_team_map` para a unidade selecionada

### Query

```ts
useQuery(['event-team-map', unit], () =>
  supabase.from('event_team_map').select('sector, collaborator_id').eq('unit', unit)
)
```

### Mutation (upsert)

```ts
useMutation(async (rows: {sector: string, collaborator_id: string | null}[]) => {
  // Deleta os que foram limpos
  const toDelete = rows.filter(r => !r.collaborator_id).map(r => r.sector);
  if (toDelete.length) {
    await supabase.from('event_team_map').delete().eq('unit', unit).in('sector', toDelete);
  }
  // Upsert os preenchidos
  const toUpsert = rows.filter(r => r.collaborator_id).map(r => ({ unit, sector: r.sector, collaborator_id: r.collaborator_id }));
  if (toUpsert.length) {
    await supabase.from('event_team_map').upsert(toUpsert, { onConflict: 'unit,sector' });
  }
})
```

---

## Fora de escopo

- Mapa de equipe por evento (override por evento específico) — Fatia futura
- Prazos relativos por task (T-30, T-7, etc.) — mantido como due_date = event_date
- Múltiplos lembretes (T-3, T-1) — YAGNI
- Edição do conteúdo dos kits pela interface — hardcoded é suficiente agora
- Geração de tasks para eventos existentes (retroativa) — só eventos novos
