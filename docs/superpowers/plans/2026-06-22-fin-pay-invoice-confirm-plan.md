# Plano — `pay_invoice` sempre-confirmado + fecha tarefa de lembrete

> Extensão focada do FIN-CONFIRM-CONFAB-NOOP (Camada 2 financeira). Execução inline, TDD.

**Goal:** matar o confab "marco a fatura como paga / fecho a tarefa" (TOM diz, não persiste). `pay_invoice` passa pelo MESMO staging → montagem → "Sim" → execução determinística do lançamento; o "Sim" paga via o handler atual (`handleFinanceAction('pay_invoice')`) **e fecha a tarefa de lembrete pinada**. Reusa o consumidor `launch_confirm` (agnóstico de ação) — zero código novo no consumidor além do fecha-tarefa.

**Causa-raiz (confirmada):** `pay_invoice` existe mas é fire-once via marker do LLM (não abre intent, sem re-entrada no "Sim"); o "Fecho a tarefa e marco paga?" é prosa livre (não abre âncora nem finance_source); no "Sim", nenhum executor determinístico pega → depende do LLM re-emitir markers; Claude deu timeout → fallback narrou "assunto fechado" sem marker. Trap adicional: confirmação genérica com `hasConcrete=false` instrui o LLM a NÃO emitir marker (domínio do chokepoint — só apontar).

**Por construção, o fix desvia o trap:** ao estagiar, abrimos um `finance_source{form:'launch_confirm'}` (não uma confirmação genérica) → consumido deterministicamente.

---

## T1 — `buildPayInvoicePreview` (puro, TDD) — `src/finance/launch-confirm.js`
Montagem de pagamento de fatura: `{cardName, amount, competencia, fromName, taskTitles}` → "Vou pagar a fatura do *X* — R$ Y (mês/ano) — saindo da *conta*. E fecho a tarefa *T*. Confirma?". `amount<=0` ou sem `cardName` → null. +3 testes.

## T2 — `stagePayInvoice(cid, params)` no engine (resolve, NÃO paga)
Espelha o handler `pay_invoice` (7571) SEM pagar: `findCard` (≠1 → null, cai no handler que pergunta), `comp = params.competencia||currentCompetencia`, `inv = cardInvoice` (total<=0 → null, handler diz "zerada"), `amount = params.amount>0?:inv.remaining`, resolve `from_account` (nome→id). Acha a tarefa de lembrete pendente (`tasks` assigned_to=cid, status=pending, title ILIKE '%fatura%' + token do nome do cartão) → pina `close_tasks:[id]` + títulos. Retorna `{ action:{action:'pay_invoice', params:{card:card.name, competencia:comp, amount, from_account}}, close_tasks, display:{cardName, amount, competencia:comp, fromName, taskTitles} }` ou `null`.

## T3 — Dispatch: branch do `pay_invoice` (montagem + intent)
No bloco FINANCE_ACTION: se houver UM `pay_invoice` (e o staging resolver) → `buildPayInvoicePreview` + `openIntent('finance_source', {form:'launch_confirm', actions:[stage.action], close_tasks}, preview)` + `awaiting_user_confirm=true` + log `staged_pay_invoice`. Senão → fluxo atual (handler pergunta/zera). Conviver com o staging de lançamento (pay_invoice é tratado à parte; turno misto raro → fluxo atual).

## T4 — Consumidor `launch_confirm`: fechar `close_tasks` após replay
Depois de replicar as `actions` (já paga via handler), fechar cada id em `payload.close_tasks` determinístico, escopo do dono: `update tasks set status=done, completed_at, completed_by=collab.id where id=? and assigned_to=collab.id`. (Idempotência: `resolveIntent` já impede re-run.)

## T5 — Skill `financeiro-pessoal.md`
"Para pagar/quitar fatura de cartão, emita `<<FINANCE_ACTION>>{action:'pay_invoice'}` — NUNCA diga 'marquei como paga' / 'fechei a tarefa' você mesmo; o engine monta a confirmação, paga e fecha a tarefa no 'Sim'."

## T6 — Verificação + deploy + ledger
`node --check` + suíte (launch-confirm + finance + camada1). scp engine + launch-confirm + skill + restart. **Smoke real com o Alf** (ele manda "paguei a fatura do Nubank" → montagem → sim → `pf_card_payments` grava + tarefa fecha). KI `FIN-PAYINVOICE-CONFAB-NOOP` + memória. Apontar gap Camada 1 ("…fechado" meio de linha) pro chat do chokepoint.

**Não toca:** handlers/executores de pagamento (payCardInvoice intacto), `hasConcrete`, staging de lançamento. Voz intacta.
