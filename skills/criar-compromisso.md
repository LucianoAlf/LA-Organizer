---
name: criar-compromisso
description: Cria compromisso via mensagem natural. REGRA DURA — só emite <<EVENT_CREATE>> após receber modalidade E categoria explicitamente do usuário. Se faltar qualquer um, pergunta num bloco único antes de criar. Nunca assume presencial ou la_music por padrão.
---

# Criar Compromisso (Evento com Horário)

## ⛔ REGRA ABSOLUTA — antes de emitir `<<EVENT_CREATE>>`

Você DEVE ter recebido (nesta mensagem ou em resposta nesta conversa):
- ✅ **modalidade** explícita (presencial / online / híbrido)
- ✅ **categoria** (la_music / mentoria / estudio / show / pessoal)

Se faltar qualquer um, responda SÓ com o bloco de perguntas (sem marker):

```
📋 Pra criar essa reunião, rápido:
• Online, presencial ou híbrido?
• Categoria: LA Music, mentoria, pessoal ou outra?
• Tem local ou link? (ou deixo sem)
```

Espere a resposta. No próximo turno, emita o marker.

- ❌ NUNCA emita `<<EVENT_CREATE>>` assumindo presencial ou la_music por padrão.
- ❌ "reunião com João" sem mais nada → SEMPRE pergunta.
- ✅ "reunião online com João" → cria (online + la_music inferido).
- ✅ "mentoria com Pedro" → cria (mentoria inferido + presencial assumido).

**Inferências permitidas (só pulam a pergunta se o sinal está explícito na mensagem):**
- "online"/"meet"/"zoom" → `modality=online`
- "presencial"/"na escola"/"na LA"/"na sala" → `modality=presencial`
- "mentoria com X" → `category=mentoria`
- "estúdio"/"gravação"/"mixagem" → `category=estudio` + `presencial`
- "médico"/"consulta"/"dentista" → `category=pessoal` + `presencial`
- "academia"/"jiu-jitsu"/"terapia" → `category=pessoal`
- "reunião interna"/"na LA"/"com a equipe" → `presencial` + `la_music`

Se as 3 infos (modalidade, categoria, horário) já estão na mensagem → pula direto pro marker.
Faltando só horário → pergunta "Que horas?" antes. Faltando só categoria (modalidade clara) → agrupa numa pergunta com local/link.

---

## ⚠️ Tarefa com hora ≠ compromisso

Nem toda fala com horário é compromisso. Compromisso bloqueia agenda (alguém espera); tarefa com hora é flexível. Hábitos pessoais com horário (academia, remédio, leitura) são **sempre tarefa**.

| O que o user falou | É | Marker |
|---|---|---|
| `academia 18h` / `treino 7h` / `tomar remédio 21h` | tarefa c/ lembrete | `TASK_CREATE` com `remind_at` |
| `ligar pro X depois das 17h` | tarefa c/ lembrete | `TASK_CREATE` com `remind_at` |
| `passar na feira hoje` / `anota: revisar contrato` | tarefa | `TASK_CREATE` |
| `reunião com X 14h` / `aula de violino 16h` | compromisso | `EVENT_CREATE` |
| `mentoria com X 10h` / `gravação no estúdio 14h` / `show no Vivo Rio 21h` | compromisso | `EVENT_CREATE` |

Em dúvida, prefira tarefa. Compromisso só quando há horário com duração ou termo de evento explícito (reunião, aula, ensaio, mentoria, sessão, encontro, gravação, masterclass, apresentação, consulta).

## ⚠️ Eventos de GRANDE PORTE → `cadastro-projeto-5w2h`, NÃO esta skill

Evento institucional da LA (workshop, show, recital, captação, festival, sarau, dia das mães/pais, formatura, lançamento, especial, festa de fim de ano, temporada, aula aberta) exige envolvidos, método, dedicação e justificativa — coisa da `cadastro-projeto-5w2h`.

| Caso | Skill |
|------|-------|
| "Marca reunião com Henrique 14h online" | criar-compromisso |
| "Mentoria com Quintela quinta 15h" | criar-compromisso |
| "Cria evento Dia das Mães com a Turminha" | cadastro-projeto-5w2h |
| "Workshop de improvisação com Moreira" | cadastro-projeto-5w2h |
| "Captação de novos professores" | cadastro-projeto-5w2h |

**Heurística:** preparação + múltiplas pessoas + execução planejada → projeto. 1 horário, 1-2 pessoas, sem prep → compromisso. Em dúvida, roteie pra projeto.

---

## Follow-up de horário

Quando você (TOM) perguntou **que horas** sobre uma pendência sem horário e o usuário respondeu **só com a hora** ("9h", "às 14:30"), resolva imediatamente:

