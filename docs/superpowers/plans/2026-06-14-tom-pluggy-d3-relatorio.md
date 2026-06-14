# Pluggy D3 — Relatório proativo + coaching Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** O TOM manda 2×/dia (12h leve, 18h completo) o relatório de conciliação ✅/❌ com coaching (Health Score + saldo real), no formato aprovado pelo Alf.

**Architecture:** `reconcile-report.js` puro (builders, TDD) + queries no `financeiro-service`/`pluggy-query` (dados do relatório + saldo real) + rituais no `dispatcher` (sync+reconcile no tick antes, claim+quiet-gate) + migration do índice de idempotência. Reusa `computeHealthScore`/`buildHealthScoreLine` (Fase E), `creditUtilization`, `monthlyReport`, `listGoals`.

**Tech:** Node CommonJS, node:test, Supabase, deploy scp+pm2.

---

### Task 1: `reconcile-report.js` — builders puros (TDD)
`buildReconcileReport({nome, conciliadoCount, pendentes, backlogExtra, healthLine, saldoReal})` → string ✅/❌ + coaching; vazio se nada. `buildNoonNudge({nome, pendentes})` → toque leve; vazio sem pendentes. `pendentes` = `[{emoji, amount, direction, label, date}]`.

### Task 2: dados do relatório
`reconcileReportData(cid, {topN=6})` no `pluggy-reconcile.js`: conta matched/total + top-N pendentes recentes (posted_date desc) com emoji por categoria + label limpo + backlog extra. `sumBankBalances(cid)` no `pluggy-query.js` (novo): soma `account.balance` das contas BANK via `pluggy.fetchAccounts` (saldo real fresh).

### Task 3: rituais no dispatcher
`checkPluggyReconcile(now)`: gate 12h (toque leve, só pendente gordo) + 18h (completo). Antes: `syncPluggy` + `reconcileStaging` (gate de frequência). Claim+quiet (`pluggy_reconcile_noon`/`pluggy_reconcile_daily`), `collaboratorsForFinanceRitual` filtrado por quem tem `pf_pluggy_items`. Migration: adiciona os 2 ritual_types ao índice `ritual_logs_sent_daily_uq`. Coaching = `computeHealthScore({receitas,despesas,credit,goals})` → `buildHealthScoreLine`.

### Task 4: deploy + smoke real + known issue
Smoke força `buildReconcileReport` com dados reais do Alf (sem enviar ao zap) → mostra a mensagem. Deploy scp+restart. Registrar `FIN-PLUGGY-D3-RELATORIO`.
