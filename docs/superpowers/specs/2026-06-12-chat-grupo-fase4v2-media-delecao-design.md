# Chat de Grupo — Fase 4 v2: Espelho completo (mídia + deleção bidirecional)

**Data:** 2026-06-12
**Status:** Aprovado (aguardando review da spec antes do plano)
**Antecessor:** Fase 4 v1 (texto) — em produção no grupo Financeiro (`docs/superpowers/specs/2026-06-12-chat-grupo-fase4-whatsapp-mirror-design.md`).

## Objetivo

Completar o espelho bidirecional entre o grupo de WhatsApp e o chat do app (`group_chat_messages`):
1. **Mídia** — áudio, imagem e PDF espelhados nos DOIS sentidos.
2. **Deleção** — apagar de um lado vira "🚫 mensagem apagada" nos dois (estilo WhatsApp).

Mantém o princípio do v1: **UM TOM, UMA MEMÓRIA, UM BANCO** (mesma `group_chat_messages`; `channel` só marca origem). Reusa o pipeline poll-over-realtime do v1.

## Decisões (fechadas no brainstorm)

- **Tipos de mídia:** áudio + imagem + PDF. Vídeo, figurinha = fora (v3).
- **Modelo de deleção:** estilo WhatsApp — placeholder "apagada" nos dois lados (não some), bidirecional. Cada um apaga as PRÓPRIAS mensagens; o Diretor apaga qualquer uma.
- **Mecanismo:** poll-over-realtime (não realtime puro) — coerente com o v1 e com o known issue `GROUPCHAT-RT-ANON-NODELIVER`.

## Schema (1 migration)

`public.group_chat_messages` — 3 colunas novas (todas nullable / default seguro):

| Coluna | Tipo | Uso |
|---|---|---|
| `deleted_at` | `timestamptz` | Quando foi apagada (null = viva). |
| `deleted_origin` | `text` | `'app'` ou `'whatsapp'` — de onde partiu a deleção. |
| `deleted_synced` | `boolean default false` | Se o OUTRO lado já foi avisado (anti-eco). |

Índice parcial p/ o poller de deleção:
`create index group_chat_messages_pending_delete on group_chat_messages (group_id) where deleted_at is not null and deleted_synced = false;`

**RLS (UPDATE de deleção pelo app):** policy permitindo um membro setar `deleted_at` na PRÓPRIA mensagem (`sender_id = current_collab_id()`) OU se for Diretor. O engine escreve via service_role (ignora RLS).

Bucket `group-chat` (Storage) já existe (Fase 1). Engine sobe mídia recebida via service_role.

## Componentes

### A. Mídia app→WhatsApp (saída)

**`src/services/uazapi-groups.js`** — novo:
- `sendGroupMedia(jid, { url, type, caption, filename, mimetype })` → POST `/send/media` com `number=jid`. Retorna `messageid`.
  Mapa `kind`→`type`: `image`→`image`, `pdf`→`document`, `audio`→`audio`.

**`src/services/group-chat-bridge-out.js`**:
- Função pura `buildWhatsappMedia(msg, senderName)` → `{ type, url, caption, filename } | null`. caption = `💬 *PrimeiroNome*${content ? ': '+content : ''}` (mantém autoria). null se não for mídia mirável ou `media_url` ausente.
- `runOutboundOnce`: o SELECT passa a trazer `media_url, media_mime, media_filename`. Por row:
  - `kind ∈ image/audio/pdf` E `media_url` → `deps.sendGroupMedia(...)` → grava `wa_message_id`.
  - texto/report → caminho atual (`buildWhatsappText`).
  - sem `media_url` (mídia ainda subindo) → deixa pendente (não marca), re-tenta no próximo tick.

### B. Mídia WhatsApp→app (entrada)

**`src/services/group-chat-bridge-in.js`** — `maybeHandleGroupMessage`:
- Antes de cair no "só texto", detecta mídia via helpers (`isAudioMessage`/`isImageMessage`/`isDocumentMessage`).
- Se mídia: `helpers.downloadMedia(body)` → `{ buffer, mime, filename }` → `supabase.storage.from('group-chat').upload('${group_id}/${uuid}.${ext}', buffer)` → `getPublicUrl`.
- Insere row: `kind` (image/audio/pdf), `media_url`, `media_mime`, `media_filename`, `content`=caption (de `extractText`), `channel='whatsapp'`, `wa_message_id`, identidade (sender_id por nome/telefone, igual v1).
- O `extractMediaText` (já chamado pelo watcher em `processOne`) transcreve áudio / analisa imagem → TOM entende. PDF: sem extração (igual hoje), mas o arquivo aparece no chat.
- Dedup por `wa_message_id` igual v1.

Helpers injetados pelo webhook: `downloadMedia` (= `audio.downloadFromUazapi` adaptado p/ pegar messageId do body), detectores de tipo (`whatsapp.isAudioMessage` etc.).

### C. Deleção

