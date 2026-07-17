# Categorização de fatura de cartão — o TOM classifica, sugere e aprende

**Data:** 2026-07-17
**Origem:** Rose (16-17/07), depois do fix do cartão errado. Padrão-ouro: a **Maria** (agente financeira do LA HQ).
**Escopo:** import de fatura de cartão (`invoice_import`). Não toca no fluxo de lançamento avulso nem no PWA.

---

## O problema (medido, não suposto)

A Rose, sobre a fatura que o TOM acabou de lançar certo:

> "As categorias maioria vieram como outros, n teve sugestão.. **Se ele puder dar sugestão ou perguntar pra eu colocar**"

Alf: *"quando o Tom lança, fica tudo em outros, não categoriza. Aí vai tudo para outros, e aí fica um **trabalho dobrado**. Se o Tom já lançar, facilita muito."*

**O número real** (`pf_transactions` da Rose, cartão, julho/2026 — 98 itens):

| categoria | itens | % |
|---|---|---|
| compras | 44 | 44,9% |
| **outros** | **30** | **30,6%** |
| transporte | 6 | 6,1% |
| farmacia | 5 | 5,1% |
| (+7 categorias) | 13 | 13,3% |

**Quem cai em "outros"** — e por quê:

| descrição | vezes | R$ | categoria certa | por que falhou |
|---|---|---|---|---|
| `MP*CONECTCAR` | **10×** | 135,05 | transporte | não está na lista |
| `Abastec` | 2× | 200,00 | combustivel | não está na lista |
| `MP *LUCASDONAS (2/3)` | 1× | 500,00 | compras | idem |
| `Prezunic` | 1× | 259,85 | mercado | idem |
| `Cencosud` | 1× | 175,49 | mercado | idem |
| `Rei do Mate`, `Global Park`, `CITYFARMA`, `IFD P L Moura`, `MP*ULTRAPASSEMENSAL` | 1× cada | — | restaurante / estacionamento / farmacia / alimentacao / transporte | idem |

**Diagnóstico:** é **limitação, não defeito.** O `stripAcquirer` funciona (`ACQUIRER_RE` já cobre `mp|ifd|pag|...`, então `MP*CONECTCAR` → `conectcar`). O buraco é que `MERCHANT_RULES` tem **22 regras** e nenhuma casa "conectcar". E os **30 slugs de despesa já existem** (`mercado`, `estacionamento`, `restaurante`, `combustivel`…) — falta só o mapeamento.

**A segunda dor:** o TOM **não aprende nada**. Não há memória de categoria por pessoa. Por isso o ConectCar caiu em "outros" **11 vezes seguidas** — e cairia na 12ª.

## Goal

O TOM entrega a fatura **já classificada**, pergunta só o que não sabe (agrupado), e **nunca pergunta a mesma loja duas vezes**. Critério: a Rose para de recategorizar na mão; o "outros" cai mês a mês sem ninguém tocar em código.

## Decisões (Alf, 17/07)

1. **Onde:** na **prévia que ela já confirma** — não num ritual depois. Os desconhecidos vão **agrupados por loja** (11 ConectCar = 1 pergunta).
2. **Aprende:** sim, **por pessoa** (`collaborator_id`). O gasto dela é dela; "Amazon" pode ser `compras` pra um e `tecnologia` pra outro.
3. **Quem sugere:** o **Gemini**, no mesmo passe em que já lê o PDF (custo marginal ~zero, cobre qualquer loja).
4. **Precedência:** `aprendido > lista curada > palpite do Gemini > outros`.

## Princípio central

**O determinístico manda; o LLM só preenche o vazio.** O que a Rose ensinou vence a lista; a lista curada vence o palpite; o palpite só entra onde ninguém sabe. Assim o Gemini nunca sobrescreve uma verdade conhecida — ele só cobre o que hoje viraria "outros". Se o Gemini falhar/vier vazio, o resultado é **exatamente o de hoje**: nunca pior.

**Aprende só na CORREÇÃO, nunca no "sim".** O "sim" é aceite do lote, não endosso item a item — se aprendesse com ele, um palpite errado do Gemini que passou batido viraria lei permanente. A memória existe pra consertar onde o Gemini erra.

## Componentes

### 1. `src/finance/categorize-invoice.js` (NOVO, puro, sem I/O)

```
resolveItemCategory({ descricao, tipo, geminiHint, learned, extraSlugs })
  -> { slug, source: 'learned'|'rules'|'gemini'|'fallback' }
```
- `learned`: `Map<merchantKey, slug>` — o engine lê do banco e injeta; o módulo não faz I/O.
- Valida o `geminiHint` contra os slugs válidos (`categories.data.js` + `extraSlugs` do usuário). **Slug inventado pelo LLM → descartado, cai pra `outros`.**
- `income` nunca casa merchant (paridade com `categorizeMerchant` atual).

