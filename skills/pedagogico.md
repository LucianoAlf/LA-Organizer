# Skill: Pedagógico

Captura demandas pedagógicas (alunos, professores, turmas, recitais, bandas) e roteia por hierarquia, subdomínio (School/Kids) e escopo. Emite `<<TASK_UPDATE>>` (criação) e `<<COORDINATION_REQUEST>>` (relay/cobrança).

---

## Quando usar

Gatilhos: aluno, professor, turma, aula, recital, banda, kids, school, infantil, avançado; nomes Juliana, Quintela, Peterson, Kinho, Renan, Leo, Ramon, Dai, Matheus, Matheus Felipe, Jordan, Rodrigo; "coordenação pedagógica", "assistente pedagógico", "assistente da [unidade]", "mentor de [especialidade]"; "relatório de aula", "plano individual", "trilha do aluno", "encaixe de turma", "responsável do aluno".

Convive com `coordenacao-conversacional.md` e `integridade-agenda.md`. Em cobrança pedagógica, **gate pedagógico tem precedência** (ver §Regras).

---

## UUIDs do departamento (use **exatos** no marker — NÃO invente)

**`department_id` (Pedagógico):** `7f6bf077-678e-43f0-b6c9-54e46607386c`

**`request_type_id` por slug:**

| slug | request_type_id |
|---|---|
| `acompanhamento-professor` | `c7dc420e-9105-435d-b291-27ca79df5fdf` |
| `apoio-ao-aluno` | `090b68eb-7b33-4fea-a80c-7574ec5ca755` |
| `alinhamento-de-turma` | `613e8ac6-7f70-4da9-99da-8fae306b8c28` |
| `alinhamento-com-responsavel` | `c32ecc43-cf12-45a4-b887-09db59ecc997` |
| `evento-pedagogico` | `9cc58c14-eb63-4f46-aa15-d13dc1596e45` |
| `pendencia-pedagogica` | `51690ae4-d90c-470d-bbb1-1df67a66a161` |
| `suporte-ao-professor` | `bd6f7652-eeea-4a4f-8174-7ebd57b4e22b` |

**Como escolher request_type:**
- Professor com dificuldade/relatório/plano de aula → `acompanhamento-professor`
- Falta recorrente/dificuldade pedagógica/ajuste de trilha do aluno → `apoio-ao-aluno`
  - **EXCEÇÃO:** "risco de evasão", "pediu pra sair", "desanimado querendo sair", "querendo desistir" NÃO É `apoio-ao-aluno` — é GERÊNCIA (`risco-de-evasao`). Skill `gerencia.md` cuida. Nesses casos, NÃO emita marker pedagógico.
- Encaixe/troca/redistribuição de turma → `alinhamento-de-turma`
- Conversa com pai/mãe/responsável → `alinhamento-com-responsavel`
- Recital/banda/show pedagógico → `evento-pedagogico`
- Pendência genérica pedagógica → `pendencia-pedagogica`
- Material/recurso/infra para professor → `suporte-ao-professor`

---

## Hierarquia (alçada)

| Papel | Quem | Pode |
|---|---|---|
| `lead` | Juliana (school), Quintela (kids) | Cria, delega e cobra dentro do subdomínio. |
| `assistant` | Leo, Ramon, Dai, Matheus Felipe, Jordan, Rodrigo | Abre demanda livre. Cobra (followup) **só dentro do escopo** — 1 match basta. |
| `mentor` | Peterson, Kinho, Renan | Orienta e abre demanda. **NUNCA** emite followup. |
| `teacher` | professor (não-collaborator no MVP) | Abre demanda **via** assistente/coord. **NUNCA** cobra. |

`coordinator`/`director` mantêm autoridade total — gate pedagógico não restringe alçada estrutural.

---

## REGRA CRÍTICA — Unidade vem do ALUNO, NÃO do lead/assistente

Quando criar task pedagógica e o user mencionar a unidade do aluno, **use EXATAMENTE essa unidade no título e na description**:

- "Carlos Henrique do Recreio, 8 anos" → unidade é **Recreio** (não Campo Grande, não inferir do Quintela)
- "aluno do Campo Grande" → Campo Grande
- "menino da Barra" → Barra

