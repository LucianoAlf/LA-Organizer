# Trava de Dedup de NOTA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir, deterministicamente no engine, que o TOM crie uma NOTA pessoal que já existe — independente do modelo (Claude ou Codex).

**Architecture:** Extrair as primitivas de similaridade que hoje vivem inline no dedup de tarefa para um util puro compartilhado; construir um detector de nota duplicada em cima delas; plugar no único choke-point de create de nota (`engine.js:9567`), bloqueando + avisando + oferecendo anexar. Bypass de re-tentativa via Map em memória (espelha `pendingDupTasks`), sem `pending_intent` (sidestepa o landmine da CHECK constraint).

**Tech Stack:** Node CJS (`_remote/src/`), `node --test`, Supabase JS client (injetado).

## Global Constraints
- TUDO em PT-BR nas falas do TOM; comportamento/tom do TOM é sagrado (não mexer no jeito das respostas).
- `collaborator_id` da nota = SEMPRE o REMETENTE (`collab.id`), nunca do marker.
- Backend Node CJS; validação `node --check` + `node --test` com cwd `_remote`.
- Deploy (scp tom + pm2 restart) **só com OK explícito do Alf** — deploy de produção exige autorização.
- Caminho de TAREFA é sagrado: a extração das primitivas NÃO pode mudar o comportamento de `detectDuplicateSemanticTask` (garantido por teste).
- Escopo: só NOTAS PESSOAIS (`NOTE_ACTION` create). Tarefas já têm dedup; notas de grupo (`group_notes`) = fast-follow.

---

### Task 1: Extrair primitivas de similaridade pra util compartilhado

**Files:**
- Create: `_remote/src/services/text-similarity.js`
- Create: `_remote/src/services/text-similarity.test.js`
- Modify: `_remote/src/engine.js` (remove defs inline `jaroWinkler` 6395-6427 e `normalizeForSim` 6430-6432; adiciona require)

**Interfaces:**
- Produces: `jaroWinkler(s1: string, s2: string): number` (0..1) e `normalizeForSim(s: string): string` — **idênticas** às de hoje no engine.

- [ ] **Step 1: Criar o util com as funções movidas VERBATIM do engine.js**

`_remote/src/services/text-similarity.js`:
```js
// src/services/text-similarity.js — primitivas puras de similaridade textual.
// Extraídas VERBATIM do engine.js (Sprint 18, dedup de tarefa/evento) pra serem
// compartilhadas com o dedup de NOTA. Sem I/O, sem estado. Mudar aqui = mudar tarefa
// também: cobertas por golden em text-similarity.test.js.
'use strict';

/** Jaro-Winkler similarity — retorna 0..1. Implementação pura, ideal p/ títulos curtos. */
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  const len1 = s1.length, len2 = s2.length;
  if (!len1 || !len2) return 0.0;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - matchDist);
    const hi = Math.min(i + matchDist + 1, len2);
    for (let j = lo; j < hi; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0.0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Normaliza string para comparação: lowercase, remove pontuação/dígitos, trim. */
function normalizeForSim(s) {
  return String(s || '').toLowerCase().replace(/[^a-záàãâéêíóôõúüç\s]/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { jaroWinkler, normalizeForSim };
```

- [ ] **Step 2: Escrever o golden test (fixa o comportamento atual)**

`_remote/src/services/text-similarity.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { jaroWinkler, normalizeForSim } = require('./text-similarity');

test('jaroWinkler: idênticos = 1', () => {
  assert.strictEqual(jaroWinkler('lista de compras', 'lista de compras'), 1.0);
});
test('jaroWinkler: vazio = 0', () => {
  assert.strictEqual(jaroWinkler('', 'x'), 0.0);
});
test('jaroWinkler: títulos quase-iguais > 0.85 (golden C7)', () => {
  const s = jaroWinkler(normalizeForSim('Lista de compras'), normalizeForSim('Lista de compras — mercado'));
  assert.ok(s > 0.85, `esperava > 0.85, veio ${s}`);
});
test('jaroWinkler: títulos distintos < 0.7', () => {
  const s = jaroWinkler(normalizeForSim('Comprar cabos'), normalizeForSim('Revisar relatório'));
  assert.ok(s < 0.7, `esperava < 0.7, veio ${s}`);
});
test('normalizeForSim: lowercase + remove acento/pontuação/dígitos', () => {
  assert.strictEqual(normalizeForSim('Reunião 12/06!'), 'reunião');
  assert.strictEqual(normalizeForSim('  Lista, de  Compras  '), 'lista de compras');
});
```

