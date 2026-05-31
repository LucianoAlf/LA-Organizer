# Metas — CRUD + Histórico de Aportes + Detalhe (PWA + TOM) — Design

**Data:** 2026-05-31
**Status:** Design aprovado visualmente pelo Alf (Visual Companion 2026-05-31, mockup `metas-detalhe.html` — opção A: detalhe com projeção + histórico de aportes apagável, aporte via sheet, editar/arquivar, bilateralidade TOM). Simulador de juros NÃO entra no detalhe (fica na MetasPage como hoje).

## Problema (auditoria 2026-05-31)
Metas está "paralisada": dá pra criar e aportar, mas:
- **Aporte "não funciona"** → o botão usa `window.prompt()` (`MetasPage.tsx:89`), que o PWA instalado (standalone) bloqueia. O fluxo lógico está correto (`addToGoal` grava), só a UX quebra.
- **Não dá pra editar** meta (nome/alvo/mensal/prazo/ícone) — nem no PWA nem no TOM (`update_goal` só aporta).
- **Não dá pra excluir/arquivar** — em lugar nenhum.
- **Sem histórico de aportes** — `addToGoal` faz `current_amount += x` manual (read-modify-write, com risco de corrida; o código marca "dívida: trocar por rpc"). Não há log → impossível mostrar histórico.
- **Sem "entrar na meta"** (tela de detalhe).

## Decisões (travadas)
- **D1 — Histórico via tabela + trigger:** nova `pf_goal_contributions` (log de aportes) + trigger `pf_sync_goal_amount` que mantém `pf_goals.current_amount` (insert soma, delete subtrai, update ajusta) — mesmo padrão do `pf_sync_account_balance`. Resolve a dívida de corrida E dá histórico. `current_amount` deixa de ser escrito à mão.
- **D2 — Aporte vira sheet** (PWA): `ContributionSheet` (valor + data + nota opcional), no lugar do `window.prompt`. Usado no card e no detalhe.
- **D3 — Detalhe da meta:** rota `/financeiro/metas/:id` com herói (barra/%/projeção), botão aporte, **timeline de aportes** (valor/data/nota, com excluir aporte → trigger reverte), e ações editar/arquivar. Sem simulador aqui.
- **D4 — Editar/Arquivar:** `GoalSheet` ganha modo edição (nome, target, monthly, deadline, ícone — não edita current_amount). Arquivar = soft (`is_active=false`), reversível.
- **D5 — Bilateralidade TOM:** aporte (`update_goal`) passa a gravar em `pf_goal_contributions` (logado; PWA e TOM compartilham o mesmo histórico). Novas actions `edit_goal` e `delete_goal`. Skill documenta.
- **D6 — Backfill:** metas existentes com `current_amount > 0` recebem 1 aporte "saldo inicial" no momento da migration (antes de criar o trigger, pra não duplicar), preservando o invariante `sum(aportes) == current_amount`.

## Arquitetura

### A. Modelo de dados (migration)
```sql
CREATE TABLE pf_goal_contributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  goal_id         uuid NOT NULL REFERENCES pf_goals(id) ON DELETE CASCADE,
  amount          numeric NOT NULL CHECK (amount > 0),
  note            text,
  contributed_at  date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pf_goal_contrib_goal   ON pf_goal_contributions(goal_id);
CREATE INDEX idx_pf_goal_contrib_collab ON pf_goal_contributions(collaborator_id);
```
- **Backfill** (antes do trigger): `INSERT ... SELECT collaborator_id, id, current_amount, 'saldo inicial', created_at::date, created_at FROM pf_goals WHERE current_amount > 0;`
- **Trigger** `pf_sync_goal_amount` AFTER INSERT/UPDATE/DELETE: insert → `current_amount += NEW.amount`; delete → `current_amount = GREATEST(current_amount - OLD.amount, 0)`; update → `-= OLD.amount += NEW.amount`; sempre `updated_at = now()`. (Criado DEPOIS do backfill.)
- **RLS:** espelhar as policies de `pf_goals` (mesma função `current_collab_id()`), pro caminho PWA (authenticated) respeitar dono. O caminho TOM (service_role) ignora RLS e filtra `collaborator_id` no código.
- `pf_goals` já tem `is_active` e `updated_at` → arquivar não precisa de migration extra.

