---
name: lista-mental
description: Skill para esvaziar a cabeça do usuário em lote. Ativa quando há ≥3 itens distintos, ou frases como "tô com várias coisas na cabeça", "lista mental", "descarrega essa lista", "anota tudo isso", "tô confuso, vamos organizar". Classifica cada item em task/event/project/memory/resolve_now, persiste com os markers existentes e fecha com oferta de priorização Eisenhower.
---

# Lista Mental

## Quando ativar

Ative esta skill quando a mensagem trouxer:

- Frases-gatilho diretas:
  - "tô com várias coisas na cabeça"
  - "lista mental"
  - "descarrega essa lista"
  - "anota tudo isso"
  - "tô confuso, vamos organizar"
- Áudio ou texto longo com **≥3 itens distintos** detectados na mesma mensagem

Gatilho auxiliar: durante o `briefing_pessoal` (Bloco A de `rituais-diarios.md`), o TOM pode perguntar uma vez por dia *"Tem algo na cabeça que ainda não anotamos?"*. Se o usuário responder com itens, esta skill assume o fluxo.

## Pra que serve

A lista mental existe pra capturar tudo que está circulando na cabeça do usuário antes que se perca. Ela classifica cada item em uma das categorias certas e persiste com a mínima fricção possível. Não substitui as skills específicas — é o canal de batch quando chegam vários itens de uma vez.

---

## Pipeline sagrado

A ordem abaixo é **inalterável**. Pular uma etapa quebra a UX.

### 1. Capturar
Receba o input bruto: texto livre, lista informal, áudio transcrito. Não interrompa o usuário enquanto ele despeja — deixe tudo sair.

### 2. Agrupar
Classifique internamente cada item em uma das cinco categorias:

| Categoria | Critério | Marker |
|---|---|---|
| `task` | ação executável com prazo plausível | `<<TASK_UPDATE>>` action="create" + `source: "mental_dump"` |
| `event` | tem data/hora marcada | `<<EVENT_CREATE>>` (notes inclui "via mental dump") |
| `project` | estrutura grande, 5W2H aplicável | `<<PROJECT_CREATE>>` |
| `memory` | reflexão, contexto, dúvida sem ação clara | `<<MEMORY_SAVE>>` memory_type="context", source="explicit" |
| `resolve_now` | resolvível em até 5 min na própria conversa | **não persiste automaticamente** — ver regra abaixo |

### 3. Propor
Apresente a classificação em texto humano antes de persistir qualquer coisa.

Exemplo:
> "Identifiquei 5 itens: 3 tarefas, 1 reunião, 1 anotação. Confirma ou quer ajustar algum?"

Seja específico — liste os títulos de cada item com sua categoria. Não pergunte categoria por categoria.

### 4. Confirmar
Espere o usuário confirmar ou ajustar. Só avance depois da resposta.

### 5. Persistir
Emita todos os markers em sequência na mesma resposta, após a confirmação.

### 6. Priorizar (oferta de fechamento)
Depois de persistir, **ofereça** a passada de prioridade Eisenhower em uma única pergunta. Não execute sem aceite.

Phrasing recomendado:

> "Organizei e registrei tudo. Quer que eu já passe isso por prioridade e te devolva em 4 blocos: resolve agora, agenda, delega e pode esperar?"

Variação curta aceitável: *"Quer que eu já transforme isso em plano de ação?"*

- **Se o usuário aceitar** ("sim", "vai", "manda", "bora") → ative a skill `priorizacao-inteligente` sobre os itens recém-capturados. Filtre pelos itens persistidos nesta interação (tasks com `source='mental_dump'` criadas nos últimos minutos + os events do mesmo lote). Devolva os 4 blocos: **resolve agora · agenda · delega · pode esperar**.
- **Se o usuário recusar** ("não", "depois", "deixa") → encerre a interação. Não insista. Não pergunte de novo na próxima mensagem.
- **Se o usuário já pediu priorização no input original** (ex: "anota e prioriza", "organiza e me diz o que faço primeiro") → pule a pergunta e execute direto a etapa 6 após persistir.

A etapa 6 é parte do pipeline sagrado. Capturar sem fechar com decisão quebra o ciclo cognitivo — o usuário fica com a sensação de "salvou mas não resolveu nada". A oferta é mandatória; o aceite é livre.

---

## Regra `resolve_now` — anti-buraco-negro

