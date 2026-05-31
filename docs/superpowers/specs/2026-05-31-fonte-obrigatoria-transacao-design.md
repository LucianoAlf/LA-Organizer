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

**Toda transação de caixa TEM fonte:** carteira, cartão ou Dinheiro. Sem fonte
resolvível, o TOM **pergunta e NÃO grava**.

## Arquitetura

### 1. Carteira "Dinheiro" auto-provisionada
Helper `ensureDinheiro(cid)` cria (idempotente) a carteira `Dinheiro`
(icon 💵) na 1ª vez que o usuário gasta em espécie. Rastreia o caixa físico
com saldo real, igual qualquer carteira.

### 2. Resolver unificado `resolveSource(cid, name)`
Substitui `findAccountByName`. Checa **carteiras E cartões**:
- match só em cartão → `{ kind: 'card', card }`
- match só em carteira → `{ kind: 'account', account }`
- "dinheiro"/"espécie"/"cash" → `{ kind: 'account', account: ensureDinheiro() }`
- match nos dois (ex: carteira "Nubank" + cartão "Nubank") → `{ kind: 'ambiguous', account, card }`
- nada → `{ kind: 'none' }`

### 3. Roteamento no `register_transaction`
- `card` → vira **compra na fatura** (`insertCardPurchase`, fora do caixa)
- `account` → transação de caixa com `account_id`
- `ambiguous` → **pergunta** "foi no cartão ou na conta Nubank?" — não grava
- `none` → **pergunta** "💸 Gasto de R$X — saiu de qual conta?" + lista
  numerada (carteiras + cartões + 💵 Dinheiro) — não grava

### 4. Trava dupla
- **Skill** (`financeiro-pessoal.md`): instrui o TOM a perguntar a fonte quando
  falta, e a tratar colisão de nome.
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

### 7. Backfill das 10 órfãs
Migration de dados: as transações órfãs existentes recebem a carteira
`Dinheiro` (recalcula saldo). **Sem deletar** dados — backfill seguro.

## Fora de escopo
- OCR de notas/comprovantes (próxima feature, já mapeada).
- Mudança de constraint DDL hard (NOT NULL): enforcement fica no engine +
  Dinheiro como fallback, mantendo flexibilidade (bills, transfers).

## Testes (smoke WhatsApp)
1. "gastei 45 no nubank com lazer" → reconhece cartão → fatura (não no caixa)
2. "paguei uber 30 no pix" sem conta dita → pergunta "saiu de qual conta?"
3. responde "do nubank" após pergunta → grava na fonte certa
4. "gastei 20 em dinheiro" → cria/usa carteira Dinheiro, debita
5. colisão (criar carteira "Nubank" + cartão) → pergunta cartão vs conta
6. PWA: saldo bate após cada lançamento (sem órfã)
