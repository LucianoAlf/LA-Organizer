# Reunião de Grupo — F1 (Núcleo do Motor) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar task a task. Steps usam checkbox (`- [ ]`).

**Goal:** O engine passa a criar reunião de grupo como **1 evento (do criador) + N participantes** quando o marker traz `attendees`, avisando cada convidado — sem tocar o caminho de hoje (evento simples / `to_name` 1:1).

**Architecture:** Helper puro `resolveAttendees(names, resolveOne)` (resolvedor injetado → testável) + um bloco novo em `applyEventActions`, DEPOIS da criação normal do evento: se `e.attendees` presente, resolve os nomes, insere `event_participants` e notifica cada um. O evento em si nasce no fluxo de hoje (agenda do criador) — a parte nova é só ADITIVA.

**Tech Stack:** Node.js CommonJS, `node --test`, Supabase (`event_participants`).

## Global Constraints

- **Zero-regressão:** o ramo novo só ativa com `e.attendees` (array, length ≥ 1). Sem `attendees` → caminho de hoje byte a byte. Golden obrigatório.
- **`to_name` (1:1) intacto:** `attendees` NÃO usa `to_name` — o evento fica na agenda do CRIADOR (`collaborator_id = collaborator.id`), os convidados viram `event_participants`. `to_name` (evento na agenda do outro) segue separado e inalterado.
- **Honestidade:** nome sem match → NÃO aborta; cria o evento + convida os resolvidos + reporta quem faltou. Nunca dizer "convidei todos" se faltou (rede `SEND-CLAIM-NOMARKER` já cobre o vazio).
- **Resolvedor real:** `resolveCollaboratorByName(name, opts)` (engine.js:3591) → `{ status:'resolved'|..., collaborator }`. O to_name usa opts com o criador como contexto (engine.js:2391-2405) — replicar.
- **`.deploy-hold`** na raiz ANTES de editar `engine.js` (Task 2). Deploy gated com OK do Alf (Task 3).
- Supabase `cesnbnrynvxvgdhfmaua`. Deploy: `scp` + `ssh tom "pm2 restart tom"`.

---

### Task 1: Helper puro `resolveAttendees` (novo módulo)

**Files:**
- Create: `src/lib/resolve-attendees.js`
- Test: `src/lib/resolve-attendees.test.js`

**Interfaces:**
- Produces: `resolveAttendees(names: string[], resolveOne: (name)=>Promise<{status,collaborator}>) → Promise<{ resolved: Array<{name, collaborator}>, unresolved: string[] }>`. Deduplica por `collaborator.id`. Resolvedor injetado (puro/testável).

- [ ] **Step 1: Escrever os testes que falham** — `src/lib/resolve-attendees.test.js`

```js
// Rodar: node --test src/lib/resolve-attendees.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveAttendees } = require('./resolve-attendees');

// resolvedor-stub: nomes conhecidos → resolved; resto → not_found
const DB = { 'anne': { id: 'a1', full_name: 'Anne' }, 'quintela': { id: 'q1', full_name: 'Quintela' }, 'yuri': { id: 'y1', full_name: 'Yuri' } };
const stub = async (name) => {
  const c = DB[name.trim().toLowerCase()];
  return c ? { status: 'resolved', collaborator: c } : { status: 'not_found', collaborator: null };
};

test('todos resolvem', async () => {
  const r = await resolveAttendees(['Anne', 'Quintela', 'Yuri'], stub);
  assert.strictEqual(r.resolved.length, 3);
  assert.deepStrictEqual(r.unresolved, []);
  assert.strictEqual(r.resolved[0].collaborator.id, 'a1');
});

test('parcial: 2 resolvem, 1 não → unresolved preserva o nome', async () => {
  const r = await resolveAttendees(['Anne', 'Fulano', 'Yuri'], stub);
  assert.strictEqual(r.resolved.length, 2);
  assert.deepStrictEqual(r.unresolved, ['Fulano']);
});

test('dedup: mesma pessoa duas vezes entra uma vez', async () => {
  const r = await resolveAttendees(['Anne', 'anne', 'ANNE'], stub);
  assert.strictEqual(r.resolved.length, 1);
});

test('vazio/nulo/espaços → seguro', async () => {
  assert.deepStrictEqual(await resolveAttendees([], stub), { resolved: [], unresolved: [] });
  assert.deepStrictEqual(await resolveAttendees(null, stub), { resolved: [], unresolved: [] });
  const r = await resolveAttendees(['  ', 'Anne'], stub);
  assert.strictEqual(r.resolved.length, 1);
  assert.deepStrictEqual(r.unresolved, []);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd /d/la-organizer/_remote && node --test src/lib/resolve-attendees.test.js`
Expected: FAIL — `Cannot find module './resolve-attendees'`.

