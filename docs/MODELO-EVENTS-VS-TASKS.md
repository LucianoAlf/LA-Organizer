# Modelo: Tasks vs Events

**Documento:** decisão arquitetural Sprint 3
**Data:** 28 de abril de 2026
**Status:** vigente

---

## Resumo

Tarefas e compromissos são **entidades distintas**. Cada uma na sua tabela. Convivem na UI, não se misturam no schema.

| Entidade | Significado | Sucesso |
|---|---|---|
| `tasks` | algo a fazer **até** uma data | toggle `done` |
| `events` | algo que acontece **de** Y **até** Z (tem hora) | `status='done'` ou `cancelled` |

---

## Por que separar

1. **Semântica diferente.** Tarefa termina com checkbox. Evento "passa" — pode ter sido cumprido, cancelado ou remarcado. Misturar gera confusão de UX.
2. **Forma diferente.** Eventos têm `start_at`, `end_at`, `modality`, `location_text`, `meeting_url`. Adicionar tudo em `tasks` deixaria 70% das colunas null em tarefas comuns.
3. **Queries divergem.** `/hoje` em tasks ordena por Eisenhower + due_date. Em events ordena por `start_at`. Lógica diferente, código mais limpo separado.
4. **Bridge limpo pra futuro.** Calendar sync, recurring, conflict detection — tudo são features de event. Modelo separado destrava esse caminho sem refactor.

---

## Privacidade

> 🛡 **Categoria NUNCA é eixo de segurança.**

Privacidade vive em **`context`** (`work | personal`), igual em `tasks` e `events`.

| Quem vê | Política |
|---|---|
| O próprio colaborador | tudo dele (any context) |
| Coordinator / Director | apenas `context = 'work'` (de qualquer colaborador) |
| Service role (TOM engine) | tudo (bypass RLS) |

**`category`** (`la_music`, `mentoria`, `aula_particular`, `outra_escola`, `estudio`, `pessoal`) é **informacional**. Aparece em badges, filtros visuais e relatórios, mas **NÃO** entra em `pg_policies`.

### Default de criação no PWA

Para reduzir fricção, o PWA aplica regra padrão na hora de criar:

| Categoria escolhida | `context` aplicado |
|---|---|
| `pessoal` | `personal` |
| qualquer outra | `work` |

Esse default NÃO é uma garantia de segurança — é só um helper de UX. A regra de RLS ainda olha o `context` final salvo no banco.

**Caso de uso real:** colaborador faz "mentoria" pessoal num horário e quer que coordenação não veja. Hoje (Sprint 3) precisa categorizar como `pessoal` pra esconder. Sprint 4+ pode introduzir um toggle explícito "esconder de coordenação" se houver demanda.

---

## Categorias (enum fechado)

Compartilhada entre `tasks.category` (opcional) e `events.category` (obrigatório):

| Valor | Quando usar |
|---|---|
| `la_music` | Atividade da LA Music School (aulas regulares, reuniões internas, eventos institucionais) |
| `mentoria` | Mentoria de carreira / desenvolvimento profissional (próprio ou de outros) |
| `aula_particular` | Aula particular fora da grade da LA Music |
| `outra_escola` | Trabalho em outra escola de música |
| `estudio` | Trabalho em estúdio (gravação, mixagem, produção) |
| `pessoal` | Compromissos pessoais (médico, família, lazer) |

**Não há tags livres nesta sprint.** Categorias podem evoluir, mas o enum permanece fechado pra preservar consistência de relatórios.

---

## Schema essencial

### `events`

```
events
├── id, collaborator_id, created_by
├── title, description (nullable)
├── context (work|personal) — privacy axis
├── category (la_music|mentoria|...) — info only
├── start_at, end_at (timestamptz, end > start enforced)
├── modality (online|presencial|hibrido)
├── location_text (nullable)
├── meeting_url (nullable, válido só para online/hibrido)
├── project_id (nullable)
├── status (scheduled|done|cancelled)
├── source (manual|tom|imported)
└── created_at, updated_at (auto)
```

