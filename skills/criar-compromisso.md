---
name: criar-compromisso
description: Permite que o colaborador crie um compromisso (evento com horário, modalidade e categoria) por mensagem natural. Diferente de tarefa — compromisso TEM horário de início e fim. Quando reconhecer, emita `<<EVENT_CREATE>>...<<END>>`.
---

# Criar Compromisso (Evento com Horário)

## Follow-up de horário (Sprint 7)

Quando você (TOM) acabou de perguntar **que horas** sobre uma pendência sem horário e o usuário respondeu **somente com hora** (ex.: "9h", "às 14:30", "14:00"), está num fluxo de follow-up. Resolva imediatamente, sem perguntar nada de novo.

### Como resolver

1. Olhe a pendência sobre a qual você perguntou. Ela aparece no contexto como `[id=ab12cd34]` em **Tarefas pessoais hoje** ou **Tarefas trabalho hoje**.
2. Se o título da pendência indica **compromisso** (`reunião`, `aula`, `ensaio`, `mentoria`, `sessão`, `encontro`, `gravação`, `consulta`): **promova** — emita `<<TASK_UPDATE>>` com `complete` na task e `<<EVENT_CREATE>>` com o horário, na mesma resposta. Default: 1h de duração, modalidade que constar no título (ex.: "Reunião online com X" → `online`); na falta, `presencial`. Categoria por contexto: `la_music` em itens internos, `mentoria` em mentorias, `aula_particular`/`outra_escola`/`estudio` quando óbvio. Em dúvida, `la_music`.
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
- envolve termos de evento: reunião, aula, ensaio, mentoria, sessão, encontro, gravação, masterclass, apresentação

Se a mensagem só pede "lembra" sem horário com duração → use `checklist-tarefas` (cria tarefa com `remind_at`).

## Tarefa vs Compromisso (regra clara)

| Sinais | Skill | Marker |
|---|---|---|
| "lembra de X em 30 min" / "às H me lembra" | tarefa | `TASK_UPDATE.create` com `remind_at` |
| "reunião com Y às H" / "aula de piano 14h-15h" / "mentoria com Z online" | **compromisso** | `EVENT_CREATE` |
| "marca uma reunião de 1h amanhã 10h" | **compromisso** | `EVENT_CREATE` |
| "anota: revisar contrato" | tarefa | `TASK_UPDATE.create` |

Em dúvida, prefira tarefa. Compromisso só quando há horário com duração ou termo de evento explícito.

## Categorias (enum fechado, igual ao PWA)

| Categoria | Quando usar |
|---|---|
| `la_music` | atividades da LA Music — aulas regulares, reuniões internas |
| `mentoria` | sessões de mentoria de carreira |
| `aula_particular` | aula particular fora da grade |
| `outra_escola` | trabalho em outra escola de música |
| `estudio` | gravação, mixagem, produção |
| `pessoal` | médico, família, lazer, conta |

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
| concluir | "fechei o ensaio", "fiz a aula", "saiu a mentoria" | `complete` |

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
