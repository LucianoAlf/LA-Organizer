---
name: planejamento-mensal
description: Skill para conduzir o ritual de planejamento mensal com liderança — escolha de 3–5 metas/OKRs leves para o mês, revisão do mês anterior e definição de carry_over. Disparada pelo cron na 1ª segunda do mês ou quando o usuário pede explicitamente.
---

# Planejamento Mensal

## Quando ativar

- Mensagem-diretiva `[RITUAL: monthly_planning]` ou `[RITUAL: monthly_planning_intro]` (cron da 1ª segunda do mês, default 07:00, gerenciado pelo dispatcher).
- Verbais: "planejamento mensal", "objetivos do mês", "vamos planejar o mês", "metas do mês", "quero planejar esse mês".
- **Apenas para liderança** (`role IN director, coordinator, manager`). Se um colaborador fora desse grupo disparar verbalmente, TOM responde com educação: *"Esse ritual é pra liderança — mas posso te ajudar a organizar suas tarefas da semana se quiser."* e encerra.

## Pra que serve

O planejamento mensal é o macro do mês: escolher 3 a 5 metas ou OKRs leves que vão guiar as decisões e prioridades nas próximas semanas. Ele não substitui o planejamento semanal — as segundas continuam acontecendo dentro do mês com o ritmo normal. A diferença é que aqui você escolhe o horizonte: o que precisa fechar, o que vai crescer, o que não pode ficar pra depois. Se alguém perguntar "como funciona?" no meio do fluxo, explique em 2–3 frases e continue.

---

## Fluxo (passo a passo)

### Turno 0 — Abertura (você emite ao receber o sinal)

```
👽 Fala, [nome]. Primeira segunda do mês — hora do planejamento mensal.

Vou te mostrar como foi o mês passado e depois a gente define as metas desse mês. Leva uns 3 minutos.
```

Se for disparo verbal (não cron): *"👽 Bora planejar o mês. Primeiro deixa eu ver como foi o mês passado — um segundo."*

---

### Turno 1 — Revisão do mês anterior

TOM consulta `monthly_plans` do mês anterior (WHERE `month_start = primeiroDiaMesAnterior AND collaborator_id = collab.id`).

Em seguida chama `computeProgress('month', collab.id, primeiroDiaMesAnterior)` para obter `{ done, total, percent, carry_over }`.

**Se existir plano do mês anterior**, apresente assim:

```
📊 [Mês Anterior] — execução: 72% (18/25 tarefas)
████████████░░░░ 72%

Metas que você tinha:
• Meta A
• Meta B
• Meta C

Carry-over: "Auditoria fiscal ainda pendente."
```

Regras de apresentação:
- Barrinha: use `█` proporcional ao `percent`, total de 16 chars. Ex: 75% → 12 █ + 4 ░.
- `carry_over` do mês anterior: exibe se existir, pula se vazio.
- Done/total: mostre como `(done/total tarefas)`.
- Tom direto, sem drama se o percentual for baixo.

**Se não existir plano anterior** (primeira vez ou sem dados), pule essa etapa inteira:

```
👽 Primeiro planejamento registrado — sem histórico pra mostrar ainda. Bora direto pras metas.
```

---

### Turno 2 — Coleta de metas

```
Quais 3 a 5 metas grandes você quer pra esse mês?

(Manda em uma mensagem só — pode ser lista, pode ser texto corrido.)
```

Após receber, repita as metas de volta para confirmar:

```
Anotei:
• [meta 1]
• [meta 2]
• [meta 3]

Tá certo ou quer ajustar alguma?
```

Regras:
- Mínimo 1 meta (aceite mesmo assim, não bloqueie).
- Máximo 5 metas. Se vier mais: *"Vieram [N] — escolhe as 5 mais importantes pra esse mês. Qual sai?"*
- Não invente metas. Apenas reformule brevemente se estiver muito vaga — e confirme.

---

### Turno 3 — Carry-over do mês passado

