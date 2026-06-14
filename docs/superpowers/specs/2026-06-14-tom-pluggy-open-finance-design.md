# Fase D — TOM + Pluggy (Open Finance): conciliação proativa

**Data:** 2026-06-14 · **Autor:** TOM/Claude (sessão Alf) · **Status:** arquitetura aprovada pelo Alf, spec em revisão

## Visão

O financeiro do TOM nasceu no PRD pra ajudar as pessoas a **se controlarem** financeiramente. O Open Finance (via Pluggy) fecha esse ciclo: o TOM passa a **enxergar o extrato real** dos bancos e cruzá-lo com os lançamentos do app. O que está lançado, ele reconhece e cala; o que falta, ele cutuca; e — usando a inteligência que já construímos (Health Score, metas, detector de assinatura) — ele **orienta**: *"nesse ritmo você não guarda esse mês"*, *"sua caixinha do Nubank tá vazia, cadê o aporte da meta?"*. Resultado: o saldo do app bate com o real, e o usuário junta mais dinheiro. Mata o problema nº 1 (esquecer de lançar) **sem** virar spam (o que faria a galera largar).

Credenciais já validadas (5 bancos `UPDATED`, 12 contas) e o shape da API já investigado com dado real — este spec é fundado em fato, não em chute.

## Decisões travadas no brainstorm

1. **Papel do extrato = espelho fiel.** Todo movimento real deve existir no app; o TOM cutuca o que falta, filtrando ruído.
2. **Cadência = 2×/dia.** Meio-dia (toque leve, só se houver algo gordo novo) + 18h (relatório completo).
3. **Regra de ouro = casar-ANTES-de-perguntar.** Se o usuário já lançou, o TOM reconhece e fica quieto. Nunca perguntar sobre o que já foi tratado (é o que vicia).
4. **Relatório das 18h mostra os dois lados:** ✅ conciliado (o que bateu) e ❌ pendente (*"isso aqui, o que foi?"*), + camada de **coaching**.
5. **Movimento interno** (transferência entre contas próprias, pagamento de fatura, rendimento) → o TOM **resolve sozinho** pra o saldo bater, sem perguntar.

## Arquitetura — 4 camadas

### D1 — Fundação (os olhos): `src/services/pluggy.js` + sync + staging
Serviço Pluggy puro de I/O:
- `getApiKey()` — `POST /auth` com Client ID/Secret; cacheia o `apiKey` em memória ~110 min (expira em 2h).
- `fetchItem(itemId)` — `GET /items/{id}` (status da conexão).
- `fetchAccounts(itemId)` — `GET /accounts?itemId=`.
- `fetchTransactions(accountId, { from })` — `GET /transactions?accountId=&from=&pageSize=500`, paginando.

**Migrations (3 tabelas, RLS por `collaborator_id` via `current_collab_id()`):**
- `pf_pluggy_items` — `id, collaborator_id, pluggy_item_id (unique), connector_name, status, last_synced_at, created_at`.
- `pf_pluggy_account_map` — `id, collaborator_id, pluggy_account_id (unique), pluggy_item_id, kind ('account'|'card'), pf_account_id, pf_card_id, display_name, confirmed bool`. Vincula conta-Pluggy ↔ conta/cartão do app.
- `pf_pluggy_transactions` (staging) — `id, collaborator_id, pluggy_transaction_id (unique), pluggy_account_id, posted_date, amount (normalizado), direction ('in'|'out'), description, pluggy_category, raw jsonb, status ('pending'|'matched'|'internal'|'noise'|'future'), matched_pf_transaction_id, resolved_at, created_at`. Índices: unique `pluggy_transaction_id`; `(collaborator_id, status)`; `(collaborator_id, posted_date)`.

**Sync** (`syncPluggy(collaboratorId)`): pra cada item ativo → contas → transações desde `last_synced_at` → **upsert** no staging (dedup por `pluggy_transaction_id`). Normaliza:
- **Sinal/direção (a pegadinha):** em conta (`BANK`), `amount` já vem com sinal (− = saída); em cartão (`CREDIT`), `DEBIT`=compra (saída) com valor positivo, `CREDIT`=estorno/pagamento (entrada). Direção sai de `type` + tipo da conta, **nunca** do sinal sozinho.
- **Parcelas futuras:** `posted_date > hoje` (ex: anuidade 12/12) → status `future`, fora do relatório de hoje.

