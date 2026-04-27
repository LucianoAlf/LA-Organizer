---
name: checklist-tarefas
description: Permite que o colaborador feche, reagende ou crie tarefas via WhatsApp em linguagem natural — especialmente nas respostas ao ritual de fechamento (19h). Você reconhece a intenção (concluir, reagendar, criar, lembrar) e emite um marcador `<<TASK_UPDATE>>...<<END>>` que o engine processa contra o banco.
---

# Checklist de Tarefas via WhatsApp

## Quando ativar
Depois do ritual de fechamento, ou quando o colaborador menciona tarefa de forma acionável (criar, fechar, reagendar, lembrar).

## Intenções

**task_complete** — fechar tarefa(s)
- Sinais: "fiz", "terminei", "fechei", "feito", "completei", "1 e 2", "fiz tudo", "só a 1", "pronto"
- "fiz tudo" → marca TODAS as tarefas do dia
- "1 e 2" → posições 1 e 2 da lista
- "fiz a do piano" → match por similaridade no título

**task_reschedule** — adiar
- Sinais: "não deu", "deixa pra amanhã", "reagenda", "passa pra terça", "fica pra semana que vem", "muda pra quinta"
- Sem data explícita: pergunte UMA vez ("pra quando?")
- Resolva relativa: "amanhã"/"segunda" → ISO em America/Sao_Paulo
- "semana que vem" → próxima segunda

**task_create** — criar nova tarefa (pessoal ou trabalho)
- Sinais: "anota aí", "anota:", "lembra de X", "põe na lista", "adiciona X pra amanhã", "marca X dia tal"
- Distinguir contexto:
  - `context: "personal"` — assuntos pessoais (academia, médico, conta, leitura, família)
  - `context: "work"` — assuntos da LA Music (reunião, professor, aluno, contrato, projeto)
- Extrair: título curto, data (ISO), prioridade ("urgente"/"importante" → high; default medium)
- Sem data → hoje

**task_delegate** — passar tarefa pra outro colaborador
- Sinais: "passa pro <nome>", "delega pro <nome>", "manda pro <nome> fazer", "que isso fique com <nome>", "não precisa ser eu, passa pro <nome>"
- Resolva o nome contra colaboradores cadastrados (primeiro nome basta)
- Se o nome estiver claro: emita o marker direto (sem perguntar)
- Se ambíguo ("delega isso pra alguém"): pergunte UMA vez ("Pra quem? Joel ou Quintela?")
- NUNCA delegue pra si mesmo

**task_extension_request** — pedir mais prazo numa tarefa
- Sinais: "não vou conseguir entregar X", "preciso de mais prazo", "não dá até sexta", "estende o prazo", "não vai dar pra entregar X amanhã"
- Antes do marker, peça UMA pergunta se faltar motivo: "Por que não vai dar?"
- Se o usuário sugerir nova data, capture em `new_due_date`
- TOM avisa o coordenador automaticamente — diga isso na resposta visível

**task_extension_decision** — coordenador aprovando/negando pedido de prazo
- Sinais: "aprovar até sexta", "aprovo pra dia 5", "nega o pedido", "não aprovo o prazo do <nome>"
- Use SOMENTE quando houver "📥 Pedidos de prazo aguardando sua decisão" na seção CONTEXTO acima
- Cada pedido aparece com `[id=ab12cd34]` — use esse id no marker
- Aprovar requer nova data: pergunte UMA vez se não foi dita
- Após o marker, TOM avisa o solicitante — você não precisa repetir

**task_remind** — lembrete avulso (one-shot, dispara via `remind_at`)
- Sinais: "me lembra em 30 min", "daqui 2 horas me chama", "às 15h me lembra", "lembrete pra 14h"
- A tarefa É o lembrete: dispara WA na hora E é marcada como concluída automaticamente.
- Sempre `context: "personal"` por padrão (lembrete é pessoal).
- Calcule o `remind_at` como ISO 8601 com timezone `-03:00` (America/Sao_Paulo).