```
Tem algo do mês passado que continua valendo — prioridade que ainda não fechou?

(Pode deixar em branco se tá tudo zerado.)
```

Aceite texto livre. Se o usuário mandar "não", "nada", "tá zerado" ou similar → `carry_over_notes: ""`.

---

### Turno 4 — Confirmação final

Apresente a estrutura completa antes de persistir:

```
📋 Planejamento de [Mês Ano]:

Metas:
• [meta 1]
• [meta 2]
• [meta 3]

Carry-over: "[texto]"  (ou "— nenhum" se vazio)

Confirma e salvo?
```

Espere confirmação explícita. Se o usuário pedir ajuste, volte ao turno correspondente.

---

### Turno 5 — Persistência

Após confirmação, emita o marker e confirme em texto:

```
✅ Planejamento de [Mês] salvo. Boa semana, [nome] — bora pra cima!
```

Marker (emitido no final da resposta, após o texto visível):

```
<<MONTHLY_PLAN>>
{
  "action": "plan",
  "month_start": "2026-06-01",
  "goals": [
    "Fechar o piloto do Sprint 21 com 3 unidades",
    "Reduzir cancelamentos em 30%",
    "Onboarding limpo dos 4 novos professores"
  ],
  "carry_over_notes": "Auditoria fiscal pendente desde abril — virar prioridade real esse mês."
}
<<END>>
```

### Schema do marker (obrigatório)

- `action`: sempre `"plan"` nessa skill. Nunca `"close"` — isso é outra skill.
- `month_start`: YYYY-MM-DD do primeiro dia do mês corrente (ex: `"2026-06-01"`).
- `goals`: array de strings, mínimo 1, máximo 5. Não vazio.
- `carry_over_notes`: string. Pode ser `""` se o usuário não tiver nada pendente.

Se qualquer campo obrigatório estiver faltando, repita o turno antes de emitir.

---

## Resoluções comuns

| Situação | O que faz |
|---|---|
| Usuário lista 6+ metas | "Vieram [N] — escolhe as 5 mais importantes. Qual sai?" |
| Usuário manda 1–2 metas | Confirma: "Só essas? Ok, registro assim mesmo." |
| Pede pra trocar uma meta no turno 4 | Volta ao turno 2, reapresenta lista, confirma de novo |
| Não tem carry-over | `carry_over_notes: ""` — sem perguntar de novo |
| "Cancela" / "deixa pra depois" | "Tudo bem, fica pra outra hora. 👋" — NÃO emita marker. |
| Manda áudio | Transcreve, confirma "Entendi: [X]. Certo?" antes de avançar |

---

## Não-objetivos

- **Não criar tasks individuais aqui** — isso vem via `priorizacao-inteligente`, `lista-mental`, etc.
- **Não substituir `planejamento-semanal`** — os dois convivem. O mensal define o macro; o semanal opera dentro dele.
- **Não emitir `<<MONTHLY_PLAN>>` com `action: "close"`** — isso é a skill `fechamento-mensal` (Task 11).
- **Não mostrar barrinha do mês corrente** — o mês acabou de começar, não há dados. A barrinha só aparece na revisão do mês anterior.
- **Não disparar para roles fora de liderança** — se o role não for `director`, `coordinator` ou `manager`, redirecione educadamente.

---

## Veto

- NUNCA emita `<<MONTHLY_PLAN>>` sem confirmação explícita do usuário no Turno 4.
- NUNCA emita `action: "close"` — essa skill só persiste `action: "plan"`.
- NUNCA invente metas que o usuário não mencionou.
- NUNCA mostre barrinha do mês corrente (só do anterior, e só se existirem dados).
- NUNCA use 🎵.
- NUNCA repita 👽 dentro do mesmo fluxo.
- Se o usuário perguntar sobre **task individual** → delegue para `priorizacao-inteligente` ou `lista-mental`.
- Se o usuário disser **"planejamento da semana"** → esta skill não está ativa; delegue para `planejamento-semanal`.
- Se o usuário perguntar sobre **fechamento do mês** → delegue para `fechamento-mensal`.
