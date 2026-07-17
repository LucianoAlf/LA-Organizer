# Boleto / conta a pagar no TOM — detecta, guarda o código, lembra no dia

**Data:** 2026-07-17
**Origem:** Alf 17/07 mandou um boleto e o TOM "alucinou" (tratou como fatura de cartão). Padrão-ouro: a **Maria** (agente financeira do LA HQ).
**Escopo:** PDF de boleto bancário/arrecadação → conta a pagar (`pf_bills`) com código de barras + lembrete no vencimento. Não toca no fluxo de fatura de cartão.

---

## O problema (raiz identificada no código, não suposta)

Alf mandou um boleto (HDI Seguros, R$ 995,93, seguro do carro BYD da Anne) e pediu: *"me lembra de pagar na data de vencimento, coleta o código de barras e já deixa salvo na descrição, e no dia me envia com o código de barras"*.

O TOM respondeu: *"📄 Li 1 compras da fatura **HDI SEGUROS S.A.** (total R$ 995,93) — mas não sei de qual cartão ela é"*. Alf: *"não é de cartão nenhum, pago pela conta do Nubank"*. TOM cancelou.

**Raiz (`src/webhook.js:19-35`, `pdfToText`):** TODO PDF passa primeiro por `gemini.analyzeInvoice`, que só pergunta *"isto é fatura de cartão?"*. O boleto tem 1 valor + emissor + data → o Gemini devolveu `isInvoice:true, itens:[1]` → virou uma "fatura de cartão de 1 item" → caiu no Intercept A (que pergunta o cartão). **Não é o LLM inventando — é o roteador tratando boleto e fatura de cartão como o mesmo documento.** São diferentes: fatura = N compras já feitas, paga o cartão; boleto = 1 conta a pagar, com **linha digitável**, paga por conta bancária.

## Goal

Mandar um boleto e o TOM: (1) reconhece que é boleto — nunca mais pergunta "qual cartão"; (2) extrai valor, vencimento, beneficiário e a **linha digitável**; (3) cria uma conta a pagar; (4) no vencimento, manda o lembrete **com o código pra copiar**. Critério: o repro do Alf de 17/07 vira uma conta a pagar criada, com lembrete agendado — sem cair no fluxo de cartão.

## Decisões (Alf, 17/07)

1. **Vira** uma conta a pagar em `pf_bills` (reaproveita lembrete + relatório), com o código de barras salvo.
2. **Entrega** a linha digitável **em texto** (copia/cola no banco) — não reenvia PDF.
3. **"Paguei"** → marca paga **E debita o saldo da conta** (baixa estilo Maria; nunca paga de verdade).
4. **Recorrência** → o TOM **pergunta** "só esse mês ou repete?"; único = `recurrence:'once'`, recorrente = conta fixa mensal.

## Princípio central

**O determinístico reconhece e valida; o LLM só lê.** O Gemini extrai os campos do PDF, mas a decisão "isto é boleto" e a confiança na linha digitável são **determinísticas**: estrutura do documento + dígito verificador. Um dígito errado na linha digitável = pagamento errado; por isso o número extraído é **validado pelo módulo 10/11 embutido** antes de ser prometido. Falhou a validação → o TOM avisa e não chuta.

## Componentes

### 1. `src/finance/boleto-parse.js` (NOVO, puro, sem I/O)

```
looksLikeBoleto(text) -> boolean
```
- `true` quando o texto extraído do PDF tem a assinatura de boleto: uma sequência de ~47-48 dígitos (com pontos/espaços) **E** vocabulário de boleto (`beneficiári|cedente|nosso número|linha digitável|pagador|vencimento` + `código de barras`). Distingue de fatura de cartão (que tem `fatura|limite|compras|cartão final`).

```
extractLinhaDigitavel(text) -> string | null   // só dígitos, 47 ou 48
```
- Varre o texto por candidatos (47/48 dígitos após remover pontos/espaços) e devolve o primeiro.