```
merchantKey(descricao) -> string
```
- Chave de agrupamento/memória. Reusa `stripAcquirer` (tira `MP*`, `IFD*`…) + tira sufixo de parcela `(2/3)`/`02/03` + tira cidade/UF colada (`SmartShelvePETROPOLISBR` → `smartshelve`) + colapsa dígitos de loja (`PREZUNIC 716` → `prezunic`).
- **É o linchpin:** agrupa os 11 ConectCar numa pergunta E é a chave da memória. Sem ela, nada disso funciona.

```
groupUnknowns(itens) -> [{ merchantKey, label, count, total, sugestao }]
```
- Agrupa o que ficou `gemini`/`fallback`, ordena por **`count DESC, total DESC`**, e corta no **top 3** (o resto vai como está, sem perguntar). Teto duro: a prévia não vira interrogatório.
- **Por que `count` e não valor** (achado do self-review, 17/07): ordenar por valor põe `LUCASDONAS R$500 > Prezunic R$259 > STUDIO PERFIL R$203` no pódio e **joga o ConectCar (10×, R$135,05) pro 8º lugar** — ou seja, esconde exatamente a dor que a Rose relatou. O que a pergunta vale é **quantos itens ela resolve**: ensinar ConectCar 1× mata 10 agora + todos os futuros; ensinar LUCASDONAS mata 1. Valor só desempata entre os de mesma contagem.

### 2. Migration: `pf_category_memory`

```sql
create table pf_category_memory (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references collaborators(id) on delete cascade,
  merchant_key text not null,
  category text not null,
  hits int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collaborator_id, merchant_key)
);
```
- RLS espelhando `pf_transactions` (`current_collab_id()`), índice em `(collaborator_id, merchant_key)`.
- `unique` + upsert: ensinar de novo **atualiza**, não duplica.

### 3. `src/services/gemini.js` — 1 campo a mais

O schema ganha `"categoria":"<slug ou null>"` por item, com a lista de slugs válidos no prompt e a instrução: **na dúvida, `null`** (melhor vazio que errado — o `null` cai na cascata).

> ⚠️ **O schema está em DOIS lugares:** `gemini.js:242` (PDF) e `gemini.js:267` (texto colado). Alterar **os dois**. Esta é a armadilha [[project_trap_a_duas_portas]] / "varrer os writers" que causou os 2 bugs desta semana (`FIN-INVOICE-CARD-GUESSED-AT-INTENT-OPEN`). O plano confirma por `grep`, não de cabeça.

### 4. `src/finance/invoice-import.js` — só o bloco novo

`buildInvoicePreview` **não muda a lista** — ela já imprime `${it.categoria || 'outros'}` por item (linha 133) e continua igual. Ganha **um parâmetro opcional** `unknowns` que, quando presente e não-vazio, insere o bloco *"Me confirma N coisas"* **entre o Total e o rodapé**.

- `unknowns` ausente/vazio → **prévia byte a byte igual à de hoje**. Os testes atuais seguem válidos sem edição — essa é a trava de zero-regressão do formato.
- O rodapé (`Responde *lançar*, *anotações* ou *cancelar*`) fica **intocado** e continua sendo a última linha.

### 5. `src/engine.js` — liga os fios (Intercept A e B)

- **A (abre a intent):** lê a memória → `resolveItemCategory` por item → grava `categoria` + `_catSource` no payload → `groupUnknowns` → prévia.
- **B (resposta):** se a fala corrige categoria (`"1 é pedágio"`, `"ConectCar é transporte"`) → **upsert na memória** → re-resolve o lote → **re-manda a prévia** (não commita: [[project_msg_promete_previa_mas_commita]] — ninguém confirma uma prévia que não viu).
- **"sim"** → commita com as categorias do payload. **Não grava memória.**

## Fluxo

```
PDF → Gemini (itens + categoria)
   → engine lê pf_category_memory (1 query)
   → resolveItemCategory por item: learned > rules > gemini > outros
   → groupUnknowns (top 3 por valor)
   → PRÉVIA (categorias + "me confirma 3 coisas")
   → "sim"                 → lança com as categorias
   → "1 é pedágio"         → upsert memória → re-resolve → PRÉVIA de novo
```

## O texto — ADITIVO, a lista NÃO muda (Alf, 17/07)

⚠️ **Correção de rota:** a primeira versão desta spec trocava as 58 linhas por um resumo. **Vetado** — mexer no tamanho/jeito do TOM é decisão do Alf ([[feedback_tom_comportamento_sagrado]]), e a Rose **nunca reclamou do tamanho**: reclamou de "outros". Descoberta ao ler o código: `buildInvoicePreview` (`invoice-import.js:133`) **já imprime a categoria por item** — `${it.categoria || 'outros'}`. Ela estava lendo 58 linhas escritas "· outros". O formato está certo; o **valor** é que estava errado.

**A lista continua exatamente como é.** Só muda o que sai depois do "·" — e ganha um bloco no fim.

**Hoje:**
```
📄 *Fatura Itaú* · vence 10/07

1. 15/06 · MP*CONECTCAR · R$ 4,00 · outros
2. 25/06 · Prezunic · R$ 259,85 · outros
3. 20/05 · AMAZON MARKETP · R$ 27,12 · 2/3 · compras
...
Total: R$ 6.008,04 · 58 lançamentos

Lanço essas compras no *Latam PASS*? Responde *lançar*, *anotações* (só salvar) ou *cancelar*.
```

