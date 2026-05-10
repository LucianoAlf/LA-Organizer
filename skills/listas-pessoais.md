---
name: listas-pessoais
description: Skill para criar e manter listas pessoais explícitas do usuário (mercado, viagem, remédios, geral). Ativa quando o user pede uma lista temática ("lista de mercado", "lista da viagem", "remédios pra comprar"), quer adicionar item a uma lista existente ("adiciona X na lista do mercado"), ou quer marcar item como feito ("marca tomate como comprado"). Ortogonal a `lista-mental.md` (que é dump aberto e classifica em tasks/events/projects).
---

# Listas Pessoais

## Quando ativar

Ativar quando o user explicitamente pede uma **lista temática persistente**:

- Frases-gatilho de criação:
  - "lista de mercado"
  - "lista da viagem"
  - "remédios que tenho que comprar"
  - "compras do supermercado"
  - "checklist da viagem pro RJ"
- Frases-gatilho de adicionar item:
  - "adiciona X na lista do mercado"
  - "põe X na minha lista de viagem"
  - "lembra de comprar X" (se houver lista shopping ativa)
- Frases-gatilho de marcar como feito:
  - "marca tomate como comprado"
  - "já comprei o passaporte"
  - "já tomei o remédio das 8h"

## Quando NÃO ativar (use outra skill)

- **Dump genérico misturando categorias** ("tô com várias coisas na cabeça: comprar leite, ligar pra escola, terminar relatório") → use `lista-mental.md`. Lá classifica cada item em task/event/project/memory.
- **Tarefa pessoal com prazo** ("amanhã preciso lembrar de pagar o boleto") → use `criar-compromisso.md` (vira task com remind_at).
- **Lista operacional da escola** (abertura, fechamento, fiscalização) → essas vivem em `op_checklists` e são gerenciadas pela liderança via `/mais/checklists-templates`. Não emita PERSONAL_LIST_ACTION pra esses casos.

## Diferença crítica: lista pessoal vs task vs checklist operacional

Os 3 são coisas distintas. **Não confunda.**

| Tipo | Onde vive | Quando usar | Marker |
|---|---|---|---|
| **Lista pessoal** | `personal_checklists` | User quer acompanhar uma lista de itens **sem prazos individuais** (lista de compras, brainstorm, ideias, projetos) | `<<PERSONAL_LIST_ACTION>>` |
| **Task** | `tasks` | User quer **ação concreta com prazo** ("preciso fazer X até dia Y") ou pede pra delegar pra alguém | `<<TASK_UPDATE>>` |
| **Checklist operacional** | `op_checklists` | Rotina recorrente disparada pelo cron (abertura, limpeza). Gerenciada pela liderança no PWA | (não emite marker) |

**Sinais de "é lista pessoal" (use PERSONAL_LIST_ACTION):**
- "crie um **checklist** disso", "lista pra eu ir riscando", "quero acompanhar essa lista"
- User mostra anotação/foto/print com vários itens e pede pra organizar
- Itens sem prazo individual

**Sinais de "são tasks" (use TASK_UPDATE create):**
- "preciso **fazer** isso até X", "agenda essas tarefas pra amanhã"
- User pede prazo, prioridade ou responsável pra cada item
- Cada item é uma ação independente com deadline

**Atenção:** "checklist de trabalho" / "checklist do projeto" / "checklist da reunião" → continua sendo lista pessoal (`PERSONAL_LIST_ACTION`), só com `context: "work"`. Não é task nem checklist operacional. Tasks têm prazo individual, checklist é só pra ticar.

## Tipos de lista

| `list_type` | Quando usar |
|---|---|
| `shopping` | Mercado, supermercado, compras gerais, ingredientes |
| `travel` | Itens de viagem (passaporte, remédio, eletrônicos, roupas) |
| `meds` | Medicamentos a tomar/comprar/repor |
| `general` | Qualquer outra lista temática (presentes, decorações, livros, brainstorms) |

## Contexto da lista (`context`)

Toda lista pessoal vive em um dos dois contextos:

- `context: "personal"` (default) — vida pessoal: mercado, viagem, remédios, presentes, hábitos
- `context: "work"` — assuntos da LA Music: brainstorm de visão, checklist de reunião, ideias de projeto, lista de fornecedores

Decide pelo conteúdo e pelo gatilho:
- "lista de mercado" → `personal`
- "checklist de trabalho", "lista do projeto", "ideias pra LA Organizer", "fornecedores", "reunião de quarta" → `work`
- Sinais explícitos do user ("é coisa de trabalho" / "é pessoal") sempre prevalecem.

## Contexto disponível

O bloco `**Listas pessoais**` no CONTEXTO traz as listas ativas do user com TODOS os itens pendentes:

```
**Listas pessoais (2 ativas com pendências):**
• [list_id=550e8400-e29b-41d4-a716-446655440000] 🛒 Mercado: 5 pendentes
  1. [item_id=f47ac10b-58cc-4372-a567-0e02b2c3d479] tomate
  2. [item_id=6ba7b810-9dad-11d1-80b4-00c04fd430c8] ovo
  ...
• [list_id=6ba7b811-9dad-11d1-80b4-00c04fd430c8] ✈️ Viagem RJ: 3 pendentes
  1. [item_id=...] passaporte
  ...
```

O `list_id` e `item_id` são **UUIDs completos** — use-os diretamente no marker sem truncar.

## Markers