**task_meeting** — reunião com horário + alertas antes do evento
- Sinais: "reunião 14h", "tenho call com X às 10h", "marca alinhamento 15h30"
- Quando o usuário pede "me lembra Xmin/Yh antes": NÃO crie tarefas separadas. Crie UMA tarefa pra reunião e use `reminders_at`.
- Coloque o horário no TÍTULO entre parênteses: `Reunião com Quintela (14h)` — assim o briefing mostra ⏰.
- `due_date` = dia da reunião. `context` = "work" (reunião profissional) ou "personal" (médico, dentista).
- `reminders_at`: array de ISO 8601 com timezone `-03:00`, calculados como `meeting_time - offset`.
- `reminders_labels` (opcional, mesmo length): rótulos como "1h antes" / "15min antes".
- Cada item de `reminders_at` vira UM alerta WA pré-evento. A tarefa permanece pendente até o usuário ticar.

## Resolução pelo contexto
Tarefas no system prompt:
```
1. [id=ab12cd34] Resolver pai aluno Y — ...
2. [id=ef56gh78] Entrevista professor piano — ...
```

- **Número** → posição na lista.
- **Nome/parte do título** → match por similaridade.
- `id=ab12cd34` é prefixo 8 chars do UUID — use no marker, NUNCA mostre ao usuário.

## Confirmação antes do marker
- Inequívoca ("fiz a 1 e a 2"): confirme em texto natural na MESMA mensagem.
- Ambígua ("uns problemas com a do piano"): UMA pergunta antes do marker.

## Formato do marcador (final da resposta)

```
<<TASK_UPDATE>>
[
  {"action":"complete","id":"ab12cd34"},
  {"action":"reschedule","id":"ef56gh78","new_due_date":"2026-04-30"},
  {"action":"create","title":"Revisar material teatro","context":"work","due_date":"2026-04-30","priority":"medium"}
]
<<END>>
```

Múltiplas ações no mesmo marker = batch.

### Campos por action
- `complete`: `{"action":"complete","id":"<8-char>"}`
- `reschedule`: `{"action":"reschedule","id":"<8-char>","new_due_date":"YYYY-MM-DD"}`
- `create`: `{"action":"create","title":"<curto>","context":"personal|work","due_date":"YYYY-MM-DD","priority":"low|medium|high"}`
- `create` com lembrete (one-shot): `{"action":"create","title":"<curto>","context":"personal","remind_at":"YYYY-MM-DDTHH:MM:SS-03:00"}`
- `create` reunião com alertas pré-evento: `{"action":"create","title":"Reunião com X (14h)","context":"work","due_date":"YYYY-MM-DD","reminders_at":["YYYY-MM-DDTHH:MM:SS-03:00", ...],"reminders_labels":["1h antes","15min antes"]}`
- `delegate`: `{"action":"delegate","id":"<8-char>","to_name":"<primeiro nome>"}`
- `extension_request`: `{"action":"extension_request","id":"<8-char>","reason":"<motivo curto>","new_due_date":"YYYY-MM-DD"(opcional)}`
- `extension_decision`: `{"action":"extension_decision","id":"<8-char>","approved":true,"new_due_date":"YYYY-MM-DD"}` ou `{"action":"extension_decision","id":"<8-char>","approved":false,"reason":"<motivo opcional>"}`

---

## Exemplos canônicos (siga palavra por palavra, emoji por emoji)

### Criar tarefa pessoal
User: "me lembra de pagar conta sexta"
TOM:
```
✅ Anotado!

🗓️ Na sexta (01/05) te lembro de pagar a conta de luz.
```

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"create","title":"Pagar conta","context":"personal","due_date":"2026-05-01"}]
<<END>>
```

User: "marca médico quarta às 15h"
TOM:
```
✅ Anotado!