**Não confunda com a unidade do assignee:**
- Lead Quintela atende **todas** as unidades de Kids (Barra, Recreio, Campo Grande). NÃO assuma "Campo Grande" só porque Quintela é o assignee.
- Lead Juliana atende todas de School. Mesma regra.
- Assistant Matheus Felipe é Kids global (`unit='all'` no banco), NÃO Campo Grande.

**Se o user não disser a unidade**, pergunte ANTES de criar: "Qual a unidade do [aluno]? (Barra / Recreio / Campo Grande)"

**NÃO invente unidade.** **NÃO arraste do contexto de turnos anteriores** (ex: outra task de outra unidade que apareceu antes).

---

---

## Escola — LA Music School ↔ LA Music Kids

| Subdomain | Lead | Assistentes vinculados |
|---|---|---|
| `school` (adolescentes/adultos) | Juliana | (sem assistente exclusivo de subdomain) |
| `kids` (infantil) | Quintela | Matheus Felipe |

**Quando ambíguo** (aluno sem idade clara, demanda genérica como "aluno X"), **pergunte antes** de criar:

> "Esse aluno é da LA Music School (adolescente/adulto) ou da LA Music Kids (infantil)? Pra eu rotear pra Juliana ou Quintela."

Não chute. Subdomain errado leva a task pro lead errado.

---

## Mapa de escopo dos assistentes

| Assistant | Escopo (`scope_type` / `scope_value`) |
|---|---|
| Leo | unit / Barra |
| Ramon | unit / Recreio + specialty / bandas |
| Dai | unit / Campo Grande |
| Matheus Felipe | subdomain / kids |
| Jordan | specialty / eventos + specialty / bateria |
| Rodrigo | specialty / cordas |

"Assistente pedagógico da Barra" → Leo. "De cordas" → Rodrigo. "De bandas" → Ramon. "Do Kids" → Matheus Felipe (apoia Quintela).

---

## 7 tipos de demanda

Em dúvida entre 2, prefira o mais específico; se persistir, pergunte.

| slug | gatilhos |
|---|---|
| `acompanhamento-professor` | "relatório de aula", "como está o professor X", "plano individual" |
| `apoio-ao-aluno` | "aluno faltando", "dificuldade dele", "trocar a trilha" |
| `alinhamento-de-turma` | "troca aluno de turma", "encaixe", "redistribuição" |
| `alinhamento-com-responsavel` | "fala com a mãe/pai", "alinha com o responsável" |
| `evento-pedagogico` | "prepara o recital", "ensaio da banda" — preparação, **não o evento** |
| `pendencia-pedagogica` | "abre uma pendência pedagógica do aluno Y" |
| `suporte-ao-professor` | "professor precisando de material/infra/recurso" |

---

## REGRA DE PRECEDÊNCIA DE GATE (não negociável)

**Se a regra pedagógica negar uma cobrança (`followup`), a regra genérica de coordenação NÃO autoriza acima dela.** DENY pedagógico = DENY final, sem fallback.

Antes de emitir `COORDINATION_REQUEST` em `followup` num contexto pedagógico (requester ou target com `pedagogical_role`), valide alçada. Se nega, recuse:

> "Esse tipo de cobrança precisa vir de quem tem alçada pedagógica para isso. Posso te ajudar a formular para mandar pra Juliana (LA Music School) ou Quintela (LA Music Kids)?"

Não converta para `relay_assisted` "para escapar" do gate — pedido negado é negado, não reroteado.

## REGRA DE MATCH DE ESCOPO

Para um `assistant` cobrar outro `assistant`, **basta 1 match em qualquer eixo**: `unit` OU `specialty` OU `subdomain`. Não exija múltiplos.

Exemplo: Ramon (Recreio + bandas) cobrar Jordan (eventos + bateria) → sem overlap → DENY. Não invente match que não existe na tabela `pedagogical_assignments`.

---

## Markers que você emite

### Criação de demanda → `<<TASK_UPDATE>>`

```
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "<título curto>",
  "description": "<descrição com aluno/professor/turma quando aplicável>",
  "to_name": "<nome do responsável resolvido>",
  "due_date": "<YYYY-MM-DD>",
  "priority": "<critical|high|medium|low>",
  "context": "work",
  "department_id": "7f6bf077-678e-43f0-b6c9-54e46607386c",
  "request_type_id": "<escolha um dos UUIDs da tabela abaixo>",
  "subdomain": "school | kids | null",
  "notes": "Origem: <quem reportou>."
}]
<<END>>
```

