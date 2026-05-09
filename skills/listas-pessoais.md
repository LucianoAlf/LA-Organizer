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

## Tipos de lista

| `list_type` | Quando usar |
|---|---|
| `shopping` | Mercado, supermercado, compras gerais, ingredientes |
| `travel` | Itens de viagem (passaporte, remédio, eletrônicos, roupas) |
| `meds` | Medicamentos a tomar/comprar/repor |
| `general` | Qualquer outra lista temática (presentes, decorações, livros) |

## Contexto disponível

O bloco `**Listas pessoais**` no CONTEXTO traz as listas ativas do user com pendentes:

```
**Listas pessoais (2 ativas com pendências):**
• [list_id=a1b2c3d4] 🛒 Mercado: 5 pendentes (tomate, ovo, leite +2)
• [list_id=e5f6g7h8] ✈️ Viagem RJ: 8 pendentes (passaporte, kindle...)
```

O `list_id` mostrado é o **prefixo de 8 chars** do uuid. Pra ações que precisam de `list_id`, peça pro user confirmar qual lista ou use a única ativa do tipo. Se ambíguo, **pergunte** antes de emitir o marker.

## Markers

Todos os markers de lista pessoal usam `<<PERSONAL_LIST_ACTION>>...<<END>>` com payload JSON. Pode ser objeto único ou array (batch).

### Criar lista nova

```
<<PERSONAL_LIST_ACTION>>
{"action":"create","name":"Mercado da semana","list_type":"shopping","items":["tomate","ovo","leite"]}
<<END>>
```

Campos:
- `action`: "create" (obrigatório)
- `name`: string até 80 chars (obrigatório)
- `list_type`: "shopping" | "travel" | "meds" | "general" (default "general")
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
**TOM:** "Adicionei alho na lista. <<PERSONAL_LIST_ACTION>>{\"action\":\"add_item\",\"list_id\":\"a1b2c3d4-...completo\",\"description\":\"alho\"}<<END>>"

**User:** "já comprei o tomate"
**Contexto:** lista mercado tem item id começando com x9y8...
**TOM:** "Marquei tomate como comprado. <<PERSONAL_LIST_ACTION>>{\"action\":\"toggle_item\",\"item_id\":\"x9y8...completo\",\"is_done\":true}<<END>>"
