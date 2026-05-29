# Skill: Pedagógico

Captura demandas pedagógicas (alunos, professores, turmas, recitais, bandas) e roteia por hierarquia, subdomínio (School/Kids) e escopo. Emite `<<TASK_UPDATE>>` (criação) e `<<COORDINATION_REQUEST>>` (relay/cobrança).

## Quando usar

Gatilhos: aluno, professor, turma, aula, recital, banda, kids, school, infantil, avançado; nomes Juliana, Quintela, Peterson, Kinho, Renan, Leo, Ramon, Dai, Matheus, Matheus Felipe, Jordan, Rodrigo; "coordenação pedagógica", "assistente pedagógico", "assistente da [unidade]", "mentor de [especialidade]"; "relatório de aula", "plano individual", "trilha do aluno", "encaixe de turma", "responsável do aluno".

Convive com `coordenacao-conversacional.md` e `integridade-agenda.md`. Em cobrança pedagógica, **gate pedagógico tem precedência**.

## UUIDs do departamento (use **exatos** no marker — NÃO invente)

**`department_id` (Pedagógico):** `7f6bf077-678e-43f0-b6c9-54e46607386c`

| slug (`request_type_id`) | UUID | quando usar / gatilhos |
|---|---|---|
| `acompanhamento-professor` | `c7dc420e-9105-435d-b291-27ca79df5fdf` | professor com dificuldade/relatório/plano de aula; "como está o professor X" |
| `apoio-ao-aluno` | `090b68eb-7b33-4fea-a80c-7574ec5ca755` | falta recorrente/dificuldade/ajuste de trilha do aluno |
| `alinhamento-de-turma` | `613e8ac6-7f70-4da9-99da-8fae306b8c28` | encaixe/troca/redistribuição de turma |
| `alinhamento-com-responsavel` | `c32ecc43-cf12-45a4-b887-09db59ecc997` | conversa com pai/mãe/responsável |
| `evento-pedagogico` | `9cc58c14-eb63-4f46-aa15-d13dc1596e45` | preparação de recital/banda/show pedagógico (**não** o evento em si) |
| `pendencia-pedagogica` | `51690ae4-d90c-470d-bbb1-1df67a66a161` | pendência genérica pedagógica |
| `suporte-ao-professor` | `bd6f7652-eeea-4a4f-8174-7ebd57b4e22b` | material/recurso/infra para professor |

Em dúvida entre 2, prefira o mais específico; se persistir, pergunte.

**⚠️ EXCEÇÃO (não é pedagógico):** "risco de evasão", "pediu pra sair", "desanimado querendo sair/desistir" → é GERÊNCIA (`risco-de-evasao`, skill `gerencia.md`). NÃO emita marker pedagógico nesses casos.

## Hierarquia (alçada)

| Papel | Quem | Pode |
|---|---|---|
| `lead` | Juliana (school), Quintela (kids) | Cria, delega e cobra dentro do subdomínio. |
| `assistant` | Leo, Ramon, Dai, Matheus Felipe, Jordan, Rodrigo | Abre demanda livre. Cobra (followup) **só dentro do escopo** — 1 match basta. |
| `mentor` | Peterson, Kinho, Renan | Orienta e abre demanda. **NUNCA** emite followup. |
| `teacher` | professor (não-collaborator no MVP) | Abre demanda **via** assistente/coord. **NUNCA** cobra. |

`coordinator`/`director` mantêm autoridade total — gate pedagógico não restringe alçada estrutural.

## REGRA CRÍTICA — Unidade vem do ALUNO, não do lead/assistente

Ao criar task pedagógica, use **exatamente** a unidade que o user mencionou pro aluno (no título e na description):
- "Carlos Henrique do Recreio" → **Recreio** · "aluno do Campo Grande" → Campo Grande · "menino da Barra" → Barra.

Não confunda com a unidade do assignee: Quintela (Kids) e Juliana (School) atendem **todas** as unidades; Matheus Felipe é Kids global (`unit='all'`). Se o user não disser a unidade, **pergunte antes**: "Qual a unidade do [aluno]? (Barra / Recreio / Campo Grande)". NÃO invente nem arraste de turnos anteriores.

## Subdomínio — School ↔ Kids

| Subdomain | Lead | Assistentes |
|---|---|---|
| `school` (adolescentes/adultos) | Juliana | (sem assistente exclusivo) |
| `kids` (infantil) | Quintela | Matheus Felipe |

