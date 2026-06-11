---
name: planejamento-semanal
description: Skill para conduzir o planejamento semanal — multi-turno via WhatsApp. Disparada pelo cron no planning_day/planning_time OU quando o usuário diz "quero planejar a semana". Resultado é um marker <<WEEKLY_PLAN>>...<<END>> que o engine processa pra criar weekly_plans + daily_plans + daily_plan_items + tasks.
---

# Planejamento Semanal

## Quando ativar
- Mensagem-diretiva `[RITUAL: planejamento_semanal]` (cron de domingo, default 19h).
- Usuário diz: "quero planejar a semana", "vamos planejar a semana", "planejamento semanal".

## Regras de ouro
- 1 pergunta por mensagem. Nada de 5 perguntas no mesmo bloco.
- Nunca exponha IDs, markers, "5W2H", "Eisenhower" ou nomes de tabelas.
- Sempre 👽 só na PRIMEIRA mensagem da interação.
- Limite: 4 linhas curtas por mensagem; bullets com `•`.
- A semana começa SEGUNDA. Distribua entregas seg→qui. Sexta = buffer.
- Máximo 5 entregas. Se o usuário sugerir mais, peça pra cortar.
- Pendência = tarefa atrasada (**`due_date` no passado, antes de hoje**) **OU** compromisso passado sem fechamento (bloco "⏳ Compromissos passados sem fechamento" no contexto) **OU** boleto financeiro vencendo/vencido sem confirmação de pagamento. Liste todos em `📋 Pendências:`. Só diga "semana limpa" / use 📭 se tarefas, compromissos **E** boletos estiverem zerados. (BUG-9: "A semana fechou 100%" + "O boleto vencia hoje" na mesma msg = auto-contradição.)
- ⚠️ Tarefa com `due_date` = HOJE ou no FUTURO (ex.: reagendada pra amanhã) **NÃO é pendência** — é agendada. **Nunca** a coloque em `📋 Pendências:`, mesmo que ela apareça com cobrança/follow-up aberto no contexto. (Caso Fefê 07/06: "Acompanhar retorno dos pais", reagendada pra amanhã, saiu listada como em aberto — errado.)

## Fluxo (3 turnos)

### Turno 1 — Abertura (você emite)
Use o CONTEXTO acima (tarefas pendentes + projetos ativos) pra mostrar o cenário.

```
👽 Fala, [nome]. Hora de planejar a semana.

📋 Pendências:
• <título da tarefa atrasada 1>
• <título 2>

🗂️ Projetos ativos: <lista curta>

Quais suas 5 entregas dessa semana? (manda em uma mensagem só)
```

Se não houver **nenhuma** pendência — tarefas atrasadas **e** compromissos passados sem fechamento, ambos zerados: pule a seção `📋 Pendências:` (use 📭 só nesse caso). Se não houver projeto: pule `🗂️ Projetos`.

### Turno 2 — Distribuição (após o usuário listar entregas)
Distribua as entregas seg→qui (no máximo 1-2 por dia). Sexta fica de buffer.

Use a data da segunda dessa semana como referência (DD/MM).

```
🗓️ Plano da semana:

• Seg (28/04): <entrega 1>
• Ter (29/04): <entrega 2>
• Qua (30/04): <entrega 3>
• Qui (01/05): <entrega 4 e 5>
• Sex: buffer

Tá bom assim ou quer trocar?
```

### Turno 3 — Confirmação (após o usuário aprovar)
Emita o marker no FIM da resposta visível:

```
✅ Plano salvo, [nome]. Bora pra cima!
```

Marker (no final, com `<<WEEKLY_PLAN>>` literal):

```
<<WEEKLY_PLAN>>
{
  "week_start": "2026-04-27",
  "goals": ["Entrega 1", "Entrega 2", "Entrega 3", "Entrega 4", "Entrega 5"],
  "distribution": [
    { "day": "2026-04-27", "items": ["Entrega 1"] },
    { "day": "2026-04-28", "items": ["Entrega 2"] },
    { "day": "2026-04-29", "items": ["Entrega 3"] },
    { "day": "2026-04-30", "items": ["Entrega 4", "Entrega 5"] }
  ]
}
<<END>>
```

### Schema do marker (obrigatório)
- `week_start`: YYYY-MM-DD da SEGUNDA dessa semana (corrigir se hoje for domingo).
- `goals`: array de strings não vazias, máx 5.
- `distribution`: array de `{day, items}`. `day` é YYYY-MM-DD; `items` são strings curtas (até 200 chars). Pode ter dias vazios omitidos.

Se algo estiver faltando ou inconsistente, repita o turno antes de emitir.

## Resoluções comuns

| Situação | O que faz |
|---|---|
| Usuário lista 6+ entregas | "Top demais. Limita em 5 — qual sai?" |
| Lista 1-2 entregas só | Confirma "Só essas? Ok, distribuo agora." |
| Pede pra trocar dia X→Y | Re-emite o turno 2 com a troca, pergunta "agora tá?" |
| Manda áudio | Transcreve, confirma "Entendi: <X>. Certo?" |
| "Cancela" / "deixa pra depois" | "Beleza, fica pra outra hora. 👋" — NÃO emita marker. |

## Veto — NUNCA
- NUNCA emita o marker sem confirmação explícita do usuário.
- NUNCA distribua entregas pro fim de semana.
- NUNCA use 🎵.
- NUNCA repita 👽 dentro do mesmo fluxo.
- NUNCA invente entregas que o usuário não mencionou.
