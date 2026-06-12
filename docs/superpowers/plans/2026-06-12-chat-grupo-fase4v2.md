# Chat de Grupo — Fase 4 v2 (Espelho completo: mídia + deleção) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans pra implementar task a task. Steps usam checkbox (`- [ ]`).

**Goal:** Espelhar áudio/imagem/PDF nos dois sentidos e deleção bidirecional (estilo WhatsApp) entre o grupo de WhatsApp e o chat do app, mantendo UM TOM/UMA MEMÓRIA.

**Architecture:** Estende o pipeline poll-over-realtime do v1. Mídia reusa o bucket `group-chat` (app já sobe; engine baixa da UAZAPI e sobe via service_role). Deleção = soft-delete (`deleted_at`) com `deleted_origin`/`deleted_synced` p/ anti-eco; app→zap revoga via `/message/delete` no tick do watcher; zap→app trata o evento `messages_update` no webhook.

**Tech Stack:** Node CJS (`_remote/src`), axios→UAZAPI, Supabase (service_role no engine), `node:test`; PWA React+TS (`_remote/web`). Deploy backend por `scp ... tom:/opt/LA-Organizer/...` + `pm2 restart tom`; frontend pelo auto-deploy (Stop hook).

**Convenções (LER ANTES):**
- `_remote` **não é git**; **não** rodar `git commit`/`git add` (o Stop hook commita+deploya o `web/` no fim do turno). Backend é deployado por `scp` + `ssh tom "pm2 restart tom"`.
- `src/` **não passa por tsc** → validar com `node --check`. `web/` passa: `cd _remote/web && npx tsc --noEmit`.
- Testes puros: `node --test <arq.test.js>`. Testes/scripts com supabase/UAZAPI: rodar **na VPS** com `ssh tom "cd /opt/LA-Organizer && node --env-file=.env ..."`.
- Migrations via MCP Supabase (`apply_migration`/`execute_sql`) — pré-aprovado. Projeto `cesnbnrynvxvgdhfmaua`.
- Grupo de teste: Financeiro `id=d95f63af-5032-4120-89f2-ca4c49684cbc`, JID `120363422067640143@g.us`.
- **NÃO commitar entre tasks.** Cada task backend termina com SCP+restart; cada task frontend valida com tsc/build (o auto-deploy publica no fim do turno).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/services/uazapi-groups.js` (modificar) | `sendGroupMedia(jid, opts)` + `deleteWaMessage(id)`. |
| `src/services/group-chat-bridge-out.js` (modificar) | `buildWhatsappMedia` (pura) + envio de mídia no `runOutboundOnce` + `runDeleteSyncOnce` (revoke app→zap). |
| `src/services/group-chat-bridge-in.js` (modificar) | Mídia zap→app (download→upload→insert) + `maybeHandleGroupDelete` + `parseDeletedWaIds` (pura). |
| `src/realtime/group-chat-watcher.js` (modificar) | Chamar `runDeleteSyncOnce` no tick. |
| `src/webhook.js` (modificar) | Rotear `messages_update` p/ `maybeHandleGroupDelete` antes do `isIgnorable`. |
| `web/src/hooks/useGroupChat.ts` (modificar) | `deleteMessage(id)` + `deleted_at` no SELECT. |
| `web/src/lib/groupChat.ts` (modificar) | `deleted_at` no tipo `ChatMsg`. |
| `web/src/screens/grupos/chat/MessageBubble.tsx` (modificar) | Menu "Apagar" + render do placeholder. |

---

## Task 1: Migration — colunas de deleção + RLS de UPDATE

**Files:** aplicar via MCP `apply_migration`.

- [ ] **Step 1: Aplicar a migration**

MCP `apply_migration`, projeto `cesnbnrynvxvgdhfmaua`, name `fase4v2_soft_delete`, query:

```sql
alter table public.group_chat_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_origin text,
  add column if not exists deleted_synced boolean not null default false;

create index if not exists group_chat_messages_pending_delete
  on public.group_chat_messages (group_id)
  where deleted_at is not null and deleted_synced = false;

-- App pode marcar deleted_at na PRÓPRIA mensagem; Diretor em qualquer uma.
-- current_collab_id() = colaborador logado (módulo pessoal). is_director() já existe no schema;
-- se não existir, troque pela checagem equivalente usada nas outras policies de diretor.
drop policy if exists group_chat_messages_soft_delete on public.group_chat_messages;
create policy group_chat_messages_soft_delete
  on public.group_chat_messages for update
  using (
    sender_id = public.current_collab_id()
    or exists (
      select 1 from public.collaborators c
      where c.id = public.current_collab_id() and c.function_role = 'director'
    )
  )
  with check (true);
```

- [ ] **Step 2: Verificar colunas**

MCP `execute_sql`:
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='group_chat_messages'
  and column_name in ('deleted_at','deleted_origin','deleted_synced');
```
Esperado: 3 linhas.

