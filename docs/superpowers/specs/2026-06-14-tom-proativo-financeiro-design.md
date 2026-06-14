# TOM Proativo Financeiro — Design (Fase C)

**Data:** 2026-06-14
**Autor:** Claude + Alf
**Status:** aprovado no brainstorm; pendente review do spec → writing-plans

## Goal
Dar ao TOM 3 alertas financeiros **proativos** (sem o usuário pedir), determinísticos (sem LLM), respeitando o limite de "alerta demais → usuário silencia": **previsão de fatura**, **gasto fora do padrão** e **assinaturas/aumento de preço**.

## Decisões do brainstorm (travadas)
- **Escopo:** as 3 frentes num spec só; implementação em sequência (C1 → C2 → C3).
- **Entrega: MISTO** — anomalia *inline* na confirmação do registro; previsão de fatura + assinaturas no *briefing diário* (agrupados, sem mensagens avulsas).
- **Determinístico:** SQL + cálculo, zero custo de LLM.
- **Por usuário:** cada colaborador vê só os seus alertas; respeita o `quiet mode` existente.
- **Anti-spam:** cada alerta é carimbado (reusa infra de `ritual_logs`/claim) — não repete no mesmo ciclo.
- **Thresholds ajustáveis:** começam nos valores abaixo e calibramos com uso real.

## Arquitetura
Três módulos **puros** (lógica isolada, testável com TDD) em `src/finance/`, plugados em 2 pontos de entrega:

| Módulo puro | Detecta | Entrega |
|---|---|---|
| `forecast-invoice.js` | fatura acima da média perto de fechar | briefing diário (dispatcher) |
| `spending-anomaly.js` | gasto fora do padrão do merchant/categoria | inline no handler de registro (engine) |
| `recurring-detect.js` | assinaturas, aumento de preço, recorrência nova | briefing diário (dispatcher) |

Queries novas no `financeiro-service.js`; entrega no `rituals/dispatcher.js` (briefing) e no `engine.js` (handlers `card_purchase` + `register_transaction`).

---

## Frente 1 — Previsão de fatura (briefing)
**Lógica (`forecast-invoice.js`):** `forecastInvoiceAlert({ openTotal, closedTotals[], daysToClose, threshold, windowDays })`
- `avg` = média das últimas 3 faturas fechadas do cartão.
- Dispara se `daysToClose <= windowDays` **E** `openTotal >= avg * (1 + threshold)`.
- Retorna `{ alert, openTotal, avg, pctOver, daysToClose }` ou `null`.

**Thresholds iniciais:** `threshold = 0.20` (20% acima), `windowDays = 5`.
**Queries:** fatura aberta (competência corrente) + 3 últimas fechadas, por cartão (reusa `cardInvoice`/competências).
**Mensagem (bloco no briefing):**
> 💳 A fatura do *Nubank* fecha em 3 dias e já está em **R$ 2.100** — 28% acima da sua média (R$ 1.640).

**Anti-spam:** 1 alerta por cartão por ciclo (competência).

---

## Frente 2 — Gasto fora do padrão (inline)
**Lógica (`spending-anomaly.js`):** `detectAnomaly({ amount, history[] })`
- `history` = valores de gastos anteriores no mesmo merchant (descrição normalizada) — fallback categoria.
- Exige `history.length >= 3`. Calcula média + desvio-padrão; `z = (amount - avg) / sd`.
- Dispara se `z >= 2` (e `amount > avg`). Retorna `{ isAnomaly, z, avg, ratio }`.

**Entrega:** no `engine.js`, após inserir o gasto (`card_purchase` e `register_transaction`), anexa uma linha à resposta que já existe — **não** é mensagem separada.
**Mensagem (anexo):**
> 💸 Registrei R$ 89 no Rappi. ⚠️ Tá ~2× o seu normal aí (média R$ 45) — tudo certo?

**Anti-spam:** não aplica (é inline, 1 por registro).

---

## Frente 3 — Assinaturas + aumento de preço (briefing)
**Lógica (`recurring-detect.js`):** `detectRecurring(transactions[])`
- Normaliza o nome do merchant (regex/lowercase, tira sufixos tipo `*1A2B`).
- Agrupa por merchant; detecta recorrência: intervalo médio entre ocorrências ~mensal (28–33 dias) **E** `>= 2` ocorrências.
- Por assinatura recorrente: `priceChanged` (último valor ≠ anterior → subiu/caiu), `isNew` (1ª ocorrência de um padrão recorrente neste mês).
- Retorna lista `[{ merchant, monthlyAmount, prevAmount, isNew, priceChanged, deltaPct }]`.

**Queries:** transações dos últimos ~4 meses do usuário, agrupáveis por merchant.
**Mensagens (bloco no briefing, só quando há mudança):**
> 🔁 *Netflix* subiu de R$ 55 → **R$ 68** este mês.
> 🆕 *Spotify* (R$ 23/mês) entrou nas suas recorrências.

**Anti-spam:** alerta de aumento 1× por mudança de preço (carimba o par merchant+valor).

---

## Transversais
- **Config:** respeita `quiet mode`; um toggle de "alertas financeiros proativos" nas prefs (default ligado). Se desligado, só anomalia inline continua (é resposta a uma ação do usuário, não push).
- **Anti-spam global:** tabela/claim `ritual_logs` (ou equivalente) por `(collaborator_id, tipo_alerta, chave, dia/ciclo)`.
- **Testes (TDD):** cada módulo puro tem suite própria — casos de fronteira (sem histórico, exatamente no threshold, recorrência irregular, merchant com sufixo variável).
- **Sem regressão:** o briefing financeiro pessoal já existe (B9); os blocos novos se anexam a ele, não criam ritual novo do zero.

## Fora de escopo (YAGNI)
- ML/embeddings pra categorização ou recorrência — usar heurística determinística.
- Pluggy/Open Finance — é a Fase D.
- Financial Health Score — é a Fase E.
- Cancelamento/negociação automática de assinatura (estilo Rocket Money) — só detectar e avisar.

## Ordem de implementação
C1 (previsão de fatura) → C2 (anomalia inline) → C3 (assinaturas). Cada uma entrega valor sozinha e é testável isolada.