### `tasks` (ajuste mínimo)

```
+ category (nullable, mesmo enum de events.category)
```

Tasks continua exatamente como antes. `category` é opcional e não impacta RLS.

---

## RLS — events

| Policy | Operação | Quem | Condição |
|---|---|---|---|
| `service_role_all_events` | ALL | public | `true` (service_role bypassa RLS de qualquer forma) |
| `auth_read_own_events` | SELECT | authenticated | `collaborator_id = current_collab_id()` |
| `auth_read_work_events_coord` | SELECT | authenticated | `context='work' AND role IN (coordinator, director)` |
| `auth_insert_own_events` | INSERT | authenticated | `collaborator_id = current_collab_id() AND created_by = current_collab_id()` |
| `auth_update_own_events` | UPDATE | authenticated | own only |
| `auth_delete_own_events` | DELETE | authenticated | own only |

**`category` não aparece em nenhuma policy.** Coord vê work events de qualquer categoria, exceto se o autor tiver explicitamente classificado como `context='personal'`.

---

## Convivência: tasks + events

### Telas afetadas

| Tela | Comportamento |
|---|---|
| `/hoje` | Feed: bloco "Compromissos" (com horário) sobre tarefas; tabs work/personal mantidas |
| `/semana` | Por dia: events com horário em destaque, depois bullets de tasks |
| `/projetos/:id` | (futuro) aba de compromissos do projeto — fora do escopo Sprint 3 |
| `/historico` | KPI separado: Tarefas (X/Y), Compromissos (N), Dias ativos |
| `/time` | Coord vê dashboard de tasks; events ainda não somam (futuro) |
| Modal de criação | Seletor inicial Tarefa | Compromisso, depois forms divergentes |

### Migração de dados existentes

**Não houve.** Tasks pré-Sprint 3 continuam tasks. Não convertemos meetings (`reminders_at[]`) em events automaticamente — bridge convive.

### TOM engine

**Não modificado nesta sprint.** TOM continua criando tasks (com `reminders_at[]` para reuniões). Sprint 4+ ensina o engine a emitir events.

Consequência: durante o bridge, o usuário pode ver:
- Reuniões criadas pelo TOM aparecem como **task** com lembretes pré-evento
- Reuniões criadas pelo PWA aparecem como **event** com horário

Isso é aceitável temporariamente. PILOTO-USUARIO deveria mencionar a diferença se virar fricção real.

---

## O que ficou de fora desta sprint

- Recorrência de eventos
- Convidados externos / attendees
- Sync com Google Calendar
- Detecção de conflito de horário
- Vista calendário com blocos arrastáveis
- Tags livres
- Cor customizável por evento
- Edição completa de evento (modal de edit; Sprint 3 cobre criação + reagendamento simples)
- TOM aprendendo a criar events
- Timezone customizável (hardcode `America/Sao_Paulo`)

---

## Perguntas frequentes (audit trail)

**Q: Por que `events.category` é NOT NULL e `tasks.category` é nullable?**
A: Eventos têm que ser categorizados (caso de uso central da Sprint 3). Tasks pré-existentes não têm categoria; deixar opcional preserva compatibilidade. Tasks novas via PWA hoje também não têm categoria — pode evoluir em sprint futura.

**Q: Por que `modality='hibrido'` (sem acento)?**
A: Acento em valor de enum complica queries e índices. Display rende "Híbrido" via mapa em TS.

**Q: Por que `meeting_url` é constraint condicional?**
A: Evento `presencial` com `meeting_url` é semanticamente errado — preserva a intenção do criador.

**Q: E se o usuário esquece de marcar `category='pessoal'` num compromisso pessoal?**
A: Coord vê. Risco aceito Sprint 3. Sprint 4+ pode introduzir lembrete UI ou toggle explícito.

**Q: TOM cria reuniões como task. Quando isso muda?**
A: Sprint 4+ ou quando engine refactor for prioridade. Bridge documentado.
