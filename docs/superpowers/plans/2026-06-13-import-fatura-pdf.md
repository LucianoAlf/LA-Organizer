# Import de Fatura por PDF → Financeiro/Anotações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o usuário manda um PDF de fatura de cartão pelo WhatsApp, o TOM estrutura os lançamentos, mostra um preview e — com 1 confirmação — lança no financeiro (compras no cartão) ou salva como anotação pessoal.

**Architecture:** O Gemini estrutura a fatura em JSON (vê o PDF real). O webhook injeta esse JSON num bloco delimitado `[FATURA_JSON]...[/FATURA_JSON]` no texto da mensagem. O engine intercepta esse bloco **determinístico (pré-LLM, sem depender do Claude)**, resolve o cartão, categoriza, monta o preview e abre um `pending_intent` kind `invoice_import`. No turno seguinte, a resposta do usuário (lançar / anotações / cancelar) é roteada deterministicamente: lança em lote via `insertCardPurchase` ou cria nota via `createNote`. Tudo reusa padrões existentes.

**Tech Stack:** Node.js (CommonJS), Gemini 3.1 Flash Lite (`src/services/gemini.js`), Supabase (`pf_transactions`, `pf_cards`, `pending_intents`, `notes`), engine de markers/intercepts em `src/engine.js`. Testes: `node --test`. Deploy: `scp` + `pm2 restart tom`.

**Referência de padrões (mapeados 13/06):**
- Intercept pré-LLM com short-circuit: padrão `TASK-QUERY-NO-FULL-LIST` (engine.js, logo após o roteador de finanças em `processMessage`).
- Pending-intent: `src/services/pending-intents.js` — `openIntent(cid, kind, payload, questionText)`, `listOpenIntents(cid,{limit})`, `resolveIntent(intentId, resolution, note)`. Lido em `engine.js:7485`.
- Lançamento de cartão: `financeService.insertCardPurchase(cid, card, { category, amount, description, transaction_date, installments, competencia, bill_id })` → array de rows.
- Cartão por nome: `financeService.findCard(cid, cardName)` → array (checar `length === 1`).
- Categoria: `mapCategory(text, type)` em `src/finance/categorize.js` → slug.
- Nota pessoal: `notesService.createNote(supabase, cid, { title, body, source: 'tom', sharedWith: [] })` → `{ ok, note }`.
- Webhook injeta PDF em `src/webhook.js:284`.

---

## File Structure

- **Create** `src/finance/invoice-import.js` — módulo PURO (sem I/O): parse do bloco `[FATURA_JSON]`, validação/normalização dos itens, builder do preview, detecção da resposta do usuário (lançar/anotações/cancelar), checagem de duplicata. Tudo testável offline.
- **Create** `src/finance/invoice-import.test.js` — unit tests (`node --test`).
- **Modify** `src/services/gemini.js` — adicionar `analyzeInvoice(buffer, caption)` (prompt que pede JSON de fatura; fallback `isInvoice:false`).
- **Modify** `src/webhook.js` — no ramo de PDF, tentar `analyzeInvoice`; se for fatura, injetar `[FATURA_JSON]{...}[/FATURA_JSON]\n<resumo legível>`; senão, manter o fluxo atual (`analyzeMedia`).
- **Modify** `src/services/pending-intents.js` — adicionar `invoice_import` ao `VALID_KINDS`.
- **Modify** `src/engine.js` — 2 intercepts pré-LLM em `processMessage`: (A) detecta `[FATURA_JSON]` → resolve cartão + categoriza + preview + abre intent + short-circuit; (B) detecta intent `invoice_import` aberta + resposta → lança lote / cria nota / cancela + short-circuit.
- **Create** `skills/importar-fatura.md` — só documentação de comportamento (o fluxo é determinístico; a skill cobre o caso de o usuário PERGUNTAR sobre o recurso).
- **Modify** `src/prompts/system.js` — gatilho da skill `importar-fatura` (keyword "fatura"/"importar fatura").

---

## Task 1: Módulo puro — `parseInvoiceBlock` + normalização

