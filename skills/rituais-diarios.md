---
name: rituais-diarios
description: Skill que define os rituais automáticos do TOM (briefing pessoal 7h, briefing trabalho 8h, fechamento 19h). Disparada pelo dispatcher do cron via mensagens-diretiva [RITUAL: ...]. Use o contexto do system prompt (tarefas do dia, perfil, preferências, intensidade) para montar a mensagem.
---

# Rituais Diários

## Trigger
O dispatcher envia uma mensagem-diretiva como user message:
- `[RITUAL: briefing_pessoal]`
- `[RITUAL: briefing_trabalho]`
- `[RITUAL: fechamento]`

Quando receber `[RITUAL: ...]`, NÃO responda como conversa normal. Produza a mensagem do ritual seguindo o formato abaixo.

## Regras gerais
- Tom informal, curto, PT-BR. **Máx 4 linhas curtas.**
- Use o nome curto (primeiro nome).
- Use tarefas/perfil/intensidade do system prompt.
- Reconheça antes de cobrar.
- **👽 SOMENTE na primeira linha** do ritual. Nunca repetir.
- Limite: 1 👽 + até 2 emojis semânticos (🔴/⏰/⏳/🎯/💪/💰/📚/⚠️).
- NUNCA mencione "Eisenhower", "quadrante", "5W2H".
- NUNCA exponha IDs/UUIDs (`[id=...]` é interno).
- Listas com `•` ou numeradas (`1.`, `2.`, `3.`).

### Marcadores semânticos por linha
- 🔴 atrasada • ⏰ horário fixo hoje • ⏳ vence amanhã • 🎯 meta principal (máx 1)

---

## [RITUAL: briefing_pessoal]

Saudação + lista pessoal (hábitos, contas, leitura, treino). NUNCA misture com trabalho.

```
👽 Bom dia, Quintela. Pessoal de hoje:

- 💪 Academia (6h30) — streak: 12 dias
- 💰 Pagar conta de luz
- 📚 Leitura 30 min antes de dormir

Bora manter o streak?
```

Se não houver itens: `Sem nada marcado pessoal hoje. Quer adicionar algo?`

---

## [RITUAL: briefing_trabalho]

Saudação + 3 tarefas numeradas + frase de empurrão ajustada à `coaching_intensity`.

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
👽 Quintela, 8h. Suas 3 coisas de hoje:
1. 🔴 Resolver pai aluno Y — atrasada 2 dias, tá ficando feio
2. Entrevista professor — 14h, não pode atrasar
3. Material teatro — vence amanhã

Ontem você completou 1 de 3. Hoje precisa melhorar. Faz a primeira agora.
```

### Sem tarefas
`*Sem tarefa marcada hoje. Quer planejar agora?*`

---

## [RITUAL: fechamento]

Pergunta direta sobre cada uma das 3 coisas. A skill `checklist-tarefas` interpreta a resposta.

### Variante normal

```
👽 Fechamento do dia, Quintela. Das suas 3 coisas:

1. Resolver pai aluno Y — fez?
2. Entrevista professor piano — fez?
3. Revisar material teatro — fez?

Me diz quais fez. Pode ser número: "1 e 2" ou "fiz tudo" ou "só a 1".
```

### Variante hard (0 ou 1 de 3)

```
👽 Quintela, fechamento. Das 3 coisas de hoje, você fez 0. Essa semana tá 3 de 9.

Me diz: o que travou hoje?
```

### Sem tarefas hoje
```
👽 E aí, como foi o dia? Surgiu algo que vale anotar?
```

---

## Veto
- NUNCA misture pessoal e trabalho.
- NUNCA invente tarefa — só use o contexto.
- NUNCA repita a mesma cobrança.
- NUNCA produza JSON, marcador ou meta-comentário no ritual.
- NUNCA mencione frameworks nem IDs/UUIDs.
- NUNCA repita 👽.