### D2 — Conciliação (o cérebro): `src/finance/reconcile.js` (PURO, testável)
`classify(pluggyTxn, candidateAppTxns, ownAccountIds)` → `{ status, matchedId? }`:
- **noise** — rendimento (categoria juros/dividendos Pluggy) com valor baixo.
- **internal** — contraparte é outra conta própria (transferência interna) ou descrição de pagamento de fatura.
- **matched** — existe lançamento do app na mesma conta, **valor exato** e `|Δdata| ≤ 3 dias`, ainda não casado → retorna `matchedId`.
- **pending** — gasto/receita externo sem correspondência → ❌.

Roda no fim do sync: grava `status` em cada staging row. **Alta confiança apenas** — na dúvida vira `pending` (melhor perguntar que esconder; o usuário valida no relatório, então erro é barato). Idempotente: row já resolvida não re-processa. Os `internal` o TOM materializa como lançamento automático (transferência/rendimento/pagamento de fatura) pra o saldo bater.

### D3 — Relatório + proativo + coaching (o valor): dispatcher + builder puro
- **Rituais** (dispatcher, padrão quiet-gate + claim já existente): `pluggy_reconcile_noon` (12h, toque leve — só dispara se houver pendente "gordo"/assinatura nova) e `pluggy_reconcile_daily` (18h, relatório completo). Ambos adicionados ao índice `ritual_logs_sent_daily_uq`. O `syncPluggy` roda antes (no tick, com gate de frequência ~4h).
- **Builder puro** `buildReconcileReport({ nome, conciliados, pendentes, coaching })`:
  - ✅ **Conciliado:** lista resumida do que bateu.
  - ❌ **Falta você me dizer:** cada pendente com valor/data/descrição; se `detectRecurring` (Fase C) reconhece assinatura → **sugere** (*"saiu R$X da Netflix, confirmo?"*) em vez de perguntar cru.
  - 🎯 **Coaching:** usa `computeHealthScore` (Fase E) + metas + saldo real → 1–2 linhas acionáveis (*"nesse ritmo fecha no vermelho"*, *"caixinha vazia, faltou o aporte de R$Y"*).
- **Resposta → lançamento:** quando o usuário responde a um ❌ (*"foi mercado"*), o engine pega a staging row pendente (via `pending-intents`), cria o lançamento com valor/data/conta do staging + categoria (`merchant-category` da Fase E ou o que ele disse) e marca a row `matched`. Reusa o motor de registro existente — zero duplicação.

### D4 — Saldo real × app (âncora)
`saldoReal` (Pluggy, por conta mapeada) × `saldo` do app → diferença. Entra no relatório das 18h quando diverge além de um limiar (*"Nubank: app R$X, real R$Y — R$Z de diferença, quer conciliar?"*).

## Decisões técnicas (recomendadas, não bloqueiam)
- **Mapeamento de conta:** auto-sugestão por banco/nome (Nubank-Pluggy → cartão Nubank do app) + confirmação 1× (no zap ou telinha). Necessário porque os cartões do app têm nomes próprios.
- **Conexão inicial (gerar item):** por ora os item_ids vêm do **Meu Pluggy** (Alf já gerou os 5; Rose faz o mesmo e passa os ids). Pluggy Connect embutido no app fica **fora de escopo** (YAGNI) — entra se virar multiusuário amplo.
- **Multi-usuário desde já:** tudo por `collaborator_id`; cada um conecta seus próprios itens.
- **Reuso:** motor de registro, `detectRecurring` (C), `merchant-category` + `computeHealthScore` (E), infra de ritual (quiet/claim), `pending-intents`.

## Segurança
`PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` só no `.env` da VPS (via ssh), como o `service_role`/UAZAPI já estão — nunca no código/git. API de dados é **read-only** (não move dinheiro). Credenciais já expostas no chat → **rotacionar o Client Secret antes de produção** (registrado em memória junto com as chaves Supabase).

## Fora de escopo (YAGNI)
- Pluggy Connect widget no app (item_ids manuais por ora).
- Pluggy Payments / iniciação de pagamento (só leitura).
- Categorização 100% automática sem validação (o usuário confirma no relatório).
- Histórico/series do Health Score (recalcula no ritual).

## Testes
- `reconcile.test.js`: matched (valor exato + janela ±3d), internal (transferência entre contas próprias + pagamento de fatura), noise (rendimento), pending (externo sem match), tolerância de data, **sinal conta×cartão** (não inverter in/out), parcela futura → `future`.
- Builder `buildReconcileReport`: ✅/❌, sugestão de assinatura, bloco de coaching, vazio (nada a relatar → não envia).
- Sync: dedup por `pluggy_transaction_id` (reimport não duplica); normalização de sinal.

## Entrega faseada (cada camada testável, deploy independente)
**D1** (fundação + sync + staging) → **D2** (reconcile) → **D3** (relatório + proativo + coaching + resposta→lançamento) → **D4** (saldo, junto do D3). O primeiro plano de implementação cobre **D1**.