**Files:**
- Create: `src/finance/invoice-import.js`
- Test: `src/finance/invoice-import.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// src/finance/invoice-import.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseInvoiceBlock } = require('./invoice-import');

test('parseInvoiceBlock extrai o JSON e limpa o texto', () => {
  const raw = '[FATURA_JSON]{"emissor":"Nubank","vencimento":"2026-06-15","total":3643.53,"itens":[{"descricao":"Shopee","valor":136.28,"data":"2026-05-07","parcela_atual":12,"parcela_total":12}]}[/FATURA_JSON]\nResumo legível aqui.';
  const r = parseInvoiceBlock(raw);
  assert.equal(r.found, true);
  assert.equal(r.invoice.emissor, 'Nubank');
  assert.equal(r.invoice.itens.length, 1);
  assert.equal(r.invoice.itens[0].valor, 136.28);
});

test('parseInvoiceBlock retorna found=false sem o bloco', () => {
  assert.equal(parseInvoiceBlock('mensagem comum').found, false);
});

test('parseInvoiceBlock tolera JSON malformado (found=false, malformed=true)', () => {
  const r = parseInvoiceBlock('[FATURA_JSON]{quebrado[/FATURA_JSON]');
  assert.equal(r.found, false);
  assert.equal(r.malformed, true);
});

test('normalizeItems descarta item sem valor e preenche parcela default', () => {
  const { normalizeItems } = require('./invoice-import');
  const items = normalizeItems([
    { descricao: 'A', valor: 10, data: '2026-05-07' },
    { descricao: 'SemValor' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].parcela_total, 1);
  assert.equal(items[0].parcela_atual, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /d/la-organizer/_remote && node --test src/finance/invoice-import.test.js`
Expected: FAIL — `Cannot find module './invoice-import'`.

- [ ] **Step 3: Implementar o mínimo**

```js
// src/finance/invoice-import.js — lógica PURA de import de fatura (sem I/O).
const BLOCK_RE = /\[FATURA_JSON\]\s*([\s\S]*?)\s*\[\/FATURA_JSON\]/i;

function parseInvoiceBlock(text) {
  if (!text || typeof text !== 'string') return { found: false, cleanText: text || '' };
  const m = BLOCK_RE.exec(text);
  if (!m) return { found: false, cleanText: text };
  const cleanText = text.replace(BLOCK_RE, '').trim();
  let json;
  try { json = JSON.parse(m[1].trim()); }
  catch { return { found: false, malformed: true, cleanText }; }
  if (!json || !Array.isArray(json.itens)) return { found: false, malformed: true, cleanText };
  return {
    found: true,
    cleanText,
    invoice: {
      emissor: String(json.emissor || '').trim(),
      vencimento: json.vencimento || null,
      total: Number(json.total) || 0,
      itens: normalizeItems(json.itens),
    },
  };
}

// Mantém só itens com valor numérico > 0; default parcela 1/1; campos string saneados.
function normalizeItems(itens) {
  if (!Array.isArray(itens)) return [];
  return itens
    .map((it) => ({
      descricao: String(it.descricao || it.description || 'Compra').trim(),
      valor: Number(it.valor) || 0,
      data: it.data || it.date || null,
      parcela_atual: Number(it.parcela_atual) || 1,
      parcela_total: Number(it.parcela_total) || 1,
    }))
    .filter((it) => it.valor > 0);
}

module.exports = { parseInvoiceBlock, normalizeItems };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /d/la-organizer/_remote && node --test src/finance/invoice-import.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/finance/invoice-import.js src/finance/invoice-import.test.js
git commit -m "feat(fatura): parseInvoiceBlock + normalizeItems (puro)"
```

---

## Task 2: Módulo puro — `buildInvoicePreview` + `detectInvoiceReply`

**Files:**
- Modify: `src/finance/invoice-import.js`
- Test: `src/finance/invoice-import.test.js`

- [ ] **Step 1: Escrever os testes que falham**

