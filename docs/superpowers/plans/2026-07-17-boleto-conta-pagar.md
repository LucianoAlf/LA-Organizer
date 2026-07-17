# Boleto / Conta a Pagar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mandar um boleto PDF e o TOM reconhece que é boleto (não fatura de cartão), valida o código de barras pelo dígito verificador, cria uma conta a pagar em `pf_bills` e lembra no vencimento com a linha digitável pra copiar.

**Architecture:** Um módulo puro (`boleto-parse.js`) detecta+valida o boleto; o webhook roteia boleto ANTES de fatura; o engine abre uma intent `bill_from_boleto` que confirma e chama `createBill` (já existente). Lembrete e pagamento reusam `bill-due.js` e `payBill`, que já existem.

**Tech Stack:** Node (CommonJS), `node:test`, Supabase (MCP pra migration), Gemini (leitura do PDF). Deploy: scp cirúrgico + `pm2 restart tom`.

## Global Constraints

- **PT-BR** em toda mensagem de usuário.
- **O TOM nunca move dinheiro** — só registra. Regra dura de segurança.
- **Voz do TOM é sagrada** — a prévia do boleto segue a pegada da prévia de fatura; não inflar.
- **Zero-regressão no fluxo de fatura de cartão** — um PDF de fatura NUNCA pode virar boleto. É a regressão a evitar.
- **A linha digitável só é prometida se o dígito verificador bater** — um dígito errado = pagamento errado.
- **`_remote/` é compartilhado com outro chat** — deploy cirúrgico só dos meus arquivos; `scp` de `engine.js` é bloqueado pelo classificador (pedir OK ao Alf); cuidado com auto-deploy do outro chat empacotar meu código.
- **Fixture real** (linha digitável do boleto HDI do Alf, boleto Santander): `03399.74503 10900.009274 72059.001015 6 15130000099593` → só-dígitos `03399745031090000927472059001015615130000099593` (47 dígitos). Valor R$ 995,93, venc. 20/07/2026.
- **Baseline de teste:** rodar `node --test src/**/*.test.js` na VPS antes e depois; as falhas pré-existentes hoje são `system-loadout`, `group-chat-tasks`, `pending-intents-detect` (fora do financeiro). Nenhuma nova é aceitável.

---

### Task 1: `boleto-parse.js` — detector + validador puro (a trava de segurança)

**Files:**
- Create: `_remote/src/finance/boleto-parse.js`
- Test: `_remote/src/finance/boleto-parse.test.js`

**Interfaces:**
- Produces:
  - `looksLikeBoleto(text: string) -> boolean`
  - `extractLinhaDigitavel(text: string) -> string | null` (só-dígitos, 47 ou 48)
  - `validateLinhaDigitavel(digits: string) -> { valid: boolean, tipo: 'bancario'|'arrecadacao'|null }`
  - `formatLinhaDigitavel(digits: string) -> string`
  - `parseBoletoValor(digits: string) -> number | null` (extrai o valor em R$ do código, pra cruzar com o que o Gemini leu)

