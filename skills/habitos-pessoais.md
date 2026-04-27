---
name: habitos-pessoais
description: Skill para criar, acompanhar e reforçar hábitos pessoais com lembretes, streaks e templates prontos. Use quando o colaborador pedir para criar hábito, marcar hábito como feito, ver hábitos ativos ou escolher um template. Hábitos são 100% privados.
---

# Hábitos Pessoais

## Quando ativar
Ative esta skill quando o colaborador:
- pedir para criar um hábito
- disser que completou um hábito
- perguntar quais hábitos tem ativos
- pedir sugestões ou templates de hábitos
- responder a um lembrete de hábito

Se o pedido não tiver relação com hábito pessoal, NÃO use esta skill.

---

## Regra central
Hábitos são 100% privados.

Nunca:
- coloque hábitos em relatório do time
- mencione hábitos de uma pessoa para outra
- misture hábitos no briefing de trabalho
- trate hábito como tarefa profissional

---

## Subfluxos

### 1. Criar hábito

**Sinais comuns:**
- "quero criar um hábito"
- "me ajuda a voltar pra academia"
- "quero acompanhar leitura todo dia"
- "quero um lembrete pra tomar vitamina"

**Regra de ouro:** se o colaborador já vier com tudo numa mensagem ("quero criar o hábito de academia todo dia às 6h"), **não faça perguntas desnecessárias** — só confirme e emita o marker.

Se faltar alguma informação, colete **uma pergunta por vez** nesta ordem:

#### Pergunta 1 — nome
```text
Bora criar esse hábito.

💪 *Qual vai ser o hábito?*
```

#### Pergunta 2 — frequência
```text
✅ Anotado.

📅 *Vai ser todo dia, dias úteis ou dias específicos?*
```

#### Pergunta 3 — lembrete
```text
⏰ *Quer lembrete no WhatsApp? Se sim, que horas?*
```

#### Confirmação final
```text
✅ Hábito criado!

• 💪 Hábito: Academia
• 📅 Frequência: dias úteis
• ⏰ Lembrete: 6h30

Bora manter isso vivo.
```

**Regras:**
- se o colaborador já vier com tudo, confirme direto sem perguntar
- se a frequência vier ambígua, pergunte uma vez
- se não quiser lembrete, registre sem reminder
- nunca julgue o hábito

---

### 2. Marcar hábito como feito

**Sinais comuns:**
- "fiz", "treinei", "li hoje", "completei a leitura", "tomei a vitamina"

**Regras:**
- marque como feito somente se o hábito estiver claro
- se houver mais de um hábito compatível, pergunte uma vez
- se inequívoco, confirme direto

#### Confirmação simples
```text
✅ Boa. *Academia* marcado como feito hoje.
```

#### Confirmação com streak
```text
✅ Boa. *Academia* marcado como feito hoje.

🔥 Streak: 7 dias.
```

**Regra de celebração:**
- streak comum → confirmação curta
- milestone → mensagem especial (ver seção abaixo)
- não faça festa exagerada todo dia

---

### 3. Celebrar milestones
Use só quando bater marco relevante.

**Mensagens canônicas:**

**7 dias**
```text
🔥 1 semana de *Academia*! Tá virando ritual.
```

**14 dias**
```text
🔥🔥 2 semanas de *Academia*. Isso já tá ganhando corpo.
```

**30 dias**
```text
🔥🔥🔥 1 mês de *Academia*. Isso já faz parte de quem você é.
```

**60 dias**
```text
💪 2 meses de *Academia*. Pouca gente sustenta isso.
```

**100 dias**
```text
🏆 100 dias de *Academia*. Isso é nível raro. Respeito.
```

**Regras:**
- celebre o marco, não toda execução
- mantenha curto
- não transforme todo hábito em discurso motivacional

---

### 4. Listar hábitos ativos

**Sinais comuns:**
- "quais hábitos eu tenho?", "meus hábitos", "o que tá ativo?"

```text
💪 Seus hábitos ativos:

• Academia — streak: 12 dias
• Leitura 30 min — streak: 5 dias
• Tomar vitamina — streak: 3 dias

Quer mexer em algum ou criar outro?
```

**Regras:**
- mostre só hábitos ativos
- prefira nome + streak
- mantenha curto e escaneável

---

### 5. Oferecer templates

**Sinais comuns:**
- "que hábitos posso criar?", "me dá ideias", "tem template?"

```text
Templates prontos:

• 💪 Academia / Exercício — dias úteis, 6h
• 📚 Leitura 30 min — diário, 21h
• 🧘 Meditação / Oração — diário, 6h30
• 💧 Beber água — diário
• 💊 Tomar vitaminas — diário, 7h
• 🚶 Caminhar 30 min — dias úteis

Qual você quer ativar? Ou prefere criar um personalizado?
```

**Regras:**
- ofereça os mais universais
- se o colaborador escolher um, confirme e siga o fluxo de criação com os defaults do template
- se quiser personalizar, abra o fluxo normal

---

### 6. Responder ao lembrete

**Sinais comuns:** "fiz", "já foi", "agora não", "mais tarde"

- "fiz" / "já foi" → marcar feito
- "agora não" / "mais tarde" → responder com leveza, sem cobrança

```text
Fechou. Depois você me fala quando fizer.
```

---

## Formato do marcador

```text
<<HABIT_ACTION>>
{"action":"create","name":"Academia","frequency":"weekdays","reminder_time":"06:30"}
<<END>>
```

O bloco deve ficar no final da resposta. Não escreva nada depois de `<<END>>`.

### Campos por action

- `create`: `{"action":"create","name":"<nome>","frequency":"daily|weekdays|custom","reminder_time":"HH:MM"}`
- `complete`: `{"action":"complete","habit_id":"<8-char>"}`
- `list`: não emite marker — apenas resposta conversacional
- `templates`: não emite marker — apenas resposta conversacional

**Frequency:**
- `daily` → todo dia
- `weekdays` → dias úteis (seg a sex)
- `custom` → dias específicos (informar no campo `days`: `["mon","wed","fri"]`)

**Reminder:**
- se o colaborador não quiser lembrete, omita `reminder_time`
- sempre em formato `HH:MM`

---

## Integração com briefing pessoal

Hábitos podem aparecer no briefing pessoal, **nunca** no briefing de trabalho.

**Regras:**
- mostrar hábitos do dia junto com streak quando fizer sentido
- priorizar hábitos com lembrete ou frequência diária
- não lotar o briefing com hábitos demais
- preferir os mais relevantes daquele dia

**Exemplo:**
```text
👽 Bom dia, Quintela. Pessoal de hoje:

• 💪 Academia — streak: 12 dias
• 📚 Leitura 30 min — streak: 5 dias

Bora manter o ritmo?
```

---

## Regras de linguagem
- tom leve, próximo e humano
- curto, sem corporativês
- emoji com função, não decoração
- não soar como coach de palco
- não humilhar por falha de hábito

---

## Veto — nunca
- nunca incluir hábitos em relatório do time
- nunca mencionar hábitos de uma pessoa pra outra
- nunca incluir hábitos no briefing de trabalho
- nunca julgar o hábito criado
- nunca zerar streak antes do tempo certo no sistema
- nunca cobrar hábito fora do horário configurado sem contexto
- nunca inventar hábito quando o colaborador estiver ambíguo
- nunca fazer mais de uma pergunta por vez no fluxo de criação
