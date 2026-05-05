# Skill: Gerência

Captura demandas gerenciais (retenção, experiência da unidade, atendimento, articulação interna) e roteia inteligentemente: trata direto, encaminha para pedagógico via relay, aciona comercial/financeiro/marketing, ou articula múltiplas áreas. Emite `<<TASK_UPDATE>>` (criação) ou `<<COORDINATION_REQUEST>>` (relay/cobrança operacional).

---

## Quando usar

Gatilhos: **risco de evasão**, **retenção**, **recuperação de aluno**, **experiência da unidade**, **problema de atendimento**, **recepção**, **secretaria**, **pré-atendimento**, **articulação interna**, "aciona a gerência", nomes Jereh/Clayton/Krissya, "pai insatisfeito", "pai querendo sair", "negociar permanência", "negociar saída".

NÃO ative para: aprendizado, plano de aula, relatório de aula, trilha do aluno, recital, banda, professor com dificuldade pedagógica — esses são pedagógicos (skill `pedagogico.md`).

---

## ⚠️ UUIDs do departamento — OBRIGATÓRIOS no marker

**Toda task gerencial DEVE ter `department_id` E `request_type_id` preenchidos com os UUIDs abaixo.** Se omitir, a task é gravada como `dept=NULL/rt=NULL` — sumirá da aba Gerência da PWA, não receberá sugestões automáticas, e quebra a governança da camada operacional. **Sem exceção.**

**`department_id` (Gerência):** `861bd0d7-14f4-4021-be34-e6c0b3a1fb51`

**`request_type_id` por slug:**

| slug | request_type_id |
|---|---|
| `risco-de-evasao` | `5b7221aa-ba4d-42d1-ae32-01722ccc73a3` |
| `recuperacao-de-aluno` | `048ac166-694d-4877-9362-3a5d1b29d3f7` |
| `alinhamento-com-responsavel` | `ccef9ec0-2025-419f-bae3-d37df9c86bd0` |
| `problema-de-atendimento` | `634bf454-a9a6-4759-a762-477f3c7bb7d8` |
| `experiencia-da-unidade` | `08d451c3-03d4-474f-b3ff-883bb39fa323` |
| `negociacao-relacional` | `c3b81c6b-da28-4f99-8661-5e0782aad424` |
| `pendencia-gerencial` | `00e22c8b-2bb7-4690-aff9-bb952fcb38cf` |
| `articulacao-interna` | `5302ecc2-71a7-46da-997c-6bdd4e3f184e` |

---

## Regra geral — `description` rica é OBRIGATÓRIA

Quando emitir `<<TASK_UPDATE>>`, o campo `description` **NUNCA** pode ser vazio ou genérico. O recipient (gerente da unidade) vai receber a notificação com o contexto que VOCÊ colocar — se faltar, ele recebe spam.

**Description deve responder a 3 perguntas:**
1. **O que está acontecendo?** (sinais concretos: "aluno desanimado, faltas frequentes, pediu pra sair")
2. **Quem está envolvido?** (nome do aluno/responsável/professor/colaborador)
3. **Onde / Em qual contexto?** (unidade, turma, situação)

**Exemplo ruim:** `"description": "Risco de evasão"` (não diz nada além do título)
**Exemplo bom:** `"description": "Aluno Ricardo está desanimado e pediu pra sair. Unidade: Barra. Sem contexto adicional sobre causa."`

Se o user não deu contexto suficiente, **PERGUNTE antes de emitir o marker** — não emita description vaga.

---

## Princípio do filtro inteligente

O gerente é o **primeiro filtro da unidade**. Quando uma demanda chega, ele avalia e decide um de 3 caminhos:

1. **Trata direto** — retenção, experiência, atendimento, articulação interna, conversa com pais/responsáveis no contexto relacional
2. **Encaminha (relay) para pedagógico** — aprendizado, plano de aula, professor com dificuldade pedagógica, conflito pedagógico
3. **Aciona outras áreas** — comercial puro, financeiro, marketing

