# Correção Definitiva — Confabulação de Lançamento Financeiro

> **Para workers agênticos:** PRÓXIMA SKILL: `superpowers:writing-plans` pra transformar esta spec em plano de implementação task-a-task.

**Goal:** Acabar com a família de bugs "o TOM diz '✅ lançado' mas nada entra no banco" no lançamento financeiro, tornando a execução determinística (independente do LLM) e a confirmação obrigatória.

**Arquitetura (1 frase):** O LLM PROPÕE (extrai campos + abre preview), o engine DISPÕE (insere só no "sim", deterministicamente) — o LLM nunca mais insere nem declara sucesso sozinho.

**Stack:** Node CommonJS (engine.js + módulos puros), testes `node:test`, Supabase (`pf_*`, `pending_intents`), deploy scp+pm2 na VPS.

---

## 1. Problema / Causa-raiz (confirmada no código + banco)

Dois furos estruturais sob uma família de **6+ correções** já feitas (`AUDIT-OPTIMISTIC-CONFIRM`, `GROUPCHAT-TOM-MENTE-NA-FALHA`, `BATCH-COMPLETE-CONFIRM-NOOP`, `FIN-INVOICE-TEXT-NO-DETERMINISTIC`, `FIN-INVOICE-INTENT-KIND-CONSTRAINT`, `FIN-CARD-INSTALLMENTS-LOST`):

- **Furo 1 — sem executor determinístico no "sim" financeiro.** O consumidor de confirmação (`engine.js:8443`) só executa `anchor` (1 tarefa) e `batch_complete`. Pro financeiro, devolve a bola pro LLM re-emitir o marker. Quando o LLM narra sucesso sem emitir (ou sob timeout do provider), nada persiste.
- **Furo 2 — a fala não é travada por prova.** O envio (`engine.js:11074`) é incondicional; o `ACTIONABLE_NO_MARKER` (`engine.js:10841`) só LOGA. A trava existente (`sanitizeOptimisticConfirm`) só cobre o caso "marker emitido e falhou", não "nenhum marker".

**Evidência Rose 21/06** (`conversation_history` + `pf_transactions`): lista 1 ("adiciona…", 11 itens) entrou via caminho determinístico (Intercept A0/B, `import_key`); listas 2 (3 itens) e 3 (2 parcelados) — ela pediu "me confirma antes" → "sim" → TOM disse "✅/encaminhado" → **nada entrou**. Quanto mais cuidadosa, mais garantido o erro.

## 2. Princípio da correção

1. **LLM PROPÕE, engine DISPÕE.** O handler de `FINANCE_ACTION` deixa de inserir; passa a **estagiar pra confirmação**. A inserção só ocorre no executor determinístico do "sim". O LLM nunca declara "lançado".
2. **SEMPRE confirmar antes** (decisão Alf 22/06). Toda finança (gasto/recebimento, carteira/cartão, único/lista/parcelado) vira **montagem** → `confirma?` → `sim` → executa. Fim do lançamento instantâneo. A montagem **sempre mostra a FONTE** (carteira X / cartão Y) — correção + educação do modelo.
3. **Confabulação vira impossível por construção** no financeiro: só o executor escreve "✅ lançado", e só após gravar.

## 3. Componentes

### 3.1 Fluxo canônico de lançamento (`engine.js`)
- **Handler `FINANCE_ACTION` (`~7432`/`~7464`):** de *insere-agora* → *estagia*. Resolve a fonte (cartão/conta), monta preview determinístico, abre intent `finance_source` com `form:'launch_confirm'` e **payload completo** (`{op, txn:{amount, installments, category, description, date, competencia}, card_id|account_id, import_key pré-gerado}`). **A reply é o preview determinístico** — descarta a prosa otimista do LLM pra essa ação (espelha `GROUPCHAT-TOM-MENTE-NA-FALHA`).
- **Consumidor determinístico do "sim"** (irmão do consumidor `finance_source` em `~7804`, roda antes do LLM e dá `return`): lê o payload, insere via `insertCardPurchase` (parcelado/cartão, já espalha N competências) ou `insertTransaction` (carteira), `resolveIntent('confirmed')`, e emite confirmação honesta determinística. **Sem LLM** → imune a timeout do provider.

### 3.2 Resolução de fonte (carteira × cartão)
- O preview declara a fonte resolvida e pede confirmação. Ambígua/ausente → pergunta qual.
- Sem carteira cadastrada (caso Juliana) → orienta cadastrar (comportamento mantido — decisão Alf 19/06: gasto avulso segue exigindo carteira).