- [ ] **Step 3: Confirmar a função de diretor usada na policy**

```sql
select id, function_role from public.collaborators where function_role = 'director' limit 3;
```
Esperado: ≥1 linha (Alf é director). Se `function_role` não for o campo certo de diretor, ajustar a policy do Step 1 pra casar o critério de diretor já usado no resto do schema (ex.: `is_director(current_collab_id())`).

---

## Task 2: `uazapi-groups.js` — sendGroupMedia + deleteWaMessage

**Files:** Modify `src/services/uazapi-groups.js`.

- [ ] **Step 1: Adicionar as duas funções**

Antes do `module.exports`, adicionar:

```js
// Posta MÍDIA num grupo. type: 'image' | 'document' | 'audio'. `url` é pública (bucket).
// Doc UAZAPI: POST /send/media { number, type, file(url), text(caption), docName, mimetype }.
// number aceita @g.us (confirmado no v1). Retorna o messageid.
async function sendGroupMedia(jid, { url, type, caption = '', filename = '', mimetype = '' }) {
  const payload = { number: jid, type, file: url, text: caption || '', readchat: true };
  if (filename) payload.docName = filename;
  if (mimetype) payload.mimetype = mimetype;
  const resp = await api.post('/send/media', payload);
  const d = resp.data || {};
  return d.messageid || d.id || (d.key && d.key.id) || null;
}

// Apaga uma mensagem do WhatsApp PRA TODOS. Doc UAZAPI: POST /message/delete { id }.
async function deleteWaMessage(id) {
  const resp = await api.post('/message/delete', { id });
  return resp.data || null;
}
```

E no `module.exports`, acrescentar `sendGroupMedia, deleteWaMessage` à lista existente.

- [ ] **Step 2: Syntax check + deploy (sem restart — ninguém usa ainda)**

```bash
cd _remote && node --check src/services/uazapi-groups.js && echo OK
scp src/services/uazapi-groups.js tom:/opt/LA-Organizer/src/services/uazapi-groups.js
```

---

## Task 3: `buildWhatsappMedia` (saída, função PURA) + testes

**Files:** Modify `src/services/group-chat-bridge-out.js`; Test `src/services/group-chat-bridge-out.test.js`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim de `src/services/group-chat-bridge-out.test.js`:

```js
const { buildWhatsappMedia } = require('./group-chat-bridge-out');

test('imagem de membro vira payload type=image com autoria na caption', () => {
  const r = buildWhatsappMedia(
    { role: 'member', kind: 'image', media_url: 'https://x/y.jpg', media_filename: 'y.jpg', content: 'olha o comprovante' },
    'Rose Silva'
  );
  assert.deepEqual(r, { type: 'image', url: 'https://x/y.jpg', caption: '💬 *Rose*: olha o comprovante', filename: 'y.jpg' });
});
test('pdf vira type=document', () => {
  const r = buildWhatsappMedia({ role: 'member', kind: 'pdf', media_url: 'https://x/b.pdf', media_filename: 'boleto.pdf' }, 'Ana');
  assert.equal(r.type, 'document');
  assert.equal(r.caption, '💬 *Ana*');
});
test('audio vira type=audio', () => {
  const r = buildWhatsappMedia({ role: 'member', kind: 'audio', media_url: 'https://x/a.webm' }, 'Ana');
  assert.equal(r.type, 'audio');
});
test('mídia sem media_url → null (ainda subindo)', () => {
  assert.equal(buildWhatsappMedia({ role: 'member', kind: 'image', media_url: null }, 'Ana'), null);
});
test('texto/report não é mídia → null', () => {
  assert.equal(buildWhatsappMedia({ role: 'member', kind: 'text', content: 'oi' }, 'Ana'), null);
  assert.equal(buildWhatsappMedia({ role: 'tom', kind: 'report', content: '<div/>' }, ''), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd _remote && node --test src/services/group-chat-bridge-out.test.js
```
Esperado: FAIL (`buildWhatsappMedia is not a function`).

- [ ] **Step 3: Implementar a função pura**

Em `src/services/group-chat-bridge-out.js`, logo após `buildWhatsappText`, adicionar:

```js
const KIND_TO_WA_TYPE = { image: 'image', pdf: 'document', audio: 'audio' };

// Converte uma row de mídia (channel='app') no payload de /send/media. null se não for
// mídia mirável ou se media_url ainda não existe (arquivo subindo). caption carrega a autoria.
function buildWhatsappMedia(msg, senderName) {
  if (!msg) return null;
  const type = KIND_TO_WA_TYPE[msg.kind];
  if (!type) return null;
  if (!msg.media_url) return null;
  const nm = firstName(senderName);
  const body = String(msg.content || '').trim();
  const caption = nm ? `💬 *${nm}*${body ? ': ' + body : ''}` : (body || '');
  const out = { type, url: msg.media_url, caption };
  if (msg.media_filename) out.filename = msg.media_filename;
  return out;
}
```

