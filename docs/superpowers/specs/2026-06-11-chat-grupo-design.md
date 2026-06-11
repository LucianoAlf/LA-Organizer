# Chat de Grupo (TOM na casa dele) — Design

> **STATUS Fase 1 (11/06 ~22h30 BRT): ENTREGUE + validada.** Tabela `group_chat_messages` + RLS de membro
> (membro só insere kinds normais; `report` é exclusivo do TOM/service_role) + bucket público `group-chat`.
> lib pura `groupChat.ts` (3/3 vitest) + `useGroupChat` (query/send/upload) + realtime registrado. Render
> seguro (DOMPurify — guard de `javascript:` URL, `rel=noreferrer` em links do TOM, `class` fora do allowlist).
> Avatar real `/tom-avatar.png`. `GroupChatDrawer` (380px empurra o conteúdo no desktop, sticky/rolável;
> tela cheia; mobile tela cheia) + `MessageList`/`Composer` (texto, 📎 imagem/PDF, 🎤 áudio MediaRecorder) +
> botão Chat com badge de não-lidas. tsc/build/vitest limpos. **Validado no preview (Alf membro temporário
> do Financeiro):** drawer empurra (1440px), report do TOM renderiza, ordem cronológica, envio real +
> realtime, mobile tela cheia (375). Seed e membership-de-teste do Alf REMOVIDOS (Financeiro = Ana+Rose).
> **Pendente:** Fase 2 (TOM engajado — backend/engine, valida na VPS) + Fase 3 (proativo de fim de sessão).


**Data:** 2026-06-11 · **Aprovado por:** Alf (mockup + faseamento) · **Origem:** Alf quer trazer as conversas das equipes pra DENTRO do app, onde o TOM tem poderes de renderização HTML muito além do WhatsApp. App-first; WhatsApp vira espelho FUTURO na mesma tabela.

**Mockup canônico (UI fiel):** `docs/superpowers/specs/assets/2026-06-11-chat-grupo-mockup.html` (copiar do companion antes do plano).

## Visão

Cada grupo de trabalho (`/grupos/:id`) ganha um **chat** num drawer de 380px que empurra o conteúdo pra esquerda (desktop), com opção de **tela cheia**; no mobile abre em tela cheia. Membros conversam entre si com realtime e anexos (imagem/PDF/áudio). O **TOM participa**: ouve e memoriza tudo, fica em silêncio até ser chamado, responde com os poderes do sistema (criar/marcar tarefa) e renderiza **relatórios bonitos em HTML**; no fim da sessão entra proativo oferecendo resumo/tarefas.

**Avatar do TOM:** SEMPRE o asset real `/tom-avatar.png` (mesmo do Header/Onboarding) — NUNCA emoji genérico. Membros usam `collaborator.avatar_url` (fallback inicial do nome).

## Decisões de produto (Alf, 11/06)

1. **TOM ouve sempre + memória de longo prazo** — toda mensagem é persistida (a tabela É a memória daquele chat). Sem custo de IA por mensagem; IA só quando engajado ou no fim de sessão.
2. **TOM não se intromete** — silêncio até gatilho de entrada ("fala Tom" / "Tom, ..." / @TOM). Gatilho de saída ("valeu Tom" / "tchau Tom") devolve ao silêncio.
3. **Proativo só no fim da sessão** — quando a conversa esfria após sessão ativa, posta UMA vez o card de fechamento (resumo/tarefas).
4. **Anexos MVP:** imagem + PDF + áudio (reuso Vision/Whisper). Figurinha → Fase 2+ (no app vira emoji/reação).
5. **Drawer 380px empurra conteúdo + tela cheia + mobile tela cheia.**
6. **Markers iguais aos do WhatsApp** — reuso do engine; a resposta do TOM é gravar linha no chat, não enviar no zap.
7. **WhatsApp = espelho futuro** na MESMA tabela (`channel`/`wa_message_id` já no schema; não wired no MVP).

## Arquitetura

### Modelo de dados (Fase 1)

Tabela **`group_chat_messages`**:
| coluna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK work_groups | |
| sender_id | uuid FK collaborators NULL | NULL = TOM |
| role | text | 'member' \| 'tom' \| 'system' (CHECK) |
| kind | text | 'text' \| 'image' \| 'pdf' \| 'audio' \| 'report' (CHECK) |
| content | text | texto/markdown (kind=report: HTML/markdown do TOM) |
| media_url | text NULL | path no bucket |
| media_mime | text NULL | |
| media_filename | text NULL | |
| media_extracted_text | text NULL | Vision/Whisper (preenchido pelo watcher) |
| channel | text NOT NULL DEFAULT 'app' | 'app' \| 'whatsapp' (espelho futuro) |
| wa_message_id | text NULL | dedup do espelho futuro |
| created_at | timestamptz DEFAULT now() | |

Índices: `(group_id, created_at desc)`; `wa_message_id` unique partial (where not null) pro futuro.
RLS: SELECT/INSERT pra quem está em `work_group_members` daquele `group_id` (helper `current_collab_id()`); service_role full. TOM escreve via service_role (sender_id NULL, role='tom').

Estado de engajamento (Fase 2): coluna em `work_groups` — `tom_chat_engaged_at timestamptz NULL` (NULL/expirado = silêncio). Sessão "ativa" = engajado nos últimos N min.

Bucket de storage (Fase 1 anexos): `group-chat` (público-restrito por RLS de membro via signed URLs, OU bucket privado + signed URL no fetch). Path: `group-chat/<groupId>/<uuid>.<ext>`.