```js
// adicionar em src/finance/invoice-import.test.js
const { buildInvoicePreview, detectInvoiceReply } = require('./invoice-import');

test('buildInvoicePreview lista itens numerados com parcela e categoria', () => {
  const out = buildInvoicePreview({
    emissor: 'Nubank', vencimento: '2026-06-15', total: 270,
    cardName: 'Nubank Rose',
    itens: [
      { descricao: 'Shopee', valor: 136.28, data: '2026-05-07', parcela_atual: 12, parcela_total: 12, categoria: 'compras' },
      { descricao: 'iFood', valor: 50, data: '2026-05-08', parcela_atual: 1, parcela_total: 1, categoria: 'alimentacao' },
    ],
  });
  assert.match(out, /Nubank Rose/);
  assert.match(out, /1\. .*Shopee.*136,28.*12\/12.*compras/);
  assert.match(out, /2\. .*iFood.*50,00.*alimentacao/);
  assert.match(out, /lançar/i); // CTA de confirmação
});

test('detectInvoiceReply roteia lançar / anotações / cancelar', () => {
  assert.equal(detectInvoiceReply('pode lançar'), 'commit_financeiro');
  assert.equal(detectInvoiceReply('lança aí'), 'commit_financeiro');
  assert.equal(detectInvoiceReply('salva nas anotações'), 'commit_anotacoes');
  assert.equal(detectInvoiceReply('só anota'), 'commit_anotacoes');
  assert.equal(detectInvoiceReply('cancela'), 'cancel');
  assert.equal(detectInvoiceReply('deixa pra lá'), 'cancel');
  assert.equal(detectInvoiceReply('e a agenda de amanhã?'), null); // não é resposta ao preview
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /d/la-organizer/_remote && node --test src/finance/invoice-import.test.js`
Expected: FAIL — `buildInvoicePreview is not a function`.

- [ ] **Step 3: Implementar**

```js
// adicionar em src/finance/invoice-import.js (antes do module.exports)
function brl(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Monta a mensagem de preview + CTA. `itens` já vêm categorizados (campo categoria).
// dupWarning: string opcional ("⚠️ ...") inserida antes do CTA.
function buildInvoicePreview({ emissor, vencimento, total, cardName, itens, dupWarning }) {
  const head = `📄 *Fatura ${emissor || ''}*${vencimento ? ` · vence ${vencimento.slice(8, 10)}/${vencimento.slice(5, 7)}` : ''}`;
  const linhas = itens.map((it, i) => {
    const parc = it.parcela_total > 1 ? ` · ${it.parcela_atual}/${it.parcela_total}` : '';
    const dia = it.data ? `${it.data.slice(8, 10)}/${it.data.slice(5, 7)} · ` : '';
    return `${i + 1}. ${dia}${it.descricao} · R$ ${brl(it.valor)}${parc} · ${it.categoria || 'outros'}`;
  });
  const somaItens = itens.reduce((s, it) => s + Number(it.valor), 0);
  const partes = [
    head,
    '',
    linhas.join('\n'),
    '',
    `Total: R$ ${brl(total || somaItens)} · ${itens.length} lançamentos`,
  ];
  if (dupWarning) partes.push('', dupWarning);
  partes.push('', `Lanço essas compras no *${cardName}*? Responde *lançar*, *anotações* (só salvar) ou *cancelar*.`);
  return partes.join('\n');
}

const RE_COMMIT_FIN = /\b(lan[çc]ar?|lan[çc]a|pode lan[çc]ar|manda|confirmo?|confirma|isso|pode ser|sim|ok|beleza)\b/i;
const RE_ANOTAR = /\b(anota[çc][õo]es?|anota|s[óo] salva|salva.*anota|guarda.*anota|nota)\b/i;
const RE_CANCEL = /\b(cancela|cancelar|deixa pra l[áa]|n[ãa]o|esquece|para)\b/i;

// Roteia a resposta do usuário ao preview. Anotações tem prioridade sobre commit
// (ex.: "anota" não deve cair em "manda"); cancelar vence "não". null = não é resposta ao preview.
function detectInvoiceReply(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  if (RE_CANCEL.test(t) && !RE_COMMIT_FIN.test(t)) return 'cancel';
  if (RE_ANOTAR.test(t)) return 'commit_anotacoes';
  if (RE_COMMIT_FIN.test(t)) return 'commit_financeiro';
  return null;
}
```

E trocar o `module.exports` por:
```js
module.exports = { parseInvoiceBlock, normalizeItems, buildInvoicePreview, detectInvoiceReply };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /d/la-organizer/_remote && node --test src/finance/invoice-import.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/finance/invoice-import.js src/finance/invoice-import.test.js
git commit -m "feat(fatura): buildInvoicePreview + detectInvoiceReply (puro)"
```

---

## Task 3: Gemini — `analyzeInvoice` (JSON estruturado)

**Files:**
- Modify: `src/services/gemini.js`

- [ ] **Step 1: Implementar `analyzeInvoice`**

Adicionar após `analyzeMedia` (reusa `uploadFile`/`callGenerateContent` já existentes). Prompt pede JSON; modelo já suporta `maxOutputTokens: 8192` (fix de 13/06).

