# Fase E — Categorização inteligente + Financial Health Score

**Data:** 2026-06-14 · **Autor:** TOM/Claude (sessão Alf) · **Status:** aprovado pelo Alf, em implementação

Última fatia do roadmap proativo financeiro (A import ✅ · B estorno ✅ · C proativo ✅ · **E aqui** · D Pluggy depende de credenciais do Alf). Duas entregas independentes, mesmo deploy.

---

## Parte 1 — Categorização por merchant BR

### Problema
A categorização hoje (`mapCategory` em `categories.data.js`, via `safeCategory` no engine) casa por **keyword genérica** (ifood, uber, posto…). Funciona pra texto que o usuário digita. Mas no **import de fatura/extrato** os merchants vêm "sujos": `MERCPAGO*DROGARIARAIA`, `PAG*IPIRANGA`, `AMAZON BR`, `MERCADOLIVRE*123`, `MAGALU SAO PAULO`. Nenhuma keyword casa → cai em **`outros`**. Isso enfraquece o relatório e o proativo.

### Solução — `src/finance/merchant-category.js` (puro)
- **`stripAcquirer(desc)`** — remove prefixos de adquirente/gateway antes do match: `PAG*`, `MP*`, `MERCPAGO*`, `MERC PAGO`, `PICPAY*`, `EBANX*`, `IFD*`, `PAGSEGURO*`, `CIELO*`, `STONE*`, `REDE*`, e o `*` separador. Também tira acento (NFD) e baixa o caso.
- **`MERCHANT_RULES`** — array ordenado de `{ re: RegExp, slug }` de **nomes próprios BR inequívocos** que as keywords genéricas não pegam. Categorias-alvo são slugs JÁ existentes em `categories.data.js`:
  - **mercado**: carrefour, pao de acucar, paodeacucar, assai, atacadao (já), big, extra, dia supermercado, sams club, makro, hortifruti (já), st marche
  - **farmacia**: drogasil, droga raia, drogaraia, raia, pacheco, pague menos, ultrafarma, panvel, venancio, drogaria sao paulo, dsp
  - **combustivel**: ipiranga, petrobras, br mania, posto br, ale combustiveis, shell (já)
  - **compras** (e-commerce): amazon, mercadolivre, mercado livre, magalu, magazine luiza, americanas, shopee, aliexpress, casas bahia, ponto frio, netshoes, shein
  - **assinaturas**: youtube premium, deezer, paramount, globoplay, hbo max, max stream, apple.com/bill, applecombill, google one, canva, chatgpt, openai, anthropic, claude.ai, amazon prime, prime video
  - **transporte**: cabify, indriver, in driver, blablacar (uber/99 já)
  - **alimentacao** (delivery): zedelivery, ze delivery, daki, james delivery (ifood/rappi já)
  - **restaurante** (redes): mcdonalds, mc donalds, burger king, "bk ", subway, outback, habibs, bobs, starbucks, kfc, giraffas, spoleto, china in box, divino fogao
- **`categorizeMerchant(desc, type)`** → `slug | null`. Só atua quando `type === 'expense'` ou sem type (merchant é despesa). Aplica `stripAcquirer`, testa as regras na ordem, devolve o 1º slug que casar; senão `null`.

Regra de ouro: **só nomes próprios FORTES** (drogasil é inequívoco; "prime" sozinho é ambíguo → fica na keyword `assinaturas`, fora daqui). Ambíguos não entram pra não errar.

### Integração — `categorize.js`
`mapCategory(text, type)` ganha **uma passada de alta precisão no topo**:
1. `categorizeMerchant(text, type)` → se casar, retorna (nome próprio é o sinal mais forte)
2. keywords específicas (atual)
3. keywords genéricas (atual)
4. fallback por tipo (atual)

Plugar no `mapCategory` cobre **import e registro manual** de uma vez (o `safeCategory` do engine já chama `mapCategory` quando o slug não é válido — sempre, no import, porque a descrição não é slug). Zero mudança nas assinaturas. `categorize.test.js` deve permanecer verde + casos novos de fatura suja.