E no `module.exports`, acrescentar `buildWhatsappMedia`.

- [ ] **Step 4: Rodar e ver passar**

```bash
cd _remote && node --test src/services/group-chat-bridge-out.test.js
```
Esperado: PASS (todos, incl. os 5 novos).

---

## Task 4: Envio de mídia no `runOutboundOnce` + deploy

**Files:** Modify `src/services/group-chat-bridge-out.js`; `src/realtime/group-chat-watcher.js` (injeção de dep).

- [ ] **Step 1: Trazer media_* no SELECT do runOutboundOnce**

Em `runOutboundOnce`, no `.select(...)` das rows, acrescentar `media_url, media_mime, media_filename` à lista de colunas (logo após `content`):

```js
    .select('id, group_id, role, kind, content, media_url, media_mime, media_filename, sender_id, wa_sender_name, ' +
            'sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
```

- [ ] **Step 2: Ramo de mídia no loop de envio**

Dentro do `for (const m of rows || [])`, ANTES do trecho que monta `text`, inserir o ramo de mídia:

```js
    const jid = byId.get(m.group_id);
    const senderName = m.sender?.preferred_name || m.sender?.full_name || m.wa_sender_name || '';

    // MÍDIA (image/audio/pdf): manda via /send/media. Se media_url ainda não existe, deixa
    // pendente (não marca) — re-tenta quando o upload terminar.
    if (['image', 'audio', 'pdf'].includes(m.kind)) {
      const media = buildWhatsappMedia(m, senderName);
      if (!media) { continue; } // sem media_url ainda → re-tenta próximo tick
      try {
        const waId = await deps.sendGroupMedia(jid, { ...media, mimetype: m.media_mime || '' });
        await supabase.from('group_chat_messages').update({ wa_message_id: waId || 'sent' }).eq('id', m.id);
        sent++;
      } catch (e) {
        console.error(`[Bridge-out] mídia falhou msg=${m.id} (re-tenta): ${e.response?.status || ''} ${e.message}`);
      }
      continue;
    }

    const text = buildWhatsappText(m, senderName);
```

(Remover a linha `const text = buildWhatsappText(m, senderName);` ANTIGA que vinha logo após o cálculo de `senderName`/`jid`, pra não duplicar — o `jid`/`senderName` agora são calculados no topo do loop.)

- [ ] **Step 3: Injetar sendGroupMedia no watcher**

Em `src/realtime/group-chat-watcher.js`, no require de uazapi-groups, acrescentar `sendGroupMedia`:
```js
const { sendGroupText, sendGroupTyping, sendGroupMedia } = require('../services/uazapi-groups');
```
E na chamada existente do tick, passar a dep:
```js
    try { await runOutboundOnce(supabaseMain, { sendGroupText, sendGroupMedia }); }
    catch (e) { console.error('[Bridge-out] tick err:', e.message); }
```

- [ ] **Step 4: Syntax + testes + deploy + restart**

```bash
cd _remote
node --check src/services/group-chat-bridge-out.js
node --check src/realtime/group-chat-watcher.js
node --test src/services/group-chat-bridge-out.test.js
scp src/services/group-chat-bridge-out.js tom:/opt/LA-Organizer/src/services/group-chat-bridge-out.js
scp src/realtime/group-chat-watcher.js tom:/opt/LA-Organizer/src/realtime/group-chat-watcher.js
ssh tom "pm2 restart tom >/dev/null 2>&1 && echo RESTARTED"
```

- [ ] **Step 5: Smoke (app→zap)** — inserir uma row de imagem como Alf (use uma URL pública qualquer do bucket existente ou uma imagem real). MCP `execute_sql`:

```sql
insert into group_chat_messages (group_id, sender_id, role, kind, content, media_url, media_filename, channel)
values ('d95f63af-5032-4120-89f2-ca4c49684cbc','0576f4b6-183d-4cf1-980e-5c8d5da0177f','member','image','teste img v2',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/240px-PNG_transparency_demonstration_1.png','teste.png','app')
returning id;
```
Aguardar ~8s. Conferir no grupo do WhatsApp que a imagem chegou com caption "💬 *Alf*: teste img v2", e `wa_message_id` preenchido no banco. **Limpar** a row depois (delete por id).

---

## Task 5: Mídia zap→app (download→upload→insert) no bridge-in + webhook

**Files:** Modify `src/services/group-chat-bridge-in.js`; `src/webhook.js`.

- [ ] **Step 1: Helper de tipo de mídia (puro) + teste**

