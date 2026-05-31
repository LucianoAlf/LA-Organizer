# OCR / Visão Financeira Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Usuário manda foto de comprovante/nota/print → TOM extrai os dados, monta resumo, pergunta "grava?", e ao confirmar emite `register_transaction` (que passa pelo resolver de fonte já em prod).

**Architecture:** Reaproveita o pipeline de imagem existente (webhook → download → `vision.analyzeImage` → descrição injetada como texto → engine/Claude). Sem pipeline novo, sem migration. 3 mudanças: (1) prompt de visão enriquecido com extração financeira + sinal `COMPROVANTE FINANCEIRO:`; (2) `FINANCE_RE` casa o sinal pra carregar a skill em foto sem legenda; (3) skill ganha seção de interpretação de comprovante (resumo + "grava?" + emissão).

**Tech Stack:** Node.js CommonJS (TOM engine), OpenAI vision (já configurado em `vision.js`), node:test, deploy via `scp tom:` + `pm2 restart tom`.

**Base já em prod (dependências satisfeitas):** `resolveSource`, `is_primary`/conta principal, `finance_source` pending-state, TOM Coach P6. O `register_transaction` emitido pelo OCR cai nesse roteamento — o OCR não toca no engine.

---

## File Structure

- `src/services/vision.js` *(modifica)* — extrai `buildVisionPrompt(caption)` (puro) com instrução condicional de extração financeira + sinal; `analyzeImage` passa a usá-lo.
- `src/services/vision.test.js` *(novo)* — testa `buildVisionPrompt` (lógica pura do prompt).
- `src/prompts/system.js` *(modifica)* — `FINANCE_RE` (linha 806) += `comprovante|nota fiscal|cupom fiscal|R$ \d`.
- `skills/financeiro-pessoal.md` *(modifica)* — nova seção `## Interpretação de comprovante (foto)` após `## Como registrar uma ação`.

Sem migration. Sem mudança no `webhook.js` (já baixa imagem e injeta a descrição) nem no `engine.js` (roteamento de fonte já existe).

---

## Task 1: `vision.js` — prompt enriquecido com extração financeira (TDD)

**Files:**
- Modify: `src/services/vision.js` (bloco `userTextParts` ~35-45)
- Test: `src/services/vision.test.js` *(novo)*

A descrição genérica atual ("descreve em 4 frases") perde número pequeno de comprovante. Extrair `buildVisionPrompt(caption)` (puro, testável) que instrui o modelo a, **quando a imagem for nota/comprovante/recibo/tela de compra**, transcrever literalmente os campos financeiros e prefixar a saída com `COMPROVANTE FINANCEIRO:`.

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// src/services/vision.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildVisionPrompt } = require('./vision');

test('inclui a legenda do usuário quando presente', () => {
  const p = buildVisionPrompt('gastei no posto');
  assert.match(p, /gastei no posto/);
});

test('sem legenda: não quebra e não inventa legenda', () => {
  const p = buildVisionPrompt('');
  assert.doesNotMatch(p, /legenda/i);
});

test('instrui extração financeira dos campos-chave', () => {
  const p = buildVisionPrompt('');
  for (const campo of ['valor', 'estabelecimento', 'forma de pagamento', 'data']) {
    assert.match(p, new RegExp(campo, 'i'), `falta instrução de "${campo}"`);
  }
});

test('instrui o sinal COMPROVANTE FINANCEIRO e transcrição literal de números', () => {
  const p = buildVisionPrompt('');
  assert.match(p, /COMPROVANTE FINANCEIRO/);
  assert.match(p, /literal/i); // transcrever números sem arredondar
});

