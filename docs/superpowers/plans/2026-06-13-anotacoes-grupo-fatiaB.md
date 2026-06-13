# Anotações do Grupo — Fatia B (Editor Rico + IA "Formatar com o TOM") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o textarea de markdown do corpo da ficha por um editor visual TipTap + botão "✨ Formatar com o TOM" (IA via assinatura OAuth do TOM, sem API key).

**Architecture:** PWA (RichEditor TipTap) chama `POST /internal/format-note` na VPS (proxy Vercel `/internal/*` já existe) → endpoint reusa `claude.chatRaw` (CLI `claude -p` OAuth, **sem** sanitizer de WhatsApp e **sem** fallback OpenAI) → devolve HTML → preview antes/depois → Aplicar. `body` passa a guardar HTML; compat retroativa via `bodyToHtml` no render; `htmlToPlain` limpa tags antes de injetar fichas fixadas no prompt. Zero migração de banco.

**Tech Stack:** React + TypeScript + Tailwind (DS), TipTap, marked, dompurify, vitest; backend Node CJS, Express, `node:test`, CLI `claude -p` (OAuth).

**Spec:** `docs/superpowers/specs/2026-06-13-anotacoes-grupo-fatiaB-editor-rico-ia.md`

---

## Modelo de deploy (LER ANTES — substitui os passos "git commit" do template)

- `D:\la-organizer\_remote` **NÃO é um repo git**. **Não há `git commit` por task.** A verificação de cada task é o **teste/tsc passando**.
- **PWA (`web/`)**: o auto-deploy hook (Stop) commita + pusha no fim do turno → Vercel builda. Usa **robocopy `/MIR`** em `web/src` (deleções espelham).
- **Backend (`src/`)**: vai por **SCP + `pm2 restart tom`** na task final (T12) — não espera o hook.
- Comandos (rodar de `D:\la-organizer\_remote`):
  - PWA typecheck: `cd web && npx tsc --noEmit`
  - PWA build: `cd web && npx vite build`
  - PWA testes: `cd web && npx vitest run src/lib/groupNotes.test.ts`
  - Backend syntax: `node --check src/<arquivo>.js`
  - Backend testes: `node --test src/<arquivo>.test.js`

## Convenções obrigatórias

- DS sempre (`Button`, `CustomSelect`, tokens `bg-bg-surface`/`text-fg`/`text-tom`/`border-border`). Cor `tom` (verde), nunca `brand`.
- Guardrail mobile/desktop: a tela já é responsiva (two-pane desktop / lista→detalhe mobile); não quebrar.
- **NÃO regredir** o `editorKey` (remount da "Nova ficha") nem o indicador Salvando/Salvo do `NoteEditor`.
- Todo HTML renderizado passa por `DOMPurify.sanitize(...)` — nunca `dangerouslySetInnerHTML` cru.

## File Structure

**Novos:**
- `web/src/lib/formatNote.ts` — cliente do endpoint de IA (fetch + secret).
- `web/src/screens/grupos/notes/FormatPreview.tsx` — modal antes/depois.
- `web/src/screens/grupos/notes/RichEditor.tsx` — editor TipTap + barra + fluxo de IA.
- `src/services/format-note.js` — puro: whitelist de ação + system prompt por ação.
- `src/services/format-note.test.js` — testes do puro.
- `src/services/group-notes.test.js` — testes do `htmlToPlain`.

**Modificados:**
- `web/package.json` — deps TipTap.
- `web/src/lib/groupNotes.ts` — `bodyToHtml`.
- `web/src/lib/groupNotes.test.ts` — testes do `bodyToHtml`.
- `web/src/screens/grupos/notes/NoteEditor.tsx` — textarea → `<RichEditor>`.
- `web/src/screens/grupos/notes/NoteDetail.tsx` — `bodyToHtml` no render.
- `web/vite.config.ts` — proxy local de `/internal/*` (dev + preview).
- `src/ai/claude.js` — extrai `runClaudeCli`; adiciona `chatRaw` + `stripModelHtml`.
- `src/ai/claude.test.js` — testes do `stripModelHtml`.
- `src/internal-api.js` — rota `POST /internal/format-note`.
- `src/services/group-notes.js` — `htmlToPlain` em `renderNoteContent`.

---

## Task 1: Instalar dependências TipTap (PWA)

**Files:**
- Modify: `web/package.json` (via npm install)

- [ ] **Step 1: Instalar os 5 pacotes**

Run (de `D:\la-organizer\_remote\web`):
```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-text-style @tiptap/extension-color @tiptap/extension-link
```
Expected: instala sem erro; `package.json` ganha as 5 deps.

- [ ] **Step 2: Verificar que o build ainda compila**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (sem erros — nada usa os pacotes ainda, só foram instalados).

---

## Task 2: `bodyToHtml` — render compatível HTML/markdown (PWA, puro, TDD)