Adicionar ao fim de `src/services/group-chat-bridge-in.test.js`:
```js
const { mediaKindFromBody } = require('./group-chat-bridge-in');
test('mediaKindFromBody detecta image/audio/pdf/null', () => {
  const detectors = {
    isAudioMessage: (b) => b.t === 'audio',
    isImageMessage: (b) => b.t === 'image',
    isDocumentMessage: (b) => b.t === 'doc',
  };
  assert.equal(mediaKindFromBody({ t: 'audio' }, detectors), 'audio');
  assert.equal(mediaKindFromBody({ t: 'image' }, detectors), 'image');
  assert.equal(mediaKindFromBody({ t: 'doc' }, detectors), 'pdf');
  assert.equal(mediaKindFromBody({ t: 'text' }, detectors), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd _remote && node --test src/services/group-chat-bridge-in.test.js
```
Esperado: FAIL (`mediaKindFromBody is not a function`).

- [ ] **Step 3: Implementar mediaKindFromBody + inserção de mídia**

Em `src/services/group-chat-bridge-in.js`, adicionar a função pura (perto dos outros helpers):
```js
// Detecta o tipo de mídia do payload usando os detectores do whatsapp.js (injetados).
function mediaKindFromBody(body, d) {
  if (d.isAudioMessage(body)) return 'audio';
  if (d.isImageMessage(body)) return 'image';
  if (d.isDocumentMessage(body)) return 'pdf';
  return null;
}
```

Em `maybeHandleGroupMessage`, SUBSTITUIR o trecho `const text = ...; if (!text...) return {handled:true}` pela versão que trata mídia ANTES de exigir texto:

```js
    const waName = data.senderName || data.pushName || null;
    const phone = extractSenderPhone(body);
    // identidade (igual v1): telefone → nome (membros). Reaproveita o bloco existente abaixo.
    let sender_id = null; // (mantém o bloco de resolução de sender_id que já existe a seguir)
```

E logo após resolver `sender_id` (no fim do bloco de identidade que já existe), inserir o ramo de mídia + texto:

```js
    const caption = helpers.extractText(body); // em imagem/doc, extractText devolve a caption
    const mkind = helpers.mediaDetectors ? mediaKindFromBody(body, helpers.mediaDetectors) : null;

    if (mkind) {
      // Mídia: baixa da UAZAPI → sobe no bucket → insere. v2: image/audio/pdf.
      let media_url = null, media_mime = null, media_filename = null;
      try {
        const dl = await helpers.downloadMedia(body); // { buffer, mime, filename? }
        if (!dl || !dl.buffer) { console.warn('[Bridge-in] download de mídia vazio — pula'); return { handled: true }; }
        media_mime = dl.mime || null;
        const ext = (media_mime && media_mime.split('/')[1]) || (mkind === 'pdf' ? 'pdf' : mkind === 'audio' ? 'ogg' : 'jpg');
        media_filename = dl.filename || `${mkind}.${ext}`;
        const path = `${group.id}/wa-${waId || Date.now()}.${ext}`;
        const up = await supabase.storage.from('group-chat').upload(path, dl.buffer, { contentType: media_mime || undefined, upsert: true });
        if (up.error) { console.error('[Bridge-in] upload falhou:', up.error.message); return { handled: true }; }
        media_url = supabase.storage.from('group-chat').getPublicUrl(path).data.publicUrl;
      } catch (e) { console.error('[Bridge-in] erro mídia (pula):', e.message); return { handled: true }; }

      await supabase.from('group_chat_messages').insert({
        group_id: group.id, sender_id, role: 'member', kind: mkind,
        content: caption && String(caption).trim() ? String(caption).trim() : null,
        media_url, media_mime, media_filename,
        channel: 'whatsapp', wa_message_id: waId, wa_sender_name: sender_id ? null : waName,
      });
      console.log(`[Bridge-in] WA→app MÍDIA(${mkind}) grupo=${group.id}`);
      return { handled: true };
    }

    // Texto (v1)
    if (!caption || !String(caption).trim()) return { handled: true };
    const text = resolveMentionsMaybe ? null : null; // (o resolveMentions de menções segue como já está)
```

> NOTA p/ o implementador: o bloco de **texto** (incl. resolução de menções e o `insert` de `kind:'text'`) já existe no arquivo — NÃO duplicar. Apenas garanta que o ramo de mídia acima venha ANTES dele e que o `caption`/`text` use o retorno de `helpers.extractText(body)`. O `sender_id` é resolvido UMA vez e usado nos dois ramos.

- [ ] **Step 4: Exportar mediaKindFromBody**

No `module.exports` de `group-chat-bridge-in.js`, acrescentar `mediaKindFromBody`.

- [ ] **Step 5: Injetar helpers de mídia no webhook**

Em `src/webhook.js`, na chamada `groupBridgeIn.maybeHandleGroupMessage(supabase, body, { ... })`, acrescentar:
```js
      mediaDetectors: {
        isAudioMessage: whatsapp.isAudioMessage,
        isImageMessage: whatsapp.isImageMessage,
        isDocumentMessage: whatsapp.isDocumentMessage,
      },
      downloadMedia: async (b) => {
        const mid = audio.extractMessageId(b);
        if (!mid) return null;
        const r = await audio.downloadFromUazapi(mid); // { buffer, mime }
        return r ? { buffer: r.buffer, mime: r.mime } : null;
      },
```