```js
// Analisa um PDF de fatura e retorna JSON estruturado. Se não for fatura, retorna { ok:true, isInvoice:false }.
async function analyzeInvoice(buffer, caption = '') {
  if (!GEMINI_API_KEY) return { ok: false, reason: 'no_provider' };
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty_buffer' };
  const prompt = [
    'Analise este PDF. Se for uma FATURA DE CARTÃO DE CRÉDITO ou extrato, retorne SOMENTE um JSON válido (sem markdown, sem cercas) no formato:',
    '{"isInvoice":true,"emissor":"<banco/cartão>","vencimento":"YYYY-MM-DD","total":<number>,"itens":[{"descricao":"<loja>","valor":<number>,"data":"YYYY-MM-DD","parcela_atual":<int>,"parcela_total":<int>}]}',
    'Liste TODAS as transações, uma a uma, sem resumir nem omitir, até a última. valor em número (ponto decimal). Compra à vista = parcela_atual:1, parcela_total:1.',
    'Se NÃO for fatura/extrato, retorne {"isInvoice":false}.',
    caption ? `Legenda do usuário: "${caption}".` : '',
  ].join('\n');
  try {
    const mediaPart = { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } };
    const raw = await callGenerateContent(mediaPart, prompt);
    const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const json = JSON.parse(clean);
    if (!json.isInvoice || !Array.isArray(json.itens)) return { ok: true, isInvoice: false };
    return { ok: true, isInvoice: true, invoice: json };
  } catch (err) {
    console.error('[Gemini] analyzeInvoice err:', err.message);
    return { ok: false, reason: 'gemini_error', error: err.message };
  }
}
```

Adicionar `analyzeInvoice` ao `module.exports`.

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check /d/la-organizer/_remote/src/services/gemini.js`
Expected: sem saída (OK).

- [ ] **Step 3: Smoke real na VPS** (reusa o gerador de PDF do smoke existente)

Run: `scp /d/la-organizer/_remote/src/services/gemini.js tom:/opt/LA-Organizer/src/services/gemini.js && ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e \"const g=require('./src/services/gemini'); const fs=require('fs'); (async()=>{const buf=fs.readFileSync('/tmp/fatura45.pdf'); console.log(JSON.stringify((await g.analyzeInvoice(buf)).invoice?.itens?.length))})()\""`
Expected: imprime o número de itens (>30), provando JSON estruturado completo. (Se `/tmp/fatura45.pdf` não existir, rodar antes `scripts/smoke-fatura-pdf.js`.)

- [ ] **Step 4: Commit**

```bash
git add src/services/gemini.js
git commit -m "feat(fatura): gemini.analyzeInvoice (JSON estruturado)"
```

---

## Task 4: Webhook — injetar `[FATURA_JSON]` quando for fatura

**Files:**
- Modify: `src/webhook.js` (ramo de documento/PDF, ~linha 263-287)

- [ ] **Step 1: Alterar o ramo de PDF**

No bloco `else if (whatsapp.isDocumentMessage(body))`, ANTES de chamar `gemini.analyzeMedia`, tentar `analyzeInvoice`. Substituir a montagem do `text`:

```js
// dentro do ramo de documento, depois de ter `buf` e mime==='application/pdf':
const inv = await gemini.analyzeInvoice(buf, caption);
if (inv.ok && inv.isInvoice && inv.invoice.itens.length > 0) {
  const captionLine = caption ? `Legenda enviada pelo usuário: "${caption}"\n` : '';
  // Bloco estruturado (consumido pelo engine, determinístico) + resumo curto legível.
  const resumo = `Fatura ${inv.invoice.emissor || ''} · ${inv.invoice.itens.length} compras · total R$ ${Number(inv.invoice.total||0).toFixed(2)}`;
  text = `[FATURA_JSON]${JSON.stringify(inv.invoice)}[/FATURA_JSON]\n${captionLine}${resumo}`;
} else {
  const r = await gemini.analyzeMedia(buf, mime, caption); // fallback: comportamento atual
  if (r.ok) {
    const captionLine = caption ? `Legenda enviada pelo usuário: "${caption}"\n` : '';
    text = `[O usuário ACABOU DE ENVIAR um PDF agora — primeira vez vendo este arquivo. Conteúdo extraído:]\n${captionLine}${r.text}`;
  } else {
    whatsapp.sendMessage(phone, 'recebi seu documento. Me conta em texto o que precisa que eu faça com ele?').catch(() => {});
    return;
  }
}
```

(Ajustar ao formato exato do bloco atual em `webhook.js:264-287` — preservar o `messageId`/`buf` já obtidos.)

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check /d/la-organizer/_remote/src/webhook.js`
Expected: sem saída (OK).

