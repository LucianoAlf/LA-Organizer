# Skill: criar-checkpoint

## Quando usar essa skill

Acionar quando o usuário pedir pra criar um **checkpoint** (marco / etapa) de um projeto via WhatsApp. Gatilhos típicos:

- "cria um checkpoint pro festival"
- "adiciona um marco no projeto X"
- "novo checkpoint: montar escala"
- "tô precisando criar uma etapa em LA Teclas"
- "checkpoint montar palco no projeto onboarding"
- "adicionar marco no festival até dia 20/06"
- "estruturar checkpoints do projeto Y" (modo multi — usar com cuidado, ver seção "Multi-checkpoint")

**NÃO usar quando** o usuário pedir tarefa simples ("adiciona uma task pra eu comprar X") — pra isso usar `checklist-tarefas`. Checkpoint é marco de projeto, tarefa é ação solta.

## Contexto importante

A tabela `project_checkpoints` no Supabase tem as colunas:

| coluna | tipo | obrigatório | observações |
|--------|------|-------------|-------------|
| `id` | uuid | gerado | use `gen_random_uuid()` ou deixe o Postgres gerar |
| `project_id` | uuid | sim | FK pra `projects.id` |
| `name` | text | sim | nome do checkpoint, max ~200 chars |
| `due_date` | date | não | YYYY-MM-DD, prazo do checkpoint |
| `status` | text | sim | enum: `'pending' \| 'in_progress' \| 'done' \| 'cancelled'`. Default ao criar: `'pending'` |
| `rationale` | text | não | "por que esse checkpoint existe" — contexto pro time |
| `sort_order` | integer | não | ordem visual. Se omitir, pode usar `max(sort_order) + 1` do projeto |
| `completed_at` | timestamp | não | preenche quando vira done |
| `assigned_to` | uuid | não | FK pra `collaborators.id`. Se null, fallback = `projects.created_by` |

## Fluxo conversacional

### 1. Identificar o projeto

Se o usuário citou o nome do projeto, **busque por similaridade** em `projects.name`:

```sql
SELECT id, name FROM projects
WHERE name ILIKE '%<nome citado>%'
  AND status IN ('active', 'planning', 'pending_approval', 'paused')
LIMIT 5;
```

- Se 1 resultado: use esse projeto.
- Se 2+ resultados: confirme com o usuário ("Achei 2 projetos com 'festival'. Qual? 1. Festival de Cordas 2026  2. Festival de Outono").
- Se 0 resultados: pergunte "Pra qual projeto?" e liste os projetos ativos recentes do usuário.

Se o usuário não citou o projeto, **olhe o contexto recente da conversa** — se ele acabou de falar de um projeto, assuma esse. Se não, pergunte.

### 2. Coletar o nome do checkpoint

Se o usuário já disse no mesmo turno ("checkpoint montar escala"), extraia. Se não, pergunte: "Qual o nome desse checkpoint?".

**Não invente** nomes genéricos. Se ele disser "qualquer um", peça pra ser específico ("Pode ser 'Montar escala', 'Reservar local', etc — me dá um nome que descreve o marco?").

### 3. Prazo (due_date) — opcional, mas pergunte

"Tem prazo? Se sim, qual?". Aceitar formatos:
- "20/06" → `2026-06-20` (assume ano corrente se omitido)
- "amanhã" → date(now() + 1 dia)
- "próxima sexta" → calcular
- "20 de junho" → `2026-06-20`
- "não tem prazo" / "depois" → deixar `due_date` como null

### 4. Responsável — opcional, perguntar uma vez

"Quem fica responsável por esse checkpoint? Se não me disser, fica com o responsável do projeto."

- Se o usuário citar uma pessoa: buscar em `project_members` do projeto:
  ```sql
  SELECT pm.collaborator_id, c.full_name, c.preferred_name
  FROM project_members pm
  JOIN collaborators c ON c.id = pm.collaborator_id
  WHERE pm.project_id = '<project_id>'
    AND (c.full_name ILIKE '%<nome>%' OR c.preferred_name ILIKE '%<nome>%');
  ```
- Match único → usar.
- Múltiplos matches → confirmar.
- Sem match → avisar "Não achei essa pessoa no time do projeto. Quer que adicione, ou deixo sem responsável (cai pro dono do projeto)?"
- Se ele disser "ninguém" / "deixa em branco" / "sem responsável" → `assigned_to = null` (vai cair no fallback do `projects.created_by`).

Salvar `collaborator_id` em `assigned_to` ou deixar null.

