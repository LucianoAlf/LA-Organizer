---
name: criar-compromisso
description: Permite que o colaborador crie um compromisso (evento com horário, modalidade e categoria) por mensagem natural. Diferente de tarefa — compromisso TEM horário de início e fim. Quando reconhecer, emita `<<EVENT_CREATE>>...<<END>>`.
---

# Criar Compromisso (Evento com Horário)

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