**Files:**
- Modify: `web/src/lib/groupNotes.ts`
- Test: `web/src/lib/groupNotes.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

No topo de `groupNotes.test.ts`, adicionar `bodyToHtml` ao import existente:
```ts
import { filterNotes, typesWithCount, allTags, noteExcerpt, templateFor, cardSubtitle, TEMPLATES, resolveColor, resolveIcon, renumber, TYPE_DEFAULTS, bodyToHtml, type GroupNote } from './groupNotes';
```
No fim do arquivo (depois do último `describe`), adicionar:
```ts
describe('bodyToHtml (compat HTML/markdown)', () => {
  it('HTML já formatado passa direto', () => {
    expect(bodyToHtml('<p>oi <strong>Rose</strong></p>')).toBe('<p>oi <strong>Rose</strong></p>');
  });
  it('markdown legado vira HTML', () => {
    expect(bodyToHtml('**oi**')).toContain('<strong>oi</strong>');
  });
  it('texto puro com quebra vira HTML com <br> (breaks)', () => {
    expect(bodyToHtml('linha 1\nlinha 2')).toContain('<br');
  });
  it('vazio ou só espaço → string vazia', () => {
    expect(bodyToHtml('')).toBe('');
    expect(bodyToHtml('   ')).toBe('');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd web && npx vitest run src/lib/groupNotes.test.ts`
Expected: FAIL — `bodyToHtml is not exported` / não definido.

- [ ] **Step 3: Implementar**

Em `groupNotes.ts`, adicionar o import do `marked` no topo (logo após o import do supabase):
```ts
import { marked } from 'marked';
```
E adicionar a função (perto de `noteExcerpt`):
```ts
// Render compatível: se o body já é HTML (editor TipTap), usa direto; senão trata como
// markdown (notas legadas + o que o TOM escreve em texto). Retorna HTML NÃO sanitizado —
// o caller aplica DOMPurify (NoteDetail/RichEditor/FormatPreview já fazem).
export function bodyToHtml(body: string): string {
  const s = body || '';
  if (!s.trim()) return '';
  const looksHtml = /<[a-z][\s\S]*>/i.test(s);
  return looksHtml ? s : (marked.parse(s, { async: false, breaks: true }) as string);
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd web && npx vitest run src/lib/groupNotes.test.ts`
Expected: PASS (todos, incluindo os 11 antigos).

---

## Task 3: `htmlToPlain` no prompt das fixadas (backend, puro, TDD)

**Files:**
- Modify: `src/services/group-notes.js`
- Test: `src/services/group-notes.test.js` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/services/group-notes.test.js`:
```js
// Rodar: node --test src/services/group-notes.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { htmlToPlain, renderNoteContent } = require('./group-notes');

test('htmlToPlain: tira tags e mantém o texto', () => {
  assert.strictEqual(htmlToPlain('<p>Senha: <strong>123</strong></p>'), 'Senha: 123');
});
test('htmlToPlain: <br> e </p> viram quebra de linha', () => {
  assert.strictEqual(htmlToPlain('<p>a</p><p>b</p>'), 'a\nb');
  assert.strictEqual(htmlToPlain('a<br>b'), 'a\nb');
});
test('htmlToPlain: decodifica entidades básicas', () => {
  assert.strictEqual(htmlToPlain('a &amp; b &lt;x&gt;'), 'a & b <x>');
});
test('htmlToPlain: texto puro (sem tags) passa intacto', () => {
  assert.strictEqual(htmlToPlain('só texto'), 'só texto');
});
test('renderNoteContent: usa htmlToPlain no body (sem tags no prompt)', () => {
  const out = renderNoteContent({ fields: [{ label: 'Login', value: 'a@b' }], body: '<p>obs <strong>x</strong></p>' });
  assert.ok(out.includes('Login: a@b'));
  assert.ok(out.includes('obs x'));
  assert.ok(!out.includes('<'), 'nenhuma tag HTML no prompt');
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node --test src/services/group-notes.test.js`
Expected: FAIL — `htmlToPlain` não exportado.

- [ ] **Step 3: Implementar**

Em `src/services/group-notes.js`, adicionar a função antes de `renderNoteContent`:
```js
// Converte HTML em texto plano pro prompt (body agora pode ser HTML do editor TipTap).
function htmlToPlain(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
```
Trocar a linha do body em `renderNoteContent` (atual: `if (n.body) lines.push(String(n.body).trim());`) por:
```js
  if (n.body) lines.push(htmlToPlain(n.body));
```
E exportar `htmlToPlain` + `renderNoteContent` no `module.exports`:
```js
module.exports = { createGroupNote, appendGroupNote, groupNotesContext, NOTE_TYPES, sanitizeFields, htmlToPlain, renderNoteContent };
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node --test src/services/group-notes.test.js`
Expected: PASS (5 testes).

- [ ] **Step 5: Sanity check do arquivo**

Run: `node --check src/services/group-notes.js`
Expected: sem saída (OK).

---

## Task 4: `format-note.js` — validação + prompts por ação (backend, puro, TDD)

**Files:**
- Create: `src/services/format-note.js`
- Test: `src/services/format-note.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/services/format-note.test.js`:
```js
// Rodar: node --test src/services/format-note.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { ACTIONS, validateFormatRequest, systemPromptFor } = require('./format-note');

test('ACTIONS são as 4 esperadas', () => {
  assert.deepStrictEqual(ACTIONS, ['format', 'summarize', 'fix', 'tone']);
});
test('validateFormatRequest: ação inválida → erro', () => {
  assert.deepStrictEqual(validateFormatRequest({ action: 'x', html: 'oi' }), { ok: false, error: 'invalid_action' });
});
test('validateFormatRequest: html vazio → erro', () => {
  assert.deepStrictEqual(validateFormatRequest({ action: 'fix', html: '   ' }), { ok: false, error: 'invalid_html' });
});
test('validateFormatRequest: html > 20000 → too_long', () => {
  const big = 'a'.repeat(20001);
  assert.deepStrictEqual(validateFormatRequest({ action: 'fix', html: big }), { ok: false, error: 'too_long' });
});
test('validateFormatRequest: válido → ok com action/html', () => {
  assert.deepStrictEqual(validateFormatRequest({ action: 'format', html: '<p>oi</p>' }), { ok: true, action: 'format', html: '<p>oi</p>' });
});
test('systemPromptFor: cada ação tem prompt string não-vazio', () => {
  for (const a of ACTIONS) assert.ok(typeof systemPromptFor(a) === 'string' && systemPromptFor(a).length > 30);
});
test('systemPromptFor: todos pedem só HTML e proíbem inventar', () => {
  for (const a of ACTIONS) {
    const p = systemPromptFor(a);
    assert.ok(/APENAS o HTML/i.test(p));
    assert.ok(/NÃO invente/i.test(p));
  }
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node --test src/services/format-note.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/services/format-note.js`:
```js
// src/services/format-note.js — puro: valida a requisição de formatação e monta o
// system prompt por ação. SEM I/O (testável). Usado por internal-api /internal/format-note.
'use strict';

const ACTIONS = ['format', 'summarize', 'fix', 'tone'];
const MAX_HTML = 20000;

const COMMON =
  '\n\nResponda APENAS o HTML do corpo — sem cercas de código, sem texto antes ou depois, ' +
  'sem comentário. NÃO invente informação que não esteja no original.';

const SYSTEM_PROMPTS = {
  format:
    'Você organiza uma anotação bagunçada em HTML limpo. Use títulos <h2>, listas <ul><li> e ' +
    'negrito <strong> onde fizer sentido. Preserve TODOS os dados — não remova nenhuma informação.' + COMMON,
  summarize:
    'Você resume uma anotação. Devolva um parágrafo curto seguido de bullets <ul><li> com os ' +
    'pontos principais, em HTML.' + COMMON,
  fix:
    'Você corrige ortografia e gramática em português, preservando o sentido e a estrutura ' +
    'HTML existente do texto.' + COMMON,
  tone:
    'Você reescreve a anotação num tom mais claro, objetivo e profissional, mantendo todas as ' +
    'informações, em HTML.' + COMMON,
};

function validateFormatRequest(body) {
  const action = body && body.action;
  const html = body && body.html;
  if (!ACTIONS.includes(action)) return { ok: false, error: 'invalid_action' };
  if (typeof html !== 'string' || !html.trim()) return { ok: false, error: 'invalid_html' };
  if (html.length > MAX_HTML) return { ok: false, error: 'too_long' };
  return { ok: true, action, html };
}

function systemPromptFor(action) {
  return SYSTEM_PROMPTS[action] || SYSTEM_PROMPTS.format;
}

module.exports = { ACTIONS, MAX_HTML, validateFormatRequest, systemPromptFor };
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node --test src/services/format-note.test.js`
Expected: PASS (7 testes).

---

## Task 5: `claude.chatRaw` — CLI OAuth sem sanitizer de WhatsApp (backend, TDD no puro)

**Files:**
- Modify: `src/ai/claude.js`
- Test: `src/ai/claude.test.js`

**Contexto:** o `chat()` atual roda um sanitizer agressivo (corta cercas ```` ``` ````, linhas em inglês, `<details>`, tags de tool) feito pra mensagens de WhatsApp — ele **destruiria** HTML legítimo. Vamos extrair o spawn cru e adicionar `chatRaw` que só faz uma limpeza leve. **O comportamento do `chat()` (produção WhatsApp) NÃO pode mudar.**

- [ ] **Step 1: Escrever o teste que falha (limpeza leve pura)**

Adicionar ao fim de `src/ai/claude.test.js`:
```js
const { stripModelHtml } = require('./claude');

test('stripModelHtml: remove cerca ```html ... ```', () => {
  assert.strictEqual(stripModelHtml('```html\n<p>oi</p>\n```'), '<p>oi</p>');
});
test('stripModelHtml: remove cerca ``` simples', () => {
  assert.strictEqual(stripModelHtml('```\n<p>oi</p>\n```'), '<p>oi</p>');
});
test('stripModelHtml: HTML puro passa intacto (trim)', () => {
  assert.strictEqual(stripModelHtml('  <p>oi</p>  '), '<p>oi</p>');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/ai/claude.test.js`
Expected: FAIL — `stripModelHtml` não exportado (os 4 testes de `buildArgs` continuam passando).

- [ ] **Step 3: Refatorar `claude.js` (extrair spawn) + adicionar `chatRaw`/`stripModelHtml`**

Em `src/ai/claude.js`:

(a) Renomear o corpo de spawn/parse: extrair a função interna que faz **spawn + parse até obter o resultado cru**, SEM o sanitizer. Criar `_spawnClaude(systemPrompt, userPrompt)` contendo **exatamente** a lógica atual de `_chatInner` da gravação do tmpFile até obter `rawResult` (`const rawResult = typeof parsed.result === 'string' ? parsed.result : ''`), resolvendo `{ rawResult, meta }` (o mesmo objeto `meta` de hoje, sem `sanitized_chars`). **Copie verbatim** a parte de spawn/timeout/parse — não altere flags nem tratamento de erro.

(b) Criar o wrapper de fila reusável (substitui o `chat` enfileirador atual):
```js
function _enqueue(fn) {
  const job = _claudeQueue.then(fn);
  _claudeQueue = job.catch(() => {});
  return job;
}
```

(c) `chat()` passa a: montar `userPrompt` (history — mesma lógica de hoje), chamar `_enqueue(() => _spawnClaude(systemPrompt, userPrompt))`, e aplicar a **cadeia de sanitização atual VERBATIM** sobre `rawResult` (mover o bloco `.replace(...)` gigante pra uma função `sanitizeWhatsapp(rawResult)` sem mudar nenhuma regex), retornando `{ text, provider: 'claude', meta: { ...meta, sanitized_chars: rawResult.length - text.length } }`. Manter os mesmos `reject_/throw` de vazio.

(d) Adicionar:
```js
// Limpeza leve pra saída HTML (NÃO usa o sanitizer de WhatsApp). Tira cercas de código.
function stripModelHtml(raw) {
  return String(raw || '')
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

// chatRaw: CLI OAuth direto, saída HTML, SEM sanitizer de WhatsApp e SEM fallback OpenAI.
async function chatRaw(systemPrompt, userPrompt) {
  const { rawResult, meta } = await _enqueue(() => _spawnClaude(systemPrompt, userPrompt));
  const text = stripModelHtml(rawResult);
  if (!text) { const e = new Error('Claude chatRaw vazio'); e.kind = 'empty'; e.provider = 'claude'; throw e; }
  return { text, provider: 'claude', meta };
}
```

(e) Atualizar o `module.exports` para incluir `chatRaw` e `stripModelHtml` (manter `chat` e `buildArgs`):
```js
module.exports = { chat, chatRaw, buildArgs, stripModelHtml };
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `node --test src/ai/claude.test.js`
Expected: PASS (4 de `buildArgs` + 3 de `stripModelHtml`).

- [ ] **Step 5: Sanity check**

Run: `node --check src/ai/claude.js`
Expected: sem saída (OK). Conferir manualmente que a cadeia `.replace(...)` do `sanitizeWhatsapp` está idêntica à de antes (caminho WhatsApp intacto).

---

## Task 6: Endpoint `POST /internal/format-note` (backend)

**Files:**
- Modify: `src/internal-api.js`

- [ ] **Step 1: Adicionar a rota**

No topo de `src/internal-api.js`, adicionar os requires (junto dos outros):
```js
const claude = require('./ai/claude');
const { validateFormatRequest, systemPromptFor } = require('./services/format-note');
```
Adicionar a rota (perto das outras `router.post('/internal/...')`, após `/internal/checklist-completed`):
```js
// IA "Formatar com o TOM" — assinatura OAuth (CLI claude.chatRaw), SEM API key, SEM fallback.
// Body: { action: 'format'|'summarize'|'fix'|'tone', html }. Auth via x-internal-secret.
router.post('/internal/format-note', requireInternalSecret, async (req, res) => {
  const v = validateFormatRequest(req.body || {});
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

  const RACE_MS = 30000;
  try {
    const aiPromise = claude.chatRaw(systemPromptFor(v.action), v.html);
    const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('format_timeout_30s')), RACE_MS));
    const r = await Promise.race([aiPromise, timeoutPromise]);
    const html = (r && r.text ? r.text : '').trim();
    if (!html) {
      supabase.from('marker_logs').insert({ marker_type: 'NOTE_FORMATTED', result: 'rejected', reason: `empty action=${v.action}`, raw_excerpt: v.action }).then(() => {}, () => {});
      return res.status(502).json({ ok: false, error: 'tom_unavailable' });
    }
    supabase.from('marker_logs').insert({ marker_type: 'NOTE_FORMATTED', result: 'executed', reason: `action=${v.action} chars=${html.length}`, raw_excerpt: v.action }).then(() => {}, () => {});
    return res.json({ ok: true, html });
  } catch (err) {
    console.warn(`[InternalAPI] format-note falhou action=${v.action}: ${err.message?.slice(0, 200)}`);
    supabase.from('marker_logs').insert({ marker_type: 'NOTE_FORMATTED', result: 'rejected', reason: String(err.message).slice(0, 200), raw_excerpt: v.action }).then(() => {}, () => {});
    return res.status(502).json({ ok: false, error: 'tom_unavailable' });
  }
});
```

- [ ] **Step 2: Sanity check**

Run: `node --check src/internal-api.js`
Expected: sem saída (OK).

> Nota: o smoke test real (curl contra a VPS) está na T12, depois do deploy. `marker_logs.result` aceita `executed`/`rejected` (visto em outros endpoints) — por isso "rejected" no erro, não "error".

---

## Task 7: Proxy local de `/internal/*` no Vite (dev + preview)

**Files:**
- Modify: `web/vite.config.ts`

**Por quê:** o preview local (localhost:4173) hoje só faz proxy de `/api/lareport`. Sem isso, `fetch('/internal/format-note')` cai no fallback do SPA e a IA não dá pra testar no preview. Generalizamos pra encaminhar `/internal/*` → VPS (encaminhando o `x-internal-secret` que o PWA já manda). Em produção quem faz isso é o rewrite do `vercel.json` (já existe) — isto é só pro local.

- [ ] **Step 1: Adicionar o handler `/internal/*`**

Em `web/vite.config.ts`, logo após a definição de `proxyHandler` (o do lareport), adicionar:
```ts
  const internalProxyHandler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url || !req.url.startsWith('/internal/')) return next();
    const url = `${TOM_API_BASE}${req.url}`;
    const method = req.method || 'GET';
    try {
      const secret = String(req.headers['x-internal-secret'] || TOM_INTERNAL_SECRET);
      const fetchInit: RequestInit = {
        method,
        headers: {
          'x-internal-secret': secret,
          ...(req.headers['content-type'] ? { 'Content-Type': String(req.headers['content-type']) } : {}),
        },
      };
      if (method !== 'GET' && method !== 'HEAD') {
        const body = await readBody(req);
        if (body.length) fetchInit.body = body.toString('utf8');
      }
      const upstream = await fetch(url, fetchInit);
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      res.end(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'upstream_failed', detail: msg }));
    }
  };
```

- [ ] **Step 2: Registrar o handler no dev e no preview**

Dentro de `lareportProxyPlugin()`, nas duas funções `configureServer` e `configurePreviewServer`, adicionar a linha do novo handler (gate só em `TOM_API_BASE`, pois o secret pode vir do request):
```ts
    configureServer(server) {
      if (TOM_API_BASE) server.middlewares.use(internalProxyHandler);
      if (!TOM_API_BASE || !TOM_INTERNAL_SECRET) return;
      server.middlewares.use(proxyHandler);
    },
    configurePreviewServer(server) {
      if (TOM_API_BASE) server.middlewares.use(internalProxyHandler);
      if (!TOM_API_BASE || !TOM_INTERNAL_SECRET) return;
      server.middlewares.use(proxyHandler);
    },
```
(Manter as anotações de tipo existentes dos parâmetros `server`.)

- [ ] **Step 3: Verificar typecheck/build**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

---

## Task 8: Cliente `formatNote` (PWA)

**Files:**
- Create: `web/src/lib/formatNote.ts`

- [ ] **Step 1: Criar o arquivo**

```ts
// web/src/lib/formatNote.ts — chama /internal/format-note (IA via CLI OAuth do TOM).
// Mesmo padrão dos outros /internal/* (VITE_TOM_API_BASE + x-internal-secret). Em prod o
// rewrite do vercel.json encaminha; em dev/preview o proxy do vite.config.
const TOM_BASE = import.meta.env.VITE_TOM_API_BASE || '';
const INTERNAL_SECRET = import.meta.env.VITE_INTERNAL_API_SECRET || '';

export type FormatAction = 'format' | 'summarize' | 'fix' | 'tone';

export async function formatNote(
  action: FormatAction,
  html: string,
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const res = await fetch(`${TOM_BASE}/internal/format-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ action, html }),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const data = await res.json();
    return data?.ok ? { ok: true, html: String(data.html || '') } : { ok: false, reason: String(data?.error || 'unknown') };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

---

## Task 9: `FormatPreview.tsx` — modal antes/depois (PWA)

**Files:**
- Create: `web/src/screens/grupos/notes/FormatPreview.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
import DOMPurify from 'dompurify';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '../../../components/Button';

interface Props {
  beforeHtml: string;
  afterHtml: string;
  loading: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

export function FormatPreview({ beforeHtml, afterHtml, loading, onApply, onDiscard }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onDiscard}>
      <div className="bg-bg-app border border-border rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm p-md border-b border-border">
          <Sparkles size={18} className="text-tom" />
          <h3 className="text-body-lg font-semibold text-fg">Formatar com o TOM</h3>
        </div>
        {loading ? (
          <div className="flex-1 grid place-items-center p-2xl">
            <div className="flex flex-col items-center gap-sm text-fg-muted">
              <Loader2 size={28} className="animate-spin text-tom" />
              <span className="text-body-sm">O TOM tá organizando…</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-md grid md:grid-cols-2 gap-md">
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Antes</div>
              <div className="text-body-sm text-fg-muted [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(beforeHtml) }} />
            </div>
            <div>
              <div className="text-label uppercase tracking-wide text-tom mb-xs">Depois</div>
              <div className="text-body-sm text-fg [&_h2]:font-semibold [&_h2]:text-fg [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:text-fg"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(afterHtml) }} />
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-sm p-md border-t border-border">
          <Button variant="secondary" size="md" onClick={onDiscard}>Descartar</Button>
          <Button variant="primary" size="md" onClick={onApply} disabled={loading || !afterHtml}>Aplicar</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS. (Se `Button` não aceitar `disabled`, conferir a prop real em `web/src/components/Button.tsx` e usar a equivalente — checar antes de assumir.)

---

## Task 10: `RichEditor.tsx` — TipTap + barra + fluxo de IA (PWA)

**Files:**
- Create: `web/src/screens/grupos/notes/RichEditor.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
import { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import DOMPurify from 'dompurify';
import { Bold, Italic, Heading2, List, Link2, Palette, Sparkles } from 'lucide-react';
import { bodyToHtml, NOTE_COLORS } from '../../../lib/groupNotes';
import { formatNote, type FormatAction } from '../../../lib/formatNote';
import { FormatPreview } from './FormatPreview';
import { showToast } from '../../../components/Toast';

const IA_ACTIONS: { key: FormatAction; label: string }[] = [
  { key: 'format', label: 'Auto-formatar' },
  { key: 'summarize', label: 'Resumir' },
  { key: 'fix', label: 'Corrigir ortografia' },
  { key: 'tone', label: 'Deixar mais claro' },
];

export function RichEditor({ valueHtml, onChange }: { valueHtml: string; onChange: (html: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [preview, setPreview] = useState<{ before: string; after: string } | null>(null);
  const [loadingIa, setLoadingIa] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color, Link.configure({ openOnClick: false })],
    content: DOMPurify.sanitize(bodyToHtml(valueHtml)),
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[160px] text-body-sm text-fg leading-relaxed [&_h2]:text-body-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-tom [&_strong]:text-fg',
      },
    },
  });

  if (!editor) return null;

  async function runIa(action: FormatAction) {
    setMenuOpen(false);
    const before = editor!.getHTML();
    setLoadingIa(true);
    setPreview({ before, after: '' });
    const r = await formatNote(action, before);
    setLoadingIa(false);
    if (r.ok) setPreview({ before, after: r.html });
    else {
      setPreview(null);
      showToast({ kind: 'error', title: 'O TOM não conseguiu formatar agora. Tenta de novo.' });
    }
  }

  function applyPreview() {
    if (preview?.after) {
      editor!.commands.setContent(DOMPurify.sanitize(preview.after));
      onChange(editor!.getHTML());
    }
    setPreview(null);
  }

  const btn = (active: boolean) =>
    `grid place-items-center w-8 h-8 rounded-md border shrink-0 focus-ring ${active ? 'border-tom text-tom' : 'border-border text-fg-muted hover:text-fg'}`;

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center gap-1 flex-wrap p-1.5 border-b border-border bg-bg-surface relative">
        <button type="button" aria-label="Negrito" className={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></button>
        <button type="button" aria-label="Itálico" className={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></button>
        <button type="button" aria-label="Título" className={btn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></button>
        <button type="button" aria-label="Lista" className={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></button>
        <button type="button" aria-label="Cor do texto" className={btn(colorOpen)} onClick={() => setColorOpen((o) => !o)}><Palette size={15} /></button>
        <button type="button" aria-label="Link" className={btn(editor.isActive('link'))} onClick={() => {
          const url = window.prompt('URL do link:');
          if (url) editor.chain().focus().setLink({ href: url }).run();
          else editor.chain().focus().unsetLink().run();
        }}><Link2 size={15} /></button>

        <div className="ml-auto relative">
          <button type="button" onClick={() => setMenuOpen((o) => !o)} className="inline-flex items-center gap-1 text-body-sm text-tom font-medium px-2 py-1.5 rounded-md hover:bg-tom/10 focus-ring">
            <Sparkles size={15} /> Formatar com o TOM
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-48 bg-bg-elevated border border-border rounded-md shadow-lg py-1">
              {IA_ACTIONS.map((a) => (
                <button key={a.key} type="button" onClick={() => runIa(a.key)} className="w-full text-left px-3 py-2 text-body-sm text-fg hover:bg-bg-surface">{a.label}</button>
              ))}
            </div>
          )}
        </div>

        {colorOpen && (
          <div className="absolute left-0 top-full mt-1 z-30 flex flex-wrap items-center gap-xs p-2 bg-bg-elevated border border-border rounded-md shadow-lg w-60">
            {NOTE_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => { editor.chain().focus().setColor(c).run(); setColorOpen(false); }} className="w-6 h-6 rounded-full focus-ring shrink-0" style={{ background: c }} />
            ))}
            <button type="button" onClick={() => { editor.chain().focus().unsetColor().run(); setColorOpen(false); }} className="text-caption text-fg-muted px-2">limpar</button>
          </div>
        )}
      </div>

      <div className="p-3">
        <EditorContent editor={editor} />
      </div>

      {preview && (
        <FormatPreview beforeHtml={preview.before} afterHtml={preview.after} loading={loadingIa} onApply={applyPreview} onDiscard={() => setPreview(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS. (Conferir a assinatura real de `showToast` em `web/src/components/Toast.tsx` — uso `{ kind, title }`, igual ao já usado em `GrupoAnotacoes.tsx`.)

---

## Task 11: Ligar no `NoteEditor` + render do `NoteDetail` (PWA)

**Files:**
- Modify: `web/src/screens/grupos/notes/NoteEditor.tsx`
- Modify: `web/src/screens/grupos/notes/NoteDetail.tsx`

- [ ] **Step 1: NoteEditor — trocar o textarea pelo RichEditor**

Adicionar o import no topo de `NoteEditor.tsx`:
```tsx
import { RichEditor } from './RichEditor';
```
Trocar o bloco final (atual — o rótulo "Anotações livres (markdown)" + `<textarea>`, linhas ~109-111) por:
```tsx
      <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Anotações livres</div>
      <RichEditor valueHtml={draft.body || ''} onChange={(html) => patch({ body: html })} />
```

- [ ] **Step 2: NoteDetail — usar `bodyToHtml` no render**

Em `NoteDetail.tsx`, no import de `groupNotes` (linha 4), adicionar `bodyToHtml`:
```tsx
import { NOTE_TYPE_META, resolveColor, resolveIcon, bodyToHtml, type GroupNote } from '../../../lib/groupNotes';
```
Trocar a linha 26 (`const bodyHtml = note.body ? DOMPurify.sanitize(marked.parse(...))`) por:
```tsx
  const bodyHtml = note.body ? DOMPurify.sanitize(bodyToHtml(note.body)) : '';
```
Se o import de `marked` ficar sem uso no arquivo, removê-lo (o `tsc --noEmit` acusa import não usado se `noUnusedLocals`; conferir e remover só se acusar).

- [ ] **Step 3: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npx vite build`
Expected: PASS (build verde).

---

## Task 12: Deploy backend + validação e2e + registro

**Files:** nenhum novo — deploy + validação.

- [ ] **Step 1: Rodar a bateria de testes toda**

Run (de `D:\la-organizer\_remote`):
```bash
node --test src/services/group-notes.test.js src/services/format-note.test.js src/ai/claude.test.js
cd web && npx vitest run src/lib/groupNotes.test.ts && cd ..
```
Expected: tudo PASS.

- [ ] **Step 2: Deploy do backend (SCP + restart)**

Run:
```bash
scp D:/la-organizer/_remote/src/ai/claude.js tom:/opt/LA-Organizer/src/ai/claude.js
scp D:/la-organizer/_remote/src/services/format-note.js tom:/opt/LA-Organizer/src/services/format-note.js
scp D:/la-organizer/_remote/src/services/group-notes.js tom:/opt/LA-Organizer/src/services/group-notes.js
scp D:/la-organizer/_remote/src/internal-api.js tom:/opt/LA-Organizer/src/internal-api.js
ssh tom "pm2 restart tom && sleep 2 && pm2 logs tom --lines 15 --nostream"
```
Expected: pm2 reinicia; log mostra "✅ TOM pronto" sem erro de require.

- [ ] **Step 3: Smoke test do endpoint (curl contra a VPS)**

Pegar o secret real: `ssh tom "grep INTERNAL_API_SECRET /opt/LA-Organizer/.env"`. Depois:
```bash
curl -s -X POST http://89.116.73.186/internal/format-note \
  -H "Content-Type: application/json" -H "x-internal-secret: <SECRET>" \
  -d '{"action":"format","html":"contas a pagar: luz dia 15, agua dia 20. internet vence dia 10"}'
```
Expected: JSON `{ "ok": true, "html": "<...>" }` com `<h2>`/`<ul>`. Testar erro: `-d '{"action":"x","html":"a"}'` → `400 {"ok":false,"error":"invalid_action"}`.

- [ ] **Step 4: Validar UI no preview (localhost:4173)**

Pré-requisito: `web/.env` (ou `.env.local`) com `VITE_TOM_API_BASE=http://89.116.73.186` e `VITE_INTERNAL_API_SECRET=<secret>` pro proxy/local funcionar. Subir o preview se necessário (`cd web && npx vite build && npx vite preview --port 4173`).

Usar `mcp__Claude_Preview__preview_eval` + `preview_screenshot` (limpar caches SW na navegação). Checar, no grupo Financeiro → Anotações → abrir/nova ficha:
1. Editor TipTap aparece no lugar do textarea; **negrito/itálico/título/lista/cor** funcionam (clicar e ver o texto mudar).
2. Digitar texto bagunçado → **✨ Formatar com o TOM → Auto-formatar** → modal "O TOM tá organizando…" → preview **Antes/Depois** → **Aplicar** → corpo vira HTML formatado.
3. Salvar (autosave "Salvo ✓") → **reload** → conteúdo persiste e renderiza no `NoteDetail`.
4. Abrir a ficha legada "Contas a Pagar 15/06/2026" (markdown) → abre certa no editor (via `bodyToHtml`), sem markdown cru à mostra.
5. "Nova ficha" continua abrindo limpa (não regrediu o `editorKey`).

- [ ] **Step 5: Validar o prompt do TOM (fixadas sem tags)**

Fixar uma ficha com body HTML e conferir, via `ssh tom`, que `renderNoteContent`/`groupNotesContext` entrega texto limpo (sem `<p>`/`<strong>`). Ex.: node REPL na VPS chamando `require('./src/services/group-notes').htmlToPlain('<p>x</p>')` → `x`.

- [ ] **Step 6: Registrar known issue + atualizar memória**

- Inserir em `tom_known_issues` (Supabase `cesnbnrynvxvgdhfmaua`) o código `GROUPNOTES-BODY-HTML` (área `marker`/`coordination`): "body de group_notes passou de markdown→HTML; render via bodyToHtml (compat), prompt via htmlToPlain; IA Formatar com o TOM via /internal/format-note (CLI OAuth, sem API key)."
- Atualizar `C:\Users\Texeira\.claude\projects\D--la-organizer\memory\project_groupchat_anotacoes_grupo.md` com a seção "Fatia B entregue" (TipTap + chatRaw + endpoint + bodyToHtml/htmlToPlain) e o lembrete de **segurança pré-prod** (JWT do Supabase + rate-limit no `/internal/format-note`).

- [ ] **Step 7: Fim do turno = auto-deploy do PWA**

Não fazer push manual. O Stop hook commita+pusha `web/` → Vercel builda. Conferir depois que o build da Vercel passou (sem órfãos `tsc`, graças ao `/MIR`).

---

## Self-Review (feito)

- **Cobertura da spec:** editor TipTap (T1,T10) ✓ · HTML canônico/`bodyToHtml` (T2,T11) ✓ · `htmlToPlain` no prompt (T3) ✓ · validação+prompts IA (T4) ✓ · `chatRaw` OAuth sem fallback/sanitizer (T5) ✓ · endpoint `/internal/format-note` (T6) ✓ · proxy local (T7) ✓ · cliente (T8) ✓ · preview antes/depois (T9) ✓ · wiring (T11) ✓ · segurança/testes/e2e (T12) ✓. 4 ações da IA cobertas em T4/T10.
- **Placeholders:** nenhum — todo passo de código tem o código; comandos com saída esperada.
- **Consistência de tipos:** `FormatAction` igual em `formatNote.ts`/`RichEditor.tsx`; `bodyToHtml(string):string` usado em T2/T10/T11; `validateFormatRequest`/`systemPromptFor`/`chatRaw`/`stripModelHtml`/`htmlToPlain` com assinaturas idênticas onde referenciadas; resposta `{ok,html}` consistente endpoint↔cliente.
- **Riscos sinalizados:** refator do `claude.js` exige copiar sanitizer/spawn **verbatim** (T5 step 3/5); `Button.disabled` e `showToast` a conferir antes de assumir (T9/T10).
