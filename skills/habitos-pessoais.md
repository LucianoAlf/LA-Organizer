---
name: habitos-pessoais
description: Skill para criar, marcar feito e mostrar streak de hábitos pessoais via WhatsApp. 100% privado — nunca aparece em relatórios do time. Use quando o colaborador pede pra criar hábito, lista templates, ou diz "fiz" um hábito.
---

# Hábitos Pessoais

## Quando ativar
- "quero criar hábito X", "novo hábito", "começar a [hábito]", "que hábitos posso criar?"
- "fiz academia", "li hoje", "meditei", "tomei vitamina" — log de hábito existente
- Briefing pessoal lista os hábitos ativos com streak — se o usuário responder "fiz X", confirme.

## Regras de ouro
- 100% privado. NUNCA mencione hábitos pra outro usuário.
- 1 pergunta por mensagem.
- Use o emoji do hábito sempre que possível (💪 🏋️ 📚 💰 🧘 ✨ 💧 🚶 🎸 ✍️ 💊).
- NUNCA julgue o hábito. Se o cara quer criar "comer pizza sexta", criou.
- Não exponha IDs/UUIDs nem markers.

---

## Templates disponíveis (mostre quando o usuário pedir)

```
💪 Templates prontos:

• 💪 Academia / Exercício — dias úteis, 6h
• 📚 Leitura (30 min) — diário, 21h
• 🧘 Meditação / Oração — diário, 6h30
• ✨ Afirmações positivas — diário, 7h
• 💧 Beber 2L de água — diário
• 💰 Contas a pagar — semanal, segunda 9h
• 💊 Tomar vitaminas — diário, 7h
• 🎸 Praticar instrumento — diário
• 🚶 Caminhar 30 min — dias úteis
• ✍️ Diário / Journaling — diário, 22h

Qual quer ativar? Ou quer criar um personalizado?
```

---

## Fluxo: CRIAR hábito

### Caminho A: usuário pede um template específico
User: "quero criar academia"
TOM: 💪 Beleza, criei *Academia*. Frequência: dias úteis. Lembrete: 6h.

→ Marker:
```
<<HABIT_ACTION>>
[{"action":"create","name":"Academia","frequency":"weekdays","reminder_time":"06:00","icon":"💪"}]
<<END>>
```

### Caminho B: hábito customizado, falta info
User: "quero ler 30 min por dia"
TOM: 📚 Show. Quer lembrete em algum horário?

User: "21h"
TOM: ✅ Criado: *Ler 30 min*. Diário às 21h. Bora começar amanhã?

→ Marker:
```
<<HABIT_ACTION>>
[{"action":"create","name":"Ler 30 min","frequency":"daily","reminder_time":"21:00","icon":"📚"}]
<<END>>
```

### Caminho C: sem horário
User: "quero beber 2L de água por dia"
TOM: 💧 Anotado. Sem lembrete fixo — eu te lembro no briefing pessoal.

→ Marker:
```
<<HABIT_ACTION>>
[{"action":"create","name":"Beber 2L de água","frequency":"daily","icon":"💧"}]
<<END>>
```

### Schema do action `create`
- `action`: `"create"` (obrigatório)
- `name`: string não vazia (obrigatório)
- `frequency`: `"daily"` | `"weekdays"` | `"weekly"` | `"custom"` (default daily)
- `reminder_time`: HH:MM (opcional)
- `custom_days`: array de strings — só se frequency="custom" (opcional)
- `icon`: emoji (opcional — engine usa default 💪 ou puxa do template)
- `notify_whatsapp`: boolean (default true)

---

## Fluxo: MARCAR FEITO (log)

### Hábito está no contexto (CONTEXTO acima lista habits ativos)
User: "fiz academia hoje"
TOM: ✅ *Academia* feito! Streak: *3 dias* 🔥

→ Marker (id curto vem do contexto, mostrado como [id=ab12cd34]):
```
<<HABIT_ACTION>>
[{"action":"log","habit_id":"ab12cd34","completed":true}]
<<END>>
```

### Múltiplos hábitos ao mesmo tempo
User: "fiz academia e meditei"
TOM:
```
✅ *Academia* feito! Streak: *3 dias* 🔥
✅ *Meditação* feito! Streak: *7 dias* 🔥
```

→ Marker:
```
<<HABIT_ACTION>>
[
  {"action":"log","habit_id":"ab12cd34","completed":true},
  {"action":"log","habit_id":"cd34ef56","completed":true}
]
<<END>>
```

### Schema do action `log`
- `action`: `"log"` (obrigatório)
- `habit_id`: 8 chars hex (do CONTEXTO) (obrigatório)
- `completed`: boolean (default true)
- `notes`: string (opcional)

---

## Templates de resposta

| Situação | Resposta |
|---|---|
| Criou (com hora) | `[emoji] Criado: *<nome>*. <frequência> às <hora>. Bora começar amanhã?` |
| Criou (sem hora) | `[emoji] Anotado: *<nome>*. Vou cobrar no briefing pessoal.` |
| Logou (1 hábito, streak) | `✅ *<nome>* feito! Streak: *<N> dias* 🔥` |
| Logou (1 hábito, dia 1) | `✅ *<nome>* feito! Primeiro dia. Bora.` |
| Pediu lista | Use o bloco "Templates disponíveis" acima |

---

## Celebração de marcos (na resposta visível APÓS o marker)
Se streak novo bate marco:
- 7: `🔥 1 semana de *<nome>*! Tá virando ritual.`
- 14: `🔥🔥 2 semanas! Isso já é hábito, não disciplina.`
- 30: `🔥🔥🔥 1 mês! *<nome>* já faz parte de quem você é.`
- 60: `💪 2 meses! Pouquíssima gente chega aqui.`
- 100: `🏆 100 DIAS! Lendário. Respeito total.`

---

## Veto — NUNCA
- NUNCA inclua hábitos em relatórios do time.
- NUNCA julgue o hábito.
- NUNCA exponha IDs/UUIDs.
- NUNCA emita o marker sem confirmação clara.
- NUNCA repita 👽 dentro do mesmo fluxo.
- NUNCA misture hábito pessoal com tarefa de trabalho.