---

## Parte 2 — Financial Health Score (0–100)

### Objetivo
Âncora mensal de saúde financeira, **com a maior alavanca** (a pesquisa avisou: número solto é fraco; vem com o fator que mais puxa pra baixo). Entregue no ritual mensal que já existe (`checkFinanceMonthly`, dia 10, 18h).

### `src/finance/health-score.js` (puro)
`computeHealthScore({ receitas, despesas, credit, goals })` →
```
{ score: 0..100, band: '🟢'|'🟡'|'🔴', factors: [{key,label,score,weight,applicable}], topLever: {label, hint} | null }
```

**3 fatores**, cada um com sub-score 0–100 e "aplicável só com dado" (peso renormalizado pelos aplicáveis — quem não tem cartão não é punido):

| Fator | Peso | Aplicável quando | Sub-score |
|---|---|---|---|
| **Poupança** (taxa do mês) | 45% | `receitas > 0` | `rate = (receitas-despesas)/receitas`. ≥0,20 → 100; 0 → 50; ≤-0,20 → 0 (linear, clamp 0..100). |
| **Uso de crédito** | 30% | `credit.limit > 0` | `u = used/limit`. ≤0,30 → 100; 0,30..0,90 linear até 10; ≥1,0 → 0. |
| **Reserva/Metas** | 25% | sempre | sem meta ativa → 40 (oportunidade, não pune a zero). com meta: média do progresso `current/target` clamp, mas piso 50 se houver aporte/saldo>0. |

- `score = round(Σ(subᵢ·pesoᵢ) / Σpesoᵢ)` só dos aplicáveis. Sem nenhum aplicável → `score=null` (ritual omite a seção).
- `band`: ≥75 🟢, 50–74 🟡, <50 🔴.
- `topLever`: fator aplicável que maximiza `(100 - sub) · peso` (maior distância ponderada de 100) + `hint` curto ("a fatura do cartão tá puxando", "tá sobrando pouco no fim do mês", "bora começar uma reserva"). `null` se score ≥ 90.

### Dados — `creditUtilization(cid)` no `financeiro-service.js`
Agrega `cardUsage` de todos os cartões ativos → `{ used, limit, pct }`. Reusa `listCards` + `cardUsage`. Se sem cartão → `{used:0, limit:0, pct:0}` (fator vira não-aplicável).

### Mensagem — `ritual-messages.js`
`buildHealthScoreLine(hs)` → bloco anexado ao `buildMonthlyFinance`:
```
🩺 *Saúde financeira: 72/100* 🟡
Maior alavanca: a fatura do cartão tá puxando — tá em 85% do limite.
```
`hs.score === null` → string vazia (não anexa). `checkFinanceMonthly` computa `credit = creditUtilization(c.id)` + `hs = computeHealthScore({...rep, credit, goals})` e passa ao builder.

---

## Fora de escopo (YAGNI)
- ML/embeddings de categorização — lookup determinístico cobre o gap; LLM custaria e a memória veta Haiku.
- Orçamento por categoria no score — 3 fatores sólidos bastam; budget fica pra depois.
- Persistir histórico do score — recalcula no ritual; sem tabela nova.

## Testes
- `merchant-category.test.js`: stripAcquirer; cada categoria-alvo casa; ambíguo não casa; income não categoriza.
- `categorize.test.js`: mantém verdes + fatura suja → categoria certa.
- `health-score.test.js`: poupança alta/negativa; crédito estourado vira topLever; sem cartão renormaliza; sem meta = 40; score null sem dado; bands.
- `ritual-messages.test.js`: linha formatada; score null → vazio.

## Deploy
scp dos arquivos novos/alterados + `pm2 restart tom`. Smoke: suíte finance completa verde + `computeHealthScore` com dados reais do Alf. Registrar `FIN-CATEGORIZACAO-HEALTH-FASE-E`.