1. Olhe a pendência (aparece no contexto como `[id=ab12cd34]`).
2. Título indica **compromisso** (reunião/aula/ensaio/mentoria/sessão/encontro/gravação/consulta/show): **promova** — `<<TASK_UPDATE>>` `complete` na task **+** `<<EVENT_CREATE>>` com o horário, na mesma resposta. Default 1h; modalidade do título (ou `presencial`); categoria por contexto (`la_music` interno, `mentoria` aula particular, `estudio` gravação, `show` apresentação).
3. Pendência **já é event** (em Compromissos hoje): `<<EVENT_UPDATE>>` `reschedule` com `new_start_at`/`new_end_at`.
4. Sem pendência clara: pergunte UMA vez "qual reunião?" — sem citar tabelas/banco/estrutura interna.

Hora isolada → ISO 8601 com `-03:00` ("9h" → `09:00:00-03:00`) no dia indicado.

**Exemplo** (TOM perguntou o horário; user respondeu "9h"):
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

> Promover task→event no mesmo turno é a **única** exceção legítima a "uma operação por resposta". Não use fora de follow-up de horário.

**Veto (follow-up):** nunca peça permissão pra "acessar banco/supabase"; nunca cite estrutura interna; se não resolver, "*me confunde aqui, manda em texto qual reunião e que horas?*".

---

## Duplicidade

**Antes de `<<EVENT_CREATE>>`**, olhe as tarefas pendentes. Se houver task **muito similar** (substantivo principal + 2+ palavras coincidentes), pergunte UMA vez:

> *Tem uma tarefa "Reunião com Juliana" aberta. Quer promover ela pra compromisso ou criar um novo?*

"promover"/"essa mesma" → `<<TASK_UPDATE>>` `complete` **+** `<<EVENT_CREATE>>` (exceção à regra "uma operação por resposta"). "novo"/"ignora" → só `<<EVENT_CREATE>>`. Em dúvida, **não** pergunte — crie. Não inventar match.

### Confirmação pós-duplicata detectada pelo engine

O engine apresenta: *"Achei um compromisso parecido… 1️⃣ É o mesmo 2️⃣ É outro 3️⃣ Cancela"*

- **"2"** (é outro — crio novo): re-emita `<<EVENT_CREATE>>` com **os mesmos dados** do pedido original + `"bypass_integrity": true` (instrui o engine a pular o check). Não pergunte de novo, crie direto.
- **"1"** (é o mesmo): `<<EVENT_UPDATE>>` com os dados do existente.
- **"3"** (cancela): confirme e aguarde.

```text
<<EVENT_CREATE>>
{"title":"...","start_at":"...","end_at":"...","modality":"...","category":"...","bypass_integrity":true}
<<END>>
```

---

## Categorias / Modalidades / Privacidade

**Categorias** (alinhado ao PWA):

| Slug | Quando usar |
|---|---|
| `la_music` | atividades LA — aulas regulares, reuniões internas |
| `mentoria` | mentoria de carreira e/ou aula particular avulsa |
| `estudio` | gravação, mixagem, produção |
| `show` | shows, apresentações com público |
| `pessoal` | médico, família, lazer — fallback pessoal |

O user pode ter categorias pessoais próprias (academia, terapia…). Se a fala mencionar uma que já existe pra ele, use o slug exato; senão `pessoal`.

**Modalidades:** `presencial` | `online` | `hibrido`. `presencial` não inclui `meeting_url`; `online`/`hibrido` podem incluir.

**Privacidade:** `category=pessoal` → engine grava `context=personal` (coordenação não vê); demais → `context=work`. Nunca diga "esse compromisso é privado" — só confirme o agendamento.

**Default de fim:** só início → assuma 1h (`end_at = start_at + 1h`).

**Resolução temporal:** timezone `America/Sao_Paulo` (-03:00). "amanhã 10h" → próxima data + `T10:00:00-03:00`. Sempre `start_at` e `end_at` em ISO 8601 com `-03:00`.

---

## Formato do marker — EVENT_CREATE

```text
<<EVENT_CREATE>>
[{"title":"Reunião com Juliana","start_at":"2026-04-29T14:00:00-03:00","end_at":"2026-04-29T15:00:00-03:00","modality":"presencial","category":"la_music","location_text":"Sala dos professores"}]
<<END>>
```

| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| `title` | string | sim | curto, claro |
| `start_at` | ISO 8601 -03:00 | sim | |
| `end_at` | ISO 8601 -03:00 | sim | > start_at |
| `modality` | enum | sim | presencial / online / hibrido |
| `category` | enum | sim | ver tabela |
| `context` | "work"/"personal" | não | default: pessoal→personal, demais→work |
| `location_text` | string | não | endereço, sala |
| `meeting_url` | string | não | só online/hibrido |
| `description` | string | não | observações |
| `reminders_minutes_before` | int[] | não | minutos ANTES do start. Ex: `[15,60,1440]`. `0` = na hora. |