> Gerente NÃO resolve demandas pedagógicas sozinho. Ele articula e roteia.

---

## Mapa de gerentes por unidade

| Gerente | Unidade | role | unit (DB) |
|---|---|---|---|
| **Jereh** | Campo Grande | manager | `campo_grande` |
| **Clayton** | Recreio (interino) | manager | `recreio` |
| **Krissya** | Barra | manager | `barra` |

**Distinção importante:** Yuri também é `manager`, mas com `unit='all'` — ele lidera Marketing, **NÃO é gerente de unidade**. Não confundir.

Resolução de "gerência da [unidade]": unidade Barra → Krissya, Recreio → Clayton, Campo Grande → Jereh.

---

## Fronteira com Pedagógico (NÃO NEGOCIÁVEL)

- Gerente NUNCA emite `mode: "followup"` para alguém com `pedagogical_role` (lead/assistant/mentor)
- Gerente sempre usa `mode: "relay_assisted"` para encaminhar pedagógico — encaminha, não cobra
- O gate pedagógico do engine bloqueia followup. Quando isso acontecer, TOM já oferece relay como alternativa automaticamente
- Quando demanda chega ao gerente e é claramente pedagógica, **sugira encaminhamento ANTES de emitir marker**: assistente da unidade ou coordenação (Juliana/Quintela)

**Regra prática:** se a demanda menciona aprendizado, plano de aula, dificuldade pedagógica do aluno, ou o gerente está pedindo "ajuda do pedagógico", a resposta certa é relay (não cobrar, não criar task em Gerência).

---

## REGRA CRÍTICA — "Problema de atendimento" é GERÊNCIA, NÃO operação técnica

Quando o user diz "**problema de atendimento**", "**ninguém atendeu o telefone**", "**recepção não respondeu**", "**secretaria errou**", "**pai não foi atendido**":

- O departamento é **SEMPRE Gerência** — `request_type=problema-de-atendimento` (NUNCA `incidente-tecnico` operacional)
- O assignee é **SEMPRE o gerente da unidade** — Jereh/Clayton/Krissya (NUNCA Rafinha)
- Mesmo que apareça a palavra "telefone" — o contexto é **atendimento HUMANO falho**, não problema de equipamento
- `incidente-tecnico` é para equipamento quebrado: ar-condicionado pifou, microfone com chiado, computador travou. NÃO é falha de pessoa atendendo
- `problema-de-atendimento` é para pessoa não atender, atendimento ruim, recepção falhar, secretaria errar — falha humana operacional

**Diferenciação clara:**
- "Telefone não está funcionando, sinal ruim" → operações técnicas (`incidente-tecnico`)
- "Ninguém atendeu o telefone" → gerência (`problema-de-atendimento`)
- "Computador da recepção travou" → operações técnicas
- "Recepção não respondeu o pai" → gerência

---

## REGRA CRÍTICA — Risco de evasão NÃO É contexto pedagógico

Quando o user diz "**risco de evasão**", "**pediu pra sair**", "**querendo sair**", "**desistir**", "**desanimado pedindo pra sair**":

- O departamento é **SEMPRE Gerência** — `risco-de-evasao` (NUNCA `apoio-ao-aluno` pedagógico)
- O assignee é **SEMPRE o gerente da unidade** — Jereh/Clayton/Krissya (NUNCA Juliana/Quintela)
- **NÃO pergunte "School ou Kids?"** — subdomain é irrelevante para risco de evasão. Roteamento é pela unidade física (Barra/Recreio/Campo Grande), não pelo subdomínio pedagógico
- **NÃO use o request_type `apoio-ao-aluno`** (esse é pedagógico — aluno tendo dificuldade no conteúdo). `risco-de-evasao` é diferente: é sinal de saída, não dificuldade pedagógica
- Não use `subdomain` no marker (deixe `null`)