`subdomain` é obrigatório quando a demanda toca aluno/turma; `null` quando é estrutural (ex: suporte ao professor sem aluno).

### Cobrança/relay → `<<COORDINATION_REQUEST>>`

Use o formato exato definido em `coordenacao-conversacional.md`. Antes de emitir em modo `followup`, **valide alçada**:
- requester é `mentor` ou `teacher` → recusa (mensagem acima).
- requester é `assistant` → confirme escopo (1 match) com o target. Sem overlap → recusa.
- requester é `lead`/`coordinator`/`director` → autorize.

### CRITICAL — fechamento de marker

Markers fecham com `<<END>>`. **NUNCA** com tag de barra estilo XML (ex.: `</...>`). Esse erro de sintaxe rejeita o marker silenciosamente no engine.

---

## 6 exemplos canônicos

### Ex.1 — "cobra o professor Renan sobre o relatório de aula" (requester: Juliana, lead/school)

- Modo: `followup` (cobrança).
- Validação: Juliana é `lead` → autorizada. Renan é `mentor`, não target padrão de followup; converta para `relay_assisted` (não é fuga ao gate — é alinhamento de papel).
- Ação: emita `COORDINATION_REQUEST` com `mode=relay_assisted`, recipient="Renan". Em paralelo, abra `acompanhamento-professor` citando Renan no description.

### Ex.2 — "alinha com a Juliana o planejamento do recital" (requester: coordinator)

- Modo: `relay_assisted` (alinhamento, não cobrança).
- Validação: requester=coordinator → autorizado. Emita `COORDINATION_REQUEST` (formato em `coordenacao-conversacional.md`).

### Ex.3 — "isso é Kids, leva pro Quintela" (requester: Juliana; aluno mencionado antes)

- Inferência: correção de subdomain. Rerote como `subdomain="kids"`, `to_name="Quintela"`.
- Ação: emita `TASK_UPDATE` com `action=create`, request_type herdado do contexto (provável `apoio-ao-aluno`).

### Ex.4 — "abre uma pendência pedagógica do aluno Y" (requester: Leo, assistant/Barra)

- Modo: criação direta. Tipo: `pendencia-pedagogica`. Pergunte subdomain se não claro.
- Emita `TASK_UPDATE` com `department_id` + `request_type_id` do UUID acima, `to_name="Juliana"`, `subdomain="school"`, `notes="Origem: Leo (assistente Barra)."`. Formato em §Markers.

### Ex.5 — "fala com o assistente pedagógico da Barra" (requester: coordinator)

- Resolva: assistente da Barra = Leo (mapa de escopo).
- Modo: `relay_assisted` se há conteúdo; pergunte conteúdo se ausente.
- Marker: `COORDINATION_REQUEST` com `recipient_name="Leo"`.

### Ex.6 — "professor tal está precisando de material" (requester: Leo, assistant/Barra)

- Tipo: `suporte-ao-professor`. Subdomain pode ser `null` se o material é estrutural.
- Marker: `TASK_UPDATE` com `request_type_id` = suporte-ao-professor, `to_name="Juliana"`, `subdomain=null`, descrição citando o professor e Leo como origem. Mesmo formato de bloco do Ex.4.

---

## Não faça

- **NÃO** crie entrada em `events` para `evento-pedagogico` — é task, não evento. O show em si pode existir como evento separado pela skill de eventos.
- **NÃO** trate professor como collaborator no MVP. Quem registra em nome do professor é assistente/coord.
- **NÃO** emita `followup` se requester é `mentor` ou `teacher`. Recuse.
- **NÃO** contorne o gate pedagógico via fallback genérico. DENY pedagógico = DENY final.
- **NÃO** chute subdomain quando ambíguo. Pergunte.
- **NÃO** feche markers com tag de barra estilo XML. Sempre `<<END>>`.
- **NÃO** invente UUIDs — `department_id` e `request_type_id` vêm do seed (resolvidos pelo engine via slug ou injetados pelo loader).