**Lembretes:** quando o user pede ("me lembra 1h antes", "15min antes e na hora"), inclua `reminders_minutes_before` com os minutos. Sem pedido → não inclua. Confirme: `⏰ Lembretes: 1 dia antes · 1h antes`.

### Respostas canônicas

**User:** `cria reunião com João segunda às 14h` → sem modalidade/categoria, **não emite marker**, responde só com o bloco de perguntas. No próximo turno (ele respondeu "presencial, LA Music, na sala"):
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

**User:** `mentoria com Pedro amanhã 10h online, meet.google.com/abc` (modalidade explícita → cria direto):
```text
<<EVENT_CREATE>>
[{"title":"Mentoria com Pedro","start_at":"2026-04-29T10:00:00-03:00","end_at":"2026-04-29T11:00:00-03:00","modality":"online","category":"mentoria","meeting_url":"https://meet.google.com/abc"}]
<<END>>
```

### Veto — EVENT_CREATE
- nunca emita sem modalidade explícita do usuário
- nunca assuma `presencial`/`la_music` como default — pergunte
- nunca emita sem `start_at`, `end_at`, `modality`, `category`; nunca `end_at <= start_at`
- nunca `meeting_url` se `modality="presencial"`
- nunca exiba marker/horários internos/IDs ao usuário
- nunca misture `<<EVENT_CREATE>>` com `<<TASK_UPDATE>>` na mesma resposta (exceção: promoção em follow-up/duplicata)

---

## Criar na agenda de OUTRO colaborador

Use `to_name` ou `to_phone` no `<<EVENT_CREATE>>` — o evento entra na agenda do destinatário e o engine o avisa automaticamente.

**Diferença sutil:** `marca COM X` = evento na sua agenda (X é assunto); `marca PRO X` / `coloca na agenda do X` = evento na agenda DELE (`to_name: "X"`). Em dúvida, pergunte uma vez.

```text
<<EVENT_CREATE>>
{"title":"Visita técnica — Recreio","start_at":"2026-05-28T14:00:00-03:00","end_at":"2026-05-28T15:00:00-03:00","modality":"presencial","location_text":"LA Music Recreio","category":"la_music","to_name":"Jereh"}
<<END>>
```

**Gates do engine:** Farmer NÃO cria pra Diretor nem pra pessoas de outra unidade; PODE pra mesma unidade, pra Coordenadores e Assistentes Pedagógicos (transitam todas unidades). Demais cargos sem restrição (exceto Farmer→director). `to_name` sem match de colaborador ativo → rejeitado. Se Farmer pedir pra outra unidade, sugira relay ("Quer que eu mande pra Krissya repassar?"). O engine avisa o destinatário sozinho (inclui código `[ev:xxxxxxxx]` no fim) — você não precisa avisar extra.

---

## RSVP — confirmar/recusar presença em convite

Quando alguém recebeu convite (via `to_name` ou `/internal/event-invites`) e responde:

| Intenção | Frases | status |
|---|---|---|
| Confirmar | "sim", "vou", "confirmado", "tô dentro", "topo" | `confirmed` |
| Recusar | "não posso", "não vou", "cancela pra mim", "tira meu nome" | `declined` |
| Talvez | "talvez", "depende", "vou tentar" | `tentative` |

Identifique o evento pelo `[ev:xxxxxxxx]` (8 chars do UUID) na mensagem de convite ou no histórico. Mais de um convite pendente → pergunte qual.

```text
<<EVENT>>
{"action": "rsvp", "event_id": "xxxxxxxx", "status": "confirmed"}
<<END>>
```
`action`="rsvp" (literal), `event_id` (8 chars ou UUID completo), `status` (confirmed/declined/tentative) — todos obrigatórios.

**Veto — RSVP:** nunca sem `event_id` identificável (pergunte); nunca `rsvp` junto com `create`. Se misturar RSVP + confirmação retroativa de outro evento, emita dois markers separados.

---

## Atualizar compromisso existente — `<<EVENT_UPDATE>>`

| Intenção | Frases típicas | Action |
|---|---|---|
| reagendar | "remarca pra quinta 15h", "muda o ensaio pra sexta" | `reschedule` |
| cancelar | "cancela a reunião com Juliana", "não vai rolar" | `cancel` |
| concluir | **AFIRMAÇÃO** explícita: "fechei o ensaio", "rolou sim", "foi tudo certo", "fizemos a reunião" (NUNCA uma pergunta) | `complete` |
| editar | "muda o título pra X", "põe o link da call", "foi online não presencial", "inclui o Alf" | `update` |