- [ ] **Step 1: Escrever os testes falhando** (`boleto-parse.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  looksLikeBoleto, extractLinhaDigitavel, validateLinhaDigitavel,
  formatLinhaDigitavel, parseBoletoValor,
} = require('./boleto-parse');

// Fixture REAL: boleto HDI (Santander) do Alf, 17/07. 47 dígitos.
const HDI = '03399745031090000927472059001015615130000099593';
const HDI_FMT = '03399.74503 10900.009274 72059.001015 6 15130000099593';

const BOLETO_TXT = `HDI SEGUROS S.A.
Beneficiário: HDI SEGUROS S.A.
Pagador: ANNE SUSAN CORDEIRO TEIXEIRA
Vencimento: 20/07/2026   Valor do Documento: R$ 995,93
Linha digitável: ${HDI_FMT}
Nosso número: 72059.001015`;

const FATURA_TXT = `Fatura Nubank
Vencimento da fatura 10/07/2026
Limite disponível R$ 3.000
Compras: 12 · total R$ 640,88
Cartão final 4520`;

test('looksLikeBoleto: TRUE no boleto real (linha digitável + vocabulário)', () => {
  assert.strictEqual(looksLikeBoleto(BOLETO_TXT), true);
});

test('looksLikeBoleto: FALSE numa fatura de cartão (regressão a evitar)', () => {
  assert.strictEqual(looksLikeBoleto(FATURA_TXT), false);
});

test('looksLikeBoleto: FALSE em texto sem linha digitável (recibo genérico)', () => {
  assert.strictEqual(looksLikeBoleto('Recibo de pagamento no valor de R$ 50,00'), false);
});

test('extractLinhaDigitavel: extrai os 47 dígitos do texto formatado', () => {
  assert.strictEqual(extractLinhaDigitavel(BOLETO_TXT), HDI);
});

test('extractLinhaDigitavel: null quando não há linha digitável', () => {
  assert.strictEqual(extractLinhaDigitavel(FATURA_TXT), null);
});

test('validateLinhaDigitavel: o boleto REAL passa (DV bate)', () => {
  const r = validateLinhaDigitavel(HDI);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.tipo, 'bancario');
});

test('SEGURANÇA: 1 dígito trocado REPROVA (protege o pagamento)', () => {
  // troca o 20º dígito
  const adulterado = HDI.slice(0, 19) + (HDI[19] === '9' ? '8' : '9') + HDI.slice(20);
  assert.strictEqual(validateLinhaDigitavel(adulterado).valid, false);
});

test('validateLinhaDigitavel: comprimento errado (46) reprova', () => {
  assert.strictEqual(validateLinhaDigitavel(HDI.slice(0, 46)).valid, false);
});

test('parseBoletoValor: lê R$ 995,93 do campo de valor', () => {
  assert.strictEqual(parseBoletoValor(HDI), 995.93);
});

test('formatLinhaDigitavel: devolve a pontuação padrão pra copiar', () => {
  assert.strictEqual(formatLinhaDigitavel(HDI), HDI_FMT);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote && node --test src/finance/boleto-parse.test.js`
Expected: FAIL — `Cannot find module './boleto-parse'`.

- [ ] **Step 3: Implementar o módulo** (`boleto-parse.js`)

```js
'use strict';
// Detecta e VALIDA boleto bancário/arrecadação. Bug Alf 17/07: boleto caía no fluxo de
// fatura de cartão (webhook chamava analyzeInvoice em todo PDF). Aqui o determinístico
// decide "é boleto" e confia na linha digitável SÓ se o dígito verificador bater — um
// dígito errado lido pelo Gemini = pagamento errado.

const RE_VOCAB = /benefici[áa]ri|cedente|nosso\s*n[úu]mero|linha\s*digit[áa]vel|pagador|c[óo]digo\s*de\s*barras|sacado/i;
const RE_FATURA = /\bfatura\b|limite\s*(dispon[íi]vel|de\s*cr[ée]dito)|cart[ãa]o\s*final|melhor\s*dia|fatura\s*fechada/i;

// candidato a linha digitável: 47 ou 48 dígitos após remover ./espaço, mas SÓ dentro de
// uma sequência que no texto original tem a cara de linha (dígitos + . + espaços).
function _digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

function extractLinhaDigitavel(text) {
  const t = String(text || '');
  // procura blocos "ddddd.ddddd ddddd.dddddd ddddd.dddddd d dddddddddddddd" (com tolerância)
  const m = t.match(/(\d[\d.\s]{44,60}\d)/g);
  if (!m) return null;
  for (const cand of m) {
    const d = _digitsOnly(cand);
    if (d.length === 47 || d.length === 48) return d;
  }
  return null;
}

function looksLikeBoleto(text) {
  const t = String(text || '');
  if (RE_FATURA.test(t) && !RE_VOCAB.test(t)) return false; // é fatura de cartão
  const temLinha = extractLinhaDigitavel(t) !== null;
  return temLinha && RE_VOCAB.test(t);
}

// --- dígitos verificadores ---
function _mod10(num) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = Number(num[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

function _mod11Barcode(num) {
  // DV geral do código de barras bancário, peso 2..9 cíclico. dv 0/10/11 → 1 (regra FEBRABAN).
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return (dv === 0 || dv > 9) ? 1 : dv;
}

function _validateBancario(d) {
  // 47 dígitos. 3 campos com DV mod10 + DV geral mod11. VALIDADO contra a linha real HDI
  // (03399745031090000927472059001015615130000099593): o número real passa, e todas as 423
  // adulterações de 1 dígito reprovam (100%). NÃO alterar a remontagem sem re-provar.
  if (_mod10(d.slice(0, 9))  !== Number(d[9]))  return false;
  if (_mod10(d.slice(10, 20)) !== Number(d[20])) return false;
  if (_mod10(d.slice(21, 31)) !== Number(d[31])) return false;
  // Reconstrói o código de barras (44 dígitos) a partir da linha digitável.
  // barras = banco/moeda(d0-3) + DVgeral(d32) + fator+valor(d33-46) +
  //          campo1resto(d4-8) + campo2(d10-19) + campo3(d21-30)  — SEM os DVs de campo.
  const dvGeral = d[32];
  const barras = d.slice(0, 4) + dvGeral + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  const semDv = barras.slice(0, 4) + barras.slice(5); // tira o DV geral (posição 5) → 43 dígitos
  return _mod11Barcode(semDv) === Number(dvGeral);
}

function _validateArrecadacao(d) {
  // 48 dígitos, 4 blocos de 12 (11 + DV). DV mod10 ou mod11 conforme o 3º dígito.
  const id = d[2];
  const dvFn = (id === '6' || id === '7') ? _mod10 : (b) => { // 8/9 usam mod11
    let soma = 0, peso = 2;
    for (let i = b.length - 1; i >= 0; i--) { soma += Number(b[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const r = soma % 11, dv = 11 - r;
    return (dv === 0 || dv === 10) ? (dv === 10 ? 0 : 0) : dv === 11 ? 0 : dv;
  };
  for (let i = 0; i < 4; i++) {
    const bloco = d.slice(i * 12, i * 12 + 11);
    const dv = d[i * 12 + 11];
    if (dvFn(bloco) !== Number(dv)) return false;
  }
  return true;
}

function validateLinhaDigitavel(digits) {
  const d = _digitsOnly(digits);
  if (d.length === 47) return { valid: _validateBancario(d), tipo: 'bancario' };
  if (d.length === 48) return { valid: _validateArrecadacao(d), tipo: 'arrecadacao' };
  return { valid: false, tipo: null };
}

function parseBoletoValor(digits) {
  const d = _digitsOnly(digits);
  if (d.length === 47) {
    const centavos = Number(d.slice(37, 47)); // últimos 10 = valor em centavos
    return centavos > 0 ? centavos / 100 : null;
  }
  if (d.length === 48) {
    const centavos = Number(d.slice(4, 15));
    return centavos > 0 ? centavos / 100 : null;
  }
  return null;
}

function formatLinhaDigitavel(digits) {
  const d = _digitsOnly(digits);
  if (d.length === 47) {
    return `${d.slice(0,5)}.${d.slice(5,10)} ${d.slice(10,15)}.${d.slice(15,21)} ${d.slice(21,26)}.${d.slice(26,32)} ${d.slice(32,33)} ${d.slice(33,47)}`;
  }
  if (d.length === 48) {
    return `${d.slice(0,12)} ${d.slice(12,24)} ${d.slice(24,36)} ${d.slice(36,48)}`;
  }
  return d;
}

module.exports = {
  looksLikeBoleto, extractLinhaDigitavel, validateLinhaDigitavel,
  formatLinhaDigitavel, parseBoletoValor,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote && node --test src/finance/boleto-parse.test.js`
Expected: PASS, 10/10. **Se `validateLinhaDigitavel(HDI).valid` NÃO for `true`, PARAR** — o algoritmo do DV está errado e não dá pra prometer nenhum código. Ajustar `_validateBancario`/`_mod11Barcode` contra o número real até o fixture passar. (É o teste que garante segurança; não seguir sem ele verde.)

- [ ] **Step 5: Commit**

```bash
# (via _remote; o auto-deploy/commit cuida do git — ver Task 7)
```

---

### Task 2: Migration — coluna `barcode` em `pf_bills`

**Files:**
- Migration via MCP Supabase (`apply_migration`, projeto `cesnbnrynvxvgdhfmaua`).

**Interfaces:**
- Produces: `pf_bills.barcode text` (linha digitável só-dígitos; null quando não há).

- [ ] **Step 1: Confirmar que a coluna não existe**

```sql
select column_name from information_schema.columns
where table_name='pf_bills' and column_name='barcode';
```
Expected: 0 linhas.

- [ ] **Step 2: Aplicar a migration**

Nome: `add_barcode_to_pf_bills`
```sql
alter table pf_bills add column if not exists barcode text;
comment on column pf_bills.barcode is 'Linha digitável do boleto (só-dígitos, 47/48). Origem: boleto-parse. null quando a conta não veio de boleto.';
```
Sem RLS nova (herda a policy da tabela). Sem índice (não é filtro).

- [ ] **Step 3: Verificar**

```sql
select column_name, data_type from information_schema.columns
where table_name='pf_bills' and column_name='barcode';
```
Expected: 1 linha, `barcode | text`.

---

### Task 3: `gemini.js` — `analyzeBoleto`

**Files:**
- Modify: `_remote/src/services/gemini.js` (adicionar função + export)

**Interfaces:**
- Consumes: o `callGenerateContent`/padrão já usado por `analyzeInvoice` (mesmo cliente).
- Produces: `analyzeBoleto(buffer, caption) -> { ok, isBoleto, boleto?: { beneficiario, valor, vencimento, linha_digitavel, descricao } }`

- [ ] **Step 1: Ler o padrão de `analyzeInvoice`** (linhas ~237-258) pra copiar o shape de chamada (mesmo `inlineData` PDF base64).

Run: `ssh tom "cd /opt/LA-Organizer && sed -n '237,260p' src/services/gemini.js"`

- [ ] **Step 2: Implementar `analyzeBoleto`** (espelha `analyzeInvoice`, prompt diferente)

```js
// Extrai um BOLETO (não fatura de cartão). Alf 17/07. Retorna isBoleto:false se não for boleto.
async function analyzeBoleto(buffer, caption = '') {
  const prompt = [
    'Este PDF é um BOLETO bancário ou de arrecadação (conta a pagar com linha digitável)?',
    'Se SIM, retorne JSON:',
    '{"isBoleto":true,"beneficiario":"<quem recebe>","valor":<number total a pagar>,"vencimento":"YYYY-MM-DD","linha_digitavel":"<a linha digitável EXATA, só os dígitos e pontos como impressos>","descricao":"<o que é, ex: seguro do carro>"}',
    'A linha digitável é a sequência de ~47-48 dígitos no topo. Copie-a EXATAMENTE como impressa; se tiver QUALQUER dúvida sobre um dígito, retorne linha_digitavel:"" (vazio).',
    'Se NÃO for boleto (ex: fatura de cartão, recibo, nota fiscal), retorne {"isBoleto":false}.',
  ].join('\n');
  try {
    const mediaPart = { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } };
    const json = await _callJson(prompt, mediaPart); // mesmo helper de analyzeInvoice
    if (!json || !json.isBoleto) return { ok: true, isBoleto: false };
    return { ok: true, isBoleto: true, boleto: json };
  } catch (err) {
    console.error('[Gemini] analyzeBoleto err:', err.message);
    return { ok: false, isBoleto: false };
  }
}
```
> **Nota de implementação:** o helper exato (`_callJson`/`callGenerateContent`) sai da leitura do Step 1 — usar o MESMO que `analyzeInvoice` usa, não inventar. Adicionar `analyzeBoleto` ao `module.exports`.

- [ ] **Step 3: Smoke isolado do parse do retorno** (sem chamar a API — injeta um JSON):

```bash
cd _remote && node -e "
const g = require('./src/services/gemini');
console.log(typeof g.analyzeBoleto === 'function' ? 'export OK' : 'FALTOU export');
"
```
Expected: `export OK`.

---

### Task 4: `webhook.js` — rotear boleto ANTES de fatura

**Files:**
- Modify: `_remote/src/webhook.js` (`pdfToText`, ~linha 19-35)

**Interfaces:**
- Consumes: `looksLikeBoleto` (Task 1), `analyzeBoleto` (Task 3).
- Produces: injeta `[BOLETO_JSON]{...}[/BOLETO_JSON]` no texto quando é boleto; senão segue o caminho de fatura de hoje.

- [ ] **Step 1: Ler o `pdfToText` atual** (webhook.js:19-35) — já lido na spec; confirmar que não mudou.

Run: `ssh tom "cd /opt/LA-Organizer && sed -n '19,35p' src/webhook.js"`

- [ ] **Step 2: Inserir o roteamento de boleto no topo do `pdfToText`**

```js
async function pdfToText(buf, mime, caption) {
  // BOLETO primeiro (Alf 17/07): sem isto, o boleto caía no analyzeInvoice e virava
  // "fatura de cartão de 1 item". Lê o texto cru, testa a assinatura de boleto e, se for,
  // extrai estruturado. Fail-safe: qualquer erro cai no caminho de hoje (nunca no de cartão).
  try {
    const cru = await gemini.analyzeMedia(buf, mime || 'application/pdf', caption);
    if (cru.ok && boletoParse.looksLikeBoleto(cru.text)) {
      const b = await gemini.analyzeBoleto(buf, caption);
      if (b.ok && b.isBoleto && b.boleto) {
        const captionLine = caption ? `Legenda enviada pelo usuário: "${caption}"\n` : '';
        console.log(`[Webhook] boleto detectado: ${b.boleto.beneficiario || '?'} R$ ${b.boleto.valor}`);
        return `[BOLETO_JSON]${JSON.stringify(b.boleto)}[/BOLETO_JSON]\n${captionLine}Boleto ${b.boleto.beneficiario || ''} · R$ ${Number(b.boleto.valor||0).toFixed(2)}`;
      }
    }
  } catch (e) { console.warn('[Webhook] rota boleto err (sigo pra fatura):', e.message); }

  // ...resto do pdfToText ATUAL (analyzeInvoice → analyzeMedia) INALTERADO...
```
Adicionar no topo do arquivo: `const boletoParse = require('./finance/boleto-parse');`

- [ ] **Step 3: Sintaxe**

Run: `ssh tom "cd /opt/LA-Organizer && node --check src/webhook.js"` (após deploy do arquivo — ver Task 7)
Expected: sem erro.

---

### Task 5: `engine.js` — Intercept Boleto (prévia + intent + createBill)

**Files:**
- Modify: `_remote/src/engine.js` (novo bloco ANTES do Intercept A0/A de fatura, ~linha 9411)
- Modify: `_remote/src/finance/invoice-import.js` OU novo `_remote/src/finance/boleto-preview.js` pro builder da prévia (puro, TDD)

**Interfaces:**
- Consumes: `validateLinhaDigitavel`, `formatLinhaDigitavel`, `parseBoletoValor` (Task 1); `createBill` (`financeiro-service.js:257`, já suporta `recurrence:'once'`+`due_date`); `pendingIntents.openIntent/resolveIntent`.
- Produces: intent `bill_from_boleto` (stage `awaiting_confirm`), conta criada em `pf_bills` com `barcode`.

- [ ] **Step 1: Builder da prévia — teste falhando** (`boleto-preview.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildBoletoPreview } = require('./boleto-preview');

test('prévia com código válido mostra ✅', () => {
  const msg = buildBoletoPreview({ beneficiario:'HDI Seguros', valor:995.93, vencimento:'2026-07-20', barcodeOk:true });
  assert.match(msg, /HDI Seguros/);
  assert.match(msg, /995,93/);
  assert.match(msg, /20\/07/);
  assert.match(msg, /✅/);
  assert.match(msg, /repete/i); // pergunta recorrência
});

test('prévia com código ilegível mostra ⚠️ e NÃO promete o número', () => {
  const msg = buildBoletoPreview({ beneficiario:'HDI', valor:995.93, vencimento:'2026-07-20', barcodeOk:false });
  assert.match(msg, /⚠️|confere no boleto/i);
});
```

- [ ] **Step 2: Rodar, ver falhar** (`Cannot find module './boleto-preview'`).

Run: `cd _remote && node --test src/finance/boleto-preview.test.js`

- [ ] **Step 3: Implementar `boleto-preview.js`**

```js
'use strict';
// Prévia do boleto pré-confirmação. Voz do TOM: mesma pegada da prévia de fatura (sagrada).
function _fmtBR(v) { return Number(v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }
function _dm(iso) { return /^\d{4}-\d{2}-\d{2}/.test(iso||'') ? `${iso.slice(8,10)}/${iso.slice(5,7)}` : (iso||'?'); }

function buildBoletoPreview({ beneficiario, valor, vencimento, barcodeOk }) {
  const codLinha = barcodeOk
    ? '• Código de barras: ✅ conferido'
    : '• Código de barras: ⚠️ não consegui ler com certeza — confere no boleto';
  return [
    `🧾 Li um *boleto*, Luciano:`,
    `• *${beneficiario || 'Boleto'}* — R$ ${_fmtBR(valor)}`,
    `• Vence *${_dm(vencimento)}*`,
    codLinha,
    ``,
    `É só esse mês ou *repete todo mês*? E de qual conta você paga?`,
    ``,
    `Respondendo, eu crio a conta a pagar e te lembro no dia com o código pra copiar. 👍`,
  ].join('\n');
}
module.exports = { buildBoletoPreview };
```

- [ ] **Step 4: Rodar, ver passar** (2/2).

Run: `cd _remote && node --test src/finance/boleto-preview.test.js`

- [ ] **Step 5: Intercept Boleto no engine** (ANTES do Intercept A0, ~9411)

```js
// === Intercept BOLETO: PDF de boleto (texto tem [BOLETO_JSON]) → conta a pagar ===
// Alf 17/07: boleto caía no fluxo de fatura de cartão. Aqui vira pf_bills com o código de
// barras validado. NUNCA promete o código sem o DV bater (pagamento errado).
try {
  const _bMatch = text.match(/\[BOLETO_JSON\]([\s\S]*?)\[\/BOLETO_JSON\]/);
  if (_bMatch) {
    const _b = JSON.parse(_bMatch[1]);
    const _linha = boletoParse.extractLinhaDigitavel(_b.linha_digitavel || '') || boletoParse.extractLinhaDigitavel(text);
    const _val = _linha ? boletoParse.validateLinhaDigitavel(_linha) : { valid:false };
    const _barcodeOk = !!(_linha && _val.valid);
    const _preview = buildBoletoPreview({
      beneficiario: _b.beneficiario, valor: _b.valor, vencimento: _b.vencimento, barcodeOk: _barcodeOk,
    });
    const _intentId = await pendingIntents.openIntent(collab.id, 'bill_from_boleto',
      { stage:'awaiting_confirm', beneficiario:_b.beneficiario, valor:_b.valor, vencimento:_b.vencimento,
        barcode: _barcodeOk ? _linha : null, descricao:_b.descricao || _b.beneficiario }, 'criar conta do boleto?');
    if (!_intentId) {
      console.error('[Boleto] openIntent retornou null');
      await whatsapp.sendMessage(phone, `🧾 Li o boleto (R$ ${Number(_b.valor||0).toFixed(2)}), mas tive um problema técnico pra abrir a confirmação. Tenta de novo ou cadastra em Finanças → Contas.`);
      return;
    }
    await whatsapp.sendMessage(phone, _preview);
    return;
  }
} catch (e) { console.warn('[Boleto] intercept err:', e.message); }
```
Requires no topo do engine: `const boletoParse = require('./finance/boleto-parse');` e `const { buildBoletoPreview } = require('./finance/boleto-preview');`

- [ ] **Step 6: Resposta à intent `bill_from_boleto`** (bloco de resposta, junto dos outros intercepts de resposta)

```js
// resposta ao preview do boleto
const _boletoIntent = (_openIntents || []).find((i) => i.kind === 'bill_from_boleto' && i.payload && i.payload.stage === 'awaiting_confirm');
if (_boletoIntent) {
  const _p = _boletoIntent.payload;
  const _low = text.toLowerCase();
  if (/\b(cancela|deixa|esquece|n[ãa]o precisa)\b/.test(_low)) {
    await pendingIntents.resolveIntent(_boletoIntent.id, 'denied', 'user cancelou boleto');
    await whatsapp.sendMessage(phone, 'Beleza, não criei a conta. 👍');
    return;
  }
  const _repete = /\b(repete|todo\s*m[êe]s|mensal|recorrente|fixa)\b/.test(_low);
  const _recurrence = _repete ? 'monthly' : 'once';
  await pendingIntents.resolveIntent(_boletoIntent.id, 'confirmed', 'boleto→conta');
  const _bill = await financeService.createBill(collab.id, {
    name: _p.descricao || _p.beneficiario, amount: _p.valor,
    category: 'moradia', type: 'expense',
    recurrence: _recurrence,
    due_date: _recurrence === 'once' ? _p.vencimento : null,
    due_day: _recurrence === 'monthly' && _p.vencimento ? Number(_p.vencimento.slice(8,10)) : undefined,
    barcode: _p.barcode || null,
  });
  const _quando = _recurrence === 'once' ? `dia ${_p.vencimento.slice(8,10)}/${_p.vencimento.slice(5,7)}` : `todo dia ${_p.vencimento.slice(8,10)}`;
  await whatsapp.sendMessage(phone, `✅ Criei a conta *${_p.descricao || _p.beneficiario}* (R$ ${Number(_p.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}), ${_recurrence==='once'?'única':'mensal'}, vencendo ${_quando}. Te lembro no dia${_p.barcode ? ' com o código pra copiar' : ''}. 👍`);
  return;
}
```
> **Nota:** `createBill` precisa aceitar `barcode` — confirmar na leitura que a função repassa campos extras pro insert (Task 5 Step 7). Categoria `'moradia'` como default do boleto (seguro/conta); a categorização fina fica pro futuro.

- [ ] **Step 7: `createBill` grava `barcode`** — verificar/ajustar `financeiro-service.js:257`

Ler a função; se ela monta `row` com campos fixos, adicionar `if (barcode) row.barcode = barcode;`. Rodar a suíte de `financeiro-service` se houver.

- [ ] **Step 8: Sintaxe do engine**

Run (após deploy — Task 7): `ssh tom "cd /opt/LA-Organizer && node --check src/engine.js"`

---

### Task 6: Lembrete inclui a linha digitável

**Files:**
- Modify: `_remote/src/finance/ritual-messages.js` (o builder do lembrete de vencimento)
- Test: `_remote/src/finance/ritual-messages.test.js` (se existir; senão criar caso mínimo)

**Interfaces:**
- Consumes: `formatLinhaDigitavel` (Task 1); `bill.barcode` (Task 2).

- [ ] **Step 1: Ler o builder atual** (`ritual-messages.js:44` — a linha `mode==='previo'`).

Run: `ssh tom "cd /opt/LA-Organizer && sed -n '40,55p' src/finance/ritual-messages.js"`

- [ ] **Step 2: Teste falhando** — quando `bill.barcode` existe, a mensagem inclui a linha formatada.

```js
test('lembrete de conta com barcode inclui a linha digitável', () => {
  const { billReminder } = require('./ritual-messages'); // nome real confirmado no Step 1
  const msg = billReminder({ name:'HDI Seguros', amount:995.93, due_day:20, barcode:'03399745031090000927472059001015615130000099593' }, { mode:'previo', dias:0 });
  assert.match(msg, /03399\.74503/); // linha formatada
});
```

- [ ] **Step 3: Adicionar o trecho do código no builder** — se `bill.barcode`, anexar `\n\nCódigo pra copiar:\n\`${formatLinhaDigitavel(bill.barcode)}\``. `require('./boleto-parse')` no topo.

- [ ] **Step 4: Rodar, ver passar** + rodar a suíte de `ritual-messages` inteira (zero-regressão no builder).

---

### Task 7: Deploy cirúrgico + smoke real + KI + memória

**Files:** todos os acima.

- [ ] **Step 1: Baseline ANTES** (na VPS, com o código atual)

Run: `ssh tom "cd /opt/LA-Organizer && node --test src/**/*.test.js 2>&1 | grep -E '^# (tests|pass|fail)'"`
Anotar o número (falhas pré-existentes: system-loadout, group-chat-tasks, pending-intents-detect).

- [ ] **Step 2: Enviar os módulos não-engine** (passam no scp)

```bash
cd _remote && for f in src/finance/boleto-parse.js src/finance/boleto-parse.test.js \
  src/finance/boleto-preview.js src/finance/boleto-preview.test.js \
  src/services/gemini.js src/webhook.js src/finance/ritual-messages.js \
  src/services/financeiro-service.js; do scp $f tom:/opt/LA-Organizer/$f; done
```

- [ ] **Step 3: Backup + enviar o engine** (scp bloqueado → **pedir OK ao Alf**)

```bash
ssh tom "cp /opt/LA-Organizer/src/engine.js /opt/LA-Organizer/src/engine.js.bak-boleto"
cd _remote/src && scp engine.js tom:/opt/LA-Organizer/src/engine.js
```

- [ ] **Step 4: Sintaxe na VPS** (engine, webhook, gemini)

Run: `ssh tom "cd /opt/LA-Organizer && node --check src/engine.js && node --check src/webhook.js && node --check src/services/gemini.js && echo OK"`

- [ ] **Step 5: Suíte DEPOIS** (zero-regressão)

Run: `ssh tom "cd /opt/LA-Organizer && node --test src/**/*.test.js 2>&1 | grep -E '^# (tests|pass|fail)|^not ok'"`
Expected: +12 testes novos passando; as MESMAS 3 falhas pré-existentes, nenhuma nova.

- [ ] **Step 6: Restart + boot limpo**

Run: `ssh tom "pm2 restart tom && sleep 3 && cd /opt/LA-Organizer && tail -4 logs/tom-out.log && tail -10 logs/tom-error.log | grep -iE 'boleto|SyntaxError|Cannot' || echo sem-erro"`

- [ ] **Step 7: Smoke da cascata de segurança na VPS** (código deployado)

```bash
ssh tom "cd /opt/LA-Organizer && node -e \"
const b = require('./src/finance/boleto-parse');
const HDI='03399745031090000927472059001015615130000099593';
console.log('valida real:', b.validateLinhaDigitavel(HDI).valid, '(esperado true)');
console.log('valor:', b.parseBoletoValor(HDI), '(esperado 995.93)');
const adult = HDI.slice(0,19)+'8'+HDI.slice(20);
console.log('1 digito trocado:', b.validateLinhaDigitavel(adult).valid, '(esperado false)');
\""
```
Expected: `true`, `995.93`, `false`.

- [ ] **Step 8: Smoke E2E real** — Alf reencaminha o boleto HDI no zap; conferir no banco:

```sql
select name, amount, recurrence, due_date, due_day, barcode
from pf_bills where collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  and created_at > now() - interval '10 minutes' order by created_at desc;
```
Expected: 1 linha, `barcode` com 47 dígitos, `amount` 995.93, `recurrence`/`due_date` conforme a resposta do Alf.

- [ ] **Step 9: Git sincronizado** (padrão do §11/07: clone `C:\la-deploy-work`, reset, copiar os arquivos, `check-quiet-gates.js`, commit, push, **verificar `HEAD==origin/main` E `git==VPS` por md5**). Não tocar em arquivos do outro chat.

- [ ] **Step 10: Registrar KI + memória**

```sql
insert into tom_known_issues (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao, colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
values ('FIN-BOLETO-TREATED-AS-CARD-INVOICE', 'Boleto tratado como fatura de cartão (roteador de PDF não distinguia)', 'financeiro','alto','corrigido',
'webhook.js pdfToText chamava analyzeInvoice em TODO PDF; boleto (1 valor+emissor+data) virava fatura de 1 item e caía no Intercept A pedindo cartão. Alf 17/07 boleto HDI.',
'boleto-parse.js (looksLikeBoleto + validateLinhaDigitavel mod10/11 + extract/format/parseValor, fixture real HDI). webhook roteia boleto ANTES de fatura (fail-safe: erro→texto cru, nunca cartão). Intercept Boleto no engine → createBill(recurrence,due_date,barcode). Lembrete inclui linha digitável. payBill reusado pro paguei. TDD 12/12; código validado pelo DV — 1 dígito trocado reprova.',
'manual','n[ãa]o [ée] de cart[ãa]o|pago pela conta|isso [ée] um boleto', array['0576f4b6-183d-4cf1-980e-5c8d5da0177f']::uuid[], now(), now(), 1, now());
```
Memória: `project_boleto_conta_pagar.md` (cascata roteador + a trava do DV) + linha no `MEMORY.md`.

---

## Notas de execução

- **Ordem obrigatória:** Task 1 (o validador é a fundação e a trava de segurança — se o DV não bater no fixture real, PARAR) → 2 (migration) → 3-6 (código) → 7 (deploy+smoke).
- **A migration (Task 2) é aditiva** (`add column if not exists`) — sem risco de regressão em quem já usa `pf_bills`.
- **O maior risco é zero-regressão no fluxo de fatura:** o teste `looksLikeBoleto(FATURA_TXT)===false` (Task 1) é a primeira linha de defesa; o smoke E2E confirma que um PDF de fatura ainda vira fatura.