- [ ] **Step 3: Rodar o teste — deve PASSAR (funções já corretas, é golden)**

Run: `cd /d/la-organizer/_remote && node --test src/services/text-similarity.test.js`
Expected: 5 pass, 0 fail.

- [ ] **Step 4: Rewire o engine.js — remover defs inline e requerer do util**

Em `_remote/src/engine.js`, REMOVER as definições inline `function jaroWinkler(...)` (linhas ~6395-6427) e `function normalizeForSim(...)` (linhas ~6430-6432). Adicionar perto do topo dos requires de services (procure outros `require('./services/...')`):
```js
const { jaroWinkler, normalizeForSim } = require('./services/text-similarity');
```
ATENÇÃO: `jaroWinkler`/`normalizeForSim` são usados em vários pontos (1664, 1675, 1902-1907, 6521-6537, 6628-6668, 9411-9415) — todos passam a usar a versão importada. NÃO mexer em `stripVerbPrefix`/`extractSuffix` (ficam inline, são só de tarefa/evento).

- [ ] **Step 5: Verificar que o engine carrega e a dedup de tarefa não quebrou**

Run: `cd /d/la-organizer/_remote && node --check src/engine.js && node -e "const e=require('./src/engine.js'); console.log('engine load OK')"`
Expected: `syntax OK` implícito + `engine load OK` (sem erro de require/símbolo).
Nota: se o `node -e` falhar por dependência de ambiente (env/DB), basta o `node --check` passar + uma busca confirmando que não sobrou nenhuma chamada a `jaroWinkler`/`normalizeForSim` sem a função existir.

- [ ] **Step 6: Commit**
```bash
git add _remote/src/services/text-similarity.js _remote/src/services/text-similarity.test.js _remote/src/engine.js
git commit -m "refactor: extrai jaroWinkler/normalizeForSim p/ text-similarity.js (compartilhado nota/tarefa)"
```

---

### Task 2: Detector de nota duplicada (`note-dedup.js`)

**Files:**
- Create: `_remote/src/services/note-dedup.js`
- Create: `_remote/src/services/note-dedup.test.js`

**Interfaces:**
- Consumes: `jaroWinkler`, `normalizeForSim` de `./text-similarity`.
- Produces:
  - `scoreNoteSimilarity(cand: {title,body}, existing: {title,body}): {titleSim:number, bodyOverlap:number}` — **puro**.
  - `isProbableDuplicate(cand, existing): boolean` — **puro**; true se `titleSim >= 0.85 AND bodyOverlap >= 0.4`.
  - `findDuplicateNote(supabase, collaboratorId: string, cand: {title,body}): Promise<{note, titleSim, bodyOverlap}|null>`.

- [ ] **Step 1: Escrever os testes (falham primeiro)**

