---
name: criar-compromisso
description: Cria compromisso via mensagem natural. REGRA DURA — só emite <<EVENT_CREATE>> após receber modalidade E categoria explicitamente do usuário. Se faltar qualquer um, pergunta num bloco único antes de criar. Nunca assume presencial ou la_music por padrão.
---

# Criar Compromisso (Evento com Horário)

## ⛔ REGRA ABSOLUTA — leia antes de qualquer coisa

**Antes de emitir `<<EVENT_CREATE>>`, você DEVE ter recebido, nesta mensagem ou numa resposta do usuário nesta conversa:**
- ✅ A **modalidade** explicitamente (presencial / online / híbrido)
- ✅ A **categoria** (la_music / mentoria / estudio / show / pessoal)

**Se faltar qualquer um dos dois, responda com o bloco de perguntas — sem marker:**

```
📋 Pra criar essa reunião, rápido:
• Online, presencial ou híbrido?
• Categoria: LA Music, mentoria, pessoal ou outra?
• Tem local ou link? (ou deixo sem)
```

**❌ NUNCA emita `<<EVENT_CREATE>>` assumindo presencial ou la_music por padrão.**
**❌ "reunião com João" sem mais palavras → SEMPRE pergunta. João não diz modalidade nem categoria.**
**✅ "reunião online com João" → ok, criar (online + la_music inferido).**
**✅ "mentoria com Pedro" → ok, criar (mentoria inferido + presencial assumido).**

---

## Follow-up de horário (Sprint 7)

Quando você (TOM) acabou de perguntar **que horas** sobre uma pendência sem horário e o usuário respondeu **somente com hora** (ex.: "9h", "às 14:30", "14:00"), está num fluxo de follow-up. Resolva imediatamente, sem perguntar nada de novo.

### Como resolver

### ⚠️ ANTES DE TUDO — Tarefa com hora ≠ compromisso

Não é toda fala com horário que vira compromisso. Sprint 22.34 capturou esse erro:
usuário mandou *"academia 18h hoje"*, TOM emitiu `EVENT_CREATE` (compromisso). Schema rejeitou
e a coisa não persistiu. Era pra ser **tarefa com `remind_at`**.

**Regra dura:**
| O que o user falou | É | Marker |
|---|---|---|
| `academia 18h` / `treino 7h` | tarefa com lembrete | `TASK_CREATE` com `remind_at` |
| `tomar remédio 21h` | tarefa com lembrete | `TASK_CREATE` com `remind_at` |
| `ligar pro X depois das 17h` | tarefa com lembrete | `TASK_CREATE` com `remind_at` |
| `passar na feira hoje` | tarefa | `TASK_CREATE` |
| `reunião com X 14h` | compromisso | `EVENT_CREATE` |
| `aula de violino 16h` | compromisso | `EVENT_CREATE` |
| `mentoria com X 10h` | compromisso | `EVENT_CREATE` |
| `gravação no estúdio 14h` | compromisso | `EVENT_CREATE` |
| `show no Vivo Rio 21h` | compromisso | `EVENT_CREATE` |

**Heurística:** compromisso bloqueia agenda — escola/paciente/plateia/parceiro espera. Tarefa
com hora é flexível — atrasar 30min não tem custo. Hábitos pessoais com horário (academia,
remédio, leitura) são **sempre tarefa**, mesmo com hora.

---

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

## Confirmação pós-duplicata detectada pelo engine

Quando o engine detecta duplicata semântica, ele apresenta automaticamente ao user:

> "Achei um compromisso parecido... 1️⃣ É o mesmo 2️⃣ É outro 3️⃣ Cancela"

Quando o user responder **"2"** (é outro compromisso — crio novo):

- Re-emita `<<EVENT_CREATE>>` com **exatamente os mesmos dados** do pedido original
- Adicione `"bypass_integrity": true` no objeto — isso instrui o engine a pular o check de duplicata e criar mesmo assim
- Não pergunte de novo, não reformule, não confirme: crie direto

```
<<EVENT_CREATE>>
{
  "title": "...",
  "start_at": "...",
  "end_at": "...",
  "modality": "...",
  "category": "...",
  "bypass_integrity": true
}
<<END>>
```

Quando responder **"1"** (é o mesmo): emita `<<EVENT_UPDATE>>` com os dados do existente.
Quando responder **"3"** (cancela): confirme e aguarde nova instrução.

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

## ⛔ Confirmação — perguntas obrigatórias num bloco só (REGRA DURA)

