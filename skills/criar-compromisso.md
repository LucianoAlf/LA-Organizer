---
name: criar-compromisso
description: Permite que o colaborador crie um compromisso (evento com horário, modalidade e categoria) por mensagem natural. Diferente de tarefa — compromisso TEM horário de início e fim. Quando reconhecer, emita `<<EVENT_CREATE>>...<<END>>`.
---

# Criar Compromisso (Evento com Horário)

## Follow-up de horário (Sprint 7)

Quando você (TOM) acabou de perguntar **que horas** sobre uma pendência sem horário e o usuário respondeu **somente com hora** (ex.: "9h", "às 14:30", "14:00"), está num fluxo de follow-up. Resolva imediatamente, sem perguntar nada de novo.

### Como resolver

1. Olhe a pendência sobre a qual você perguntou. Ela aparece no contexto como `[id=ab12cd34]` em **Tarefas pessoais hoje** ou **Tarefas trabalho hoje**.
2. Se o título da pendência indica **compromisso** (`reunião`, `aula`, `ensaio`, `mentoria`, `sessão`, `encontro`, `gravação`, `consulta`, `show`): **promova** — emita `<<TASK_UPDATE>>` com `complete` na task e `<<EVENT_CREATE>>` com o horário, na mesma resposta. Default: 1h de duração, modalidade que constar no título (ex.: "Reunião online com X" → `online`); na falta, `presencial`. Categoria por contexto: `la_music` em itens internos, `mentoria` em mentorias/aulas particulares, `estudio` em gravação/produção, `show` em apresentações. Em dúvida, `la_music`.
3. Se a pendência **já é um event** (apareceu em **Compromissos hoje** com `[id=...]`): emita `<<EVENT_UPDATE>>` com `action: "reschedule"` e os novos `new_start_at`/`new_end_at`.
4. Se não houver pendência clara no contexto, NÃO improvise. Pergunte UMA vez "qual reunião?" — sem citar tabelas, banco, ou estrutura interna.

### Resolução temporal da hora isolada

- "9h" → `09:00:00-03:00` no dia já indicado (hoje, salvo se o contexto disser outro dia)
- "14:30" → `14:30:00-03:00`
- "às 9" → `09:00:00-03:00`
- Sempre ISO 8601 com `-03:00` no marker

### Resposta canônica

**TOM (turno anterior):** "⏰ Não tem horário registrado pra essa reunião, Alf. Sabe que horas é?"
**Usuário:** "9h"

```text
✅ Marcado!

📅 *Reunião com Henrique Musiartes*
🗓️ Hoje · 09h–10h
🏢 Presencial
```
```text
<<TASK_UPDATE>>
[{"action":"complete","id":"ae3d537c"}]
<<END>>
<<EVENT_CREATE>>
[{"title":"Reunião com Henrique Musiartes","start_at":"2026-04-28T09:00:00-03:00","end_at":"2026-04-28T10:00:00-03:00","modality":"presencial","category":"la_music"}]
<<END>>
```

> Esta é a **única** exceção legítima a "uma operação por resposta": promover task → event no mesmo turno, porque é semanticamente uma operação ("registrar o horário que faltava"). Não use esse padrão fora de follow-up de horário.

### Veto (follow-up)

- Nunca pergunte permissão pra "acessar banco / supabase / atualizar tabela".
- Nunca cite estrutura interna pro usuário.
- Se não consegue resolver, peça desculpa e oferece pra ele mandar de novo: "*me confunde aqui, manda em texto qual reunião e que horas?*". Sem mencionar bug, MCP, sistema.

---

## Antes de criar — checar duplicidade com tarefa pendente

**Regra anti-duplicação (Sprint 5):** antes de emitir `<<EVENT_CREATE>>`, olhe a lista de tarefas pendentes no contexto. Se houver uma task com título **muito similar** ao do compromisso pedido (ex.: tarefa "Reunião com Juliana" e o usuário pede "marca reunião com Juliana às 14h"), pergunte UMA vez:

> *Tem uma tarefa "Reunião com Juliana" aberta. Quer promover ela pra compromisso ou criar um novo?*

Se o usuário disser "promover" / "essa mesma" → emita `<<TASK_UPDATE>>` com `complete` na task (id curto do contexto) **E** `<<EVENT_CREATE>>` na mesma resposta. É a única exceção à regra "uma operação por resposta" (a "promoção" é semanticamente uma operação).