`_remote/src/services/note-dedup.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreNoteSimilarity, isProbableDuplicate, findDuplicateNote } = require('./note-dedup');

const C7_EXISTING = { title: 'Lista de compras — mercado', body: '5kg de arroz\n2kg de feijão\nBiscoitos para Alice\nIogurte para a Alice' };
const C7_NEW = { title: 'Lista de compras', body: '5kg de arroz\n2 kg de feijão\nBiscoitos para Alice levar para a escola' };

test('C7: mesma lista, título diferente → duplicata', () => {
  assert.strictEqual(isProbableDuplicate(C7_NEW, C7_EXISTING), true);
});
test('Reunião com datas diferentes e corpo diferente → NÃO duplicata', () => {
  const a = { title: 'Reunião 12/06', body: 'Pauta: orçamento Q2, contratações' };
  const b = { title: 'Reunião 19/06', body: 'Pauta: retrospectiva, planejamento da Barra' };
  assert.strictEqual(isProbableDuplicate(a, b), false);
});
test('Títulos totalmente diferentes → NÃO duplicata', () => {
  const a = { title: 'Ideias de marketing', body: 'reels, parcerias' };
  const b = { title: 'Lista de compras', body: 'arroz, feijão' };
  assert.strictEqual(isProbableDuplicate(a, b), false);
});
test('Mesmo título, corpos sem overlap → NÃO duplicata (notas distintas homônimas)', () => {
  const a = { title: 'Anotações', body: 'comprar presente da Alice' };
  const b = { title: 'Anotações', body: 'ligar pro contador sobre imposto' };
  assert.strictEqual(isProbableDuplicate(a, b), false);
});
test('scoreNoteSimilarity retorna titleSim e bodyOverlap', () => {
  const s = scoreNoteSimilarity(C7_NEW, C7_EXISTING);
  assert.ok(s.titleSim > 0.85 && s.bodyOverlap >= 0.4, JSON.stringify(s));
});
test('findDuplicateNote: acha a melhor acima do limiar', async () => {
  const fakeSupabase = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [C7_EXISTING, { title: 'Outra coisa', body: 'nada a ver' }] }) }) }) }) }) }) };
  const r = await findDuplicateNote(fakeSupabase, 'collab-1', C7_NEW);
  assert.ok(r && r.note.title === 'Lista de compras — mercado', JSON.stringify(r));
});
test('findDuplicateNote: nada parecido → null', async () => {
  const fakeSupabase = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ title: 'Ideias projeto X', body: 'foo' }] }) }) }) }) }) }) };
  const r = await findDuplicateNote(fakeSupabase, 'collab-1', C7_NEW);
  assert.strictEqual(r, null);
});
```

- [ ] **Step 2: Rodar — deve FALHAR (módulo não existe)**

Run: `cd /d/la-organizer/_remote && node --test src/services/note-dedup.test.js`
Expected: FAIL — `Cannot find module './note-dedup'`.

- [ ] **Step 3: Implementar `note-dedup.js`**

`_remote/src/services/note-dedup.js`:
```js
// src/services/note-dedup.js — dedup determinística de NOTA pessoal (provider-agnóstica).
// Espelha o dedup de tarefa: dup exige título-similar E overlap-de-corpo (um sinal só
// não basta — "Reunião 12/06" vs "19/06" têm título similar mas corpos distintos).
'use strict';
const { jaroWinkler, normalizeForSim } = require('./text-similarity');

const TITLE_MIN = 0.85;   // limiar de similaridade de título (tunável)
const BODY_MIN = 0.40;    // limiar de overlap de corpo (tunável)

// tokens significativos do corpo (mantém dígitos: "5kg", "12" distinguem notas)
function bodyTokens(s) {
  return new Set(
    String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter((w) => w.length >= 3),
  );
}

function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  return inter / Math.min(aSet.size, bSet.size); // overlap-coefficient (mais tolerante a tamanho)
}

function scoreNoteSimilarity(cand, existing) {
  const titleSim = jaroWinkler(normalizeForSim(cand.title || ''), normalizeForSim(existing.title || ''));
  const bodyOverlap = jaccard(bodyTokens(cand.body), bodyTokens(existing.body));
  return { titleSim, bodyOverlap };
}

function isProbableDuplicate(cand, existing) {
  const { titleSim, bodyOverlap } = scoreNoteSimilarity(cand, existing);
  return titleSim >= TITLE_MIN && bodyOverlap >= BODY_MIN;
}

async function findDuplicateNote(supabase, collaboratorId, cand) {
  const { data } = await supabase.from('notes')
    .select('id, title, body')
    .eq('collaborator_id', collaboratorId)
    .eq('archived', false)
    .order('updated_at', { ascending: false })
    .limit(50);
  let best = null;
  for (const n of (data || [])) {
    if (!isProbableDuplicate(cand, n)) continue;
    const s = scoreNoteSimilarity(cand, n);
    if (!best || s.titleSim > best.titleSim) best = { note: n, ...s };
  }
  return best;
}

module.exports = { scoreNoteSimilarity, isProbableDuplicate, findDuplicateNote, TITLE_MIN, BODY_MIN };
```