- [ ] **Step 3: Commit**

```bash
git add src/webhook.js
git commit -m "feat(fatura): webhook injeta [FATURA_JSON] pra fatura de cartão"
```

---

## Task 5: pending-intents — kind `invoice_import`

**Files:**
- Modify: `src/services/pending-intents.js:15`

- [ ] **Step 1: Adicionar o kind**

```js
const VALID_KINDS = new Set(['task_creation','event_creation','approval_pending','confirmation','finance_source','invoice_import']);
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check /d/la-organizer/_remote/src/services/pending-intents.js`
Expected: sem saída (OK).

- [ ] **Step 3: Commit**

```bash
git add src/services/pending-intents.js
git commit -m "feat(fatura): pending-intent kind invoice_import"
```

---

## Task 6: Engine — intercept A (proposta) e B (commit)

**Files:**
- Modify: `src/engine.js` (em `processMessage`, logo após o roteador de finanças / intercept de task-query — seguir o padrão `TASK-QUERY-NO-FULL-LIST`)

**Contexto:** `collab` (remetente) já resolvido; `text` é a mensagem; `_openIntents` já foi carregado em `engine.js:7485`. Imports no topo do engine: `const invoiceImport = require('./finance/invoice-import');`, `const pendingIntents = require('./services/pending-intents');` (já existe), `financeService`, `notesService` (já existem), `safeCategory` (já existe no engine).

- [ ] **Step 1: Intercept A — proposta de fatura (texto tem `[FATURA_JSON]`)**

Inserir antes da chamada ao LLM (mesmo ponto do intercept de task-query). Pseudocódigo concreto:

```js
// === Intercept: import de fatura por PDF (determinístico, pré-LLM) ===
const _invParsed = invoiceImport.parseInvoiceBlock(text);
if (_invParsed.found) {
  const inv = _invParsed.invoice;
  // 1) resolve cartão pelo emissor
  const cards = await financeService.findCard(collab.id, inv.emissor);
  if (!cards || cards.length === 0) {
    await whatsapp.sendMessage(phone, `Achei ${inv.itens.length} compras na fatura, mas não identifiquei o cartão "${inv.emissor}". De qual dos seus cartões é essa fatura?`);
    await pendingIntents.openIntent(collab.id, 'invoice_import',
      { stage: 'awaiting_card', invoice: inv }, 'qual cartão?');
    return; // short-circuit
  }
  const card = cards.length === 1 ? cards[0] : null;
  // 2) categoriza cada item (safeCategory já existe no engine)
  const itensCat = inv.itens.map((it) => ({ ...it, categoria: safeCategory(it.descricao, 'expense') }));
  // 3) checa duplicata (mesmo cartão, competência da fatura, count parecido)
  const dupWarning = await buildInvoiceDupWarning(collab.id, card, itensCat); // helper abaixo
  // 4) preview + abre intent
  const preview = invoiceImport.buildInvoicePreview({
    emissor: inv.emissor, vencimento: inv.vencimento, total: inv.total,
    cardName: card ? card.name : inv.emissor, itens: itensCat, dupWarning,
  });
  await pendingIntents.openIntent(collab.id, 'invoice_import',
    { stage: 'awaiting_confirm', card_id: card ? card.id : null, emissor: inv.emissor,
      vencimento: inv.vencimento, total: inv.total, itens: itensCat }, 'lançar fatura?');
  await whatsapp.sendMessage(phone, preview);
  return; // short-circuit (não chama o LLM)
}
```

Helper de duplicata (adicionar perto dos helpers de finanças no engine):
```js
async function buildInvoiceDupWarning(cid, card, itens) {
  if (!card) return null;
  try {
    // competência aproximada = mês mais comum dos itens; consulta count de pf_transactions no cartão+competência
    const { data } = await supabase.from('pf_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('collaborator_id', cid).eq('card_id', card.id).not('competencia', 'is', null);
    // heurística leve: se já houver lançamentos no cartão, avisa
    return null; // v1: aviso textual genérico opcional; manter simples (YAGNI)
  } catch { return null; }
}
```
(v1: `buildInvoiceDupWarning` pode retornar `null` — o preview + confirmação já é a rede. Deixar o helper plugado pra evolução.)