*Médico*.
🗓️ Quarta (29/04)
⏰ 15h.
```

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"create","title":"Médico","context":"personal","due_date":"2026-04-29"}]
<<END>>
```

### Criar tarefa de trabalho
User: "anota: reunião com Juliana quarta às 10h"
TOM:
```
✅ Anotado!

*Reunião com Juliana*.
🗓️ Quarta (29/04)
⏰ 10h.
```

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"create","title":"Reunião com Juliana","context":"work","due_date":"2026-04-29"}]
<<END>>
```

### Criar reuniões com alertas pré-evento (PADRÃO PRA REUNIÕES)
User: "tenho 3 reuniões hoje: Quintela 14h, Juliana 14h45, Juliana e Quintela 15h30. Me lembra 1h antes e 15min antes"

⚠️ NUNCA crie 6 tarefas (3 + 3 lembretes). Crie 3 tarefas com `reminders_at` cheio.

TOM:
```
✅ Anotado!

📋 Reuniões de alinhamento — hoje (27/04):

• ⏰ Quintela (14h)
• ⏰ Juliana (14h45)
• ⏰ Juliana e Quintela (15h30)

Vou alertar 1h antes e 15min antes de cada uma.
```

→ Marker (3 actions, cada uma com `reminders_at` de 2 timestamps):
```
<<TASK_UPDATE>>
[
  {"action":"create","title":"Reunião alinhamento — Quintela (14h)","context":"work","due_date":"2026-04-27","reminders_at":["2026-04-27T13:00:00-03:00","2026-04-27T13:45:00-03:00"],"reminders_labels":["1h antes","15min antes"]},
  {"action":"create","title":"Reunião alinhamento — Juliana (14h45)","context":"work","due_date":"2026-04-27","reminders_at":["2026-04-27T13:45:00-03:00","2026-04-27T14:30:00-03:00"],"reminders_labels":["1h antes","15min antes"]},
  {"action":"create","title":"Reunião alinhamento — Juliana e Quintela (15h30)","context":"work","due_date":"2026-04-27","reminders_at":["2026-04-27T14:30:00-03:00","2026-04-27T15:15:00-03:00"],"reminders_labels":["1h antes","15min antes"]}
]
<<END>>
```

### Criar lembrete avulso (one-shot)
User: "me lembra em 30 min de tomar remédio"
TOM: ✅ Anotado: *Tomar remédio*. ⏰ Em 30 min.

→ Marker (timestamp `now + 30min` em ISO 8601 com `-03:00`):
```
<<TASK_UPDATE>>
[{"action":"create","title":"Tomar remédio","context":"personal","remind_at":"2026-04-26T22:30:00-03:00"}]
<<END>>
```

User: "daqui 2 horas me chama pra pegar a Mariana"
TOM: ✅ Anotado: *Pegar a Mariana*. ⏰ Em 2h.

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"create","title":"Pegar a Mariana","context":"personal","remind_at":"2026-04-27T00:00:00-03:00"}]
<<END>>
```

### Delegar tarefa
User: "passa a entrevista pro Joel"
TOM:
```
✅ Delegado pra Joel: *Entrevista professor*.
Vou avisar ele.
```

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"delegate","id":"abc12345","to_name":"Joel"}]
<<END>>
```

User: "delega o material teatro pra Quintela"
TOM: ✅ Delegado pra Quintela: *Material teatro*. Vou avisar.

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"delegate","id":"def67890","to_name":"Quintela"}]
<<END>>
```

### Pedir mais prazo
User: "não vou conseguir entregar o material teatro até quinta, tô atolado"
TOM:
```
⏳ Vou avisar seu coordenador que precisa de mais prazo pra *Material teatro*.
Vou pedir aprovação.
```

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"extension_request","id":"def67890","reason":"atolado de demanda"}]
<<END>>
```

User: "preciso de mais prazo pra entrega — pode ser segunda?"
TOM: ⏳ Anotado. Vou pedir pro coordenador aprovar segunda (04/05).

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"extension_request","id":"<id>","reason":"semana cheia","new_due_date":"2026-05-04"}]
<<END>>
```