**Depois** (mesmas linhas, categoria certa, + o bloco novo):
```
📄 *Fatura Itaú* · vence 10/07

1. 15/06 · MP*CONECTCAR · R$ 4,00 · transporte     ← era "outros"
2. 25/06 · Prezunic · R$ 259,85 · mercado          ← era "outros"
3. 20/05 · AMAZON MARKETP · R$ 27,12 · 2/3 · compras
...
Total: R$ 6.008,04 · 58 lançamentos

*Me confirma 3 coisas* (ou só responde *lançar*):
1. *ConectCar* — 10× · R$ 135,05 → _transporte_?
2. *Abastec* — 2× · R$ 200,00 → _combustível_?
3. *LUCASDONAS* — 1× · R$ 500,00 → _compras_?
Se algo estiver errado, corrige: _"1 é pedágio"_, _"o 3 é lazer"_.

Lanço essas compras no *Latam PASS*? Responde *lançar*, *anotações* (só salvar) ou *cancelar*.
```

Números do bloco = **os "outros" REAIS da Rose** (`pf_transactions`, julho/2026), não ilustrativos.

Repare a ordem: **ConectCar vem primeiro por repetir 10×**, sendo o *menor valor* dos três. É o `count DESC` em ação — a pergunta que resolve mais itens vem na frente.

**Consequência boa e barata:** com a categoria certa, as 58 linhas **voltam a ter serventia sozinhas** (ela confere item a item, como já fazia). Hoje são 58× "outros" = ruído. O fix da cascata melhora a prévia sem tocar no formato.

**Zero-regressão de formato:** o rodapé (`Responde *lançar*, *anotações* ou *cancelar*`) e a numeração das linhas continuam idênticos — os testes atuais de `buildInvoicePreview` seguem válidos sem edição.

## Bordas (zero-regressão)

- **Gemini falha/timeout/`categoria` ausente** → `geminiHint = null` → cascata cai em rules/outros = **comportamento de hoje**. A leitura da fatura **nunca** falha por causa de categoria.
- **Slug inventado pelo LLM** (`"pedágio"`) → não está nos slugs válidos → descartado → `outros`.
- **Memória vazia** (todo mundo, dia 1) → `learned` vazio → rules > gemini > outros. Nunca pior que hoje.
- **Zero desconhecido** → sem bloco de perguntas, só o resumo. Nunca "me confirma 0 coisas".
- **`pf_category_memory` indisponível** → `try/catch` → `learned` vazio → segue. Fail-safe.
- **`buildInvoicePreview` sem o parâmetro novo** → prévia idêntica à de hoje.

## Testes

- **TDD** em `categorize-invoice.js`: precedência (learned vence rules vence gemini), slug inválido descartado, income não casa, `merchantKey` (os 11 `MP*CONECTCAR` → 1 chave; `SmartShelvePETROPOLISBR` == `SmartShelve`; `AMAZON MARKETP 02/03` sem a parcela), `groupUnknowns` (ordem por valor, teto 3).
- **Fixture real:** os 30 "outros" da Rose (extraídos do banco) viram caso de teste — meta explícita: **ConectCar (10×), Abastec (2×), Prezunic, Cencosud, Rei do Mate, Global Park, CITYFARMA, ULTRAPASSEMENSAL saem de "outros"**.
- **Ordenação:** teste provando que `ConectCar (10×, R$135,05)` vem **antes** de `LUCASDONAS (1×, R$500)` — é a trava contra voltar a ordenar por valor.
- **Zero-regressão:** suíte `finance/` + `invoice-import` verdes antes e depois. Baseline atual: **1780 pass / 5 fail** (as 5 são pré-existentes e fora do financeiro).
- **Smoke real na VPS** + **olho no banco** (lição-mãe: teste verde ≠ fix — conferir `pf_transactions.category` e `pf_category_memory` gravados de verdade).

## Fora de escopo

- Plano de contas contábil da Maria (`5.2.11 Softwares`) — é o Super Folha, outro sistema. Aqui são as 30 categorias pessoais do app.
- Recategorizar o passado (os 30 itens já lançados) — a Rose corrige no app se quiser.
- Categorização do extrato Pluggy e do lançamento avulso — outro caminho, outra fase.
- Promover memória pessoal → lista global do código (curadoria manual, fase futura).
- Botão "Nova conta" tapando o valor do cartão no PWA — bug de UI, outro arquivo, **atacar separado**.

## Rollout (Alf, 17/07)

Validar com **os cartões do Alf** primeiro → depois liberar pra Rose → depois o time.

## Portão de aceite

1. Os 7 merchants da tabela acima saem de "outros" (provado com fixture real).
2. Smoke na VPS com a fatura real + **olho no banco** (categoria gravada, memória gravada).
3. A Rose importa uma fatura e **não** precisa recategorizar na mão o que ela já ensinou.
4. Baseline 1780/5 intacto.