Se disser "novo" / "outra" / "ignora" → emita `<<EVENT_CREATE>>` normalmente, sem mexer na task.

**Critério de "muito similar"**: título da task contém o substantivo principal do pedido (ex.: "reunião com Juliana", "mentoria com Pedro", "ensaio sábado") com 2+ palavras coincidentes. Em dúvida, **não** pergunte — apenas crie o event. Não inventar match.

---

## Quando ativar
Ative esta skill quando o colaborador descrever algo que:
- tem **horário de início** explícito ("às 14h", "14:00", "das 10 às 11")
- tem **modalidade** óbvia ou inferível (presencial, online, google meet, zoom, sala, no estúdio, na escola)
- envolve termos de evento PEQUENO: reunião, aula, ensaio, mentoria, sessão, encontro, gravação, masterclass, apresentação, consulta

Se a mensagem só pede "lembra" sem horário com duração → use `checklist-tarefas` (cria tarefa com `remind_at`).

## ⚠️ Eventos de GRANDE PORTE NÃO são compromissos (Sprint 11.5b)

Quando o user descreve um **evento de grande porte da LA** — workshop, show, recital, captação, festival, sarau, dia das mães, dia dos pais, formatura, lançamento, especial, festa de fim de ano, temporada, aula aberta, apresentação do coro — **NÃO ative esta skill**. Esses eventos exigem:
- envolvidos / responsáveis (perg. 5 do 5W2H)
- como vai executar / método (perg. 6)
- horas/semana de dedicação do time (perg. 7)
- justificativa (perg. 2)

A skill **`cadastro-projeto-5w2h`** cobre isso completamente — pergunta os 7 itens, persiste como projeto, e o PWA reflete na aba Projetos.

**Distinção rápida:**
| Caso | Skill |
|------|-------|
| "Marca reunião com Henrique 14h online" | criar-compromisso |
| "Aula de piano com Maria amanhã 10h" | criar-compromisso |
| "Mentoria com Quintela quinta 15h" | criar-compromisso |
| **"Cria evento Dia das Mães com a Turminha"** | **cadastro-projeto-5w2h** |
| **"Workshop de improvisação com Moreira"** | **cadastro-projeto-5w2h** |
| **"Show de fim de ano dos alunos"** | **cadastro-projeto-5w2h** |
| **"Captação de novos professores"** | **cadastro-projeto-5w2h** |

**Heurística:** o evento envolve preparação + múltiplas pessoas + execução planejada → projeto. É só compromisso pontual no calendário (1 horário, 1-2 pessoas, sem prep) → compromisso.

**Em dúvida:** roteie pra `cadastro-projeto-5w2h`. Pior caso, vira projeto pequeno. Não trate evento institucional como compromisso de calendário — vai perder envolvidos/responsáveis/método.

## Tarefa vs Compromisso (regra clara)

| Sinais | Skill | Marker |
|---|---|---|
| "lembra de X em 30 min" / "às H me lembra" | tarefa | `TASK_UPDATE.create` com `remind_at` |
| "reunião com Y às H" / "aula de piano 14h-15h" / "mentoria com Z online" | **compromisso** | `EVENT_CREATE` |
| "marca uma reunião de 1h amanhã 10h" | **compromisso** | `EVENT_CREATE` |
| "anota: revisar contrato" | tarefa | `TASK_UPDATE.create` |

Em dúvida, prefira tarefa. Compromisso só quando há horário com duração ou termo de evento explícito.

## Categorias

System (sempre disponíveis, alinhado com PWA Sprint 22.26):

| Slug | Quando usar |
|---|---|
| `la_music` | atividades da LA Music — aulas regulares, reuniões internas |
| `mentoria` | mentoria de carreira **e/ou** aula particular avulsa (label PWA: "Aula Particular/Mentoria") |
| `estudio` | gravação, mixagem, produção (label PWA: "Gravação/Produção") |
| `show` | shows, apresentações, eventos com público |
| `pessoal` | médico, família, lazer, conta — fallback genérico pessoal |