### Realtime
Adicionar `group_chat_messages` ao `WATCHED_TABLES` de `useRealtimeSync.ts` (INSERT → invalida a query do chat daquele grupo). O hook do chat usa queryKey `['group-chat', groupId]`.

### TOM no chat (Fase 2) — vigia na VPS
Novo serviço `src/services/group-chat-watcher.js`:
- Subscreve via supabase-realtime (service_role) INSERTs em `group_chat_messages` com `role='member'`.
- Por mensagem: SEMPRE já está salva (memória). Decide se aciona o engine:
  - **Entrada:** regex de menção pura (`\btom\b`, "fala tom", "@tom") quando NÃO engajado → marca `tom_chat_engaged_at=now()`, roda engine.
  - **Engajado:** mensagem dentro da janela ativa → roda engine.
  - **Saída:** regex de despedida ao TOM (`(valeu|obrigad[ao]|tchau|até)\b.*\btom\b` ou `tom.*\b(valeu|tchau)\b`) → engine responde curto + limpa `tom_chat_engaged_at`.
- **Engine reusado:** extrair de `engine.js` um `processGroupChatMessage({ groupId, senderCollabId, text, history })` que monta o system prompt (com contexto do grupo + histórico recente do chat como memória) → chama IA → parseia markers (TASK etc.) → **resposta = INSERT em `group_chat_messages` (role='tom')** em vez de WhatsApp send. Reaproveita o parser de markers existente.
- **Anexos:** ao ver `kind in (image,pdf,audio)`, roda Vision/Whisper → grava `media_extracted_text`; o texto extraído entra no contexto se o TOM estiver engajado.

### Proativo de fim de sessão (Fase 3)
- Detecção híbrida: um tick (cron leve) verifica grupos com sessão ativa recente que esfriaram (sem mensagem há X min) E com sinais de despedida entre humanos → posta UMA vez (idempotente via flag) o card de fechamento (`kind='system'` ou 'tom' com botões).
- Botões (quick-replies no chat): "Gerar resumo" → TOM compõe `kind='report'` (HTML); "Criar tarefa" → abre fluxo; "Tá tranquilo" → encerra.

### Renderização rica (Fase 1)
Componente `MessageBubble`: texto normal → markdown leve (negrito/bullets) sanitizado; `kind='report'` → render HTML **sanitizado com DOMPurify** dentro de um cartão com ações baixar/compartilhar. Instalar `dompurify` (+ `marked` pro markdown→HTML). Tokens DS only.

### UI (Fase 1)
- `useGroupChat(groupId)`: query de mensagens (paginada/limite) + mutation de envio (insert) + upload de anexo (storage).
- `GroupChatDrawer`: painel 380px no `GrupoWorkspace` (flex: conteúdo `flex-1` + `aside` 380px quando aberto). Botão "💬 Chat" no header (badge não-lidas). Toggle tela cheia (estado → `aside` vira overlay full).
- Mobile: o "Chat" abre rota/tela cheia (sem drawer).
- `MessageList` (bolhas, avatar real, dia divider, agrupamento) + `Composer` (texto, 📎 imagem/PDF, 🎤 áudio com gravação, enviar).
- Não-lidas: marca simples por `last_read_at` (localStorage ou coluna em work_group_members — decidir no plano; MVP pode ser localStorage por grupo).

## Faseamento (cada fase = spec deste doc + plano próprio + entrega validável)

- **Fase 1 — Chat humano + render + anexos:** tabela+RLS+realtime, `useGroupChat`, drawer+fullscreen+mobile, bolhas com avatar real, composer com imagem/PDF/áudio, render HTML sanitizado (TOM ainda não responde sozinho — mas se uma linha `role='tom'` existir, renderiza). Valida a hipótese "elas preferem aqui".
- **Fase 2 — TOM engajado:** extração `processGroupChatMessage`, watcher na VPS, estado engajar/desengajar, markers (criar/marcar tarefa) gravando no chat, extração de mídia pro contexto.
- **Fase 3 — Proativo de fim de sessão:** detecção de fechamento + card + resumo HTML (`kind='report'`).

## Fora de escopo (radar)
- Espelho WhatsApp bidirecional (schema pronto; não wired).
- Figurinhas/stickers (vira reação/emoji depois).
- Reações por mensagem, edição/exclusão de mensagem, threads.
- Busca no histórico do chat (a memória existe; UI de busca depois).
- Chamadas de voz/vídeo.

## Riscos / cuidados
- **Segurança de render:** HTML do TOM SEMPRE via DOMPurify (sem `<script>`, sem `on*`, sem `javascript:`). Mesmo o TOM sendo "confiável", nunca injetar cru.
- **Custo:** IA só quando engajado ou no fim de sessão; gatilhos por regex barata antes de chamar o engine.
- **Anti-loop:** o watcher NUNCA reage a `role='tom'`/`role='system'` (só `role='member'`), senão o TOM responde a si mesmo.
- **Dado sensível via service_role:** sender_id vem do remetente autenticado (RLS no insert do membro); o TOM grava via service_role com sender_id NULL — nunca confiar em sender_id vindo do payload do LLM.
- **Realtime fan-out:** a query do chat filtra por group_id; o canal já existente cobre.

## Validação (cada fase)
tsc + build + (vitest nas puras) + preview no browser-agent/preview_eval (desktop 1440 + mobile 375) contra o mockup; e2e real no grupo Financeiro.