- [ ] **Step 2: Intercept B — resposta ao preview (intent `invoice_import` aberta)**

Inserir logo após o intercept A:

```js
// === Intercept: resposta ao preview de fatura ===
const _invIntent = (_openIntents || []).find((i) => i.kind === 'invoice_import' && i.payload && i.payload.stage === 'awaiting_confirm');
if (_invIntent) {
  const decision = invoiceImport.detectInvoiceReply(text);
  if (decision) {
    const pay = _invIntent.payload;
    if (decision === 'cancel') {
      await pendingIntents.resolveIntent(_invIntent.id, 'denied', 'user cancelou');
      await whatsapp.sendMessage(phone, 'Beleza, cancelei — não lancei nada. 👍');
      return;
    }
    if (decision === 'commit_anotacoes') {
      const body = invoiceImport.buildInvoicePreview({ ...pay, cardName: pay.emissor }); // reusa formatação
      await notesService.createNote(supabase, collab.id, { title: `Fatura ${pay.emissor} ${pay.vencimento || ''}`.trim(), body, source: 'tom', sharedWith: [] });
      await pendingIntents.resolveIntent(_invIntent.id, 'confirmed', 'salvou em anotações');
      await whatsapp.sendMessage(phone, `📝 Salvei a fatura nas suas anotações (${pay.itens.length} compras). Não lancei no financeiro.`);
      return;
    }
    if (decision === 'commit_financeiro') {
      if (!pay.card_id) { await whatsapp.sendMessage(phone, 'Antes preciso saber o cartão. De qual cartão é essa fatura?'); return; }
      const cards = await financeService.findCard(collab.id, pay.emissor);
      const card = (cards || []).find((c) => c.id === pay.card_id) || (cards || [])[0];
      let okN = 0;
      for (const it of pay.itens) {
        try {
          await financeService.insertCardPurchase(collab.id, card, {
            category: it.categoria, amount: it.valor, description: it.descricao,
            transaction_date: it.data || pay.vencimento || undefined,
            installments: it.parcela_total > 1 ? it.parcela_total : 1,
          });
          okN++;
        } catch (e) { console.error('[Fatura] item falhou:', it.descricao, e.message); }
      }
      await pendingIntents.resolveIntent(_invIntent.id, 'confirmed', `lançou ${okN} itens`);
      await whatsapp.sendMessage(phone, `✅ Lancei ${okN} de ${pay.itens.length} compras no *${card.name}*. Confere na tela de Cartões!`);
      return;
    }
  }
  // se não detectou intenção clara, deixa o LLM responder normalmente (não short-circuita)
}
```

> ⚠️ **Atenção parcelas:** `insertCardPurchase` com `installments = parcela_total` cria N parcelas a partir da data. Numa fatura, o item já é UMA parcela específica (ex.: 12/12). Em v1, lançar como `installments: 1` (a compra daquela fatura) é mais fiel — **decisão de implementação: usar `installments: 1` sempre** e registrar `parcela_atual/total` na descrição (ex.: `"Shopee (12/12)"`). Ajustar o loop:
```js
description: it.parcela_total > 1 ? `${it.descricao} (${it.parcela_atual}/${it.parcela_total})` : it.descricao,
installments: 1,
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check /d/la-organizer/_remote/src/engine.js`
Expected: sem saída (OK).

- [ ] **Step 4: Commit**

```bash
git add src/engine.js
git commit -m "feat(fatura): engine intercepts proposta + commit (lança lote / nota)"
```

---

## Task 7: Skill + gatilho + deploy + smoke E2E

**Files:**
- Create: `skills/importar-fatura.md`
- Modify: `src/prompts/system.js` (gatilho da skill)

- [ ] **Step 1: Criar a skill (documentação de comportamento)**

```markdown
# Skill: Importar Fatura (PDF)

Quando o usuário ENVIA um PDF de fatura de cartão, o sistema já estrutura e mostra um preview automaticamente — você NÃO precisa fazer nada nesse turno (o engine intercepta).

Se o usuário PERGUNTAR sobre o recurso ("você lê fatura?", "como mando minha fatura?"):
- Confirme: "Pode me mandar o PDF da fatura aqui. Eu listo as compras e te pergunto se quer lançar no financeiro ou só salvar nas anotações."
- NUNCA peça screenshot nem diga que não consegue (você lê PDF — ver IDENTIDADE).
```