**Pessoais customizadas:** o user pode criar suas próprias no PWA (academia, jiu-jitsu, terapia, etc.). Se a fala mencionar uma categoria pessoal específica e ela já existir pra esse colaborador, usar o slug exato dela. Se não existir, usar `pessoal` (a tabela `event_categories` resolve o resto).

## Modalidades

`presencial` | `online` | `hibrido`

- `presencial` → não inclui `meeting_url`
- `online` ou `hibrido` → pode incluir `meeting_url` (Google Meet, Zoom, etc.)

## Privacidade

- `category=pessoal` → o engine grava `context=personal` automaticamente (coordenação não vê)
- demais → `context=work` (coordenação enxerga)
- nunca diga "esse compromisso é privado" — só responda confirmando o agendamento

## Default de fim

Se o usuário só disser horário de início, **assuma 1 hora de duração** (`end_at = start_at + 1h`). Se disser "uma aula", manter 1h. Se disser "ensaio rápido", 30min é razoável — mas só se ele indicar.

## Resolução temporal
- Timezone fixo: `America/Sao_Paulo` (-03:00)
- "amanhã às 10h" → próxima data + `T10:00:00-03:00`
- "quarta 14h" → próxima quarta-feira + `T14:00:00-03:00`
- Sempre emita `start_at` e `end_at` em ISO 8601 com `-03:00`

## Confirmação
- Intenção clara → confirma e emite o marker na MESMA resposta
- Faltando categoria óbvia → pergunta UMA vez ("É da LA Music ou pessoal?")
- Faltando horário → pergunta UMA vez ("Que horas?")

## Formato do marker

```text
<<EVENT_CREATE>>
[
  {
    "title": "Reunião com Juliana",
    "start_at": "2026-04-29T14:00:00-03:00",
    "end_at": "2026-04-29T15:00:00-03:00",
    "modality": "presencial",
    "category": "la_music",
    "location_text": "Sala dos professores"
  }
]
<<END>>
```

### Campos
| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| `title` | string | sim | curto, claro |
| `start_at` | ISO 8601 -03:00 | sim | |
| `end_at` | ISO 8601 -03:00 | sim | > start_at |
| `modality` | enum | sim | presencial / online / hibrido |
| `category` | enum | sim | ver tabela acima |
| `context` | "work" / "personal" | não | default: pessoal→personal, demais→work |
| `location_text` | string | não | endereço, sala |
| `meeting_url` | string | não | só para online/hibrido |
| `description` | string | não | observações |

## Respostas canônicas

### Compromisso de trabalho com modalidade presencial
**User:** `marca reunião com Juliana quarta 14h por uma hora`
```text
✅ Marquei!

📅 *Reunião com Juliana*
🗓️ Quarta (29/04) · 14h–15h
🏢 Presencial
```
```text
<<EVENT_CREATE>>
[{"title":"Reunião com Juliana","start_at":"2026-04-29T14:00:00-03:00","end_at":"2026-04-29T15:00:00-03:00","modality":"presencial","category":"la_music"}]
<<END>>
```

### Compromisso online com link
**User:** `mentoria com Pedro amanhã 10h online, meet.google.com/abc`
```text
✅ Marquei!

📅 *Mentoria com Pedro*
🗓️ Amanhã · 10h–11h
💻 Online · meet.google.com/abc
```
```text
<<EVENT_CREATE>>
[{"title":"Mentoria com Pedro","start_at":"2026-04-29T10:00:00-03:00","end_at":"2026-04-29T11:00:00-03:00","modality":"online","category":"mentoria","meeting_url":"https://meet.google.com/abc"}]
<<END>>
```

### Compromisso pessoal
**User:** `consulta médica sexta 16h`
```text
✅ Marquei.

📅 *Consulta médica*
🗓️ Sexta (01/05) · 16h–17h
```
```text
<<EVENT_CREATE>>
[{"title":"Consulta médica","start_at":"2026-05-01T16:00:00-03:00","end_at":"2026-05-01T17:00:00-03:00","modality":"presencial","category":"pessoal"}]
<<END>>
```

## Veto — nunca
- nunca emita `<<EVENT_CREATE>>` sem `start_at`, `end_at`, `modality` e `category`
- nunca emita com `end_at <= start_at`
- nunca emita `meeting_url` se `modality="presencial"`
- nunca exiba o marker / horários internos / IDs ao usuário
- nunca misture `<<EVENT_CREATE>>` com `<<TASK_UPDATE>>` na mesma resposta — escolha um
- nunca emita evento de outro colaborador (a skill não tem create-for-other; isso fica em `checklist-tarefas`)

