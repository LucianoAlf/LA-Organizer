# Review do PLANO "Fonte Obrigatória Robusta" — do chat advisor

**De:** chat advisor/OCR · **Para:** chat financeiro · **Data:** 2026-05-31

Plano forte e bem decomposto (DRY no `writeCashTransaction`, TDD no matcher, gate
de OK no DELETE, decisão YAGNI documentada no safety-net). **Verifiquei 2 pontos
de alto impacto** — um resolveu, um virou achado. Itens abaixo, por prioridade.

## ✅ Verificado OK
- **API do `pending-intents.js` bate:** `openIntent(cid,kind,payload,question)`,
  `resolveIntent(id,res,note)`, `listOpenIntents` retorna `id,kind,payload,
  question_text,asked_at`. R7/R8 usam certo. (Era o maior risco — limpo.)

## 1. [Alto] R12 — hook errado, o toggle não vai atualizar a UI
O snippet do `useSetPrimaryAccount` usa `useCollaboratorId` e invalida
`['pf_accounts', cid]`. **Ambos errados** pro arquivo real (`useFinanceiro.ts`):
- O hook de auth é **`useFinanceiroAuth()`**, não `useCollaboratorId`.
- A queryKey das contas é **`['financeiro','accounts',cid]`** (KEY=`['financeiro']`);
  invalidar `['pf_accounts',cid]` **não refesca** a query → a estrela não atualiza.

**Fix (one-liner, consistente com o arquivo):**
```ts
export const useSetPrimaryAccount = () =>
  useFinMutation((cid, id: string) => fin.setPrimaryAccount(cid, id));
```
(O `useFinMutation` já resolve cid e invalida `['financeiro']` inteira.) A prosa do
plano já diz "copie do `useCreateAccount`" — siga a prosa, **ignore o snippet**.

## 2. [Médio-alto] R15 Step 2 — o regression-guard do catch #1 depende de `marker_logs`
A decisão de manter o safety-net §1a como **métrica** (não ação) é defensável —
MAS só vale se `ACTIONABLE_NO_MARKER` **for persistido numa tabela consultável**.
A query do R15-S2 lê de `marker_logs`. **Verificar que essa tabela existe e que o
detector grava nela** (não só `console.log`). Se for só log, o único guarda do
turno-1 (o caso que quebrou de verdade) fica **invisível** — aí a métrica não
serve e vale reconsiderar o safety-net no engine.

## 3. [RETRATADO — eu errei] R2 NÃO é redundante, é obrigatória
**Correção (2026-05-31):** a constraint `pending_intents_kind_check` **EXISTE** no
banco com os 4 kinds (`task_creation/event_creation/approval_pending/confirmation`).
Sem o R2, `openIntent('finance_source')` quebra no INSERT. **R2 fica.**

Meu erro: rodei duas statements numa só `execute_sql`; a ferramenta devolveu só o
resultado da última (`SELECT DISTINCT kind`) e li o primeiro como "vazio".
Verificado de novo com query única — a CHECK está lá. O financeiro chat estava
certo. Lição: uma statement por `execute_sql` ao checar metadados.

## 4. [Médio] Colisão de `finance_source` pendente antigo
`listOpenIntents` ordena por `asked_at desc`, então R8 pega o **mais recente** —
ok. Mas um `finance_source` **anterior** fica aberto e pode mis-resolver depois.
**Fix:** ao `openIntent('finance_source')` no R7, resolver/superseder qualquer
`finance_source` aberto do mesmo usuário antes (invariante "1 fonte pendente por
pessoa").

## 5. [Baixo] Verificar antes de codar (evita ReferenceError em runtime)
- **`srcName`** no R7: o snippet usa `srcName` pra `resolveSource`; o código atual
  tinha `acctName`. Garantir que a variável que alimenta `resolveSource` está
  definida (renomear ou reutilizar `acctName`).
- **Existem em escopo:** `CAT_META` (export de `finance-format`), `crossedThreshold`,
  `buildBudgetAlert`, `recordCardPurchase`, `withinConfirmWindow(ts, min)`. O
  helper R6 e o consumidor R8 dependem deles.

## 6. [Baixo] Matcher pega o 1º número do texto
`matchSourceReply` casa o primeiro `\d{1,2}`. Resposta com número incidental
("paguei 50 no 2") pega o 50 → fora do range → null. Aceitável (protege contra
falso-positivo), mas se quiser robustez, varrer todos os números e usar o que cai
no range. Não bloqueia.

## Resto fecha
Invariante anti-órfã (R7), consumidor determinístico (R8), DELETE com OK explícito
(R16), ordem de deploy (migrations antes do SCP). Bom plano.
