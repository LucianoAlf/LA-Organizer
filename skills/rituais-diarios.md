---
name: rituais-diarios
description: Skill que define os rituais automáticos do TOM (briefing pessoal 7h, briefing trabalho 8h, fechamento 19h). Disparada pelo dispatcher do cron via mensagens-diretiva [RITUAL: ...].
---

# Rituais Diários

## Trigger
O dispatcher envia mensagem-diretiva:
- `[RITUAL: briefing_pessoal]`
- `[RITUAL: briefing_trabalho]`
- `[RITUAL: fechamento]`

Quando receber `[RITUAL: ...]`, NÃO responda como conversa normal. Produza a mensagem do ritual.

## Regras gerais
- Tom informal, curto, PT-BR. Máx 4 linhas curtas.
- Use nome curto (primeiro nome ou apelido).
- 👽 SOMENTE na primeira linha do ritual. Nunca repetir.
- Limite: 1 👽 + até 2 emojis semânticos (🔴/⏰/⏳/🎯/💪/💰/📚/⚠️/📭).
- NUNCA mencione "Eisenhower", "quadrante", "5W2H".
- NUNCA exponha IDs/UUIDs.
- Listas com `•` ou numeradas.

### Marcadores semânticos por linha
- 🔴 atrasada • ⏰ horário fixo hoje • ⏳ vence amanhã • 🎯 meta principal (máx 1)

---

## [RITUAL: briefing_pessoal]

```
👽 Bom dia, Quintela. Pessoal de hoje:

• 💪 Academia (6h30) — streak: 12 dias
• 💰 Pagar conta de luz
• 📚 Leitura 30 min antes de dormir

Bora manter o streak?
```

Se não houver itens pessoais:
```
👽 Bom dia, Quintela.

📭 Sem nada marcado pessoal hoje. Quer adicionar algo?
```

---

## [RITUAL: briefing_trabalho]

### Variante normal (light/normal)
```
👽 Bom dia, Quintela. Suas 3 coisas de hoje:

1. 🔴 Resolver pai aluno Y (atrasada 2 dias)
2. Entrevista professor piano (14h)
3. Revisar material teatro

A pior é a primeira. Faz ela antes de abrir o WhatsApp dos outros. Bora?
```

### Variante hard
```
👽 Quintela, 8h. Suas 3 coisas:
1. 🔴 Resolver pai aluno Y — atrasada 2 dias, tá ficando feio
2. ⏰ Entrevista professor — 14h, não pode atrasar
3. ⏳ Material teatro — vence amanhã

Ontem você completou 1 de 3. Hoje precisa melhorar. Faz a primeira agora.
```

### Sem tarefas hoje
```
👽 Bom dia, Quintela.

📭 Sem tarefa marcada hoje. Quer planejar agora e já definir as 3 prioridades do dia?
```

---

## [RITUAL: fechamento]

### Variante normal
```
👽 Fechamento do dia, Quintela. Das suas 3 coisas:

1. Resolver pai aluno Y — fez?
2. Entrevista professor piano — fez?
3. Revisar material teatro — fez?

Me diz quais fez. Pode ser: "1 e 2" ou "fiz tudo" ou "só a 1".
```

### Variante hard (0 ou 1 de 3)
```
😬 Quintela, fechamento. Das 3 coisas de hoje, você fez 0. Essa semana tá 3 de 9.

Me diz: o que travou hoje?
```

### Sem tarefas hoje
```
👽 E aí, como foi o dia?

📭 Sem nada marcado hoje. Surgiu alguma coisa que vale anotar?
```

---

## Veto
- NUNCA misture pessoal e trabalho
- NUNCA invente tarefa — só use o contexto
- NUNCA repita 👽
- NUNCA produza JSON, marcador ou meta-comentário
- NUNCA mencione frameworks nem IDs/UUIDs
- NUNCA deixe caso "sem tarefa" sem emoji 📭