---

## Atualizar compromisso já existente (Sprint 5+)

A skill também cobre **reagendar / cancelar / concluir** compromisso já existente. Use o marker `<<EVENT_UPDATE>>`.

### Sinais
| Intenção | Frases típicas | Action |
|---|---|---|
| reagendar | "remarca a reunião pra quinta 15h", "muda o ensaio pra sexta", "passa pra outra hora" | `reschedule` |
| cancelar | "cancela o compromisso", "cancela a reunião com Juliana", "não vai rolar" | `cancel` |
| concluir | "fechei o ensaio", "fiz a aula", "saiu a mentoria", "rolou", "rolou sim", "foi tudo certo", "deu certo a reunião", "tudo certo com X", "fizemos a reunião", "saiu a reunião com X", "a aula foi", "a reunião foi" | `complete` |

### ⚠️ REGRA CRÍTICA — confirmação retroativa SEMPRE emite marker

Quando o usuário CONFIRMA RETROATIVAMENTE que um compromisso já existente rolou (presente ou passado), você DEVE emitir `<<EVENT_UPDATE>>` com `complete`. Não pode só responder "boa, registrado" em texto e parar — isso deixa o banco com `status=scheduled` quando deveria estar `complete`. Se você acabou de dizer "registrado", "anotado", "marcado", "boa" sobre uma confirmação, o marker é OBRIGATÓRIO no mesmo turno.

Padrões de confirmação retroativa (qualquer um dispara):
- `rolou`, `rolou sim`, `rolou tranquilo`
- `foi`, `foi sim`, `foi tudo certo`, `foi de boa`
- `tudo certo com X` quando X é evento conhecido (em **Compromissos hoje**)
- `fizemos a reunião`, `saiu a reunião`, `acabamos a aula`
- mensagens com horário passado + nome do evento ("a reunião com Henrique foi das 9h às 10h30")

Sem marker = bug. Smoke da Sprint 10 captou esse caso em produção: usuário disse "Reunião com Henrique rolou sim! Foi das 9h às 10h30", TOM respondeu em texto "Boa, registrado", mas banco continuou `scheduled`. Não repetir.

> Observação sobre **correção de modalidade** (ex.: user disse "foi online, não presencial"): o marker `EVENT_UPDATE` atual suporta só `reschedule/cancel/complete`. Pra mudar modalidade retroativamente, ainda não há action — pergunte UMA vez se quer reagendar com modalidade nova ou aceite que ficará registrado como criado e siga. Sprint 11+ adiciona `edit` action.

### Resolução do compromisso
Os compromissos do dia/da semana aparecem no contexto com `[id=ab12cd34]`. Use esse id curto no marker. Em ambiguidade, pergunte UMA vez antes de emitir.

### Formato do marker

```text
<<EVENT_UPDATE>>
[
  {"action":"reschedule","id":"ab12cd34","new_start_at":"2026-04-30T15:00:00-03:00","new_end_at":"2026-04-30T16:00:00-03:00"}
]
<<END>>
```

| action | campos |
|---|---|
| `reschedule` | `id`, `new_start_at` (ISO -03:00), `new_end_at` (ISO -03:00, > new_start_at) |
| `cancel` | `id` |
| `complete` | `id` |

### Respostas canônicas

**User:** `remarca a reunião com Juliana pra quinta 15h`
```text
🗓️ Movido: *Reunião com Juliana* — quinta (30/04) · 15h–16h.
```

**User:** `cancela o ensaio de hoje`
```text
❌ Cancelado: *Ensaio*.
```

**User:** `fechei a mentoria`
```text
✅ Fechado: *Mentoria com Pedro*.
```

### Veto — update
- nunca emita `<<EVENT_UPDATE>>` sem `id`
- `reschedule` exige `new_start_at` E `new_end_at`. Se o usuário só disser "muda pra 15h" sem dizer duração, mantenha a mesma duração que o evento original tem.
- nunca misture `<<EVENT_CREATE>>` e `<<EVENT_UPDATE>>` na mesma resposta — uma operação por vez.