- [ ] **Step 6: Syntax + testes + deploy + restart**

```bash
cd _remote
node --test src/services/group-chat-bridge-in.test.js
node --check src/services/group-chat-bridge-in.js
node --check src/webhook.js
scp src/services/group-chat-bridge-in.js tom:/opt/LA-Organizer/src/services/group-chat-bridge-in.js
scp src/webhook.js tom:/opt/LA-Organizer/src/webhook.js
ssh tom "pm2 restart tom >/dev/null 2>&1 && echo RESTARTED"
```

- [ ] **Step 7: Smoke (zap→app)** — mandar UMA imagem no grupo do WhatsApp. Conferir log `[Bridge-in] WA→app MÍDIA(image)` e no banco a row `channel='whatsapp', kind='image', media_url` não-nulo. Conferir no app que a imagem renderiza (MessageBubble já lida com image).

```bash
ssh tom "pm2 logs tom --lines 40 --nostream | grep -iE 'Bridge-in.*MÍDIA|upload falhou'"
```

---

## Task 6: Deleção — funções puras (`parseDeletedWaIds` + seletor) + testes

**Files:** Modify `src/services/group-chat-bridge-in.js` (parser); Test nos dois `.test.js`.

- [ ] **Step 1: Testes do parser (zap→app)**

Adicionar a `src/services/group-chat-bridge-in.test.js`:
```js
const { parseDeletedWaIds } = require('./group-chat-bridge-in');
test('parseDeletedWaIds extrai ids só quando há sinal de deleção', () => {
  // formato A: message único com status Deleted
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages_update', message: { messageid: 'AAA', status: 'Deleted' } }), ['AAA']);
  // formato B: array
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages_update', messages: [{ messageid: 'BBB', wasDeleted: true }] }), ['BBB']);
  // sem sinal de deleção → vazio (não apaga em update de leitura/edição)
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages_update', message: { messageid: 'CCC', status: 'Read' } }), []);
  // evento não-update → vazio
  assert.deepEqual(parseDeletedWaIds({ EventType: 'messages', message: { messageid: 'D' } }), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd _remote && node --test src/services/group-chat-bridge-in.test.js
```
Esperado: FAIL (`parseDeletedWaIds is not a function`).

- [ ] **Step 3: Implementar parseDeletedWaIds (defensivo)**

Em `src/services/group-chat-bridge-in.js`:
```js
// Extrai os wa_message_id apagados de um evento messages_update. DEFENSIVO: só retorna id
// quando há sinal explícito de deleção (status 'Deleted'/'Revoked' OU wasDeleted/isDeleted/deleted true).
// Sem sinal → []. Assim um update de leitura/edição NUNCA apaga por engano.
function parseDeletedWaIds(body) {
  if (!body || body.EventType !== 'messages_update') return [];
  const arr = Array.isArray(body.messages) ? body.messages : (body.message ? [body.message] : []);
  const isDel = (m) => {
    const st = String(m.status || m.messageStatus || '').toLowerCase();
    return st === 'deleted' || st === 'revoked' || m.wasDeleted === true || m.isDeleted === true || m.deleted === true;
  };
  return arr.filter(isDel).map((m) => m.messageid || m.id || (m.key && m.key.id)).filter(Boolean);
}
```
E exportar `parseDeletedWaIds`.

- [ ] **Step 4: Teste do seletor de revoke (app→zap)**

Adicionar a `src/services/group-chat-bridge-out.test.js`:
```js
const { selectRevocable } = require('./group-chat-bridge-out');
test('selectRevocable: só rows app-origin, não sincronizadas, com wa_message_id real', () => {
  const rows = [
    { id: 1, deleted_origin: 'app', deleted_synced: false, wa_message_id: '3EBXYZ' }, // revoga
    { id: 2, deleted_origin: 'app', deleted_synced: false, wa_message_id: 'sent' },   // placeholder → não revoga
    { id: 3, deleted_origin: 'app', deleted_synced: false, wa_message_id: null },     // não enviada → não revoga
    { id: 4, deleted_origin: 'whatsapp', deleted_synced: false, wa_message_id: '3EB' }, // veio do zap → não revoga
  ];
  assert.deepEqual(selectRevocable(rows).map((r) => r.id), [1]);
});
```

- [ ] **Step 5: Implementar selectRevocable**

Em `src/services/group-chat-bridge-out.js`:
```js
const WA_PLACEHOLDER_IDS = new Set(['sent', 'skipped']);
// Rows cuja deleção (feita no app) precisa ser revogada no WhatsApp.
function selectRevocable(rows) {
  return (rows || []).filter((r) =>
    r.deleted_origin === 'app' && r.deleted_synced === false &&
    r.wa_message_id && !WA_PLACEHOLDER_IDS.has(r.wa_message_id));
}
```
E exportar `selectRevocable`.