### B. Backend / TOM
**`src/services/financeiro-service.js`:**
- `addGoalContribution(cid, goalId, { amount, note=null, date=null })` → insert em `pf_goal_contributions` (trigger atualiza). Substitui o update manual de `current_amount`.
- `updateGoal(cid, goalId, patch)` → whitelist (name, target_amount, monthly_contribution, deadline, icon).
- `deactivateGoal(cid, goalId)` → `is_active=false`.
- `listGoalContributions(cid, goalId)` · `deleteGoalContribution(cid, contributionId)` (trigger reverte).
- Todas filtram `.eq('collaborator_id', cid)`.

**`src/engine.js`:**
- `update_goal` (aporte) → chama `addGoalContribution` (agora logado). Mantém a confirmação atual.
- **Novas:** `edit_goal` (params name/target_amount/monthly_contribution/deadline/icon → `updateGoal`) e `delete_goal` (arquiva → `deactivateGoal`). `query_goal` já existe.
- **`skills/financeiro-pessoal.md`:** documenta `edit_goal`/`delete_goal` e que o aporte é logado (histórico compartilhado com o app).

### C. PWA
**`web/src/lib/financeiro.ts`:**
- `addToGoal(cid, goalId, amount, opts?: { note?, date? })` → **reimplementar** pra inserir em `pf_goal_contributions` (remove o read-modify-write manual).
- `updateGoal(cid, id, patch)` (whitelist) · `deactivateGoal(cid, id)` · `listGoalContributions(cid, goalId)` · `deleteGoalContribution(cid, id)`.
- Tipos: `PfGoal` ganha `is_active`; novo `PfGoalContribution` (id, goal_id, amount, note, contributed_at).

**`web/src/hooks/useFinanceiro.ts`:** `useAddToGoal` (ajustar assinatura), `useUpdateGoal`, `useDeactivateGoal`, `useGoalContributions(goalId)` (query), `useDeleteGoalContribution`.

**Componentes/telas:**
- **`ContributionSheet.tsx` (novo):** AdaptiveSheet com Valor + Data + Nota (opcional) → `useAddToGoal`. Substitui o `window.prompt` na `MetasPage`.
- **`GoalSheet.tsx`:** prop `initial?: PfGoal` (modo edição) — edita name/target/monthly/deadline/icon. Footer com Arquivar (danger) em modo edição.
- **`MetaDetalhePage.tsx` (novo)** rota `/financeiro/metas/:id`: herói (ícone, nome, barra/%, "R$ x de R$ y", projeção "nesse ritmo") + botão aporte (abre ContributionSheet) + timeline de aportes (valor/nota/data, ✕ apaga → `useDeleteGoalContribution`) + ✏️ Editar (abre GoalSheet edit) + 🗄️ Arquivar. DS puro; texto preto sobre verde `tom`.
- **`MetasPage.tsx`:** card clicável → navega pro detalhe; "+ Adicionar contribuição" → abre `ContributionSheet` (não mais prompt). Simulador segue aqui.
- **Rota** em `App.tsx`: `financeiro/metas/:id` → `MetaDetalhePage`.
- **Realtime:** incluir `pf_goal_contributions` nas telas de metas (MetasPage/MetaDetalhePage).

## Fora de escopo (anti-gold-plating)
- Criação de meta permanece como está (já tem ícone/mensal/prazo — não é o gargalo).
- Simulador de juros dentro do detalhe (fica na MetasPage).
- Editar valor/data de um aporte já feito (só criar e excluir aporte; corrigir = excluir + refazer).
- Aporte vinculado a uma carteira (debitar saldo ao guardar) — meta é acompanhamento, não move saldo de carteira aqui.

## Testes
- **Serviço/DB:** aporte insere em `pf_goal_contributions` e o trigger atualiza `current_amount`; excluir aporte reverte; `sum(aportes) == current_amount` após operações; backfill preserva o invariante; editar/arquivar meta. Validar por `execute_sql`.
- **PWA:** `tsc --noEmit` + `vite build` + preview — aportar pelo sheet (não prompt), ver na timeline, excluir aporte (saldo reverte), editar meta, arquivar; detalhe abre por `/financeiro/metas/:id`; 375 e 1440.
- **Smoke WhatsApp (bilateralidade):** "guardei 200 pro carro" (aporte logado → aparece no app), "muda o alvo do carro pra 25000" (edit_goal), "arquiva a meta do carro" (delete_goal); conferir que o app reflete e o histórico bate.