### 3.3 Trava anti-confabulação global (Parte 2 — rede de segurança)
- `ACTIONABLE_NO_MARKER` passa a **AGIR**, conservador: claim cristalino de sucesso + input acionável + **zero persistência no turno** → rebaixa **só a frase mentirosa** pra correção honesta curta (não reescreve a mensagem toda, não muda a voz do TOM). Reusa os supressores existentes (info-gathering/decline/pergunta) pra não dar falso-positivo. Estende `src/lib/optimistic-confirm.js` pro caso "nenhum marker".

### 3.4 Módulo puro novo (TDD) — `src/finance/launch-confirm.js`
- `buildLaunchPayload(parsed)` → payload normalizado (sinal por tipo, competência, import_key).
- `buildLaunchPreview(payload, source)` → texto da montagem na voz do TOM (fonte explícita).
- `detectLaunchConfirm(text)` → yes/no/corrige (espelha `detectInvoiceReply`).
- `buildLaunchedMessage(rows)` / `buildHonestNoLaunchMessage()` → confirmações determinísticas.
- `buildAntiConfabRewrite(reply, outcome)` → rebaixa claim falso (Parte 2).

### 3.5 Skill `skills/financeiro-pessoal.md`
- LLM: extrair campos + emitir `FINANCE_ACTION` **como PROPOSTA**; **NUNCA** dizer "lançado/feito/encaminhado"; sempre incluir a fonte; deixar o engine confirmar e executar.

## 4. Fluxo de dados

```
msg → LLM extrai campos → FINANCE_ACTION (PROPOSTA, nunca insere)
   → engine: resolve fonte + monta preview determinístico + abre intent (payload completo + import_key)
   → TOM: "Confirma? • <itens> • Fonte: <Cartão/Carteira>"
   → user "sim"  → consumidor DETERMINÍSTICO insere (insertCardPurchase/insertTransaction)
                 → resolveIntent('confirmed') → "✅ lançado" (VERDADEIRO)
   → user corrige → ajusta payload, re-preview
   → (timeout do provider no "sim") → irrelevante: o executor não usa LLM
```

## 5. Tratamento de erro
- `openIntent` retorna `null` (drift de CHECK) → fallback honesto, nunca promete (defense-in-depth, lição do `FIN-INVOICE-INTENT-KIND-CONSTRAINT`). **Reuso o kind `finance_source` → SEM migração** (anti-regressão; o kind já passa no CHECK do banco vivo).
- Insert falha → mensagem honesta, sem "✅".
- Re-run do "sim" → no-op: `resolveIntent` (primária, intent resolvida não reaparece) + `import_key` (secundária, `23505` = skip).

## 6. Testes
- **Unit puros** (`node:test`): payload, preview, detectLaunchConfirm, mensagens honestas, gate anti-confab.
- **Smoke na VPS** reproduzindo a Rose: (a) lista de 3 itens; (b) 2 parcelados (3x e 2x); (c) "gastei 50 no almoço" (avulso carteira); (d) recebimento. Validar: montagem → "sim" → entra com competências certas; e que "✅" **só** sai após persistência.

## 7. Rollout
- `node --check` + scp + `pm2 restart tom`.
- Registrar em `tom_known_issues`: **`FIN-CONFIRM-CONFAB-NOOP`** (relacionado a `BATCH-COMPLETE-CONFIRM-NOOP` + `AUDIT-OPTIMISTIC-CONFIRM`).
- **Recuperar os 5 lançamentos perdidos da Rose** (3 da lista 2 + 2 parcelados) — **checar duplicata antes** (ela pode ter lançado na mão).
- Atualizar memória.

## 8. Fora de escopo (explícito)
- Estorno/refund e import de fatura (já determinísticos) — não mexer agora.
- Carteira obrigatória pra gasto avulso — **mantido** (decisão Alf 19/06).
- **Voz/tom/tamanho das respostas do TOM — INTOCADOS (sagrado).** Só mexe na MECÂNICA de execução, na honestidade factual, e em tornar a confirmação sempre-presente. O estilo da montagem é o que o TOM já faz.

## 9. Guardrails
- `collaborator_id` sempre do remetente, nunca do LLM. Engine escreve via `service_role`.
- Preview = WYSIWYG: o que a montagem mostra é exatamente o que o executor insere (builder determinístico, sem drift LLM↔payload).