- [ ] **Step 2: Gatilho no system.js** (seguir o padrão dos outros `if (keyword) systemPrompt += loadSkill(...)`)

```js
// perto dos outros gatilhos de skill
if (/\b(importar?\s+fatura|ler\s+fatura|mandar?\s+(a\s+)?fatura|fatura\s+do\s+cart[ãa]o)\b/i.test(lastUserMessage)) {
  systemPrompt += '\n\n---\n\n' + loadSkill('importar-fatura');
}
```

- [ ] **Step 3: Verificar sintaxe + deploy**

```bash
node --check /d/la-organizer/_remote/src/engine.js && node --check /d/la-organizer/_remote/src/webhook.js && node --check /d/la-organizer/_remote/src/services/gemini.js
scp /d/la-organizer/_remote/src/finance/invoice-import.js tom:/opt/LA-Organizer/src/finance/invoice-import.js
scp /d/la-organizer/_remote/src/services/gemini.js tom:/opt/LA-Organizer/src/services/gemini.js
scp /d/la-organizer/_remote/src/services/pending-intents.js tom:/opt/LA-Organizer/src/services/pending-intents.js
scp /d/la-organizer/_remote/src/webhook.js tom:/opt/LA-Organizer/src/webhook.js
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp /d/la-organizer/_remote/skills/importar-fatura.md tom:/opt/LA-Organizer/skills/importar-fatura.md
scp /d/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
ssh tom "pm2 restart tom && pm2 logs tom --lines 5 --nostream"
```
Expected: boot limpo (sem erro de require).

- [ ] **Step 4: Smoke E2E (PDF real)**

Pedir pra um usuário de teste (ou a Rose) enviar uma fatura real pelo WhatsApp. Acompanhar `ssh tom "pm2 logs tom --lines 40 --nostream"`. Conferir no banco:
```sql
SELECT count(*) FROM pf_transactions WHERE collaborator_id='<cid>' AND card_id='<card>' AND created_at > now() - interval '5 min';
```
Expected: o nº de itens lançados bate com a fatura; a fatura aparece na tela de Cartões.

- [ ] **Step 5: Registrar known issue + commit final**

```sql
INSERT INTO tom_known_issues (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao, colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
VALUES ('FIN-INVOICE-IMPORT','Import de fatura PDF -> financeiro/anotacoes','financeiro','baixo','corrigido','feature nova','PDF fatura -> gemini.analyzeInvoice JSON -> webhook [FATURA_JSON] -> engine intercept (cartao+categoria+preview+pending) -> commit lote insertCardPurchase OU nota createNote','manual','usuario manda PDF de fatura e quer lancar de uma vez', ARRAY['Rose'], now(), now(), 1, now());
```
```bash
git add -A && git commit -m "feat(fatura): skill importar-fatura + gatilho + deploy"
```

---

## Self-Review (preenchido pelo autor do plano)

- **Spec coverage:** destino pergunta-na-hora (Task 6B: lançar/anotações/cancelar ✓); preview+1 OK (Task 2 buildInvoicePreview + Task 6B ✓); anotação pessoal simples (Task 6B createNote ✓); Gemini→JSON (Task 3 ✓); reusa findCard/categorize/insertCardPurchase/createNote/pending-intent ✓; casos de borda: cartão não identificado (Task 6A awaiting_card ✓), não-é-fatura (Task 4 fallback ✓), JSON malformado (Task 1 ✓), desistência (Task 6B cancel ✓).
- **Gaps conhecidos (decisão consciente):** dedup avançado fica como helper plugado retornando `null` (v1 — o preview é a rede); item-a-item fora de escopo; "awaiting_card" abre intent mas a resolução do cartão escolhido no turno seguinte precisa de um 3º ramo de intercept (adicionar se o teste E2E mostrar necessidade — a maioria dos cartões casa pelo emissor).
- **Type consistency:** `invoice.itens[].{descricao,valor,data,parcela_atual,parcela_total}` consistente entre parse → categoriza (+categoria) → preview → insertCardPurchase. `findCard` retorna array (checado). `createNote(supabase, cid, {title,body,source,sharedWith})` conforme mapeado.
