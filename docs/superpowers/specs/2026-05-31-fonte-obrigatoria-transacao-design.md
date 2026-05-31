# Fonte Obrigatória + Roteamento Conta/Cartão/Dinheiro — Design

**Data:** 2026-05-31
**Status:** Aprovado (design via diálogo + decisão Dinheiro travada)

## Problema (com evidência)

Toda entrada/saída pode ser gravada **sem fonte**. Hoje o engine
(`engine.js:5929-5937`) resolve `account_name → account_id`; se não acha,
**grava mesmo assim** com `account_id: null`. O rodapé "De onde saiu?"
(`finance-format.js:89`) é passivo — não trava nada.

`findAccountByName` (`financeiro-service.js:31`) busca **só em `pf_accounts`** —
nunca olha `pf_cards`. Então "gastei 45 no Nubank" (onde Nubank é **cartão**)
não acha carteira, ignora o cartão, e grava órfã.

**Estado real do banco (Luciano):** 0 carteiras, 1 cartão "Nubank", **10
transações órfãs** (account_id NULL + card_id NULL). O saldo é ficção.

## Regra

**Toda transação TEM fonte — despesa E receita:** carteira, cartão ou Dinheiro.
Sem fonte resolvível, o TOM **pergunta e NÃO grava**.
- Despesa sem fonte → "💸 saiu de qual conta?"
- Receita sem fonte → "💰 caiu em qual conta?" (NUNCA "de onde saiu" — semântica errada)

**A fonte é resolvida pelo que EXISTE, não por palavra-chave.** Se o nome só bate
cartão → cartão; só bate carteira → carteira; bate nos dois → pergunta. Isto
**substitui a regra antiga de colisão** que está hoje na `financeiro-pessoal.md`
("gastei no X sem dizer cartão = sempre carteira") — essa regra sai.

**Métodos de pagamento ≠ fonte.** "pix", "débito", "transferência", "ted" são
*como* pagou, não *de onde* — resolvem `none` → o TOM pergunta a conta.
"crédito"/"cartão"/"parcelei"/"em Nx" → roteia pro cartão.

## Arquitetura

### 1. Carteira "Dinheiro" auto-provisionada
Helper `ensureDinheiro(cid)` cria (idempotente) a carteira `Dinheiro`
(icon 💵) na 1ª vez que o usuário gasta em espécie. Rastreia o caixa físico
com saldo real, igual qualquer carteira.

### 2. Resolver unificado `resolveSource(cid, name)`
Substitui `findAccountByName`. Checa **carteiras E cartões**:
- vazio / método de pagamento ("pix"/"débito"/"transferência"/"ted") → `{ kind: 'none' }`
- "dinheiro"/"espécie"/"cash" → `{ kind: 'account', account: ensureDinheiro() }`
- match só em cartão → `{ kind: 'card', card }`
- match só em carteira → `{ kind: 'account', account }`
- match nos dois (ex: carteira "Nubank" + cartão "Nubank") → `{ kind: 'ambiguous', account, card }`
- nada → `{ kind: 'none' }`

Vale para despesa E receita (receita em cartão = estorno/crédito na fatura é
fora de escopo v1 → receita só aceita carteira/Dinheiro; cartão numa receita →
trata como `none` e pergunta a conta).

### 3. Roteamento no `register_transaction`
- `card` → vira **compra na fatura** (`insertCardPurchase`, fora do caixa)
- `account` → transação de caixa com `account_id`
- `ambiguous` → **pergunta** "foi no cartão ou na conta Nubank?" — não grava
- `none` → **pergunta** + lista numerada (carteiras + cartões + 💵 Dinheiro) — não grava
  - despesa: "💸 Gasto de R$X — saiu de qual conta?"
  - receita: "💰 Entrada de R$X — caiu em qual conta?"

### 4. Trava dupla
- **Skill** (`financeiro-pessoal.md`): instrui o TOM a perguntar a fonte quando
  falta (despesa e receita), e a tratar colisão de nome. **Remover a regra antiga
  "sem dizer cartão = sempre carteira"** — fonte agora é pelo que existe (§2).
- **Engine** (safety-net): se `register_transaction` chega sem fonte resolvível,
  recusa + devolve a pergunta. Garante que nunca grava órfã mesmo se o LLM falhar.

### 5. Injeção de contexto
A skill financeira recebe a lista de **nomes** de carteiras + cartões + Dinheiro
do usuário (sem saldo). Assim o TOM reconhece "no Nubank" = cartão e consegue
montar a pergunta com as opções certas.

### 6. Estado da pergunta = stateless
Sem tabela de pending. Quando o TOM pergunta e o usuário responde "no Nubank",
o LLM re-emite `register_transaction` com a fonte — ele tem o contexto da
conversa. O safety-net do engine só recusa+pergunta; o follow-up é natural.

### 7. Órfãs existentes = re-registrar limpo (sem backfill)
As órfãs atuais são **dado de teste** (serão apagadas). Backfillar pra "Dinheiro"
credita receitas (Salário 5k, Extra 2k) no caixa físico — semanticamente errado e
sem valor. Decisão: **não fazer backfill**; o Alf re-registra o que importar agora
com a fonte certa (já valida o fluxo novo de ponta a ponta). Cuidado só na
contagem: as 10× "TV" / "material" têm `card_id` (parcelas de cartão) — **não são
órfãs**; órfã = `account_id NULL AND card_id NULL`.

## Fora de escopo
- OCR de notas/comprovantes (próxima feature, já mapeada).
- Mudança de constraint DDL hard (NOT NULL): enforcement fica no engine +
  Dinheiro como fallback, mantendo flexibilidade (bills, transfers).

## Testes (smoke WhatsApp)
1. "gastei 45 no nubank com lazer" → reconhece cartão → fatura (não no caixa)
2. "paguei uber 30 no pix" (método, sem conta) → pergunta "💸 saiu de qual conta?" + lista
3. responde "do nubank" após pergunta → grava na fonte certa
4. "gastei 20 em dinheiro" → cria/usa carteira Dinheiro, debita
5. "recebi 2000 de extra" (receita sem fonte) → pergunta "💰 caiu em qual conta?"
6. colisão (criar carteira "Nubank" + cartão) → pergunta cartão vs conta
7. safety-net: forçar marker sem fonte → engine recusa e pergunta (não grava órfã)
8. PWA: saldo bate após cada lançamento (sem órfã)