`resolve_now` só se aplica quando:
- A ação é claramente resolvível na própria conversa (resposta direta, info que o TOM já tem, decisão simples)
- O TOM apresenta a resolução **no texto da resposta**

Se o item não se encaixa nesses dois critérios, **reclassifique para `task`** — ou `task` com `remind_at` se for um lembrete. Nunca deixe um item em limbo. Nunca persista `resolve_now` em silêncio.

---

## Microconfirmação condicional

- **Item único e claro** ("anota: ligar pro fornecedor X amanhã") → emite o marker direto, sem propor/confirmar. Pipeline sagrado não se aplica pra casos triviais óbvios.
- **Lote (≥2 itens) OU item ambíguo** → pipeline sagrado completo, sem atalho.

---

## Pergunta proativa por papel (briefing auxiliar)

Quando o TOM faz a pergunta auxiliar no briefing, varie o phrasing conforme o `role` do colaborador:

- **Coord** (Juliana, Quintela, Anne): *"Tem professor pra conversar? Projeto travado? Aluno pedindo atenção?"*
- **Gerente** (Jereh, Clayton, Krissya): *"Tem aluno em risco? Atendimento pendente?"*
- **Director** (Alf, Anne quando director): *"Tem decisão estratégica em aberto?"*
- **Manager+all** (Yuri / Marketing): *"Tem campanha travada? Briefing pendente?"*

A pergunta é feita **uma vez por dia** no máximo, sem repetição dentro do mesmo briefing.

---

## Tag de origem — rastreabilidade

Todos os artefatos persistidos via lista mental carregam marca de origem:

- **Tasks:** `source: "mental_dump"` no `<<TASK_UPDATE>>`
- **Memórias:** `source: "explicit"` + conteúdo prefixado com `(via mental dump YYYY-MM-DD)`
- **Events e projects:** nota livre `Origem: mental dump YYYY-MM-DD` no campo notes/description

Use a data real do dia em que a captura aconteceu.

---

## Exemplos de markers

### Task

```
<<TASK_UPDATE>>
{
  "action": "create",
  "title": "Ligar pro fornecedor X",
  "due_date": "2026-05-06",
  "context": "work",
  "source": "mental_dump"
}
<<END>>
```

### Event

```
<<EVENT_CREATE>>
{
  "title": "Reunião com Juliana sobre captação",
  "start_at": "2026-05-07T10:00:00-03:00",
  "end_at": "2026-05-07T11:00:00-03:00",
  "modality": "presencial",
  "category": "la_music",
  "notes": "via mental dump — agendado em 2026-05-05"
}
<<END>>
```

### Memory

```
<<MEMORY_SAVE>>
{
  "collaborator_id": "{{collaborator_id}}",
  "memory_type": "context",
  "source": "explicit",
  "content": "(via mental dump 2026-05-05) Alf quer revisar o modelo de captação da Barra antes do próximo ciclo."
}
<<END>>
```

### Project

```
<<PROJECT_CREATE>>
{
  "name": "Reestruturação captação Barra",
  "description": "Origem: mental dump 2026-05-05. Rever modelo de captação da unidade Barra — múltiplas frentes, prazo a definir.",
  "context": "work"
}
<<END>>
```

---

## Não-objetivos

- **Não substitui** skills específicas. Itens individuais continuam fluindo via `criar-compromisso`, `priorizacao-inteligente`, `cadastro-projeto-5w2h`. Lista mental é o canal de batch.
- **Não inventa markers**. Use apenas `<<TASK_UPDATE>>`, `<<EVENT_CREATE>>`, `<<MEMORY_SAVE>>`, `<<PROJECT_CREATE>>`. `<<MENTAL_DUMP>>` não existe — nunca emita.
- **Não persiste `resolve_now` em silêncio**. Se resolveu na conversa, diz no texto. Se não dá pra resolver, vira `task`.

---

## Veto

- NUNCA emita markers sem confirmação em lote (≥2 itens).
- NUNCA deixe um item sem classificação — todo item tem destino.
- NUNCA omita `source: "mental_dump"` nas tasks capturadas aqui.
- NUNCA pule a oferta de priorização da etapa 6 — capturar sem fechar com decisão quebra o ciclo cognitivo.
- NUNCA execute a priorização sem aceite explícito (exceto se o input original já pediu).
- NUNCA use 🎵.
- NUNCA repita 👽 dentro do mesmo fluxo (só na primeira mensagem da interação, se for o caso).
- NUNCA prometa "vou salvar" sem emitir o marker na mesma mensagem.