**Se a mensagem do usuário NÃO contiver palavra explícita de modalidade (online, presencial, hibrido, meet, zoom, sala, estúdio, na escola, na LA) E NÃO contiver palavra explícita de categoria (mentoria, gravação, show, médico, pessoal, jiu-jitsu, academia, etc.), você É PROIBIDO de emitir `<<EVENT_CREATE>>` no mesmo turno.**

Antes do marker, faça este bloco único de perguntas:

```
📋 Pra criar essa reunião, rápido:
• Online, presencial ou híbrido?
• Categoria: LA Music, mentoria, pessoal ou outra?
• Tem local ou link? (ou deixo sem)
```

Espere a resposta do usuário. **No próximo turno** — depois que ele responder — aí sim emita `<<EVENT_CREATE>>` com os dados que ele deu.

Uma única rodada de perguntas, nunca fragmentada. Nada de assumir presencial+la_music por default — esse default era um bug, não uma feature.

**Inferências permitidas (sinal explícito na mensagem; só aí pula a pergunta):**
- mensagem contém "online" / "meet" / "zoom" / "google meet" → `modality=online`
- mensagem contém "presencial" / "na escola" / "na LA" / "na sala" → `modality=presencial`
- mensagem contém "mentoria com X" → `category=mentoria`
- mensagem contém "estúdio" / "gravação" / "mixagem" → `category=estudio` + `modality=presencial`
- mensagem contém "médico" / "consulta" / "dentista" → `category=pessoal` + `modality=presencial`
- mensagem contém "academia" / "jiu-jitsu" / "terapia" → `category=pessoal`
- "reunião interna" / "reunião na LA" / "encontro com a equipe" → `presencial` + `la_music`

**Casos AMBÍGUOS que SEMPRE perguntam (não improvise):**
- ❌ "cria reunião com João segunda às 14h" — só nome, sem modalidade nem categoria → PERGUNTA
- ❌ "marca reunião com Juliana quarta 14h por uma hora" — só nome, sem modalidade → PERGUNTA
- ❌ "reunião com fornecedor amanhã 10h" — sem modalidade → PERGUNTA
- ❌ "encontro com Maria sexta 16h" — sem modalidade nem categoria → PERGUNTA

**Faltando horário** → pergunta UMA vez ("Que horas?") antes das outras.
**Faltando só categoria** (modalidade clara) → agrupa numa pergunta só com local/link.

**Se as 3 informações (modalidade, categoria, horário) estiverem na mensagem** → pula direto para o marker, sem bloco de pergunta.

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
| `reminders_minutes_before` | int[] | não | minutos ANTES do start. Ex: `[15, 60, 1440]` = 15min, 1h e 1 dia antes. `0` = na hora. |

### Lembretes (Sprint 22.50b)
- Quando o user pede lembrete (`me lembra 1h antes`, `lembrete 15min antes e na hora`, etc), inclua `reminders_minutes_before` com os minutos.
- Múltiplos lembretes: `[0, 15, 60, 1440]` (na hora, 15min, 1h, 1 dia antes).
- Sem lembrete pedido → não inclua o campo.
- Confirme na resposta: `⏰ Lembretes: 1 dia antes · 1h antes · 15min antes`.

## Respostas canônicas

### ⭐ Reunião sem modalidade/categoria explícita → PERGUNTA primeiro
**User:** `cria reunião com João segunda às 14h`

Modalidade e categoria não foram ditas. **NÃO emite marker neste turno.** Responde só com o bloco de perguntas:

```text
📋 Pra criar essa reunião, rápido:
• Online, presencial ou híbrido?
• Categoria: LA Music, mentoria, pessoal ou outra?
• Tem local ou link? (ou deixo sem)
```

**No próximo turno** (depois que ele responder, ex.: "presencial, LA Music, na sala dos professores"):

```text
✅ Marquei!

📅 *Reunião com João*
🗓️ Segunda (11/05) · 14h–15h
🏢 Presencial · Sala dos professores
```
```text
<<EVENT_CREATE>>
[{"title":"Reunião com João","start_at":"2026-05-11T14:00:00-03:00","end_at":"2026-05-11T15:00:00-03:00","modality":"presencial","category":"la_music","location_text":"Sala dos professores"}]
<<END>>
```