```
validateLinhaDigitavel(digits) -> { valid: boolean, tipo: 'bancario'|'arrecadacao'|null }
```
- **A trava de segurança.** Boleto bancário (47 dígitos) usa módulo 10 nos campos 1-3 + módulo 11 no dígito geral; arrecadação/concessionária (48 dígitos) usa módulo 10 ou 11 conforme o 3º dígito. Implementa os dois. `valid:false` → o TOM não promete o código.

```
formatLinhaDigitavel(digits) -> string   // com a pontuação padrão pra ler/copiar
```

### 2. Migration: campo do código em `pf_bills`

```sql
alter table pf_bills add column if not exists barcode text;
```
- `pf_bills` hoje **não tem** onde guardar o código (colunas: name, amount, due_day, category, type, status, remind_days_before, last_paid_at, is_active, recurrence, due_date). Uma coluna `barcode` (a linha digitável só-dígitos). Sem RLS nova (herda a policy da tabela).

### 3. `src/services/gemini.js` — schema de boleto

Novo prompt/função `analyzeBoleto(buffer, caption)` (ou estende `analyzeMedia`) que retorna:
```
{ isBoleto:true, beneficiario:"<nome>", valor:<number>, vencimento:"YYYY-MM-DD", linha_digitavel:"<dígitos>", descricao:"<o que é>" }
```
- Reaproveita `callGenerateContent` com o PDF. Instrução: extrair a linha digitável **exatamente como impressa**; na dúvida de um dígito, devolver o campo vazio (o validador pega o resto).

### 4. `src/webhook.js` — rotear boleto ANTES de fatura

Em `pdfToText`, **antes** do `analyzeInvoice`: se `analyzeMedia` (texto cru do PDF) casar `looksLikeBoleto`, chama `analyzeBoleto` e injeta `[BOLETO_JSON]{...}[/BOLETO_JSON]` em vez de `[FATURA_JSON]`. Só cai no caminho de fatura se **não** for boleto. Fail-safe: se `analyzeBoleto` falhar, cai no comportamento de hoje (texto cru pro LLM), nunca no fluxo de cartão errado.

### 5. `src/engine.js` — Intercept Boleto (novo, antes do Intercept A de fatura)

- Detecta `[BOLETO_JSON]` → valida a linha digitável (`validateLinhaDigitavel`) → monta a prévia → abre intent `bill_from_boleto` (stage `awaiting_confirm`), payload com `{ beneficiario, valor, vencimento, barcode, barcode_ok, descricao }`.
- **Resposta:** "só esse mês" / "repete" define `recurrence`; "de qual conta" grava a conta de pagamento. Confirmação → `createBill(collab.id, { name, amount, recurrence, due_date, category, barcode, ... })`.
- Reusa a intent + o padrão de prévia/confirmação já provados no fluxo de fatura ([[project_msg_promete_previa_mas_commita]]: a prévia é confirmada, não commita antes de ver).

### 6. Lembrete no vencimento — `bill-due.js` já cobre

`isBillDue` **já lembra conta única** (`recurrence:'once'` + `due_date <= horizonte`, inclui atrasada) e recorrente. Só o **builder da mensagem** (`ritual-messages.js`) ganha: quando a conta tem `barcode`, o lembrete inclui a linha digitável formatada. Zero mudança na lógica de quando lembrar.

### 7. Pagamento — reusa o fluxo de "pagar conta" existente

"Paguei a HDI" → o fluxo atual de pagar conta marca `last_paid_at` + debita o saldo da conta. Nada novo (Decisão 3 já é o comportamento do pay-bill de hoje; confirmar no plano).

## Fluxo de dados

```
PDF chega → webhook: analyzeMedia (texto cru)
   → looksLikeBoleto? SIM → analyzeBoleto → [BOLETO_JSON]
                       NÃO → segue pro analyzeInvoice (fatura) como hoje
   → engine Intercept Boleto: valida linha digitável → PRÉVIA (com ✅/⚠️ do código)
   → "repete todo mês, pago do Nubank" → createBill(recurrence, due_date, barcode)
   → bill-due.js (ritual de vencimento) → no dia: lembrete + linha digitável
   → "paguei" → marca paga + debita conta
```

