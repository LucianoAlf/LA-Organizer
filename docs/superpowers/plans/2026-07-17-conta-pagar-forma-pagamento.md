# Conta a pagar — forma de pagamento (boleto/PIX) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** O Alf vê/edita no app o código de barras (que o TOM já coleta) e uma chave PIX; o TOM coleta os dois; o lembrete entrega o código da forma escolhida.

**Architecture:** `pf_bills` ganha `payment_method` + `pix_key` (`barcode` já existe). Módulo puro `pix-parse.js` (paralelo do `boleto-parse`) valida o copia-e-cola por CRC16. Backend/engine/lembrete/PWA passam a ler/gravar os campos. `payment_method` é a fonte-de-verdade da forma (não infere por campo preenchido).

**Tech Stack:** Node CommonJS + `node:test`; React/TS + Vite + design system (CustomSelect/Field/tokens); Supabase (MCP migration).

## Global Constraints

- **PT-BR** em toda mensagem. **TOM nunca move dinheiro.** **Voz do TOM sagrada.**
- **Design system (CLAUDE.md):** nunca `<select>` nativo → `CustomSelect`; `Field`; tokens `bg-bg-surface`/`text-fg`/`border-border`. Testar 375px E 1440px.
- **Zero-regressão:** boleto de hoje intacto (conta HDI segue com `barcode`); suíte `finance/` + `tsc --noEmit` + `vite build` verdes.
- **Paridade de payload:** `payment_method`/`pix_key` entram em TODOS os writers (grep, não de cabeça): service `createBill`+`updateExistingBill`, front `createBill`(l.424)+`updateBill`(l.488), engine boleto + engine pix.
- **Trava:** PIX copia-e-cola (BR Code EMV) tem CRC16 no fim — validar; 1 char trocado reprova. Chave crua não valida.
- **`_remote/` compartilhado:** scp do engine pede OK do Alf; git-sync cirúrgico (§11/07).
- **Baseline VPS:** 1931 pass / 3 fail (pré-existentes: system-loadout, group-chat-tasks, pending-intents-detect).

---

### Task 1: Migration — `payment_method` + `pix_key` em `pf_bills`

- [ ] **Step 1:** confirmar que não existem:
```sql
select column_name from information_schema.columns where table_name='pf_bills' and column_name in ('payment_method','pix_key');
```
Expected: 0 linhas.
- [ ] **Step 2:** aplicar migration `add_payment_method_pix_to_pf_bills`:
```sql
alter table pf_bills add column if not exists payment_method text;
alter table pf_bills add column if not exists pix_key text;
comment on column pf_bills.payment_method is 'boleto | pix | outro | null — forma de pagamento (fonte-de-verdade do lembrete).';
comment on column pf_bills.pix_key is 'Chave PIX ou o copia-e-cola (BR Code EMV).';
```
- [ ] **Step 3:** verificar (2 linhas). Backfill: a conta HDI (barcode não-null) recebe `payment_method='boleto'`:
```sql
update pf_bills set payment_method='boleto' where barcode is not null and payment_method is null;
```

---

### Task 2: `pix-parse.js` — parser + validador CRC16 (puro, TDD)

**Files:** Create `_remote/src/finance/pix-parse.js` + `.test.js`

**Interfaces (Produces):**
- `looksLikePixCopiaECola(text) -> boolean`
- `extractPixCopiaECola(text) -> string|null`
- `validatePixBRCode(payload) -> { valid: boolean }`
- `extractPixKeyFromText(text) -> string|null`

- [ ] **Step 1: teste falhando** (`pix-parse.test.js`)
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { looksLikePixCopiaECola, extractPixCopiaECola, validatePixBRCode, extractPixKeyFromText } = require('./pix-parse');

// BR Code EMV mínimo válido (CRC calculado). Substituir pelo real do Alf no smoke.
// Este payload de exemplo tem CRC correto (gerado pelo mesmo algoritmo do módulo).
const BRCODE = '00020126360014BR.GOV.BCB.PIX0114+5521999999999520400005303986540510.005802BR5909Fulano Tal6009Sao Paulo62070503***6304';
// NOTA: o CRC dos últimos 4 chars é preenchido no Step 3 após implementar (é auto-referente).

