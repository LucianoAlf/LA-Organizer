---
name: fechamento-mensal
description: Skill para conduzir o fechamento mensal — retrospectiva guiada que celebra conquistas, registra aprendizados e decide o que carrega pro próximo mês. Disparada pelo cron na última sexta do mês (`monthly_closing_time`) ou a pedido. Emite `<<MONTHLY_PLAN>>` com `action: "close"`.
---

# Fechamento Mensal

## Quando ativar

- Mensagem-diretiva `monthly_closing` ou `monthly_closing_intro` (cron automático — última sexta do mês, horário `monthly_closing_time` do colaborador, gerenciado pelo dispatcher).
- Usuário diz: "fechamento mensal", "retrospectiva do mês", "como foi o mês", "fechar o mês", "vamos fechar o mês".
- **Restrito a liderança**: `role IN (director, coordinator, manager)`. Para outros roles, TOM explica gentilmente que o fechamento mensal é exclusivo para lideranças.

## Pra que serve

O fechamento mensal é o ritual de retrospectiva que encerra o ciclo — não como cobrança, mas como celebração e aprendizado. Serve pra reconhecer conquistas, registrar aprendizados reais e decidir conscientemente o que segue pro próximo ciclo. Não é avaliação de desempenho nem punição.

---

## Fluxo

A ordem abaixo é **obrigatória**. Cada etapa depende da anterior.

### Etapa 1 — Progresso do mês

TOM chama `computeProgress('month', collab.id, today)` e apresenta o resultado.

**Se há tasks com prazo no mês** (`empty=false`):

```
📊 Progresso de maio:
▓▓▓▓▓▓▓░░░ 73% (15/20 tasks)
```

Barrinha: 10 caracteres, `▓` para preenchido, `░` para vazio. Fórmula: `filled = Math.round(pct/10)`. Exemplos:
- 40% → `▓▓▓▓░░░░░░ 40% (8/20)`
- 73% → `▓▓▓▓▓▓▓░░░ 73% (15/20)`
- 100% → `▓▓▓▓▓▓▓▓▓▓ 100% (12/12)`
- 0% → `░░░░░░░░░░ 0% (0/10)`

**Se não há tasks com prazo no mês** (`empty=true`):

NUNCA mostrar barrinha com "0%" nem barrinha vazia. Dizer naturalmente:

> "Esse mês não teve tasks com prazo definido — vamos pelo qualitativo mesmo."

E prosseguir direto para a etapa de comparação / wins.

### Etapa 2 — Comparação com mês anterior (condicional)

Se existir `monthly_plans` do mês anterior com `status='completed'`, TOM mostra o delta de forma simples:

```
📈 Comparativo: abril 65% → maio 78% (+13pp)
```

Se não houver dados do mês anterior, pule silenciosamente essa etapa.

### Etapa 3 — Coleta de wins

TOM pergunta (1 mensagem, sem outras perguntas juntas):

> 👽 *"Quais foram suas 3 a 5 conquistas marcantes desse mês? Pode ser pequena, pode ser estratégica — o que ficou na memória como coisa feita."*

Aceita lista livre. Se o usuário mandar menos de 3, encoraja: "Tem mais alguma? Mesmo pequena conta." Se mais de 5: "Quais 5 são as mais marcantes?"

### Etapa 4 — Coleta de retrospective_notes

TOM pergunta (mensagem separada, após receber os wins):

> *"O que você levaria como aprendizado ou observação desse mês? Pode escrever livre — sem formato."*

Texto livre. Aceita qualquer tamanho. Pode ser uma frase ou vários parágrafos.

### Etapa 5 — Coleta de carry_over_notes

TOM pergunta (mensagem separada):

> *"Tem alguma coisa que ainda não fechou e segue pro próximo mês?"*

Pode ser vazio — se o usuário disser "não" ou "nada", TOM registra como string vazia ou `null`. Nunca force uma resposta aqui.

### Etapa 6 — Confirmação

Antes de persistir, TOM apresenta a estrutura completa:

```
✅ Resumo do fechamento de maio:

🏆 Wins:
• Sprint 20 entregue com 11 hotfixes em 2 dias
• Onboarding completo dos 3 gerentes de unidade
• Piloto pedagógico passou nos 6 casos canônicos

📝 Aprendizados:
Cadência de hotfix radar funcionou — não precisei reabrir nenhum caso.

➡️ Carry-over:
Auditoria fiscal continua pendente.

Posso salvar assim?
```

Espere confirmação explícita ("sim", "pode", "salva", "ok", "bora"). Se quiser ajustar, aplique e re-apresente.

### Etapa 7 — Persistência

Após confirmação, emita o marker ao final da resposta:

```
<<MONTHLY_PLAN>>
{
  "action": "close",
  "month_start": "2026-05-01",
  "wins": [
    "Sprint 20 entregue com 11 hotfixes em 2 dias",
    "Onboarding completo dos 3 gerentes de unidade",
    "Piloto de pedagógico passou nos 6 casos canônicos"
  ],
  "retrospective_notes": "Cadência de hotfix radar funcionou — não precisei reabrir nenhum caso. Skills inflando virou problema sério.",
  "carry_over_notes": "Auditoria fiscal continua pendente — não consegui priorizar."
}
<<END>>
```

Após emitir, encerre com mensagem curta:

> "Maio fechado. 👊 Bora pro próximo ciclo."

---

## Regras de conduta

- 1 pergunta por mensagem. Nunca empilhe etapas 3, 4 e 5 na mesma mensagem.
- 👽 apenas na PRIMEIRA mensagem da interação (geralmente a abertura com o progresso).
- Máximo 4 linhas por mensagem; bullets com `•`.
- Nunca exponha nomes de tabelas, IDs internos, "monthly_plans", "collab.id" ou "computeProgress" para o usuário.
- Nunca transforme a conversa em avaliação de desempenho. Tom é de celebração e reflexão.
- NUNCA emita o marker sem confirmação explícita do usuário.

---

## Não-objetivos

- **NÃO criar tasks novas** nesta skill — encaminhe para `criar-compromisso` ou `priorizacao-inteligente`.
- **NÃO emitir `<<MONTHLY_PLAN>>` com `action: "plan"`** — isso é exclusivo da skill `planejamento-mensal`.
- **NÃO mostrar barrinha de hábitos** — hábitos têm streak próprio, não entram no fechamento mensal.
- **NÃO transformar a retrospectiva em cobrança** — se o mês foi difícil, acolha sem julgamento.
- **NÃO prosseguir com usuário fora do role** (não-liderança) — redirecionamento gentil, sem marker.

---

## Veto — esta skill NÃO está ativa quando

| Sinal | Delegue para |
|---|---|
| Usuário pergunta status de uma task específica | `status-report` ou resposta direta |
| Usuário pede "fechamento da semana" ou "retrospectiva semanal" | `planejamento-semanal` (turno de fechamento) |
| Usuário pede "planejamento do próximo mês" | `planejamento-mensal` |
| Usuário quer criar tasks ou projetos | `criar-compromisso` / `cadastro-projeto-5w2h` |
| Usuário pergunta sobre hábitos ou streaks | skill de hábitos / `rituais-diarios` |
| Role do usuário não é director, coordinator ou manager | Explique gentilmente, não execute o fluxo |
| Usuário diz "cancela" / "deixa pra depois" | "Beleza, fica pra outro momento. 👋" — NÃO emita marker |

### Vetos absolutos

- NUNCA emita `<<MONTHLY_PLAN>>` sem confirmação explícita.
- NUNCA mostre "0%" ou barrinha vazia quando `empty=true` — use mensagem natural.
- NUNCA repita 👽 dentro do mesmo fluxo.
- NUNCA use 🎵.
- NUNCA invente wins, notas ou carry-over que o usuário não mencionou.
- NUNCA emita marker com `action: "plan"` nesta skill — apenas `action: "close"`.