**App UI (`web/src/screens/grupos/chat/`)**:
- `MessageBubble`: menu de ação (hover desktop / long-press mobile) com "Apagar" — visível só nas próprias mensagens, ou em qualquer uma se Diretor.
- `useGroupChat.deleteMessage(id)`: `update group_chat_messages set deleted_at=now(), deleted_origin='app', deleted_synced=false where id=?` (gated por RLS).
- Render: se `deleted_at` setado → "🚫 Mensagem apagada" (estilo muted), ignora content/media/ACTIONS.

**zap→app (`src/webhook.js` + `bridge-in`)**:
- O webhook hoje descarta `EventType !== 'messages'` (no `isIgnorable`). Passa a interceptar `messages_update` ANTES disso e rotear p/ `groupBridgeIn.maybeHandleGroupDelete(supabase, body)`.
- `maybeHandleGroupDelete`: extrai o(s) id(s) apagado(s) do payload de revoke; se a row existe (`wa_message_id` casa) e ainda não deletada → seta `deleted_at=now()`, `deleted_origin='whatsapp'`, `deleted_synced=true`.

**app→zap (`bridge-out`)**:
- `runDeleteSyncOnce(supabase, deps)` (acoplado ao tick do watcher): seleciona rows `deleted_at not null AND deleted_synced=false AND deleted_origin='app'` com `wa_message_id` REAL (não null/'sent'/'skipped') → `deps.deleteWaMessage(wa_message_id)` (UAZAPI `/message/delete`) → `deleted_synced=true`.
- Se `wa_message_id` é placeholder ('sent'/'skipped'/null) → não dá pra revogar no WhatsApp → marca `synced=true` mesmo assim (só some no app).
- Revoke recusado pela UAZAPI (msg fora da janela) → re-tenta poucas vezes; após N falhas, marca synced p/ não travar o poller (loga).

**`uazapi-groups.js`** — novo `deleteWaMessage(id)` → POST `/message/delete { id }`.

### D. Render do placeholder

- **App:** `deleted_at` setado → bolha "🚫 Mensagem apagada". O cliente precisa receber o UPDATE. O app já usa realtime (Fase 1); validar que UPDATE de `deleted_at` chega (REPLICA IDENTITY / subscription com UPDATE). Fallback: refetch leve no foco/intervalo se realtime não entregar update.
- **WhatsApp:** deleção nativa (quando apagado lá, ou quando chamamos `/message/delete`).

## Anti-loop & idempotência

- **Mídia:** dedup por `wa_message_id` na entrada; marca `wa_message_id` na saída (= "já espelhada", nunca reenvia). `channel='whatsapp'` nunca volta pro WhatsApp.
- **Deleção:** `deleted_origin` + `deleted_synced`. Deleção vinda do WhatsApp nasce `synced=true` (nunca re-ecoa). Deleção do app é enviada uma vez e marca `synced=true`.

## Tratamento de erro

- **503/hibernação** no envio de mídia → deixa pendente (`wa_message_id` null), re-tenta no próximo ciclo. Known issue `project_uazapi_hibernation`.
- **Download/upload de mídia (entrada) falhou** → loga e PULA (não insere row quebrada); responde 200 ao webhook (sem retry-storm).
- **Revoke recusado** → re-tenta poucas vezes, depois marca synced (loga).
- **`maybeHandleGroupDelete` sem match** (msg de grupo não-linkado ou não espelhada) → ignora em silêncio.

## Validação

- **Testes puros (`node:test`):** `buildWhatsappMedia` (mapa kind→type, caption com autoria, null p/ não-mídia); seletor de revoke (quais rows precisam `/message/delete`); parser do `messages_update` (extrai id apagado de payloads de exemplo).
- **E2E na VPS (instância real):**
  - Mídia: mandar imagem, áudio e PDF no grupo do WhatsApp → conferir que aparecem no app (com o arquivo) e o TOM entende (transcrição/OCR). Mandar os três no app → conferir que chegam no WhatsApp com a autoria na caption.
  - Deleção: apagar uma msg no WhatsApp → vira placeholder no app. Apagar uma no app → some/placeholder no WhatsApp. Conferir zero loop, zero duplicata, e que a deleção não re-ecoa.
- **Registrar** `tom_known_issues` ao fechar (codigo `GROUPCHAT-FASE4V2-MEDIA-DELETE`).

## Fora do escopo (YAGNI)

- Vídeo e figurinha (sticker) → v3.
- Editar mensagem (a UAZAPI tem `/message/edit`, mas não pedido).
- Reações do TOM / espelho de reações → projeto à parte.
- Apagar o card de relatório (kind='report') a partir do WhatsApp (ele nasce no app).
- TOM enviar mídia (no grupo ele responde em texto/HTML/report).

## Riscos conhecidos (validar na implementação, não bloqueiam o design)

1. **Forma do `messages_update`:** confirmar no primeiro delete real qual campo marca a deleção e onde vem o id. Design é defensivo (degrada gracioso se não casar).
2. **Áudio WebM do app:** o navegador grava WebM/opus; o WhatsApp toca melhor ogg/opus ou mp3. Se não tocar como "voz", mandar como arquivo de áudio (`type=audio` com filename) — ainda reproduzível. Sem transcodificação no v2.
3. **Realtime de UPDATE no app:** garantir que o `deleted_at` chega ao cliente (REPLICA IDENTITY FULL / subscription). Fallback de refetch se necessário.