### 5. Rationale — opcional, mas perguntar uma vez

"Quer me dizer por que esse checkpoint existe? Isso ajuda o time depois quando alguém pegar pra fazer."

Se ele disser "não", pular. Se ele explicar, salvar em `rationale`.

### 6. Confirmar e inserir

Antes de inserir, **confirme** o que vai criar:

> "Beleza, vou criar:
> 🎯 **Checkpoint:** Montar escala de ensaios gerais
> 📅 **Prazo:** 20/05/2026
> 👤 **Responsável:** Krissya
> 💡 **Por quê:** Ensaio sem escala vira caos
> 📁 **Projeto:** Festival de Cordas 2026
>
> Confirma?"

Se ele confirmar, inserir:

```sql
INSERT INTO project_checkpoints (project_id, name, due_date, rationale, status, sort_order, assigned_to)
VALUES (
  '<project_id>',
  '<nome>',
  '<due_date or null>',
  '<rationale or null>',
  'pending',
  COALESCE((SELECT MAX(sort_order) + 1 FROM project_checkpoints WHERE project_id = '<project_id>'), 0),
  '<assigned_to or null>'
)
RETURNING id, name;
```

Após o insert, confirmar:

> "Pronto! ✅ Checkpoint **Montar escala de ensaios gerais** criado no Festival de Cordas 2026. Tá visível pro time no app."

## Multi-checkpoint (estruturar projeto inteiro)

Se o usuário pedir pra **estruturar checkpoints de um projeto** (várias etapas de uma vez), faça uma conversa guiada:

1. "Beleza, vamos estruturar o projeto X. Quais marcos principais você quer? Pode listar separado por linha ou vírgula."
2. Coletar a lista.
3. Pra cada item, sugerir um `rationale` curto (mas perguntar antes de assumir).
4. Pra cada item, perguntar prazo (ou "todos sem prazo por enquanto?").
5. Confirmar TUDO antes de inserir (mostrar lista numerada).
6. Inserir em lote (1 transação).

**Importante:** sempre `sort_order` incrementando — o primeiro checkpoint da lista vira o de menor número.

## O que NÃO fazer

- ❌ Criar checkpoint sem confirmar com o usuário (sempre confirmar)
- ❌ Inventar `due_date` quando o usuário não deu (deixar null)
- ❌ Inventar `rationale` (deixar null se ele não explicou)
- ❌ Criar checkpoint sem ter certeza do `project_id` (sempre identificar primeiro)
- ❌ Atualizar status pra `'done'` na criação (sempre começa `'pending'`)
- ❌ Esquecer de informar o usuário que o checkpoint aparece no app PWA também

## Espelhamento PWA ↔ TOM

**CRUCIAL:** Tudo que é criado por essa skill aparece imediatamente no app web em `/projetos/<id>` na aba **Checkpoints**. O usuário pode ver, marcar como done, deletar, reordenar pela UI também. A bidirectionalidade é completa porque ambos os lados (TOM e UI) escrevem na mesma tabela `project_checkpoints`.

Se o usuário perguntar "isso aparece no app?", responder: "Sim, já tá lá. Abre /projetos/<projeto> na aba Checkpoints."

## Exemplos completos

### Exemplo 1: criação simples

```
USER: cria checkpoint montar escala no festival até 20/05
TOM:  Achei o "Festival de Cordas 2026". Vou criar o checkpoint
      "Montar escala" com prazo 20/05/2026. Quer me dizer por
      que esse checkpoint existe?
USER: ensaio sem escala vira caos, professor perde tempo
TOM:  Beleza, vou criar:
      🎯 Checkpoint: Montar escala
      📅 Prazo: 20/05/2026
      💡 Por quê: Ensaio sem escala vira caos, professor perde tempo
      📁 Projeto: Festival de Cordas 2026
      Confirma?
USER: sim
TOM:  Pronto ✅ Checkpoint Montar escala criado. Tá visível pro
      time no app em /projetos/.../checkpoints.
```

### Exemplo 2: sem prazo

```
USER: adiciona marco no projeto LA Teclas: reservar sala maior
TOM:  Achei o "LA Teclas". Tem prazo pra esse checkpoint?
USER: não, depois a gente vê
TOM:  Quer me dizer por que esse checkpoint existe?
USER: pode pular
TOM:  Vou criar:
      🎯 Checkpoint: Reservar sala maior
      📅 Prazo: —
      📁 Projeto: LA Teclas
      Confirma?
USER: bora
TOM:  Pronto ✅ Checkpoint criado.
```
