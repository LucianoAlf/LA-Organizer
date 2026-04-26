---
name: cadastro-projeto-5w2h
description: Conduz cadastro de projeto via conversa de 7 perguntas (5W2H), uma por mensagem. Ao confirmar, emite marcador <<PROJECT_CREATE>> que o engine persiste. Só coordenador ou diretor pode disparar. NUNCA mencione "5W2H" ou jargão pro usuário — é só nome interno desta skill.
---

# Cadastro de Projeto (5W2H — interno)

> ⚠️ NUNCA mencione "5W2H" pro usuário. É nome interno. Pro colaborador, é só "criar um projeto novo" — uma conversa guiada.

## Trigger
"quero criar projeto", "novo projeto", "vamos criar um projeto", "cadastra um projeto", ou intenção clara equivalente.

## Gate de permissão (PRIMEIRA COISA)
Olhe o `Role` do colaborador no contexto:
- `coordinator` ou `director` → siga o fluxo abaixo.
- outros → responda EXATAMENTE:
  > "Só coordenador ou diretor pode criar projeto. Quer que eu avise alguém?"
  E PARE. Sem perguntas, sem marcador.

## Regra crítica — Q1

⚠️ A PRIMEIRA pergunta após detectar intent é SEMPRE imediata e sem preamble.

NUNCA adicione "Show!", "Bora!", "Vamos lá!" ou qualquer transição antes do Q1.

A primeira mensagem do fluxo é EXATAMENTE:

🗂️ *Como vai chamar esse projeto?*

Direto. Sem ack, sem introdução, sem comentário.

## Fluxo — 7 perguntas, UMA por mensagem (na ordem)
Espere a resposta antes da próxima. Cada pergunta em **negrito** WhatsApp.

1. **(nome)** "🗂️ *Como vai chamar esse projeto?*" → `name`
2. **(justificativa)** "🎯 *Por que esse projeto existe? Qual a justificativa?*" → `justification`
3. **(local)** "📍 *Onde vai acontecer? Qual unidade ou local?*" → `location` (campo_grande / recreio / barra / online / etc)
4. **(janela)** "🗓️ *Qual a janela? Início e fim?*" → `start_date` e `end_date` ISO `YYYY-MM-DD` ou `null`
5. **(quem)** "👥 *Quem vai participar? Pode ser por nome ou função.*" → texto em `description`
6. **(como)** "🛠️ *Como vai executar? Qual a abordagem?*" → `methodology`
7. **(horas)** "⏱️ *Quantas horas por semana esse projeto vai consumir do time?*" → `estimated_hours_week` (número)

## Confirmação
Recapitule TUDO em **bullet list** (`•`), pergunta final em **negrito**:
> "_Confere se tá certo:_
> • Nome: ...
> • Justificativa: ...
> • Local: ...
> • Janela: ... → ...
> • Quem: ...
> • Como: ...
> • Horas/semana: ...
>
> *Posso criar?*"

## Resposta
- Confirma ("sim"/"pode"/"manda"/"fechou"/"cria"): emita o marcador.
- Pede alteração ("muda nome pra X"): ajuste, repita confirmação.
- Cancela ("cancelar"/"esquece"): aborte. Texto: "Beleza, cancelei aqui. Quando quiser, é só chamar."

## Marcador final (OBRIGATÓRIO ao confirmar)
A resposta termina EXATAMENTE com este bloco:

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

- Antes do marcador: `✅ <Nome do Projeto> criado! Bora distribuir tarefas?` — SEM ID, SEM 👽, SEM "5W2H".
- `category`: `pedagogical` | `commercial` | `administrative` | `operational` | `event` | `infrastructure`. Default `operational`.
- `start_date`/`end_date`: ISO ou `null`.
- `estimated_hours_week`: número, sem aspas.
- `description`: resposta da pergunta 5.

## Veto
- NUNCA pule o gate de permissão.
- NUNCA emita o marcador antes da confirmação.
- NUNCA despeje as 7 perguntas de uma vez.
- NUNCA invente respostas.
- NUNCA mostre o marcador antes da confirmação.
- NUNCA mencione "5W2H", "Eisenhower", IDs ou nomes técnicos.
- NUNCA exponha ID do projeto.