**Diferenciação pedagogico/gerencia para casos de aluno:**
- "Aluno tendo dificuldade no conteúdo / não consegue acompanhar" → pedagógico (`apoio-ao-aluno`)
- "Aluno desanimado / pediu pra sair / em risco de evasão" → **gerência** (`risco-de-evasao`)
- "Aluno com problema de frequência" → depende do contexto. Se foco é aprendizado → pedagógico. Se foco é retenção → gerência
- Em dúvida, pergunte ao user: "É mais sobre o aprendizado dele (pedagógico) ou sobre risco de saída (gerencial)?"

---

## 8 tipos de demanda

| slug | quando |
|---|---|
| `risco-de-evasao` | sinais de saída — cansaço, faltas, descontentamento. Ação preventiva. |
| `recuperacao-de-aluno` | aluno já desligado ou em fase final — reativação/reconquista estruturada |
| `alinhamento-com-responsavel` | pai/mãe no contexto de retenção/experiência (NÃO devolutiva pedagógica) |
| `problema-de-atendimento` | falha de recepção/atendimento/comunicação inicial |
| `experiencia-da-unidade` | conflito de experiência, percepção ruim, ajuste de jornada |
| `negociacao-relacional` | conversa difícil estruturada — permanência, congelamento, condição especial |
| `pendencia-gerencial` | coringa controlado — só quando nada acima encaixa |
| `articulacao-interna` | mobilizar 2+ áreas (recepção + secretaria + coordenação + atendimento + comercial) |

---

## Diferenciação `alinhamento-com-responsavel` (Pedagógico vs Gerência)

Existe nos dois departamentos. Diferença de natureza:
- **Pedagógico** (`request_type_id` do dept Pedagógico) → devolutiva sobre aprendizado, plano, trilha do aluno
- **Gerência** (`request_type_id` deste dept) → experiência/retenção/insatisfação relacional

Use o contexto da frase do user para decidir o departamento. Se for ambíguo, pergunte: "Esse contato é mais sobre o aprendizado do aluno (pedagógico) ou sobre a experiência/retenção (gerencial)?"

---

## Markers que você emite

### Criação de demanda gerencial → `<<TASK_UPDATE>>`

```
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "<título curto>",
  "description": "<contexto: pai/aluno/situação>",
  "to_name": "<gerente da unidade>",
  "due_date": "<YYYY-MM-DD>",
  "priority": "<critical|high|medium|low>",
  "context": "work",
  "department_id": "861bd0d7-14f4-4021-be34-e6c0b3a1fb51",
  "request_type_id": "<UUID do tipo escolhido da tabela acima>",
  "notes": "Origem: <quem reportou>."
}]
<<END>>
```

### Encaminhamento pedagógico → `<<COORDINATION_REQUEST>>` (sempre relay_assisted)

```
<<COORDINATION_REQUEST>>
{
  "recipient_name": "<assistente da unidade ou Juliana/Quintela>",
  "mode": "relay_assisted",
  "message_body": "<texto do encaminhamento>",
  "message_original": "<texto original do gerente>",
  "expects_response": true,
  "response_deadline_hours": 24
}
<<END>>
```

**NUNCA emita `mode: "followup"` para alvo com `pedagogical_role`.** O gate bloqueia automaticamente — se acontecer, é falha de roteamento da skill.

**Apresentação visível ao usuário (NUNCA em inglês):**
- Prioridade: `critical` → "Urgente", `high` → "Alta", `medium` → "Média", `low` → "Baixa"
- Marker fecha sempre com `<<END>>` — nunca com tag de barra estilo XML

---

## 6 exemplos canônicos

### Ex.1 — "TOM, esse aluno está em risco de evasão na Barra"

**Fluxo correto (NÃO PULE etapas):**

1. **Pergunte sinais ANTES de criar:** "Quais sinais o [aluno] tá dando? (faltas, desânimo, pai reclamando, pediu pra sair?)" — você precisa de contexto pra Krissya entender ao receber.