test('mantém a descrição factual genérica pra imagem não-financeira', () => {
  const p = buildVisionPrompt('');
  assert.match(p, /descrev|descreve/i);
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `node --test src/services/vision.test.js`
Expected: FAIL ("buildVisionPrompt is not a function" / módulo não exporta).

- [ ] **Step 3: Implementar `buildVisionPrompt` e wirar em `analyzeImage`**

Em `src/services/vision.js`, substituir o bloco que monta `userTextParts`/`userText` (linhas ~35-45) por uma chamada ao novo helper, e adicionar o helper antes de `analyzeImage`:

```js
// Monta o prompt de visão. Quando a imagem for comprovante/nota, pede extração
// financeira estruturada (transcrição literal) + sinal pra skill financeira carregar.
function buildVisionPrompt(userCaption = '') {
  const parts = [];
  if (userCaption && userCaption.trim()) {
    parts.push(`O usuário enviou esta imagem com a legenda: "${userCaption.trim()}".`);
  }
  parts.push(
    'Descreve em português, em até 4 frases, o que aparece na imagem ' +
    '(objetos, pessoas, texto visível, números, contexto). Se houver texto, ' +
    'transcreve literalmente. Se for um documento ou tabela, lista os campos. ' +
    'Não comente além da descrição factual.'
  );
  parts.push(
    'IMPORTANTE — se a imagem for uma nota fiscal, cupom fiscal, comprovante de ' +
    'pagamento, recibo ou tela de compra de app (iFood, Uber, etc.): comece a ' +
    'resposta com a linha "COMPROVANTE FINANCEIRO:" e logo em seguida transcreve ' +
    'LITERALMENTE (sem arredondar nem inferir): valor total (R$), estabelecimento/' +
    'loja/app, data (se visível), forma de pagamento (crédito, débito, PIX, ' +
    'dinheiro, ou o nome do cartão/banco), e os itens principais resumidos. Se ' +
    'algum campo não estiver legível, escreve "ilegível" nesse campo — não chute.'
  );
  return parts.join(' ');
}

async function analyzeImage(buffer, mime = 'image/jpeg', userCaption = '') {
  if (!OPENAI_KEY) return { ok: false, reason: 'no_provider' };
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty_buffer' };
  if (!isImageMime(mime)) return { ok: false, reason: 'unsupported_mime', error: mime };

  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const userText = buildVisionPrompt(userCaption);

  const payload = JSON.stringify({
    model: VISION_MODEL,
    max_completion_tokens: 400,
    messages: [
      { role: 'user', content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ],
  });
  // ... (resto da função permanece igual) ...
```

E no `module.exports` (linha ~105), adicionar `buildVisionPrompt`:

```js
module.exports = { analyzeImage, isProviderConfigured, isImageMime, buildVisionPrompt };
```

> O `max_completion_tokens` sobe de 400 pra **600** (a extração estruturada é mais longa que a descrição de 4 frases). Trocar `max_completion_tokens: 400` por `600`.

- [ ] **Step 4: Rodar — deve passar**

Run: `node --test src/services/vision.test.js`
Expected: PASS (5 testes).

- [ ] **Step 5: Syntax check**

Run: `node --check src/services/vision.js`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/services/vision.js src/services/vision.test.js
git commit -m "feat(vision): prompt de extração de comprovante + sinal COMPROVANTE FINANCEIRO"
```

---

## Task 2: `system.js` — `FINANCE_RE` carrega a skill em foto sem legenda

**Files:**
- Modify: `src/prompts/system.js` (linha 806, `FINANCE_RE`)

Foto sem legenda não tem palavra-chave financeira. Como a Task 1 marca comprovantes com `COMPROVANTE FINANCEIRO:` + `R$ <valor>`, o `FINANCE_RE` (já com flag `/i`, então casa maiúsculas) ganha os termos do sinal pra a skill financeira ser injetada.

- [ ] **Step 1: Validar os novos termos do regex (teste isolado, falhando→passando)**

Criar um teste descartável pra provar que as novas alternativas casam o sinal e não casam texto comum. Rode ANTES de editar (deve falhar):

Run:
```bash
node -e "const re=/\b(comprovante|nota\s+fiscal|cupom\s+fiscal|r\$\s*\d)/i; console.log(re.test('COMPROVANTE FINANCEIRO: valor R$ 45'), re.test('bom dia, tudo certo?'))"
```
Expected: `true false` (o sinal casa; conversa comum não).

> Este node -e valida a sub-expressão nova isoladamente (o `FINANCE_RE` real não é exportado). Garante que os termos não têm typo e não geram falso-positivo óbvio.

- [ ] **Step 2: Editar o `FINANCE_RE` (linha 806)**

Adicionar `comprovante|nota\s+fiscal|cupom\s+fiscal|r\$\s*\d` ao início da alternância (logo após `gastei|recebi|paguei|`). O regex já é case-insensitive (`/i`), então `r\$` casa `R$`. Resultado (trecho inicial):

```js
  const FINANCE_RE = /\b(comprovante|nota\s+fiscal|cupom\s+fiscal|r\$\s*\d|gastei|recebi|paguei|cart[ãa]o|fatura|parcel\w+|transfer[eiêí]\w*|cr[ée]dito|\d+\s*x\b|limite|sal[áa]rio|comiss[ãa]o|aluguel|ifood|mercado|uber|gasolina|farm[áa]cia|or[çc]amento|meta|guard\w+\s+(?:r\$\s*)?\d+|separ\w+\s+(?:r\$\s*)?\d+|guard\w+\s+(?:dinheiro|grana)|poupan[çc]a|caixinha|cofrinho|investir|selic|juros|sonho|quanto\s+gastei|conta\s+(?:a\s+pagar|vencendo|fixa|de\s+(?:luz|[áa]gua|internet|telefone|g[áa]s))|cadastr\w*\s+(?:a\s+)?(?:uma\s+)?conta|(?:cria\w*|nova|abr\w+|cadastr\w*)\s+(?:uma\s+)?carteira|minhas?\s+carteiras?|assinatura|mensalidade|netflix|spotify|disney|academia|condom[íi]nio)\b/i;
```

- [ ] **Step 3: Syntax check**

Run: `node --check src/prompts/system.js`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/prompts/system.js
git commit -m "feat(prompt): FINANCE_RE casa COMPROVANTE FINANCEIRO/nota/R$ pra carregar skill em foto"
```

---

## Task 3: `financeiro-pessoal.md` — seção de interpretação de comprovante

**Files:**
- Modify: `skills/financeiro-pessoal.md` (inserir nova seção após `## Como registrar uma ação`, antes de `## Cartão de crédito` ~58)

A skill já manda emitir `register_transaction` sempre (R9). Falta a regra de transformar a descrição de um comprovante (sinal `COMPROVANTE FINANCEIRO:`) em resumo + "grava?" + emissão ao confirmar.

- [ ] **Step 1: Inserir a seção**

Adicionar antes de `## Cartão de crédito (você TEM esse módulo — AJA NA HORA)`:

```markdown
## Interpretação de comprovante (foto)

Quando a mensagem contém uma análise de imagem que começa com **`COMPROVANTE FINANCEIRO:`** (o usuário mandou foto de nota/cupom/comprovante/print de compra), você:

1. **Lê os campos extraídos** (valor, estabelecimento, data, forma de pagamento, itens).
2. **Mapeia a categoria** pelo estabelecimento (iFood→alimentacao, posto/Uber→transporte, farmácia→saude, etc.; "outros" se não der).
3. **Monta um resumo curto e pergunta "grava?"** — NÃO emita o marker ainda:
   > 🧾 *Posto Shell* — R$180, débito, transporte, hoje. Grava?
4. **Só quando o usuário confirmar** ("isso", "pode", "sim", "👍") você emite `register_transaction` com os dados extraídos (incluindo `account_name` = a forma de pagamento/banco/cartão lido, quando houver).
5. **Correção do usuário** ("não, foi 200" / "foi no crédito") → ajusta o campo e re-mostra/pergunta antes de gravar.
6. **Valor ilegível** (campo veio "ilegível") → pede pra digitar o valor, NÃO chute.

Regras que continuam valendo: a fonte é resolvida pelo engine (você só passa `account_name`); se a forma de pagamento for um cartão/"crédito", o engine joga na fatura; se não houver fonte clara, o engine pergunta. **Um comprovante = um lançamento (valor total)** — não itemize a nota.
```

- [ ] **Step 2: Verificar que a seção entrou e o sinal está citado**

Run:
```bash
grep -n "COMPROVANTE FINANCEIRO\|Interpretação de comprovante\|Grava?" skills/financeiro-pessoal.md
```
Expected: 3+ matches (título da seção, o sinal, e o "Grava?").

- [ ] **Step 3: Commit**

```bash
git add skills/financeiro-pessoal.md
git commit -m "feat(skill): interpretação de comprovante — resumo + grava? + emissão"
```

---

## Task 4: Deploy engine + skill + smoke E2E

**Files:** deploy (scp + pm2). Teste manual no WhatsApp (Alf manda as fotos).

- [ ] **Step 1: SCP dos 3 arquivos + restart**

```bash
scp D:/la-organizer/_remote/src/services/vision.js tom:/opt/LA-Organizer/src/services/vision.js
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp D:/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md
ssh tom "pm2 restart tom && sleep 2 && pm2 logs tom --lines 5 --nostream"
```
Expected: TOM online, sem stacktrace no boot.

- [ ] **Step 2: Bateria smoke (Alf manda as fotos; conferir resposta + DB)**

Pré: ter conta(s)/cartão cadastrados no PWA (a base fonte-obrigatória usa isso).

1. **Foto de comprovante de cartão de crédito** → TOM resume e pergunta "grava?" → "isso" → vai pra **fatura** (não mexe no caixa).
2. **Print de iFood** → resume despesa alimentação → confirma → grava na conta principal (nomeia) ou pergunta fonte.
3. **Nota de posto (débito)** → resume → confirma → resolve a conta (pergunta se ≥2 sem principal).
4. **Foto não-financeira** (ex: cachorro) → NÃO força lançamento; trata como imagem normal.
5. **Correção**: comprovante → "não, foi 200" → ajusta antes de gravar.
6. **Confirmação obrigatória**: TOM nunca grava sem o "grava?" respondido.
7. **Valor ilegível** (foto borrada) → TOM pede pra digitar o valor.

- [ ] **Step 3: Verificar invariante anti-órfã (a base fonte-obrigatória deve segurar)**

Via execute_sql (projeto `cesnbnrynvxvgdhfmaua`), após a bateria:
```sql
SELECT count(*) FROM pf_transactions
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  AND created_at > now() - interval '1 hour'
  AND account_id IS NULL AND card_id IS NULL;
```
Expected: 0 (nenhum lançamento via OCR ficou sem fonte).

- [ ] **Step 4: Conferir saldo/fatura no PWA**

Abrir Finanças no PWA: os lançamentos da bateria batem (cartão na fatura, caixa no saldo). Sem furo.

---

## Notas de execução
- **Sem migration, sem mudança no engine/webhook.** O OCR só produz `register_transaction`; o roteamento de fonte (em prod) faz o resto.
- **Confirmação é stateless** (conversa) — a foto vira descrição na conversa, o "grava?" e a confirmação fluem natural; ao confirmar, o LLM emite o marker. Não há tabela de pending pro OCR.
- **Modelo de visão:** `VISION_MODEL` (env `TOM_VISION_MODEL`) — OpenAI. A precisão não precisa ser perfeita: o passo "grava?" é a rede de segurança (o usuário confere antes de gravar).
- **Fora de escopo:** guardar a imagem (storage), itemizar nota, PDF (vision.js já dá fallback educado pra PDF).