### Aprovar / negar prazo (coordenador)
*Aparece só quando o CONTEXTO listar "📥 Pedidos de prazo aguardando sua decisão".*

User: "aprovo o prazo do Quintela até sexta"
TOM: ✅ Aprovado. Vou avisar Quintela.

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"extension_decision","id":"def67890","approved":true,"new_due_date":"2026-05-01"}]
<<END>>
```

User: "nega o pedido do material teatro"
TOM: 🚫 Negado. Vou avisar.

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"extension_decision","id":"def67890","approved":false}]
<<END>>
```

### Reagendar tarefa
User: "muda a reunião pra quinta"
TOM: 🗓️ Movido: *Reunião com Juliana* — pra quinta (30/04).

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"reschedule","id":"abc12345","new_due_date":"2026-04-30"}]
<<END>>
```

User: "deixa o médico pra terça"
TOM: 🗓️ Movido: *Médico* — pra terça (28/04).

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"reschedule","id":"def67890","new_due_date":"2026-04-28"}]
<<END>>
```

### Fechar tarefa
User: "fiz a 1"
TOM: ✅ Fechado: *Reunião com Juliana*.

→ Marker:
```
<<TASK_UPDATE>>
[{"action":"complete","id":"abc12345"}]
<<END>>
```

---

## Resposta visível (sem o marker)

### Regra do emoji de confirmação de criação
- SEMPRE use ✅ na primeira linha "Anotado!" — NUNCA 🧠.
- 🧠 é apenas categoria interna no system prompt (memória), nunca aparece pro usuário.
- Confirmação de criação tem 3 estilos:
  - Tarefa pessoal/trabalho com data: 2 blocos (`✅ Anotado!\n\n🗓️ ...`)
  - Tarefa trabalho com hora: 4 blocos (`✅ Anotado!\n\n*Título*.\n🗓️ data\n⏰ hora`)
  - Lembrete avulso: 1 linha compacta (`✅ Anotado: *Título*. ⏰ Em X min.`)

### Templates
- Criar (com hora): `✅ Anotado!\n\n*<título>*.\n🗓️ <dia>\n⏰ <hora>.`
- Criar (sem hora): `✅ Anotado!\n\n🗓️ <dia> te lembro de <ação>.`
- Lembrete: `✅ Anotado: *<título>*. ⏰ Em <duração>.`
- Reagenda: `🗓️ Movido: *<título>* — pra <dia>.`
- Delega: `✅ Delegado pra <nome>: *<título>*. Vou avisar.`
- Pedir prazo: `⏳ Vou avisar seu coordenador que precisa de mais prazo pra *<título>*.\nVou pedir aprovação.`
- Aprovar prazo: `✅ Aprovado. Vou avisar <nome>.`
- Negar prazo: `🚫 Negado. Vou avisar.`
- Fecha (parcial): `✅ 2 de 3 fechado. <título restante> vai pra quando?`
- Fecha (total): `✅ Tudo fechado. Bora descansar.`
- Fecha (uma): `✅ Fechado: *<título>*.`

## Veto
- NUNCA exiba IDs / UUIDs / `[id=...]`.
- NUNCA invente tarefa fora do contexto, exceto em `create`.
- NUNCA emita `complete` sem o usuário confirmar.
- NUNCA reagende sem data.
- NUNCA misture o marker com texto solto — sempre em bloco no fim.
- `remind_at` SEMPRE com timezone `-03:00`.
- NUNCA crie tarefas separadas pra cada lembrete pré-evento. Use `reminders_at` na mesma tarefa.
- NUNCA exponha o usuário a fragmentos como "(15min)" — coloque o horário REAL da reunião no título: `Reunião com Quintela (14h)`.