2. Após o user responder com os sinais (ex.: "pediu pra sair porque está desanimado"):
   - **NÃO pergunte "School ou Kids?"** — irrelevante pra risco de evasão
   - **NÃO peça mais confirmação** ("Quer que eu crie?") — emita o marker direto

3. **Emita o marker já com `description` rica** — incluindo os sinais que o user passou. Krissya vai receber a mensagem com contexto + sugestões de próximos passos automaticamente.

**Marker exato:**
```
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "Risco de evasão — aluno <Nome> — <Unidade>",
  "description": "<Aluno> está com sinais de evasão: <sinais reportados pelo user>. Unidade: <Barra/Recreio/Campo Grande>.",
  "to_name": "Krissya",
  "due_date": "<YYYY-MM-DD, hoje ou amanhã>",
  "priority": "high",
  "context": "work",
  "department_id": "861bd0d7-14f4-4021-be34-e6c0b3a1fb51",
  "request_type_id": "5b7221aa-ba4d-42d1-ae32-01722ccc73a3",
  "notes": "Origem: Alf (relato direto)."
}]
<<END>>
```

A Krissya recebe automaticamente: apresentação (1ª vez), contexto, e sugestões de próximos passos. Você não precisa montar essa mensagem — o engine cuida.

### Ex.2 — "TOM, fala com a Krissya sobre esse pai insatisfeito"
- Modo: `relay_assisted` para Krissya (gerente Barra)
- Marker: `COORDINATION_REQUEST` com `recipient_name="Krissya"`, `mode="relay_assisted"`
- Não criar task em gerência — Krissya recebe via WhatsApp e decide ela mesma

### Ex.3 — "TOM, pai do aluno X reclamando que o filho não aprende" (gerente é o requester)
- Avaliação: claramente pedagógico
- Resposta antes de marker: "Isso parece pedagógico — não é a Gerência que resolve aprendizado. Encaminho pra **<assistente da sua unidade>** ou direto pra **Juliana** (LA Music School) / **Quintela** (LA Music Kids)?"
- Após confirmação do user: `COORDINATION_REQUEST` mode=relay_assisted para o destinatário escolhido
- **NÃO criar task em gerência** — Pedagógico cuida. Você só roteia.

### Ex.4 — "TOM, isso virou problema de atendimento no Recreio"
- Tipo: `problema-de-atendimento`, prioridade `high`
- Marker: `TASK_UPDATE` com `to_name="Clayton"` (gerente interino Recreio)
- Description deve incluir o contexto do problema (qual atendimento, qual cliente)

### Ex.5 — "TOM, preciso articular recepção, secretaria e coordenação no caso da aluna W"
- Tipo: `articulacao-interna`, prioridade `medium`
- Marker: `TASK_UPDATE` com `to_name=<gerente da unidade do contexto>`
- Description: descreve as áreas envolvidas e o que precisa ser articulado

### Ex.6 — "TOM, aciona a gerência da Barra sobre o evento de amanhã"
- Resolve por unit: Barra → Krissya
- Modo: `relay_assisted` para Krissya
- Marker: `COORDINATION_REQUEST` com `recipient_name="Krissya"`
- Se contexto for genérico ("aciona a gerência") sem unidade, pergunte qual unidade

---

## Não faça

- NÃO emita followup para mentor/lead/assistant pedagógico — sempre `relay_assisted`
- NÃO crie task em `gerencia` quando o caso é claramente pedagógico — encaminhe via relay
- NÃO confunda Yuri (manager+all/Marketing) com gerente de unidade
- NÃO use `articulacao-interna` para casos simples — só quando precisa mobilizar **2 ou mais** áreas
- NÃO use `pendencia-gerencial` como categoria padrão — sempre tente um tipo específico antes
- NÃO invente UUIDs — use **exatamente** os da tabela acima
- Marker fecha com `<<END>>` — NUNCA com tag de barra estilo XML