- [ ] **Step 6: Rodar os dois e ver passar**

```bash
cd _remote
node --test src/services/group-chat-bridge-in.test.js
node --test src/services/group-chat-bridge-out.test.js
```
Esperado: PASS nos dois.

---

## Task 7: `runDeleteSyncOnce` (app→zap revoke) + wire no watcher

**Files:** Modify `src/services/group-chat-bridge-out.js`; `src/realtime/group-chat-watcher.js`.

- [ ] **Step 1: Implementar o runner**

Em `src/services/group-chat-bridge-out.js`, antes do `module.exports`:
```js
// Revoga no WhatsApp as mensagens apagadas no app (deleted_origin='app', não sincronizadas).
// deps.deleteWaMessage(id) injetado. Após revogar (ou falha definitiva), marca deleted_synced=true.
async function runDeleteSyncOnce(supabase, deps, limit = 10) {
  const { data: rows } = await supabase.from('group_chat_messages')
    .select('id, wa_message_id, deleted_origin, deleted_synced')
    .not('deleted_at', 'is', null).eq('deleted_synced', false).eq('deleted_origin', 'app')
    .limit(limit);
  const revocable = selectRevocable(rows);
  let done = 0;
  for (const r of rows || []) {
    if (!revocable.includes(r)) {
      // placeholder/sem wa_id → nada a revogar; marca sincronizado (só some no app).
      await supabase.from('group_chat_messages').update({ deleted_synced: true }).eq('id', r.id);
      continue;
    }
    try {
      await deps.deleteWaMessage(r.wa_message_id);
      await supabase.from('group_chat_messages').update({ deleted_synced: true }).eq('id', r.id);
      done++;
    } catch (e) {
      console.error(`[Bridge-del] revoke falhou msg=${r.id}: ${e.response?.status || ''} ${e.message}`);
      // não marca synced → re-tenta. (janela de revoke do WhatsApp é curta; se persistir, some só no app.)
    }
  }
  return done;
}
```
E exportar `runDeleteSyncOnce`.

- [ ] **Step 2: Wire no watcher**

Em `src/realtime/group-chat-watcher.js`:
- no require: `const { runOutboundOnce, runDeleteSyncOnce } = require('../services/group-chat-bridge-out');`
- no require de uazapi-groups: acrescentar `deleteWaMessage`.
- no tick, após o `runOutboundOnce`:
```js
    try { await runDeleteSyncOnce(supabaseMain, { deleteWaMessage }); }
    catch (e) { console.error('[Bridge-del] tick err:', e.message); }
```

- [ ] **Step 3: Syntax + testes + deploy + restart**

```bash
cd _remote
node --check src/services/group-chat-bridge-out.js
node --check src/realtime/group-chat-watcher.js
node --test src/services/group-chat-bridge-out.test.js
scp src/services/group-chat-bridge-out.js tom:/opt/LA-Organizer/src/services/group-chat-bridge-out.js
scp src/realtime/group-chat-watcher.js tom:/opt/LA-Organizer/src/realtime/group-chat-watcher.js
ssh tom "pm2 restart tom >/dev/null 2>&1 && echo RESTARTED"
```

---

## Task 8: Webhook trata `messages_update` (zap→app delete)

**Files:** Modify `src/services/group-chat-bridge-in.js` (`maybeHandleGroupDelete`); `src/webhook.js`.

- [ ] **Step 1: Implementar maybeHandleGroupDelete**

Em `src/services/group-chat-bridge-in.js`:
```js
// Trata o evento messages_update (deleção feita no WhatsApp). Marca deleted_at nas rows
// cujo wa_message_id casa, em grupos LINKADOS. deleted_synced=true (não re-ecoa pro zap).
// Retorna { handled } — handled=true se for um messages_update (consumimos o evento).
async function maybeHandleGroupDelete(supabase, body) {
  try {
    if (!body || body.EventType !== 'messages_update') return { handled: false };
    const ids = parseDeletedWaIds(body);
    if (!ids.length) return { handled: true }; // update sem deleção → consome e ignora
    for (const waId of ids) {
      await supabase.from('group_chat_messages')
        .update({ deleted_at: new Date().toISOString(), deleted_origin: 'whatsapp', deleted_synced: true })
        .eq('wa_message_id', waId).is('deleted_at', null);
    }
    console.log(`[Bridge-in] WA delete espelhado: ${ids.length} msg(s)`);
    return { handled: true };
  } catch (e) {
    console.error('[Bridge-in] erro delete:', e.message);
    return { handled: true };
  }
}
```
E exportar `maybeHandleGroupDelete`.

- [ ] **Step 2: Rotear no webhook ANTES do isIgnorable**