test('looksLikePixCopiaECola: TRUE num BR Code', () => {
  assert.strictEqual(looksLikePixCopiaECola('00020126...5204000053039865802BR6304ABCD'), true);
});
test('looksLikePixCopiaECola: FALSE em texto qualquer', () => {
  assert.strictEqual(looksLikePixCopiaECola('oi tom, paga a conta de luz'), false);
});
test('extractPixKeyFromText: email após gatilho', () => {
  assert.strictEqual(extractPixKeyFromText('a chave pix é fulano@email.com'), 'fulano@email.com');
});
test('extractPixKeyFromText: CPF só-dígitos', () => {
  assert.strictEqual(extractPixKeyFromText('chave pix 12345678901'), '12345678901');
});
test('extractPixKeyFromText: null sem gatilho', () => {
  assert.strictEqual(extractPixKeyFromText('paga amanhã por favor'), null);
});
```
- [ ] **Step 2:** rodar, ver falhar (`Cannot find module`).
- [ ] **Step 3: implementar `pix-parse.js`**
```js
'use strict';
// PIX: detecta/valida "copia e cola" (BR Code EMV) e extrai chave de texto. Paralelo do
// boleto-parse. A validação é a trava: o BR Code tem CRC16 no fim — copia-e-cola adulterado
// reprova. Chave crua (email/CPF/telefone/aleatória) não tem verificador → guarda como veio.

// ATENÇÃO: NUNCA remover espaços INTERNOS — o BR Code os tem no nome do recebedor
// ("Fulano Tal"); strip corrompe o payload e quebra o CRC (bug pego no de-risk 17/07,
// self-generated + 693/693 adulterações reprovam). Só tira quebra de linha + trim.
function _clean(text) { return String(text || '').replace(/[\r\n]+/g, '').trim(); }

function looksLikePixCopiaECola(text) {
  const s = _clean(text);
  return (/000201/.test(s) && /6304[0-9A-Fa-f]{4}/.test(s)) || /BR\.GOV\.BCB\.PIX/i.test(s);
}

function extractPixCopiaECola(text) {
  const m = _clean(text).match(/000201.*?6304[0-9A-Fa-f]{4}/);
  return m ? m[0] : null;
}

// CRC16-CCITT (poly 0x1021, init 0xFFFF) sobre o payload até e incluindo '6304'.
function _crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function validatePixBRCode(payload) {
  const s = _clean(payload); // trim/newline só — NÃO strip de espaço interno (quebra o CRC)
  const m = s.match(/^(.*6304)([0-9A-Fa-f]{4})$/);
  if (!m) return { valid: false };
  return { valid: _crc16(m[1]) === m[2].toUpperCase() };
}

const RE_PIX_TRIGGER = /\bchave\s*pix\b|\bpix\s*[ée:]\b|\bpix\b.*\b[ée]\b/i;
function extractPixKeyFromText(text) {
  const t = String(text || '');
  if (!RE_PIX_TRIGGER.test(t)) return null;
  const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) return email[0];
  const uuid = t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const fone = t.match(/\+?55\d{10,11}/);
  if (fone) return fone[0];
  const doc = t.match(/\b\d{11}\b|\b\d{14}\b/);
  if (doc) return doc[0];
  return null;
}

