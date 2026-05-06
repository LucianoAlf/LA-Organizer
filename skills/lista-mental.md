---
name: lista-mental
description: Skill para esvaziar a cabeça do usuário em lote. Ativa quando há ≥3 itens distintos, ou frases como "tô com várias coisas na cabeça", "lista mental", "descarrega essa lista", "anota tudo isso", "tô confuso, vamos organizar". Classifica cada item em task/event/project/memory/resolve_now, persiste com os markers existentes e devolve um plano de ação prático por padrão.
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

A lista mental existe para tirar da cabeça do usuário tudo o que está solto e devolver isso em forma de clareza prática.

Ela não serve só para registrar. Serve para transformar carga mental em:
- tarefas
- compromissos
- projetos
- contexto relevante
- e, principalmente, **próximos passos úteis**

Se o TOM apenas salvar e organizar, mas não ajudar a decidir, ele resolveu pela metade.

Não substitui as skills específicas — é o canal de batch quando chegam vários itens de uma vez.

---

## Princípio central

**Lista mental não devolve lista organizada. Devolve plano de ação.**

O objetivo final desta skill não é produzir um inventário bonito.  
É reduzir carga cognitiva e devolver direção prática.

---

## Pipeline sagrado

A ordem abaixo é **inalterável**. Pular uma etapa quebra a UX.

### 1. Capturar
Receba o input bruto: texto livre, lista informal, áudio transcrito.  
Não interrompa o usuário enquanto ele despeja — deixe tudo sair.

### 2. Agrupar
Classifique internamente cada item em uma das cinco categorias:

| Categoria | Critério | Marker |
|---|---|---|
| `task` | ação executável com prazo plausível | `<<TASK_UPDATE>>` action="create" + `source: "mental_dump"` |
| `event` | tem data/hora marcada | `<<EVENT_CREATE>>` (notes inclui origem do mental dump) |
| `project` | estrutura grande, 5W2H aplicável | `<<PROJECT_CREATE>>` |
| `memory` | reflexão, contexto, dúvida sem ação clara | `<<MEMORY_SAVE>>` memory_type="context", source="explicit" |
| `resolve_now` | resolvível em até 5 min na própria conversa | **não persiste automaticamente** — ver regra abaixo |

### 3. Propor
Apresente a classificação em texto humano antes de persistir qualquer coisa.

Exemplo:
> "Identifiquei 5 itens: 3 tarefas, 1 reunião, 1 anotação. Confirma ou quer ajustar algum?"

Seja específico — liste os títulos de cada item com sua categoria.  
Não pergunte categoria por categoria.

### 4. Confirmar
Espere o usuário confirmar ou ajustar. Só avance depois da resposta.

### 5. Persistir
Emita todos os markers em sequência na mesma resposta, após a confirmação.

### 6. Priorizar e devolver plano de ação
Depois de persistir, o TOM **deve** devolver um plano de ação por padrão.

A saída padrão da lista mental é:

- **faz agora**
- **agenda**
- **delega / verifica**
- **pode esperar**

Use a lógica da `priorizacao-inteligente`, mas sem expor "Eisenhower", quadrantes ou jargão interno.

### Regra principal da etapa 6
A priorização é **automática por padrão**.

### Exceções
Só não priorize automaticamente quando:
- o usuário pedir explicitamente **apenas captura** (`"só anota"`, `"só salva"`, `"depois eu vejo"`)
- houver ambiguidade séria suficiente para bloquear a decisão útil
- faltar informação crítica que torne a priorização irresponsável

### Quando o usuário já pede prioridade
Se o usuário disser algo como:
- "anota e prioriza"
- "organiza e me diz o que faço primeiro"
- "me devolve isso em ordem"
- "o que eu resolvo agora?"

entregue a priorização naturalmente, sem mencionar etapas internas.

### Forma da saída
A resposta final precisa parecer **agenda de ação**, não apenas lista organizada.

Exemplo:
> "Registrei e organizei.  
> *Faz agora*  
> • Ligar pro Lenildo  
> • Confirmar X  
>
> *Agenda*  
> • Encontro do livro — sexta  
> • Reunião com Ana — quinta  
>
> *Delega / verifica*  
> • Questão jurídica SonoraMente  
>
> *Pode esperar*  
> • Projeto dos agentes operacionais"

Se faltar algum detalhe menor, assuma default razoável e siga.

---

## Regra `resolve_now` — anti-buraco-negro

`resolve_now` só se aplica quando:
- a ação é claramente resolvível na própria conversa
- o TOM consegue apresentar a resolução **no texto da resposta**

Exemplos:
- resposta direta
- informação que o TOM já tem
- decisão simples que não exige persistência