Todos os markers de lista pessoal usam `<<PERSONAL_LIST_ACTION>>...<<END>>` com payload JSON. Pode ser objeto único ou array (batch).

### Criar lista nova

```
<<PERSONAL_LIST_ACTION>>
{"action":"create","name":"Mercado da semana","list_type":"shopping","context":"personal","items":["tomate","ovo","leite"]}
<<END>>
```

Lista de trabalho:
```
<<PERSONAL_LIST_ACTION>>
{"action":"create","name":"Visão LA Organizer","list_type":"general","context":"work","items":["repositório mental","ideias soltas","matriz Eisenhower"]}
<<END>>
```

Campos:
- `action`: "create" (obrigatório) — também aceita "create_list" como alias
- `name`: string até 80 chars (obrigatório). Também aceita `title` como alias
- `list_type`: "shopping" | "travel" | "meds" | "general" (default "general")
- `context`: "personal" | "work" (default "personal") — define a aba do PWA onde a lista aparece
- `items`: array de strings (opcional — pode criar lista vazia)

### Adicionar item a lista existente

```
<<PERSONAL_LIST_ACTION>>
{"action":"add_item","list_id":"<uuid completo da lista>","description":"queijo"}
<<END>>
```

> **Nota:** `list_id` deve ser o uuid COMPLETO. Se você só tem o prefixo do contexto, peça confirmação antes ("Qual lista? A do Mercado?") e use o id que estiver disponível na sessão. Se não tiver, busque criando uma RPC `<<MEMORY_SAVE>>` com a pergunta como gatilho de retomada.

### Marcar item como feito (ou desfazer)

```
<<PERSONAL_LIST_ACTION>>
{"action":"toggle_item","item_id":"<uuid>","is_done":true}
<<END>>
```

`is_done` opcional (default true). Para desmarcar, passar `false`.

### Renomear lista

```
<<PERSONAL_LIST_ACTION>>
{"action":"rename","list_id":"<uuid>","name":"Mercado da semana"}
<<END>>
```

### Arquivar lista (some da visualização)

```
<<PERSONAL_LIST_ACTION>>
{"action":"archive","list_id":"<uuid>"}
<<END>>
```

### Batch (múltiplas ações em uma resposta)

```
<<PERSONAL_LIST_ACTION>>
[
  {"action":"add_item","list_id":"abc...","description":"farinha"},
  {"action":"add_item","list_id":"abc...","description":"óleo"}
]
<<END>>
```

## Regras

1. **Sempre confirmar antes de criar:** quando o user lista vários itens em texto livre ("preciso comprar tomate, ovo, leite, queijo"), recapitule e pergunte "Crio uma lista de mercado com esses 4 itens?" antes de emitir.
2. **Não emita marker silencioso.** Se foi pedido pra criar lista, fale no texto que vai criar e cite os itens.
3. **Use `list_id` completo no marker** (uuid v4). Os 8 chars no contexto são só visual.
4. **Não duplique listas:** se já existe lista shopping ativa do user, prefira `add_item` em vez de `create`.
5. **Operacional ≠ pessoal:** checklist de abertura de escola NÃO é lista pessoal. Não emita PERSONAL_LIST_ACTION pra demandas de trabalho — use `checklists-operacionais.md`.

## Exemplos

**User:** "preciso comprar tomate, ovo, leite e queijo"
**TOM:** "Posso criar uma lista de mercado com esses 4 itens? (tomate, ovo, leite, queijo)"
**User:** "pode"
**TOM:** "Lista criada. <<PERSONAL_LIST_ACTION>>{\"action\":\"create\",\"name\":\"Mercado\",\"list_type\":\"shopping\",\"items\":[\"tomate\",\"ovo\",\"leite\",\"queijo\"]}<<END>>"

**User:** "adiciona alho na lista do mercado"
**Contexto tem:** `[list_id=a1b2c3d4] 🛒 Mercado`
**TOM:** "Adicionei alho na lista. <<PERSONAL_LIST_ACTION>>{\"action\":\"add_item\",\"list_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"description\":\"alho\"}<<END>>"

**User:** "já comprei o tomate"
**Contexto:** lista mercado tem item_id f47ac10b-58cc-4372-a567-0e02b2c3d479
**TOM:** "Marquei tomate como comprado. <<PERSONAL_LIST_ACTION>>{\"action\":\"toggle_item\",\"item_id\":\"f47ac10b-58cc-4372-a567-0e02b2c3d479\",\"is_done\":true}<<END>>"

**User:** [manda foto de anotação com vários tópicos sobre o LA Organizer] "cria um checklist de trabalho com isso"
**TOM:** "Anotei. Vou criar uma lista de trabalho com 5 itens: Repositório mental, Captura de ideias, Computador de coisas a fazer, Ideias soltas, Matriz Eisenhower. Pode? <<PERSONAL_LIST_ACTION>>{\"action\":\"create\",\"name\":\"Visão LA Organizer\",\"list_type\":\"general\",\"context\":\"work\",\"items\":[\"Repositório mental\",\"Captura de ideias\",\"Computador de coisas a fazer\",\"Ideias soltas\",\"Matriz Eisenhower\"]}<<END>>"

**Importante neste último exemplo:** o user pediu "checklist", não "tarefas". Não emita TASK_UPDATE create — emita PERSONAL_LIST_ACTION com `context:"work"`. Tasks têm prazo individual; checklist é só pra ticar.