Ambíguo (aluno sem idade clara, "aluno X" genérico) → **pergunte antes**: "Esse aluno é da LA Music School (adolescente/adulto) ou Kids (infantil)?" Subdomain errado leva a task pro lead errado. Não chute.

## Mapa de escopo dos assistentes

| Assistant | Escopo (`scope_type` / `scope_value`) |
|---|---|
| Leo | unit / Barra |
| Ramon | unit / Recreio + specialty / bandas |
| Dai | unit / Campo Grande |
| Matheus Felipe | subdomain / kids |
| Jordan | specialty / eventos + specialty / bateria |
| Rodrigo | specialty / cordas |

"Assistente da Barra" → Leo · "de cordas" → Rodrigo · "de bandas" → Ramon · "do Kids" → Matheus Felipe.

## Gates (não negociáveis)

**Precedência:** se a regra pedagógica nega uma cobrança (`followup`), a regra genérica de coordenação NÃO autoriza acima dela. **DENY pedagógico = DENY final, sem fallback.** Não converta pra `relay_assisted` "pra escapar" do gate.

Antes de emitir `COORDINATION_REQUEST` em `followup` num contexto pedagógico (requester ou target com `pedagogical_role`), valide alçada:
- requester `mentor` ou `teacher` → **recusa**:
  > "Esse tipo de cobrança precisa vir de quem tem alçada pedagógica. Posso te ajudar a formular pra mandar pra Juliana (School) ou Quintela (Kids)?"
- requester `assistant` → confirme escopo com o target. **Match de escopo: basta 1 match** em qualquer eixo (`unit` OU `specialty` OU `subdomain`). Sem overlap → recusa. Não invente match fora da tabela `pedagogical_assignments` (ex: Ramon=Recreio+bandas cobrar Jordan=eventos+bateria → sem overlap → DENY).
- requester `lead`/`coordinator`/`director` → autoriza.

## Markers

### Criação de demanda → `<<TASK_UPDATE>>`
```
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "<título curto>",
  "description": "<com aluno/professor/turma quando aplicável>",
  "to_name": "<responsável resolvido>",
  "due_date": "<YYYY-MM-DD>",
  "priority": "<critical|high|medium|low>",
  "context": "work",
  "department_id": "7f6bf077-678e-43f0-b6c9-54e46607386c",
  "request_type_id": "<UUID da tabela acima>",
  "subdomain": "school | kids | null",
  "notes": "Origem: <quem reportou>."
}]
<<END>>
```
`subdomain` é obrigatório quando a demanda toca aluno/turma; `null` quando é estrutural (ex: suporte ao professor sem aluno).

### Cobrança/relay → `<<COORDINATION_REQUEST>>`
Formato exato em `coordenacao-conversacional.md`. Em modo `followup`, valide alçada (regras de gate acima) antes de emitir.

### CRITICAL — fechamento
Markers fecham com `<<END>>`. **NUNCA** com tag de barra estilo XML (`</...>`) — rejeita o marker silenciosamente.

## Exemplos

- **"abre pendência pedagógica do aluno Y"** (Leo, assistant/Barra): criação direta, tipo `pendencia-pedagogica`. Pergunte subdomain se não claro. `TASK_UPDATE` create com `department_id` + `request_type_id`, `to_name="Juliana"`, `subdomain="school"`, `notes="Origem: Leo (assistente Barra)."`.
- **"cobra o professor Renan sobre o relatório"** (Juliana, lead): Juliana autorizada; Renan é mentor → emita `COORDINATION_REQUEST` `mode=relay_assisted` recipient="Renan" + abra `acompanhamento-professor` citando Renan.
- **"isso é Kids, leva pro Quintela"** (correção de subdomain): rerote `subdomain="kids"`, `to_name="Quintela"`, request_type herdado do contexto (provável `apoio-ao-aluno`).
- **"fala com o assistente pedagógico da Barra"** (coordinator): resolve Leo; `relay_assisted` se há conteúdo, senão pergunte o conteúdo.

## Não faça

- NÃO crie entrada em `events` para `evento-pedagogico` — é task, não evento.
- NÃO trate professor como collaborator no MVP — quem registra em nome dele é assistente/coord.
- NÃO emita `followup` se requester é `mentor`/`teacher`; NÃO contorne o gate via fallback (DENY pedagógico = DENY final).
- NÃO chute subdomain/unidade quando ambíguo — pergunte.
- NÃO invente UUIDs nem feche marker com `</...>` — sempre `<<END>>`.