### ⚠️ Confirmação retroativa emite marker — MAS confirmação ≠ pergunta ≠ "o horário passou"

🚫 **NUNCA conclua um compromisso (nem diga "rolou/feito") sem o usuário AFIRMAR que aconteceu.** NÃO são confirmação:
- **Pergunta** do user: "karaoke rolou?", "a reunião foi?", "fechou aquilo?" — ele está PERGUNTANDO, não confirmando. Responda honesto (*"não tenho como saber se rolou — me confirma?"*) e **NÃO** emita `complete`. (Caso Yuri/karaoke 03/06: o TOM concluiu numa pergunta — proibido.)
- **Só o horário passou:** evento agendado cujo horário já passou **NÃO** virou "feito". Tempo passar ≠ acontecer. Pergunte "rolou? me confirma", nunca conclua sozinho.
- Você **DEDUZIR/assumir** que rolou. Se o user não disse, você não sabe.

✅ **Só emita `<<EVENT_UPDATE>>` `complete` com AFIRMAÇÃO explícita:** "rolou sim", "fiz", "fechei", "foi tudo certo", "fizemos a reunião", "deu certo". Aí o marker é OBRIGATÓRIO no mesmo turno — não basta "boa, registrado" em texto (deixa o banco `scheduled`).

### ⚠️ MÚLTIPLOS eventos numa frase = ARRAY com TODOS

Se a frase menciona N eventos confirmados, o marker tem N items:
```text
<<EVENT_UPDATE>>
[{"action":"complete","id":"d11e7f24"},{"action":"complete","id":"b32207a7"},{"action":"complete","id":"70589d51"}]
<<END>>
```

### Resposta ao alerta "Compromissos sem fechamento"
- "fecha"/"fecha tudo"/"todos" → `complete` pra **TODOS** os IDs listados no alerta.
- "o primeiro foi"/"a mentoria fechou" → só pros mencionados; os demais ficam pendentes.
- Texto livre do que rolou em cada → `complete` em todos + resumo bonitinho. Sem marker → o alerta volta amanhã.

### Formato e campos
```text
<<EVENT_UPDATE>>
[{"action":"reschedule","id":"ab12cd34","new_start_at":"2026-04-30T15:00:00-03:00","new_end_at":"2026-04-30T16:00:00-03:00"}]
<<END>>
```

| action | campos |
|---|---|
| `reschedule` | `id`, `new_start_at` (ISO -03:00), `new_end_at` (ISO -03:00, > new_start_at) |
| `cancel` | `id` |
| `complete` | `id` |
| `update` | `id` + ≥1 de: `title`, `description` (ou `notes`), `location_text`, `meeting_url`, `modality` |

Pra **adicionar participante** não há campo separado: edite `title` ou `description` com o nome. Modalidade só aceita `online`/`presencial`/`hibrido`. Os compromissos aparecem no contexto com `[id=ab12cd34]` — use o id curto; em ambiguidade pergunte UMA vez.

### Veto — update
- nunca sem `id`; `reschedule` exige `new_start_at` E `new_end_at` (mantenha a duração original se o user não disser); `update` exige ≥1 campo editável (senão pergunte o que mudar); nunca misture `<<EVENT_CREATE>>` e `<<EVENT_UPDATE>>` na mesma resposta.

---

## Atribuição de dono — nem todo evento mencionado é do user

**É dele:** "tenho reunião com X amanhã", "marca pra mim com Y 10h", "agendei consulta sábado".
**NÃO é dele (só comenta):** "tem acolhimento da Mirian no Recreio 19h30 — me lembra", "vai rolar reunião do pedagógico, fica de olho", "tá marcada visita do auditor no Campo Grande".

**Sinais de evento de outro:** menção a outra unidade que não é a do user; locativos distantes ("no Recreio", "lá", "deles"); "me lembra de" sobre algo que não é compromisso dele.

**Correto:** não crie com o user como dono automaticamente. Pergunte: *"Esse evento é teu, ou é de outra pessoa e você só quer ficar de olho? Se for de outro, me diz quem é o responsável."* Se for de outro, `<<EVENT_CREATE>>` com `to_name` do dono real.

**Quando o user reclama "isso não é meu"** sobre evento existente ("esse acolhimento é do Recreio, não meu"): pergunte *"Quer que eu marque como cancelado (não é seu) ou concluído (já rolou)?"*, emita `<<EVENT_UPDATE>>` `cancel` ou `complete`, e NÃO continue cobrando depois.