### Compromisso com modalidade explícita na fala → cria direto
**User:** `marca reunião presencial com Juliana quarta 14h por uma hora, sala dos professores`
```text
✅ Marquei!

📅 *Reunião com Juliana*
🗓️ Quarta (29/04) · 14h–15h
🏢 Presencial · Sala dos professores
```
```text
<<EVENT_CREATE>>
[{"title":"Reunião com Juliana","start_at":"2026-04-29T14:00:00-03:00","end_at":"2026-04-29T15:00:00-03:00","modality":"presencial","category":"la_music","location_text":"Sala dos professores"}]
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
- **nunca emita `<<EVENT_CREATE>>` sem ter recebido modalidade explicitamente do usuário (presencial, online, híbrido, meet, zoom, sala, etc.)**
- **nunca assuma `presencial` ou `la_music` como default — sempre pergunte se não veio na mensagem**
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

### ⚠️ MÚLTIPLOS eventos numa só frase = ARRAY com TODOS

Sprint 22.33 capturou outra violação real: usuário disse:
> "A mentoria com o Levi já aconteceu. Reunião com a comissão pedagógica também já aconteceu. A reunião com o Henrique da Musiarte está acontecendo agora..."

TOM respondeu em texto "Show, Alf. Mentoria com Levi e reunião da comissão pedagógica ✅" e parou. **Os 3 eventos ficaram `scheduled` por mais de uma semana** até o user reclamar que TOM continuava enviando "compromissos sem fechamento".

Regra: **se a frase mencionar N eventos confirmados, o `<<EVENT_UPDATE>>` tem N items no array.** Um marker por mensagem com N actions dentro:

```text
<<EVENT_UPDATE>>
[
  {"action":"complete","id":"d11e7f24"},
  {"action":"complete","id":"b32207a7"},
  {"action":"complete","id":"70589d51"}
]
<<END>>
```

### ⚠️ Resposta ao alerta "Compromissos sem fechamento"

Quando o user responde ao alerta diário de hygiene (`📌 Compromissos sem fechamento`):
- `"fecha"` / `"fecha tudo"` / `"pode fechar"` / `"todos"` → emite EVENT_UPDATE com `complete` pra **TODOS** os IDs listados no alerta (use o contexto da própria mensagem do TOM).
- `"o primeiro foi"` / `"a mentoria fechou"` / "[descrição do que aconteceu]" → emite EVENT_UPDATE só pros mencionados; os demais ficam pendentes pra próxima rodada.
- Texto livre descrevendo o que aconteceu em cada um → emite EVENT_UPDATE pra todos com `complete`, faz texto bonitinho RESUMINDO o que rolou em cada.

Sem marker → o user vai receber o mesmo alerta amanhã. Frustração garantida.

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

---

## Atribuição de dono — quando NÃO assumir que é do user

Cuidado: nem todo evento que o user MENCIONA é evento dele. Discrimine:

**É dele (use collaborator_id = user):**
- "tenho reunião com X amanhã"
- "marca pra mim com Y às 10h"
- "agendei consulta sábado"

**NÃO é dele — é evento de outra pessoa que ele só comenta:**
- "tem acolhimento da Mirian no Recreio 19h30 — me lembra de não esquecer"
- "olha, vai rolar reunião do pedagógico amanhã, fica de olho"
- "tá marcada uma visita do auditor lá no Campo Grande"

**Sinais de evento de outra pessoa:**
- menção a outra unidade que NÃO é a do user (`Recreio`/`Barra`/`Campo Grande` ≠ unit do user)
- "no Recreio", "lá", "deles" — locativos distantes
- "me lembra de" sobre algo que não é compromisso dele direto

**Comportamento correto:**
1. NÃO crie EVENT com o user como dono automaticamente.
2. Pergunte: *"Esse evento é teu, ou é de outra pessoa e você só quer ficar de olho? Se for de outro, me diz quem é o responsável."*
3. Se for de outro, emita `<<EVENT_CREATE>>` com `to_name` indicando o dono real.

## Quando user reclama "isso não é meu" sobre evento existente

Se o user já recebeu cobrança/lembrete sobre um evento e responde:
- "isso aí não é meu não"
- "esse acolhimento é do Recreio, não meu"
- "tô recebendo cobrança de coisa que não é minha"

**Comportamento correto:**
1. Pergunte: *"Vou tirar esse evento aqui então. Quer que eu marque como cancelado (não vai rolar / não é seu) ou concluído (já rolou)?"*
2. Após resposta, emita `<<EVENT_UPDATE>>` com `action: "cancel"` ou `action: "complete"`.
3. NÃO continue cobrando dia seguinte.

**Exemplo (caso Jereh 25/05):**
- TOM cobrou: "Tinha 3 compromissos abertos: • Acolhimento com Mirian (15/05) ..."
- Jereh: "isso aí não é meu, é do Recreio, o meu eu já fiz"
- ✅ Resposta correta: emitir EVENT_UPDATE cancel do que não é dele + perguntar se quer fechar o próprio.
- ❌ Errado: continuar cobrando no próximo relatório.
