# Fonte Obrigatória + Financeiro Guiado (app = fonte de verdade) — Design

**Data:** 2026-05-31
**Status:** Aprovado (design via diálogo; revisão robusta substitui o §6 stateless)

## Problema (com evidência)

Toda entrada/saída pode ser gravada **sem fonte**. O engine
(`engine.js`, case `register_transaction`) resolvia `account_name → account_id`;
se não achava, **gravava mesmo assim** com `account_id: null`. Saldo vira ficção.

A primeira spec resolveu o caso fácil (fonte na mesma frase: "gastei 45 no
nubank" → `resolveSource` roteia certo). **O que continua quebrando é o caso
sem-conta / multi-turn**, porque a resolução dependia do LLM re-emitir o marker
no turno seguinte (stateless). Evidência nos logs (31/05):

- "gastei 70 no nubank" → fatura do cartão OK ✅
- "paguei uber no pix" → LLM **perguntou de boca, sem emitir marker**
  (`ACTIONABLE_NO_MARKER`)
- resposta "nubank" → LLM **fabricou** "✅ Registrado! Forma PIX·Nubank"
  (sem marker → **transação perdida**, nada persistido)
- "recebi 2000" → **timeout do Claude → fallback Codex perdeu o contexto**

**Causa-raiz:** multi-turn de resolução de fonte conduzido pelo LLM é frágil —
ele esquece de emitir o marker, fabrica confirmação ou perde contexto no
fallback. A robustez precisa morar no **engine** (determinístico), não no LLM.

**Estado real do banco (Luciano):** órfãs são dado de teste (serão re-registradas).

## Princípio condutor: o app é a fonte de verdade

LA-**Organizer** é um app de organização. As contas/cartões/dinheiro do usuário
são cadastrados **no PWA** (Finanças → Carteiras / Cartões) — é lá a fonte de
verdade. O TOM no WhatsApp **lança** transações contra essas fontes; ele não é o
lugar de cadastrar a estrutura financeira de forma bagunçada.

Consequência de design: em vez de inventar fallback/gambiarra quando falta
fonte, o sistema **conduz o usuário a fazer o certo** — cadastrar no app. Isso
casa com o rollout (vídeo + broadcast pros 22 usuários ensinando o fluxo).

Combinação adotada = **prevenção + safety-net**:
- **Prevenção:** conta principal (default silencioso) + TOM Coach guiando ao app.
- **Safety-net:** pending-state no engine (nunca grava órfã, nunca depende do LLM
  lembrar do contexto).

## Regra

**Toda transação TEM fonte — despesa E receita:** carteira, cartão ou Dinheiro.
Sem fonte resolvível, o engine **pergunta e NÃO grava** (estado pendente).
- Despesa sem fonte → "💸 saiu de qual conta?"
- Receita sem fonte → "💰 caiu em qual conta?" (NUNCA "de onde saiu")

**A fonte é resolvida pelo que EXISTE, não por palavra-chave.** Nome bate só
cartão → cartão; só carteira → carteira; nos dois → pergunta. Substitui a regra
antiga de colisão ("sem dizer cartão = sempre carteira") — essa sai.

**Métodos de pagamento ≠ fonte.** "pix", "débito", "transferência", "ted",
"boleto" são *como* pagou → `none` → resolve por conta principal ou pergunta.
"crédito"/"cartão"/"parcelei"/"em Nx" → roteia pro cartão.

## Arquitetura

### 1. Resolução determinística da fonte (engine, nunca LLM)
O LLM **sempre emite o marker** `register_transaction` (com `account_name` se a
pessoa disse, sem se não disse). **Ele nunca pergunta de boca nem fabrica
confirmação** — quem decide gravar/perguntar é o engine. Ordem de resolução no
case `register_transaction`:

1. **Fonte na mensagem** (`account_name` preenchido) → `resolveSource`:
   - `card` → compra na fatura (`insertCardPurchase`, fora do caixa)
   - `account` → transação de caixa com `account_id`
   - `ambiguous` (carteira E cartão com mesmo nome) → **pendência** "cartão ou conta?"
   - `none` (método de pagamento / nome desconhecido) → cai no passo 2
   - **"dinheiro"/"espécie" → auto-provisiona a carteira Dinheiro** (`ensureDinheiro`)
     e grava — **única exceção** ao 0-contas→coach (caixa físico é fonte real;
     ver §1a).
2. **Sem fonte + tem conta principal** (`is_primary`) → grava na principal e
   **nomeia a principal assumida na confirmação** ("_lancei na sua conta
   principal (Itaú)_"). Não é silencioso-mudo: o default é discreto mas **sempre
   identificado**, senão um default errado passa batido.
3. **Sem fonte + tem ≥2 contas e nenhuma principal** → **pendência** + pergunta
   com lista numerada (carteiras + cartões¹ + 💵 Dinheiro).
4. **Sem fonte + 0 contas cadastradas** → **não grava**; dispara o **coaching pro
   app** (TOM Coach P6): "pra eu organizar certo, cadastra sua conta no app —
   Finanças → Carteiras. Aí é só mandar 'gastei 45' que eu já sei de onde saiu."

¹ Receita não aceita cartão (estorno/crédito-em-fatura é fora de escopo v1).

### 1a. Emissão do marker no turno 1 (ponto mole do LLM) — defesa em camadas
O pending-state (§3) conserta o **turno 2**, mas o **turno 1** ainda depende do
LLM emitir o marker em vez de perguntar de boca (a falha real dos logs:
`ACTIONABLE_NO_MARKER` em "paguei uber no pix"). Defesa em 2 camadas:

- **Skill imperativa** (`financeiro-pessoal.md`): "mesmo sem saber a fonte (só
  'pix'/'débito'/'transferência'/'boleto'), **SEMPRE** emita
  `register_transaction` **sem** `account_name`; **NUNCA** pergunte de boca nem
  fabrique confirmação — quem pergunta a fonte é o engine."
- **Safety-net fraco no engine** (`ACTIONABLE_NO_MARKER`): manter o detector como
  métrica de regressão **e** avaliar usá-lo como rede — quando a utterance é
  financeira-acionável (regex de gasto/receita + valor) mas o LLM respondeu sem
  marker, o engine dispara a pergunta de fonte determinística em vez de deixar a
  resposta de-boca do LLM passar. Decisão de viabilidade fica no plano (precisa
  de classificador leve de "acionável"); se entrar, fecha o único furo restante.

### 1b. Carteira Dinheiro como exceção intencional ao 0-contas→coach
"dinheiro"/"espécie" é fonte **explícita** → auto-provisiona `Dinheiro` e grava,
mesmo com 0 contas. **Decisão de propósito:** isso permite usar "em dinheiro"
para sempre sem cadastrar nada no app. É aceitável — o caixa físico é uma fonte
real e rastreável. O coaching pro app (§1.4) só dispara quando **não há fonte
nenhuma** (nem explícita "dinheiro", nem conta cadastrada).

### 2. Conta principal (`is_primary`)
Migration: coluna `is_primary boolean default false` em `pf_accounts`. No máximo
uma principal por colaborador (índice parcial único). App ganha toggle "conta
principal" em Carteiras (radio/estrela). Sem principal definida e com 1 só
carteira, o engine trata essa única como principal de fato (sem ambiguidade).

### 3. Pending-state no engine (padrão `pending-intents`)
Reusa o serviço já existente (`pending-intents` / `pending-followups`, já
`require`d em `system.js`). Quando o engine decide perguntar (passos 1-ambiguous
e 3), ele **salva a intenção pendente** (type, amount, description, category,
type income/expense, candidatos) e **devolve a pergunta determinística**
(`buildSourceQuestion`). Próxima mensagem do usuário:

- O engine, **antes do LLM**, vê que há pendência financeira aberta e tenta
  casar a resposta contra os candidatos. O matcher cobre **duas formas de
  pergunta**:
  - **lista de fontes** (passo 3): casa por número ("2") ou nome ("nubank" /
    "dinheiro") contra a lista numerada.
  - **binária cartão-vs-conta** (passo 1-ambiguous): casa "cartão"/"crédito"
    vs "conta"/"carteira" / o nome.
  - casou → **grava a transação pendente** com a fonte escolhida → confirma
    (`buildTxnConfirmation`). **Determinístico — não passa pelo LLM**, então não
    fabrica nem perde no fallback.
  - não casou (usuário mudou de assunto) → descarta a pendência (TTL curto) e
    segue o fluxo normal.

Isso elimina as três falhas dos logs: sem marker-ausente, sem fabricação, sem
perda no timeout/fallback.

### 4. TOM Coach — P6 financeiro (`skills/coach-usabilidade.md`)
Adicionar o padrão **P6** à skill do **TOM Coach** (não "Alfredo" — Alfredo/Alf é
o usuário): quando o usuário tenta lançar transação e **não tem nenhuma conta
cadastrada**, o TOM dá um nudge leve direcionando ao app:
> "Pra organizar certo, cadastra suas contas e cartões no app primeiro
> (Finanças → Carteiras / Cartões) — é lá a fonte de verdade. Aí é só mandar
> 'gastei 45' que eu já sei de onde saiu."

Coaching, não bloqueio rude: explica o porquê (organização) e o ganho (lançar
fica trivial depois). Alinhado ao tom das demais regras P1-P5.

### 5. Injeção de contexto (nomes, sem saldo)
A skill financeira recebe a lista de **nomes** de carteiras + cartões + Dinheiro
do usuário (sem saldo), já implementado em `system.js` (FINANCE_RE → "## Fontes
deste usuário"). Mantém o LLM ciente de "Nubank = cartão" pra emitir
`account_name` correto. (Exceção escopada ao §6.4 do design financeiro original:
nomes de fonte podem entrar quando a skill carrega; saldos não.)

### 6. Garantia anti-órfã (invariante)
O engine **nunca** grava transação de caixa com `account_id NULL AND card_id
NULL`. Todo caminho termina em: (a) grava com fonte resolvida, (b) grava na
principal, (c) pendência aguardando resposta, ou (d) coaching pro app sem gravar.
Não existe quinto caminho. Esse invariante é o coração da feature.

### 7. App: completar o cadastro (pré-requisito do rollout)
Antes do broadcast, verificar/garantir no PWA:
- **Carteiras**: criar / editar / definir principal (toggle `is_primary`).
- **Cartões**: form com limite, dia de fechamento, dia de vencimento, bandeira.
- **Contas fixas** (bills): existem e criam.
Gaps viram tarefas no plano.

### 8. Órfãs existentes = DELETAR + re-registrar limpo (sem backfill)
Órfãs atuais são **dado de teste**. Backfillar pra "Dinheiro" creditaria receitas
(Salário, Extra) no caixa físico — semanticamente errado. **Não fazer backfill.**

Mas **não basta ignorar**: se as órfãs ficarem no banco, dobram a contagem quando
o Alf re-registrar e seguem poluindo saldo/categoria no PWA. Então o plano
**deleta as órfãs de teste**:

```sql
DELETE FROM pf_transactions
WHERE collaborator_id = '<luciano>'
  AND account_id IS NULL AND card_id IS NULL;
```

⚠️ **Deletar dado em produção → exige OK explícito do Alf** (CLAUDE.md). O plano
mostra a contagem antes (SELECT), pede confirmação, então deleta. Cuidado na
contagem: parcelas de cartão têm `card_id` → **não são órfãs**; órfã =
`account_id NULL AND card_id NULL`. Depois o Alf re-registra o que importar pelo
fluxo novo (valida ponta a ponta).

## Rollout (responsável: Alf)
Gravar vídeo + disparar broadcast pros 22 usuários ensinando: cadastre suas
contas/cartões no app primeiro, depois é só falar com o TOM. O sistema reforça
isso via TOM Coach P6 pra quem ainda não cadastrou.

## Fora de escopo
- OCR de notas/comprovantes (próxima feature).
- Receita em cartão (estorno/crédito na fatura).
- Constraint DDL hard (NOT NULL) — enforcement fica no engine + pending-state,
  mantendo flexibilidade (bills, transfers).
- Wizards multi-passo no chat pra cadastro (o cadastro é no app; o chat só
  direciona). YAGNI por ora.

## Testes
**Unit (node:test, lógica pura):**
- `resolveSource` (já coberto): none/cash/card/account/ambiguous.
- `buildSourceQuestion` / `buildTxnConfirmation` / `buildTxnFooter` (já cobertos).
- **Novo:** matcher de resposta da pendência ("nubank"/"2"/"dinheiro" →
  candidato certo; resposta off-topic → não casa).

**Smoke WhatsApp:**
1. "gastei 45 no nubank com lazer" → cartão → fatura (não no caixa)
2. "paguei uber 30 no pix" + tem conta principal → grava na principal **e a nomeia**
   na confirmação ("_lancei na sua conta principal (Itaú)_")
3. "paguei uber 30 no pix" + 2 contas, sem principal → pergunta → responde "2" →
   **engine grava** (sem passar pelo LLM) → confirma
4. "gastei 20 em dinheiro" **com 0 contas** → auto-provisiona Dinheiro, grava
   (exceção §1b — NÃO cai no coach)
5. "recebi 2000 de extra" sem fonte → "💰 caiu em qual conta?" (cartão fora da lista)
6. colisão (carteira "Nubank" + cartão) → pergunta cartão vs conta → responde
   "cartão" → **engine grava na fatura** (matcher binário, §3)
7. **0 contas**: "gastei 50" (sem "dinheiro") → não grava → TOM Coach P6 → app
8. safety-net: marker sem fonte resolvível nunca grava órfã
9. **ACTIONABLE_NO_MARKER**: utterance financeira sem marker → engine dispara a
   pergunta de fonte (não deixa resposta de-boca do LLM passar) — se o safety-net
   §1a entrar no plano
10. órfãs deletadas: `SELECT count(*) ... account_id NULL AND card_id NULL` = 0
11. PWA: saldo bate após cada lançamento (sem órfã)