Em `src/webhook.js`, logo após o bloco de dedupe e ANTES (ou junto) da interceptação de grupo já existente, adicionar:
```js
    // Fase 4 v2 — deleção vinda do WhatsApp (messages_update).
    const del = await groupBridgeIn.maybeHandleGroupDelete(supabase, body);
    if (del.handled) return;
```
Colocar este bloco ANTES da chamada `maybeHandleGroupMessage` (um messages_update não é uma mensagem nova).

- [ ] **Step 3: Syntax + deploy + restart**

```bash
cd _remote
node --check src/services/group-chat-bridge-in.js
node --check src/webhook.js
scp src/services/group-chat-bridge-in.js tom:/opt/LA-Organizer/src/services/group-chat-bridge-in.js
scp src/webhook.js tom:/opt/LA-Organizer/src/webhook.js
ssh tom "pm2 restart tom >/dev/null 2>&1 && echo RESTARTED"
```

- [ ] **Step 4: Validar o formato real do messages_update**

Apagar uma mensagem no grupo do WhatsApp e capturar o payload:
```bash
ssh tom "pm2 logs tom --lines 80 --nostream | grep -iE 'messages_update|Bridge-in.*delete|DEBUG Body' | tail -5"
```
Conferir no banco que a row ficou `deleted_at` setado. **Se não apagou:** ler o payload real do `messages_update` no log e ajustar `parseDeletedWaIds` (campo de status/flag e onde vem o id) — re-deploy.

---

## Task 9: App — botão "Apagar" + render do placeholder

**Files:** Modify `web/src/lib/groupChat.ts`; `web/src/hooks/useGroupChat.ts`; `web/src/screens/grupos/chat/MessageBubble.tsx`.

- [ ] **Step 1: Tipo ganha deleted_at**

Em `web/src/lib/groupChat.ts`, na interface `ChatMsg`, adicionar:
```ts
  deleted_at?: string | null;
```

- [ ] **Step 2: SELECT + mutation de delete no hook**

Em `web/src/hooks/useGroupChat.ts`:
- no `.select(...)` das mensagens, acrescentar `deleted_at`.
- adicionar a mutation (perto do `send`), usando o client autenticado existente (`supabase`):
```ts
  async function deleteMessage(id: string) {
    const { error } = await supabase
      .from('group_chat_messages')
      .update({ deleted_at: new Date().toISOString(), deleted_origin: 'app', deleted_synced: false })
      .eq('id', id);
    if (error) throw error;
  }
```
e expor `deleteMessage` no retorno do hook.

- [ ] **Step 3: Placeholder + menu no MessageBubble**

Em `web/src/screens/grupos/chat/MessageBubble.tsx`:
- receber props `canDelete: boolean` e `onDelete: () => void` (passadas por MessageList: `canDelete = msg.sender_id === currentCollabId || isDirector`).
- no topo do render do conteúdo, se `msg.deleted_at` setado, renderizar só o placeholder e retornar:
```tsx
  if (msg.deleted_at) {
    return (
      <div className="px-3 py-2 text-sm italic text-fg-muted flex items-center gap-1">
        <span aria-hidden>🚫</span> Mensagem apagada
      </div>
    );
  }
```
- quando NÃO deletada e `canDelete`, mostrar um botão discreto (aparece no hover desktop / via long-press mobile) que chama `onDelete()`. Use o token de cor `text-fg-muted` e um ícone Lucide `Trash2`. Exemplo mínimo (hover):
```tsx
  {canDelete && (
    <button
      onClick={onDelete}
      aria-label="Apagar mensagem"
      className="opacity-0 group-hover:opacity-100 transition text-fg-muted hover:text-danger p-1"
    >
      <Trash2 size={14} />
    </button>
  )}
```
(O container da bolha precisa de `group` no className pra o `group-hover` funcionar. Em mobile, sem hover, manter o botão sempre visível em tamanho pequeno OU via long-press — escolha o que já existe no padrão do app; se nada existe, deixar sempre visível discreto.)

- [ ] **Step 4: Wire no MessageList**

Em `web/src/screens/grupos/chat/MessageList.tsx`, ao renderizar cada `MessageBubble`, passar `canDelete` e `onDelete={() => deleteMessage(msg.id)}` (receber `deleteMessage`, `currentCollabId`, `isDirector` por props vindas de `useGroupChat`/contexto).

- [ ] **Step 5: tsc + build**

```bash
cd _remote/web && npx tsc --noEmit && npx vite build
```
Esperado: 0 erros. (O auto-deploy publica no fim do turno.)

- [ ] **Step 6: Validar no preview (localhost:4173)**

Abrir o chat do Financeiro, passar o mouse numa mensagem própria → botão de lixeira aparece → clicar → vira "🚫 Mensagem apagada". Confirmar via `mcp__Claude_Preview__preview_*` + screenshot. Conferir que mensagem de OUTRA pessoa não mostra o botão (a menos que logado como Diretor).

---

## Task 10: Validação E2E + RLS realtime + known issue + limpeza

