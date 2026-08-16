# Fatia #2 — Alvo errado em ação destrutiva financeira (fail-closed no resolveTxnTarget)

**Data:** 2026-08-16 · **Família:** `dropped_request`/alvo-errado (alta gravidade) · **Domínio:** financeiro

## Sintoma medido

> USUÁRIO: "apaga a fatura **Itaú de R$950,21**" → TOM: "🗑️ Apaguei *Google Canva* (R$34,90)."

O usuário nomeou um alvo específico e o TOM **apagou outro** (o mais recente). Ação destrutiva
(delete), dado financeiro real. Conecta com [[project_card_phantom_delete_real]].

## Raiz — fail-OPEN no `src/finance/txn-target.js`

`resolveTxnTarget(rawText, recent)` resolve QUAL transação apagar/editar entre as 10 recentes:
1. valor ("de 30") → filtra por amount;
2. nome ("a do mercado") → filtra por descrição/categoria após palavra-ref isolada;
3. **fallback: `return { kind:'one', txn: cands[0] }`** — o mais recente.

A fatura Itaú de R$950,21 **não está nas transações recentes** (é fatura, não lançamento): o valor
950 não casa, o nome "Itaú" não casa → cai no **fallback cego e apaga o mais recente (Canva)**.
Quando o usuário deu ESPECIFICIDADE que não bateu, chutar o mais recente numa operação destrutiva
é o pior resultado. Afeta `delete_transaction` E `edit_transaction` (mesmo resolvedor).

## Design — fail-closed quando a especificidade não bate

O fallback "mais recente" só é legítimo quando o usuário **não deu referência** ("apaga isso",
"desfaz o último"). Se deu e não bateu → `none` (pergunta), nunca chuta.

1. **Valor especificado sem match → `none`.** Se há valor no texto e `byVal` é vazio, retorna
   `none` em vez de cair no nome/fallback. (Mata o caso Itaú R$950,21.)
2. **Nome-referência que não bateu → `none`.** Após `byName` vazio, se o texto tem uma palavra-ref
   ISOLADA (`o/a/do/da/de/essa/esse/aquele…`, com o boundary `(?:^|\s)` que já existe) seguida de um
   token de conteúdo (≥3 letras) que **não** é palavra de CAMPO genérica (categoria, valor,
   descrição, data, conta, cartão, saldo, parcela, fatura, lançamento, última, recente, compra,
   gasto…), então houve referência que falhou → `none`. Senão (só pronome/campo) → mais recente.

Puro, sem I/O. Reusa o `REF_BEFORE` isolado (por isso "pra lazer" não conta — o "a" está dentro de
"pra", sem boundary).

## Freios / não-regressão (testes existentes preservados)

- `"exclui essa"` / `""` / `"apaga a última"` → mais recente (sem ref de conteúdo). ✓
- `"a do mercado"` → Mercado (byName). ✓
- `"a de 30"` → many; `"era 80"` → one (valor casa). ✓
- `"muda a categoria pra lazer"` → mais recente (edit: "categoria" é campo; "lazer" após "pra" sem
  boundary). ✓ ← o mais delicado
- `"exclui o uber"` → Uber. ✓

## Casos novos (fail-closed)

- `"apaga a fatura Itaú de R$950,21"` (valor não casa) → `none`. 
- `"apaga a fatura do Itaú"` (nome não casa, "itaú" não é campo) → `none`.
- Handler: `none` → "Não achei qual lançamento. Diz o valor ou o nome" (já existe) — pergunta em vez
  de apagar errado.

## Prova de aceite

- Puros: `txn-target.test.js` — todos os existentes verdes + novos (valor-sem-match → none;
  nome-inexistente → none; "apaga a fatura do Itaú" → none; boundary "pra lazer" preservado).
- Replay VERMELHO (o que importa aqui): "apaga a fatura Itaú de R$950,21" com um lançamento recente
  de OUTRO valor → NÃO apaga o recente (fail-closed); a resposta pergunta/nega.
- Replay VERDE: "apaga a de 80" com um lançamento de R$80 recente → apaga o certo.
- Suíte VPS fail 3 + restart provado.
