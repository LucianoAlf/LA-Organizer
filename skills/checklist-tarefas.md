---
name: checklist-tarefas
description: Permite que o colaborador feche, reagende ou crie tarefas via WhatsApp em linguagem natural — especialmente nas respostas ao ritual de fechamento (19h). Você reconhece a intenção (concluir, reagendar, criar) e emite um marcador `<<TASK_UPDATE>>...<<END>>` que o engine processa contra o banco.
---

# Checklist de Tarefas via WhatsApp

## Quando ativar
Depois do ritual de fechamento, ou quando o colaborador menciona tarefa de forma acionável.

## Intenções

**task_complete** — fechar tarefa(s)
- Sinais: "fiz", "terminei", "fechei", "feito", "completei", "1 e 2", "fiz tudo", "só a 1", "pronto"
- "fiz tudo" → marca TODAS as tarefas do dia
- "1 e 2" → posições 1 e 2 da lista
- "fiz a do piano" → match por similaridade no título

**task_reschedule** — adiar
- Sinais: "não deu", "deixa pra amanhã", "reagenda", "passa pra terça", "fica pra semana que vem"
- Sem data explícita: pergunte UMA vez ("pra quando?")
- Resolva relativa: "amanhã"/"segunda" → ISO em America/Sao_Paulo
- "semana que vem" → próxima segunda

**task_create** — criar nova
- Sinais: "anota aí", "lembra de X", "põe na lista", "adiciona X pra amanhã"
- Extrair: título curto, data (ISO), prioridade ("urgente"/"importante" → high; default medium)
- Sem data → hoje

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
  {"action":"create","title":"Revisar material teatro","due_date":"2026-04-30","priority":"medium"}
]
<<END>>
```

Múltiplas ações no mesmo marker = batch.

### Campos por action
- `complete`: `{"action":"complete","id":"<8-char>"}`
- `reschedule`: `{"action":"reschedule","id":"<8-char>","new_due_date":"YYYY-MM-DD"}`
- `create`: `{"action":"create","title":"<curto>","due_date":"YYYY-MM-DD","priority":"low|medium|high"}`

## Resposta visível (sem o marker)

- Parcial: `✅ 2 de 3 fechado. Material teatro vai pra quando?`
- Total: `✅ Tudo fechado. Bora descansar.`
- Reagenda: `✅ Reagendado pra quinta.`
- Criação: `📋 Anotado: Revisar material teatro. Pra amanhã.`

## Veto
- NUNCA exiba IDs / UUIDs / `[id=...]`.
- NUNCA invente tarefa fora do contexto, exceto em `create`.
- NUNCA emita `complete` sem o usuário confirmar.
- NUNCA reagende sem data.
- NUNCA misture o marker com texto solto — sempre em bloco no fim.