- [ ] **Step 4: Rodar — deve PASSAR (7/7)**

Run: `cd /d/la-organizer/_remote && node --test src/services/note-dedup.test.js`
Expected: 7 pass, 0 fail. Se algum limiar ficar no fio, ajustar `TITLE_MIN`/`BODY_MIN` e re-rodar (são tunáveis por design).

- [ ] **Step 5: Commit**
```bash
git add _remote/src/services/note-dedup.js _remote/src/services/note-dedup.test.js
git commit -m "feat: note-dedup.js — detector determinístico de nota duplicada (título-sim + overlap-corpo)"
```

---

### Task 3: Plugar a trava no handler de `NOTE_ACTION` create

**Files:**
- Modify: `_remote/src/engine.js` (handler `NOTE_ACTION`, ~9548-9586; + require + Map no topo do módulo)

**Interfaces:**
- Consumes: `findDuplicateNote` de `./services/note-dedup`; `normalizeForSim` de `./services/text-similarity` (já requerido na Task 1).

- [ ] **Step 1: Adicionar require + Map de bypass no topo do engine.js**

Perto do require da Task 1, adicionar:
```js
const { findDuplicateNote } = require('./services/note-dedup');
// NOTE-DEDUP: bypass de re-tentativa. Se o usuário insistir ("cria outra mesmo") logo após
// um bloqueio, a 2ª tentativa do MESMO título passa. Em memória (espelha pendingDupTasks);
// no pior caso de restart, o usuário leva 1 aviso "já existe?" a mais. TTL curto.
const recentNoteDupBlocks = new Map(); // key: `${collabId}|${normTitle}` -> ts
const NOTE_DEDUP_BYPASS_MS = 5 * 60 * 1000;
```

- [ ] **Step 2: Reescrever o bloco `else if (parsedNote)` com a trava no create**

Substituir o corpo de `} else if (parsedNote) {` (engine.js ~9556-9585) por:
```js
    } else if (parsedNote) {
      const a = parsedNote.action;
      let dupBlocked = false;

      // NOTE-DEDUP trava (provider-agnóstica): não duplicar nota que já existe.
      if (a.action === 'create') {
        let dup = null;
        try { dup = await findDuplicateNote(supabase, collab.id, { title: a.title, body: a.body }); }
        catch (eDup) { console.warn('[NoteDedup] non-fatal:', eDup.message); }
        const dupKey = `${collab.id}|${normalizeForSim(a.title)}`;
        const fresh = recentNoteDupBlocks.get(dupKey);
        const nowMs = Date.now();
        if (dup && !(fresh && nowMs - fresh < NOTE_DEDUP_BYPASS_MS)) {
          dupBlocked = true;
          recentNoteDupBlocks.set(dupKey, nowMs); // arma o bypass p/ re-tentativa
          await logMarker(collab.id, 'NOTE_ACTION', 'skipped', `dup:${String(dup.note.id).slice(0, 8)} t=${dup.titleSim.toFixed(2)} b=${dup.bodyOverlap.toFixed(2)}`, null);
          const baseN = (parsedNote.cleanText || '').trim();
          const corpo = String(dup.note.body || '').slice(0, 500);
          reply = (baseN ? baseN + '\n\n' : '') +
            `📋 Essa anotação já existe: *${dup.note.title}*\n\n${corpo}\n\nQuer que eu *adicione* os itens novos nela? Responde "anexa" que eu coloco lá.`;
        } else if (dup && fresh) {
          recentNoteDupBlocks.delete(dupKey); // re-tentativa confirmada → segue e cria
        }
      }

      if (!dupBlocked) {
        let res;
        let shareNotice = '';
        try {
          if (a.action === 'create' || a.action === 'share') {
            const { ids, unresolved } = await notesService.resolveShareNames(supabase, a.share_with || []);
            if (unresolved.length) {
              shareNotice = `\n\n_⚠️ não achei "${unresolved.join('", "')}" pra compartilhar — confere o nome?_`;
            }
            if (a.action === 'create') {
              res = await notesService.createNote(supabase, collab.id, { title: a.title, body: a.body, source: 'tom', sharedWith: ids });
            } else {
              res = await notesService.shareNote(supabase, collab.id, a.note, ids);
            }
          } else {
            res = await notesService.appendToNote(supabase, collab.id, a.note, a.body);
          }
        } catch (eNote) {
          res = { ok: false, error: eNote.message };
        }
        await logMarker(collab.id, 'NOTE_ACTION', res.ok ? 'executed' : 'rejected', `${a.action}:${res.ok ? 'ok' : String(res.error).slice(0, 120)}`, null);
        let baseN = parsedNote.cleanText || '';
        if (!res.ok) {
          baseN = (baseN ? baseN + '\n\n' : '') + (res.error === 'note_not_found'
            ? '_não achei essa anotação. Me diz o título que eu procuro._'
            : '_⚠️ não consegui salvar a anotação agora — tenta de novo?_');
        }
        reply = (baseN || reply) + shareNotice;
      }
    }
```

