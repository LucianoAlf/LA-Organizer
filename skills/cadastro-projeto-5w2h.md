---
name: cadastro-projeto-5w2h
description: Conduz cadastro de projeto via conversa de 7 perguntas (5W2H), uma por mensagem. Ao confirmar, emite marcador <<PROJECT_CREATE>> que o engine persiste. Só coordenador ou diretor pode disparar. NUNCA mencione "5W2H" ou jargão pro usuário — é só nome interno desta skill.
---

# Cadastro de Projeto (5W2H — interno)

> ⚠️ NUNCA mencione "5W2H" pro usuário. É nome interno. Pro colaborador, é só "criar um projeto novo".

## Trigger
"quero criar projeto", "novo projeto", "vamos criar um projeto", ou intenção clara equivalente.

## Gate de permissão (PRIMEIRA COISA)
Olhe o `Role` do colaborador no contexto:
- `coordinator` ou `director` → siga o fluxo abaixo.
- outros → responda: "Só coordenador ou diretor pode criar projeto. Quer que eu avise alguém?" E PARE.

## Fluxo — 7 perguntas, UMA por mensagem (na ordem)
Espere a resposta antes da próxima. Cada pergunta em negrito com emoji semântico.

1. 🗂️ *Como vai chamar esse projeto?* → `name`
2. 🎯 *Por que esse projeto existe? Qual a justificativa?* → `justification`
3. 📍 *Onde vai acontecer? Qual unidade ou local?* → `location`
4. 🗓️ *Qual a janela? Início e fim (ou "a definir")?* → `start_date` e `end_date`
5. 👥 *Quem vai participar? Pode ser por nome ou função.* → `description`
6. 🛠️ *Como vai executar? Qual a abordagem?* → `methodology`
7. ⏱️ *Quantas horas por semana esse projeto vai consumir do time?* → `estimated_hours_week`

## Confirmação
Recapitule TUDO em bullet list com emojis:
```
_Confere se tá certo:_

• 🗂️ Nome: Sarau de Violinos
• 🎯 Justificativa: Celebrar 14 anos da escola
• 📍 Local: Recreio
• 🗓️ Janela: 01/jun → 30/jul/2026
• 👥 Quem: Jordão + equipe pedagógica Recreio
• 🛠️ Como: Ensaios semanais + apresentação final
• ⏱️ Horas/semana: 5h

*Posso criar?*
```

## Resposta
- Confirma ("sim"/"pode"/"fechou"/"cria"): emita o marcador.
- Pede alteração: ajuste, repita confirmação.
- Cancela: "Beleza, cancelei. Quando quiser, é só chamar."

## Marcador final (OBRIGATÓRIO ao confirmar)
Antes do marcador: `✅ <Nome> criado! Bora distribuir tarefas?` — SEM ID.

```
<<PROJECT_CREATE>>
{
  "name": "Sarau de Violinos",
  "description": "Jordão lidera; equipe pedagógica de Recreio.",
  "justification": "Celebrar 14 anos da escola.",
  "location": "recreio",
  "start_date": "2026-06-01",
  "end_date": "2026-07-30",
  "methodology": "Ensaios semanais + apresentação final",
  "estimated_hours_week": 5,
  "category": "operational"
}
<<END>>
```

`category`: `pedagogical` | `commercial` | `administrative` | `operational` | `event` | `infrastructure`. Default `operational`.

## Veto
- NUNCA pule o gate de permissão
- NUNCA emita o marcador antes da confirmação
- NUNCA despeje as 7 perguntas de uma vez
- NUNCA mencione "5W2H", "Eisenhower", IDs ou nomes técnicos
- NUNCA exponha ID do projeto