## O texto (validado pelo Alf, 17/07)

```
🧾 Li um *boleto*, Luciano:
• *HDI Seguros* — R$ 995,93
• Vence *25/07*
• Código de barras: ✅ conferido

É só esse mês ou *repete todo mês*? E de qual conta você paga?

Respondendo, eu crio a conta a pagar e te lembro no dia com o código pra copiar. 👍
```
Quando o validador reprova: troca a linha do código por `⚠️ não consegui ler o código com certeza — confere no boleto`. Mantém a voz do TOM ([[feedback_tom_comportamento_sagrado]]): mesma pegada da prévia de fatura.

No dia do vencimento:
```
🧾 *Hoje vence:* HDI Seguros — R$ 995,93

Linha digitável (copia e cola no banco):
`23793.38128 60007.827136 95000.063305 8 10310000099593`
```

## Bordas (zero-regressão)

- **PDF que É fatura de cartão** → `looksLikeBoleto` false → segue pro `analyzeInvoice` como hoje. O fluxo de cartão fica **intacto** (é a regressão a evitar).
- **Boleto sem linha digitável legível** → `barcode_ok:false` → cria a conta mesmo assim (valor+vencimento valem), mas o lembrete diz "confere o código no boleto" em vez de dar número errado.
- **`analyzeBoleto` falha/timeout** → cai no texto cru pro LLM (comportamento de hoje). A leitura nunca quebra por causa do boleto.
- **Gemini erra 1 dígito** → `validateLinhaDigitavel` reprova (dígito verificador não bate) → não promete o código. É a razão de existir a validação.
- **Documento ambíguo (nota fiscal, recibo)** → não casa `looksLikeBoleto` (sem linha digitável) → texto cru pro LLM, como hoje.

## Testes

- **TDD** em `boleto-parse.js`: `looksLikeBoleto` (boleto vs fatura vs recibo), `extractLinhaDigitavel` (47 e 48 dígitos, com/sem pontuação), `validateLinhaDigitavel` (dígito verificador correto passa; 1 dígito trocado reprova — **o caso que protege o pagamento**), `formatLinhaDigitavel`.
- **Fixture real:** a linha digitável do boleto HDI do Alf (extraída do PDF) vira caso de teste — valida de verdade.
- **Zero-regressão:** o fluxo de fatura de cartão continua passando (um PDF de fatura NÃO vira boleto). Suíte `finance/` verde antes e depois.
- **Smoke real na VPS** com o boleto do Alf + **olho no banco** (`pf_bills` criada com `barcode`, `recurrence`, `due_date` corretos).

## Fora de escopo

- **Pagar de verdade** — o TOM nunca move dinheiro (regra dura de segurança).
- **Parcelamento auto-agendado** ("3/12" cria as 12 futuras) — agora, recorrente vira conta fixa mensal simples; o auto-agendamento de N parcelas fica pra fase futura.
- **Boleto no grupo / pra outra pessoa** — primeiro o fluxo 1:1 do Alf; grupo depois.
- **Reenviar o PDF** — entrega é a linha digitável em texto (Decisão 2).

## Rollout (Alf, 17/07)

Validar com o **Alf** (o boleto real da HDI) → depois liberar pra **Rose** testar → depois o time.

## Portão de aceite

1. O repro do Alf (boleto HDI) **não cai mais no fluxo de cartão** — vira conta a pagar.
2. A linha digitável é **validada** (dígito verificador) antes de ser prometida; boleto ilegível não gera número errado.
3. Smoke na VPS + **olho no banco** (`pf_bills` com `barcode`/`recurrence`/`due_date`).
4. Fluxo de fatura de cartão **intacto** (suíte verde, um PDF de fatura não vira boleto).
