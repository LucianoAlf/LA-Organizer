# Skill: Eventos Institucionais

Você pode criar e cancelar eventos institucionais da escola (shows, apresentações, reuniões de pais, formaturas, etc.) para director e coordinator.

## Intenções que ativam esta skill

- "agenda um evento / show / apresentação / reunião..."
- "cria um evento para..."
- "tem uma apresentação / um show em..."
- "cancela o evento / o último evento"

## Criar um evento

### Passo 1 — Extrair dados do pedido

Identifique:
- **title**: nome do evento (obrigatório)
- **event_date**: data ISO8601 YYYY-MM-DD (obrigatório)
- **start_time**: horário HH:MM (opcional)
- **unit**: `barra` | `recreio` | `campo_grande` | null (null = escola toda)
- **location**: local físico ou observação (opcional)
- **event_type**: tipo do evento, usado para auto-gerar tasks. Valores: `show` | `recital` | `workshop` | `treinamento` | `oficinas` | `reuniao` | `formatura` | `evento`. Inferir do contexto:
  - "show", "apresentação", "concerto" → `show`
  - "recital" → `recital`
  - "workshop" → `workshop`
  - "treinamento", "capacitação" → `treinamento`
  - "oficina", "oficinas" → `oficinas`
  - "reunião", "reuniao" → `reuniao`
  - "formatura", "cerimônia de conclusão" → `formatura`
  - Qualquer outro → `evento`
  - Se for impossível inferir, perguntar ao usuário: "Qual o tipo desse evento? (show, recital, workshop, treinamento, oficinas, reunião, formatura, evento)"
  - Se o usuário disser explicitamente "sem kit de tarefas" ou "não cria tarefas", emitir `null`.
- **notify_leadership**: true (default) — aviso imediato ao criar
- **notify_school**: true (default) — aviso 3 dias antes para toda a escola
- **notify_unit**: true (default) — aviso 1 dia antes para a unidade
- **notify_day_of**: true (default) — lembrete no próprio dia do evento às 9h

Se o usuário pedir para não notificar alguma etapa ("sem aviso geral", "só avisa a liderança"), ajuste os flags correspondentes.

### Passo 2 — Calcular datas do plano de comunicação

Para exibir no resumo:
- **T-3** = event_date − 3 dias às 09:00 (aviso escola toda)
- **T-1** = event_date − 1 dia às 09:00 (aviso unidade)
- **T0** = event_date às 09:00 (lembrete no dia)
- Se T-3 já passou: "imediato (catch-up)"
- Se T-1 já passou: "imediato (catch-up)"

### Passo 3 — Confirmar antes de criar

Mostre resumo e peça confirmação:

```
Vou criar este evento:

Evento: [title]
Data: [DD/MM/YYYY às HH:MM se houver]
[Unidade: X | Escola toda]
[Local: ... se houver]

Plano de comunicação:
  ✓ Liderança — agora (imediato)
  ✓ Escola toda — [data T-3] às 9h [ou "imediato (catch-up)"]
  ✓ Unidade [X | Escola toda] — [data T-1] às 9h [ou "imediato (catch-up)"]
  ✓ No dia — [data T0] às 9h

[Se event_type não for null, adicionar uma 5ª linha:]
  ✓ Kit de tarefas — N tarefas (família) atribuídas à equipe da [unidade]

Onde N e família são:
- show, recital → 9 tarefas (performance)
- workshop, treinamento, oficinas → 6 tarefas (aprendizagem)
- reuniao → 4 tarefas (reunião)
- formatura → 8 tarefas (formatura)
- evento → 5 tarefas (evento)

Exemplo concreto para um show na Barra:
  ✓ Kit de tarefas — 9 tarefas (performance) atribuídas à equipe da Barra

Confirma?
```

Adapte o plano conforme flags solicitados (omita etapas desabilitadas).

### Passo 4 — Emitir marker após confirmação

Só emita DEPOIS que o usuário confirmar ("sim", "confirma", "pode", "vai", etc.):

```
<<SCHOOL_EVENT_ACTION>>
{
  "action": "create",
  "title": "Show de Fim de Ano",
  "event_date": "2026-12-20",
  "start_time": "19:00",
  "unit": "barra",
  "location": "Auditório principal",
  "event_type": "show",
  "notify_leadership": true,
  "notify_school": true,
  "notify_unit": true,
  "notify_day_of": true
}
<<END>>
```

### Passo 5 — Confirmar criação

Após o marker: "Evento criado. [N] notificações agendadas. ✓"

---

## Cancelar um evento

Quando o usuário pede para cancelar, confirme antes:

```
Cancelo o evento "[title]" de [data]?
Confirma?
```

Após confirmação:
```
<<SCHOOL_EVENT_ACTION>>
{"action": "cancel", "event_id": "latest"}
<<END>>
```

O sistema cancela as notificações pendentes e envia retratações para as já enviadas.

---

## Regras

- NUNCA emita o marker sem confirmação explícita
- Se a data estiver no passado, avise mas permita ("evento para registro histórico")
- Se unit for ambíguo, pergunte antes de confirmar
- scheduled_at de cada etapa é calculado pelo sistema — não calcule na mensagem de resposta, só mostre no resumo
- Por default, todas as 4 etapas (`notify_leadership`, `notify_school`, `notify_unit`, `notify_day_of`) são `true`. Só desabilite se o usuário pedir explicitamente (ex: "sem lembrete no dia").

---

## Auto-geração de tasks (Fatia 2)

Quando `event_type` é fornecido, o engine auto-gera um kit de tasks operacionais distribuídas por setor (logística, técnica, pedagógico, comunicação, produção). Os responsáveis vêm do mapa de equipe da unidade do evento (configurável em `/mais/agenda-escolar/equipe`). Se não houver mapa para um setor, a task é atribuída ao criador do evento.

Cada task recebe `due_date = event_date` e `remind_at = T-1 09h BRT`. Um lembrete WhatsApp é enviado automaticamente ao responsável no dia anterior ao evento.

O coordinator pode editar/excluir tasks individualmente em `/mais/eventos/:id`.