Se o item não se encaixa nesses dois critérios, **reclassifique para `task`** — ou `task` com `remind_at` se for um lembrete.

Nunca deixe um item em limbo.  
Nunca persista `resolve_now` em silêncio.

---

## Regra de defaults razoáveis

O TOM não deve transformar falta de detalhe em interrogatório.

Se a ausência de informação **não bloquear** a decisão útil, assuma um default razoável e siga.

Exemplos:
- sem horário → trate como compromisso flexível / agenda do dia
- sem prazo claro → assuma "esta semana"
- sem definição completa → classifique no melhor bloco útil (`delega/verifica` ou `pode esperar`)
- sem detalhe fino → registre o suficiente para não perder a ação

Pergunte apenas quando a falta de informação impedir:
- classificar
- persistir com segurança
- ou devolver um plano de ação minimamente confiável

---

## Microconfirmação condicional

- **Item único e claro**  
  Ex.: "anota: ligar pro fornecedor X amanhã"  
  → emite o marker direto, sem propor/confirmar.  
  O pipeline sagrado não precisa ser expandido em casos triviais óbvios.

- **Lote (≥2 itens) OU item ambíguo**  
  → pipeline sagrado completo, sem atalho.

---

## Pergunta proativa por papel (briefing auxiliar)

Quando o TOM faz a pergunta auxiliar no briefing, varie o phrasing conforme o `role` do colaborador:

- **Coord** (Juliana, Quintela, Anne):  
  *"Tem professor pra conversar? Projeto travado? Aluno pedindo atenção?"*

- **Gerente** (Jereh, Clayton, Krissya):  
  *"Tem aluno em risco? Atendimento pendente?"*

- **Director** (Alf, Anne quando director):  
  *"Tem decisão estratégica em aberto?"*

- **Manager+all** (Yuri / Marketing):  
  *"Tem campanha travada? Briefing pendente?"*

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

```text
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

```text
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

```text
<<MEMORY_SAVE>>
{
 "memory_type": "context",
 "source": "explicit",
 "content": "(via mental dump 2026-05-05) Revisar o modelo de captação da Barra antes do próximo ciclo."
}
<<END>>
```

### Project

```text
<<PROJECT_CREATE>>
{
 "name": "Reestruturação captação Barra",
 "description": "Origem: mental dump 2026-05-05. Rever modelo de captação da unidade Barra — múltiplas frentes, prazo a definir."
}
<<END>>
```

---

## Não-objetivos

- **Não substitui** skills específicas. Itens individuais continuam fluindo via `criar-compromisso`, `priorizacao-inteligente`, `cadastro-projeto-5w2h`. Lista mental é o canal de batch.
- **Não inventa markers.** Use apenas `<<TASK_UPDATE>>`, `<<EVENT_CREATE>>`, `<<MEMORY_SAVE>>`, `<<PROJECT_CREATE>>`. `<<MENTAL_DUMP>>` não existe — nunca emita.
- **Não persiste `resolve_now` em silêncio.** Se resolveu na conversa, diz no texto. Se não dá pra resolver, vira `task`.
- **Não termina em lista organizada se já houver informação suficiente para devolver direção prática.**

---

## Veto

- NUNCA emita markers sem confirmação em lote (≥2 itens).
- NUNCA deixe um item sem classificação — todo item tem destino.
- NUNCA omita `source: "mental_dump"` nas tasks capturadas aqui.
- NUNCA encerre uma lista mental grande apenas com registro organizado se já houver informação suficiente para devolver próximos passos.
- NUNCA transforme a priorização em pergunta extra quando já houver material suficiente para devolver um plano de ação útil.
- NUNCA deixe de priorizar automaticamente salvo opt-out explícito do usuário ou bloqueio real de entendimento.
- NUNCA reemita `action: "create"` para um item cujo conflito o usuário acabou de resolver com "1" — esse item está fechado; a task existente já cobre. Apenas confirme em texto.
- Quando user responde "2" (outro caso) a uma microconfirmação de duplicata: use um título **explicitamente diferente** do item existente citado — nunca o mesmo título.
- Dívida estrutural conhecida: o engine processa um dup por turno (early return). Num batch de N itens com M conflitos, haverá M turnos de microconfirmação antes de chegar na proposta final. Isso é limitação de design atual, não bug da skill — informe o usuário se perguntar por que há múltiplas confirmações.
- NUNCA use 🎵.
- NUNCA repita 👽 dentro do mesmo fluxo (só na primeira mensagem da interação, se for o caso).
- NUNCA prometa "vou salvar" sem emitir o marker na mesma mensagem.