- [ ] **Step 3: Implementar `resolve-attendees.js`**

```js
'use strict';
// Reunião de grupo (F1) — resolve nomes de convidados → colaboradores, deduplicando por id.
// Puro: o resolvedor é injetado (no engine é resolveCollaboratorByName). Nome sem match NÃO
// aborta — vai pra `unresolved` pro engine reportar honesto. Ver
// docs/superpowers/specs/2026-07-01-reuniao-grupo-design.md
async function resolveAttendees(names, resolveOne) {
  const resolved = [];
  const unresolved = [];
  const seen = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const r = await resolveOne(name);
    if (r && r.status === 'resolved' && r.collaborator && r.collaborator.id) {
      if (seen.has(r.collaborator.id)) continue;
      seen.add(r.collaborator.id);
      resolved.push({ name, collaborator: r.collaborator });
    } else {
      unresolved.push(name);
    }
  }
  return { resolved, unresolved };
}

module.exports = { resolveAttendees };
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `node --test src/lib/resolve-attendees.test.js`
Expected: PASS — 4 testes verdes.

- [ ] **Step 5: Commit** (o auto-deploy hook commita no fim do turno; não fazer git manual).

---

### Task 2: Ramo `attendees` no `applyEventActions` + golden

**Files:**
- Modify: `src/engine.js` (após a criação do evento em `applyEventActions`, ~linha 2470; o log `[Event] create` está em 2476)
- Test: `src/engine-attendees.test.js` (golden — roda na VPS, puxa `../supabase/client`)

**Interfaces:**
- Consumes: `resolveAttendees` de `./lib/resolve-attendees`; `resolveCollaboratorByName` (engine.js:3591); a msg de convite existente (engine.js:2549).
- Produces: quando `e.attendees` (array length ≥ 1) presente numa criação de evento, o engine cria **1** evento (agenda do criador), insere `event_participants` (`status='invited'`) pra cada convidado resolvido, notifica cada um, e acumula `{ participantsAdded, unresolved }` no `integrityPayload`/retorno pro engine reportar. Sem `attendees` → nada muda.

- [ ] **Step 1: `.deploy-hold`**

Run: `touch /d/la-organizer/.deploy-hold && echo held`

- [ ] **Step 2: Escrever o golden que falha** — `src/engine-attendees.test.js`

```js
// Roda na VPS: ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/engine-attendees.test.js"
// Golden estrutural: garante que o parser de EVENT_CREATE ACEITA o campo attendees (não rejeita
// por schema) — a persistência real é validada live na Task 3 (precisa de collaborators reais).
const { test } = require('node:test');
const assert = require('node:assert');
const { parseEventCreateMarker } = require('./engine'); // se não exportado, ver nota abaixo

test('parser aceita attendees como array de nomes', () => {
  const raw = '<<EVENT_CREATE>>[{"title":"Reunião X","start_at":"2026-07-03T09:00:00-03:00","end_at":"2026-07-03T10:00:00-03:00","modality":"presencial","category":"la_music","attendees":["Anne","Quintela"]}]<<END>>';
  const parsed = parseEventCreateMarker(raw);
  assert.ok(parsed && parsed.events && parsed.events[0]);
  assert.deepStrictEqual(parsed.events[0].attendees, ['Anne', 'Quintela']);
});
```

> **Nota:** se `parseEventCreateMarker` não estiver exportado, o golden vira um teste do schema-validator do EVENT (localizar como o marker é validado — grep `attendees` / `EVENT_CREATE` schema) OU validar via `applyEventActions` com stub. O executor confirma lendo o parser antes de escrever o teste.

- [ ] **Step 3: Rodar o golden na VPS e confirmar que falha** (attendees ainda é campo desconhecido/ignorado)

Run: `scp src/engine.js src/engine-attendees.test.js src/lib/resolve-attendees.js tom:/opt/LA-Organizer/src/ ... && ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/engine-attendees.test.js"`
Expected: FAIL (attendees não sobrevive ao parse/validação).

- [ ] **Step 4: Implementar o ramo `attendees`**

No topo do `applyEventActions` (require perto dos outros): `const { resolveAttendees } = require('./lib/resolve-attendees');`.

Garantir que `attendees` sobreviva à validação do EVENT_CREATE (whitelist do schema — mesmo lugar que aceita `to_name`/`checklist`). Depois, **após** o evento ser criado com sucesso (onde `data` = evento criado, ~linha 2470, e ANTES do bloco de reminders ~2557), inserir:

```js
// Reunião de grupo (F1) — 1 evento + N participantes. attendees vive na agenda do CRIADOR
// (não usa to_name). Resolve nomes, insere event_participants (invited), notifica cada um.
if (data?.id && Array.isArray(e.attendees) && e.attendees.length > 0) {
  try {
    const { resolved, unresolved } = await resolveAttendees(
      e.attendees,
      (nm) => resolveCollaboratorByName(nm, { requesterId: collaborator.id, activeOnly: true })
    );
    for (const { collaborator: part } of resolved) {
      if (part.id === collaborator.id) continue; // criador não é convidado de si
      await supabase.from('event_participants').upsert({
        event_id: data.id, collaborator_id: part.id, status: 'invited',
        invited_by: collaborator.id, invited_at: new Date().toISOString(),
      }, { onConflict: 'event_id,collaborator_id' });
      // reusa a msg de convite existente (a mesma do to_name, engine.js:2549)
      if (!opts.suppressNotify && part.phone) {
        const senderName = (collaborator.preferred_name || collaborator.full_name || '').split(' ')[0];
        const whenStr = (safeDate(e.start_at)?.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })) || e.start_at;
        const locPart = e.location_text ? `\n📍 ${String(e.location_text).slice(0, 80)}` : '';
        const msg = `📅 *${senderName}* te convidou pra um compromisso:\n\n*${row.title}*\n🗓️ ${whenStr}${locPart}\n\nConfirma presença? (responde "vou" ou "não posso")`;
        whatsapp.sendMessage(part.phone, msg).catch(err => console.error(`[Event] invite err: ${err.message}`));
        await logConversation(part.id, 'outbound', `[convite de ${senderName}: ${row.title}]`);
      }
    }
    console.log(`[Event] attendees: ${resolved.length} convidados, ${unresolved.length} não resolvidos (${unresolved.join(',')}) event=${String(data.id).slice(0,8)}`);
    // guarda pro engine reportar honesto no reply
    integrityPayload = { ...(integrityPayload || {}), attendeesAdded: resolved.length, attendeesUnresolved: unresolved };
  } catch (attErr) {
    console.warn('[Event] attendees branch err (non-fatal):', attErr.message);
  }
}
```

Notas (executor confirma lendo):
- `resolveCollaboratorByName` opts: replicar o objeto que o `to_name` passa em engine.js:2391-2405 (não inventar chaves — usar as reais).
- `safeDate`, `whatsapp`, `logConversation`, `row`, `opts` já estão em escopo no loop (usados na vizinhança 2508-2552).
- `integrityPayload` é a via de retorno já usada no loop; o engine lê no report pós-`applyEventActions` (~10176). Se o formato não casar, usar o mesmo canal do `okCount`/`failCount`.

- [ ] **Step 5: `node --check` + golden verde na VPS**

Run: `node --check src/engine.js && echo OK` (local) → deploy → `ssh tom "... node --env-file=.env --test src/engine-attendees.test.js"`
Expected: PASS (attendees sobrevive ao parse).

---

### Task 3: Deploy gated + verificação live + registro

**Files:** nenhum novo.

- [ ] **Step 1: Deploy** — `scp src/lib/resolve-attendees.js src/engine.js tom:/opt/LA-Organizer/src/...` (caminhos certos) + `ssh tom "node --check ... && pm2 restart tom"`.

- [ ] **Step 2: Verificação live (com OK do Alf)** — Alf manda um marker de grupo OU a F2 (skill) já emite. Confere no banco: 1 evento (agenda do Alf) + N `event_participants` `status=invited` + N convites outbound. `EVENT_CREATE` reason `ok=1` (sem `held_dup`).

- [ ] **Step 3: Remover `.deploy-hold`** (`rm -f /d/la-organizer/.deploy-hold`) + registrar `REUNIAO-GRUPO-F1` no `tom_known_issues` (status corrigido, causa = N-eventos vs 1+participantes) + atualizar memória.

---

## Self-Review

**Cobertura da spec (F1):** modelo 1-evento-N-participantes → Task 2 ✅; resolver nomes + parcial → Task 1 ✅; notificar cada convidado → Task 2 ✅; reporte honesto (unresolved) → Task 2 (integrityPayload) ✅; zero-regressão sem attendees → golden Task 2 ✅. Fora de F1 (planos seguintes): skill de grupo (F2), RSVP→organizador (F3), lembrete participante (F4), PWA picker (F5).

**Placeholders:** o único ponto "executor confirma lendo" é a whitelist do schema do EVENT (onde aceitar `attendees`) e as opts exatas do `resolveCollaboratorByName` — ambos são DRY sobre código existente (o `to_name`/`checklist` já fazem o mesmo), não invenção. Explicitado.

**Consistência de tipos:** `resolveAttendees → { resolved:[{name,collaborator}], unresolved:[] }` (Task 1) consumido igual na Task 2. `event_participants` colunas (`event_id, collaborator_id, status, invited_by, invited_at`) batem com o insert existente em engine.js:2510.