- [ ] **Step 3: Verificar sintaxe**

Run: `cd /d/la-organizer/_remote && node --check src/engine.js`
Expected: sem erro.

- [ ] **Step 4: Commit**
```bash
git add _remote/src/engine.js
git commit -m "feat: trava de dedup no NOTE_ACTION create (bloqueia + avisa + oferece anexar; bypass de re-tentativa)"
```

---

### Task 4: Teste de integração no engine (prova provider-agnóstica)

**Files:**
- Create: `_remote/src/services/note-dedup.integration.test.js`

Prova que, dada uma nota duplicada, o create é bloqueado — sem subir o engine inteiro (testa a composição `findDuplicateNote` + a regra de decisão do handler, isolada numa função-espelho do bloco do handler).

- [ ] **Step 1: Escrever o teste de integração**

`_remote/src/services/note-dedup.integration.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findDuplicateNote } = require('./note-dedup');

// Espelha a REGRA do handler (Task 3) sem subir o engine: bloqueia se há dup e não há bypass fresco.
function decideNoteCreate({ dup, fresh, nowMs, bypassMs }) {
  if (dup && !(fresh && nowMs - fresh < bypassMs)) return 'blocked';
  return 'create';
}

const EXISTING = { id: 'n1', title: 'Lista de compras — mercado', body: '5kg de arroz\n2kg de feijão\nBiscoitos para Alice' };
function supaWith(notes) {
  return { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: notes }) }) }) }) }) }) };
}

test('nota duplicada presente → 1ª tentativa BLOQUEIA (não cria)', async () => {
  const dup = await findDuplicateNote(supaWith([EXISTING]), 'c1', { title: 'Lista de compras', body: '5kg de arroz\n2 kg de feijão\nBiscoitos para Alice levar pra escola' });
  assert.ok(dup, 'devia achar duplicata');
  assert.strictEqual(decideNoteCreate({ dup, fresh: undefined, nowMs: 1000, bypassMs: 300000 }), 'blocked');
});

test('re-tentativa dentro da janela → CRIA (bypass)', async () => {
  const dup = await findDuplicateNote(supaWith([EXISTING]), 'c1', { title: 'Lista de compras', body: '5kg de arroz\n2 kg de feijão' });
  assert.strictEqual(decideNoteCreate({ dup, fresh: 1000, nowMs: 2000, bypassMs: 300000 }), 'create');
});

test('sem nota parecida → CRIA normal', async () => {
  const dup = await findDuplicateNote(supaWith([{ id: 'n9', title: 'Plano de aula', body: 'escalas maiores' }]), 'c1', { title: 'Lista de compras', body: 'arroz feijão' });
  assert.strictEqual(dup, null);
  assert.strictEqual(decideNoteCreate({ dup, fresh: undefined, nowMs: 1, bypassMs: 300000 }), 'create');
});
```