**Files:** nenhum (validação).

- [ ] **Step 1: E2E mídia (3 tipos × 2 sentidos)**

- WhatsApp → app: mandar no grupo uma **imagem**, um **áudio** e um **PDF**. Conferir no app que os 3 renderizam (imagem/preview, player de áudio, link do PDF) e que o TOM "entende" (transcrição do áudio / OCR da imagem chegam em `media_extracted_text`).
- app → WhatsApp: mandar os 3 pelo composer do app. Conferir que chegam no grupo do WhatsApp com a caption "💬 *Nome*…".

```sql
select role, channel, kind, media_url is not null as tem_url, left(coalesce(content,''),20) as c,
       wa_message_id is not null as espelhada
from group_chat_messages where group_id='d95f63af-5032-4120-89f2-ca4c49684cbc'
order by created_at desc limit 12;
```

- [ ] **Step 2: E2E deleção (2 sentidos)**

- Apagar no **WhatsApp** uma msg → conferir no app que virou "🚫 Mensagem apagada" (em ≤8s).
- Apagar no **app** (botão lixeira) uma msg que foi espelhada → conferir no WhatsApp que sumiu/virou "mensagem apagada".
```sql
select left(coalesce(content,''),20) as c, channel, deleted_at is not null as del, deleted_origin, deleted_synced
from group_chat_messages where group_id='d95f63af-5032-4120-89f2-ca4c49684cbc' and deleted_at is not null
order by deleted_at desc limit 8;
```
Esperado: `deleted_synced=true` em todas após um ciclo; nenhuma re-revogação em loop.

- [ ] **Step 3: Conferir o realtime de UPDATE no app**

No preview, com o chat aberto, apagar uma msg via WhatsApp e ver se o app atualiza pra "apagada" SOZINHO (sem refresh). Se NÃO atualizar: a tabela precisa de `REPLICA IDENTITY FULL` e/ou a subscription do `useGroupChat` precisa incluir eventos UPDATE. Aplicar via MCP:
```sql
alter table public.group_chat_messages replica identity full;
```
e garantir no `useGroupChat` que o canal realtime escuta `event: '*'` (não só INSERT). Re-validar.

- [ ] **Step 4: Anti-loop**

```bash
ssh tom "pm2 logs tom --lines 100 --nostream | grep -iE 'Bridge-out|Bridge-in|Bridge-del'"
```
Conferir: nenhuma mídia espelhada 2×, nenhuma deleção re-ecoada (cada `wa_message_id` único; deleção do zap nasce `synced=true`).

- [ ] **Step 5: Limpar mensagens de teste** — apagar via MCP `execute_sql` as rows de teste criadas (mídias de smoke, etc.), mantendo o chat limpo pras meninas.

- [ ] **Step 6: Registrar known issue**

`execute_sql` INSERT em `tom_known_issues` com `codigo='GROUPCHAT-FASE4V2-MEDIA-DELETE'`, area `'realtime'`, status `'corrigido'`, resumindo: mídia (áudio/imagem/PDF) e deleção bidirecional espelhadas; anti-eco por `deleted_origin`/`deleted_synced`; sinal padrão "mídia mandada num lado não aparece no outro; apaguei e continuou no outro lado".

---

## Self-Review (preenchido pelo autor do plano)

- **Cobertura da spec:** schema 3 colunas + RLS (T1) ✓; sendGroupMedia/deleteWaMessage (T2) ✓; mídia saída pura+runner (T3/T4) ✓; mídia entrada (T5) ✓; deleção puras (T6) + app→zap (T7) + zap→app webhook (T8) ✓; app UI apagar + placeholder (T9) ✓; anti-loop (T6 selectRevocable + T8 synced=true) ✓; realtime UPDATE (T10 Step 3) ✓; e2e + known issue + limpeza (T10) ✓. Riscos da spec endereçados: messages_update (T8 Step 4 valida o payload real), áudio WebM (T4 manda type='audio'; se não tocar, vira arquivo — observar no T10 Step 1), realtime UPDATE (T10 Step 3).
- **Sem placeholders:** todos os steps de código têm o código completo. O único ponto "verificar" é o formato do messages_update (T8 Step 4) e o critério de diretor na RLS (T1 Step 3) — ambos com instrução concreta de como confirmar/ajustar, não TODO aberto.
- **Consistência de nomes:** `sendGroupMedia`, `deleteWaMessage`, `buildWhatsappMedia`, `selectRevocable`, `runOutboundOnce`, `runDeleteSyncOnce`, `mediaKindFromBody`, `parseDeletedWaIds`, `maybeHandleGroupDelete`, `deleteMessage` (app) — usados de forma idêntica entre tasks. Colunas `deleted_at/deleted_origin/deleted_synced`, `media_url/media_mime/media_filename`, `wa_message_id`, `channel` consistentes. Mapa `kind`→type (`image`/`document`/`audio`) idêntico em T2/T3.