module.exports = { looksLikePixCopiaECola, extractPixCopiaECola, validatePixBRCode, extractPixKeyFromText };
```
- [ ] **Step 4:** completar o fixture `BRCODE` — rodar `node -e "const {validatePixBRCode}=require('./src/finance/pix-parse'); ..."` pra gerar o CRC do payload de teste, colar no teste um caso `validatePixBRCode(real).valid===true` + um com 1 char trocado `===false`. Rodar, ver 7/7 verde.
- [ ] **Step 5:** `node --check`.

---

### Task 3: Backend — service + engine gravam os campos

**Files:** Modify `_remote/src/services/financeiro-service.js`, `_remote/src/engine.js`

- [ ] **Step 1:** `createBill` (assinatura + `row`) aceita `payment_method` e `pix_key` (paridade com o `barcode` de hoje). `updateExistingBill` já repassa `row` — confirmar.
- [ ] **Step 2:** Intercept Boleto (engine) grava `payment_method:'boleto'` no `createBill` (uma linha).
- [ ] **Step 3: novo Intercept PIX** (engine, junto dos outros de resposta): quando `looksLikePixCopiaECola(text)` OU `extractPixKeyFromText(text)` **e** há intent `bill_from_boleto`/conta em foco recente:
```js
const pixParse = require('./finance/pix-parse');
const _cola = pixParse.extractPixCopiaECola(text);
const _chave = _cola || pixParse.extractPixKeyFromText(text);
if (_chave) {
  const _ok = _cola ? pixParse.validatePixBRCode(_cola).valid : true; // chave crua não valida
  if (_cola && !_ok) { await whatsapp.sendMessage(phone, '⚠️ Esse PIX copia-e-cola não conferiu (pode ter vindo cortado). Manda de novo?'); return; }
  // localizar a conta-alvo (última criada sem forma, ou nomeada) → updateExistingBill(payment_method:'pix', pix_key:_chave)
}
```
> O alvo (qual conta) sai da leitura do fluxo no Step de implementação — reusar a conta recém-criada pelo boleto ou a nomeada. Não inventar handler novo se já houver um "editar conta" no engine; grep primeiro.
- [ ] **Step 4:** `node --check` engine + service.

---

### Task 4: Lembrete decide por `payment_method`

**Files:** Modify `_remote/src/finance/ritual-messages.js` + teste

- [ ] **Step 1: teste** — `payment_method:'pix'` + `pix_key` → lembrete tem a chave; `'boleto'` → linha digitável; `'outro'`/null → nem código nem chave.
- [ ] **Step 2:** em `buildBillReminder`, trocar o gate `if (bill.barcode && ...)` por:
```js
if (mode === 'dia' || mode === 'atrasada') {
  if (bill.payment_method === 'boleto' && bill.barcode) {
    const { formatLinhaDigitavel } = require('./boleto-parse');
    cod = `\n\nCódigo pra copiar:\n\`${formatLinhaDigitavel(bill.barcode)}\``;
  } else if (bill.payment_method === 'pix' && bill.pix_key) {
    cod = `\n\nPIX pra copiar:\n\`${bill.pix_key}\``;
  }
}
```
> Manter compat: conta antiga com `barcode` mas sem `payment_method` — o backfill (Task 1) já setou `payment_method='boleto'`, então cai no 1º ramo. Adicionar teste desse caso.
- [ ] **Step 3:** rodar teste + suíte `ritual-messages`.

---

### Task 5: PWA — `BillSheet.tsx` seletor de forma + campo + copiar

**Files:** Modify `_remote/web/src/screens/financeiro/components/BillSheet.tsx`, `_remote/web/src/lib/financeiro.ts`; Create `_remote/web/src/components/CopyButton.tsx`

- [ ] **Step 1: `lib/financeiro.ts`** — `createBill`(l.424) e `updateBill`(l.488): adicionar aos tipos de input/patch e ao `row`/update: `payment_method?: 'boleto'|'pix'|'outro'|null`, `barcode?: string|null`, `pix_key?: string|null`. (Paridade — os DOIS.)
- [ ] **Step 2: `CopyButton.tsx`** (DS):
```tsx
import { useState } from 'react';
export function CopyButton({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500); } catch {} }}
      className="text-sm text-tom px-2 py-1 rounded-md border border-border hover:bg-bg-surface">
      {ok ? 'copiado ✓' : 'copiar'}
    </button>
  );
}
```
- [ ] **Step 3: `BillSheet.tsx`** — estados `paymentMethod` + `code`; `<Field label="Forma de pagamento"><CustomSelect options={[{value:'boleto',label:'Boleto'},{value:'pix',label:'PIX'},{value:'outro',label:'Outro'}]} .../></Field>`; condicional: boleto→`<Field label="Código de barras">` input+CopyButton; pix→`<Field label="Chave PIX">` input+CopyButton; carregar do `bill` na edição; passar no save.
- [ ] **Step 4:** `cd web && npx tsc --noEmit` + `npx vite build`. Preview 375 + 1440, dark mode.

---

### Task 6: Deploy + smoke real + KI + memória

- [ ] **Step 1:** baseline VPS (`node --test src/**/*.test.js`).
- [ ] **Step 2:** scp dos não-engine + web; scp do engine (**OK do Alf**); backup antes.
- [ ] **Step 3:** sintaxe VPS + `pm2 restart tom` + boot limpo.
- [ ] **Step 4:** suíte VPS (as MESMAS 3 falhas, +N novos). Auto-deploy Vercel do `web/` no push.
- [ ] **Step 5: smoke real:** app abre HDI → vê barcode + copiar; muda forma pra PIX, salva chave. Alf manda um PIX copia-e-cola → conferir `pix_key`/`payment_method` no banco + CRC validado.
- [ ] **Step 6:** git-sync cirúrgico (§11/07, só meus arquivos) + `HEAD==origin/main` + `git==VPS` md5.
- [ ] **Step 7:** KI `FIN-BILL-PAYMENT-METHOD-PIX` + memória (estende [[project_boleto_conta_pagar]]).

---

## Notas
- **Task 2 é a fundação** (o validador CRC). **Task 5 é a mais visível** (o que o Alf pediu — ver no app). Ordem: 1→2→3→4→5→6.
- **Paridade de payload é o risco #1** — o grep dos 6 writers no Step de cada task, não de cabeça.