- [ ] **Step 2: Rodar — deve PASSAR (3/3)**

Run: `cd /d/la-organizer/_remote && node --test src/services/note-dedup.integration.test.js`
Expected: 3 pass, 0 fail.

- [ ] **Step 3: Rodar TODA a suíte nova junta (sanidade)**

Run: `cd /d/la-organizer/_remote && node --test src/services/text-similarity.test.js src/services/note-dedup.test.js src/services/note-dedup.integration.test.js`
Expected: 15 pass, 0 fail.

- [ ] **Step 4: Commit**
```bash
git add _remote/src/services/note-dedup.integration.test.js
git commit -m "test: integração da trava de dedup de nota (bloqueia/​bypass/​cria)"
```

---

### Task 5: Deploy + smoke + registro

**Files:** nenhum (deploy + DB).

- [ ] **Step 1: PEDIR OK EXPLÍCITO DO ALF pro deploy** (regra: deploy de prod exige autorização). Só seguir após "pode subir".

- [ ] **Step 2: scp dos arquivos + restart** (services → `src/services/`; engine → `src/`)
```bash
cd /d/la-organizer/_remote && scp src/services/text-similarity.js src/services/note-dedup.js tom:/opt/LA-Organizer/src/services/ && scp src/engine.js tom:/opt/LA-Organizer/src/ && ssh tom "pm2 restart tom && pm2 describe tom | grep -E 'status|restarts' | head -3"
```

- [ ] **Step 3: Smoke real com nota descartável** — criar uma nota de teste pro Alf, depois pedir pro TOM criar a MESMA via WhatsApp 1:1, confirmar que ele responde "já existe + quer anexar?" em vez de duplicar. Conferir `ritual_logs`/`logMarker` por `NOTE_ACTION skipped dup:`. Limpar a nota descartável depois.

- [ ] **Step 4: Registrar `CODEX-FALLBACK-DUP` como corrigido** em `tom_known_issues` (Supabase `cesnbnrynvxvgdhfmaua`):
```sql
UPDATE tom_known_issues
SET status='corrigido', fix_resumo='Trava determinística no engine: NOTE_ACTION create checa nota existente (título-sim ≥0.85 E overlap-corpo ≥0.4) via note-dedup.js; dup → não cria, avisa + oferece anexar; bypass de re-tentativa em memória. Provider-agnóstica (vale Claude e Codex). Primitivas extraídas p/ text-similarity.js (compartilhado c/ tarefa, golden).', corrigido_em=now()
WHERE codigo='CODEX-FALLBACK-DUP';
```
(Se ainda não existir, INSERT seguindo o protocolo do CLAUDE.md.)

- [ ] **Step 5: Atualizar memória** `project_motor_tom_sonnet_vs_gpt55` — anotar que a trava de dedup de nota foi entregue (último pré-requisito técnico do swap Codex→primário); o gap restante vira só "validar voz em volume".

---

## Notas de decisão (YAGNI / refinamentos do plano)
- **Sem `pending_intent`/migration no MVP:** o landmine da CHECK constraint (`FIN-INVOICE-INTENT-KIND-CONSTRAINT`) é sidesteppado usando Map em memória só pro bypass de re-tentativa. O "anexar" usa o action `append` que o marker JÁ suporta (o usuário diz "anexa" → o TOM emite append com os itens, frescos no histórico). Robustez de restart (guardar o corpo bloqueado) = fast-follow se necessário.
- **Match exige título-sim E overlap-corpo:** `normalizeForSim` apaga dígitos, então só título daria falso positivo em notas datadas ("Reunião 12/06" vs "19/06"). O overlap de corpo é o desempate (espelha "score + sinal compartilhado" da tarefa).
- **Notas de grupo (`group_notes`)** ficam de fora (fast-follow): mesmo `findDuplicateNote` reusado depois no caminho do `GROUP_NOTE`.
