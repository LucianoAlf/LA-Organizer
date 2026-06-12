# Chat de Grupo — Fase 4: Espelho bidirecional com WhatsApp (v1, texto)

**Data:** 2026-06-12
**Status:** Aprovado (aguardando review da spec antes do plano de implementação)

## Objetivo

Espelhar bidirecionalmente o chat de grupo do app (`group_chat_messages`) com um grupo
real de WhatsApp onde o TOM já foi adicionado. Mensagem no WhatsApp aparece no app e
vice-versa; o TOM age a partir dos dois lados. **Espelho total** (toda mensagem cruza) e
**texto primeiro** (mídia fica para o v2).

## Requisito de primeira classe — UM TOM, UMA MEMÓRIA, UM BANCO

O ponto inegociável desta fase: **não pode existir "dois toms".** O mesmo TOM que atende
no chat do app (desktop/PWA) é o mesmo que atende no grupo de WhatsApp das meninas —
mesma voz, mesmo contexto, mesma memória.

Isso é garantido por construção: **WhatsApp e app gravam na MESMA tabela
`group_chat_messages` do MESMO `work_group`.** O campo `channel` só registra a origem
('app' | 'whatsapp'); para o engine é uma conversa única. Ao montar a resposta, o TOM lê:

- **Curto prazo:** histórico recente da `group_chat_messages` do grupo (os dois canais
  intercalados em ordem cronológica) — já é o que `loadContext` faz hoje.
- **Médio prazo:** a sessão engajada (`tom_chat_engaged_at` / `tom_chat_closed_session_at`).
- **Longo prazo:** o resumo rolante `work_groups.tom_chat_memory`.

Nenhuma dessas três fontes é por-canal. Logo, a Rose falando no WhatsApp ou no app é o
mesmo TOM com a mesma memória. O espelho é "real" porque a fonte de verdade é uma só.

## Arquitetura

Ponte com duas direções, reaproveitando o pipeline da Fase 3 (poll-over-realtime):

```
WhatsApp (grupo)  --webhook-->  bridge-in  --insert(channel=whatsapp)-->  group_chat_messages
                                                                               |
                                                          watcher (já existe) pega role=member
                                                                               |
                                                              processGroupChatMessage (1 TOM, 1 memória)
                                                                               |
                                                          insere resposta do TOM (channel=app)
                                                                               |
group_chat_messages  --poller-->  bridge-out (channel=app, wa_message_id null)  --sendGroupText-->  WhatsApp (grupo)
```

- **Entrada** = o webhook que já existe (estendido para aceitar o grupo linkado).
- **Saída** = um poller que posta no WhatsApp o que nasceu no app (mensagens de membro
  digitadas no app + respostas do TOM).
- O **watcher da Fase 3 não muda** — ele continua sendo quem aciona o TOM; só passa a
  enxergar também as mensagens que entraram via WhatsApp (são `role='member'` normais).

## Instância / número

**Mesma instância de produção do TOM** (mesmo número do 1:1). Uma identidade só. Risco
baixo: o engine já ignora todos os grupos hoje; passa a tratar apenas o JID linkado e
mantém o 1:1 intacto.

### Config do webhook (lado UAZAPI — ação no painel)

- **Escutar eventos:** `messages`
- **Excluir dos escutados:** `wasSentByApi` (anti-loop nativo — o que o bot envia pela API
  NÃO volta pro webhook). **Manter.**
- **NÃO** colocar `isGroupYes` no excluir → é isso que libera as mensagens de grupo a
  chegarem no webhook. (Hoje, com `isGroupYes`, grupo nunca chega.)
- **URL:** endpoint de webhook do TOM (o mesmo que já recebe o 1:1).

## Schema (mínimo)

- `work_groups.wa_group_jid` (text, nullable, **unique**) — liga o grupo do app ao JID do
  WhatsApp (`xxxx@g.us`). Só o Financeiro preenchido no v1.
- `group_chat_messages` — já tem `channel` ('app'|'whatsapp', default 'app') e
  `wa_message_id` (text). Adicionar **`wa_sender_name`** (text, null): nome de exibição de
  quem mandou no WhatsApp quando o número não casa com nenhum colaborador.

## Componentes

### 1. `src/services/uazapi-groups.js` (novo)
- `listGroups()` → lista os grupos da instância (JID + nome/subject). Usado p/ achar o JID.
- `sendGroupText(jid, text)` → posta texto no grupo (UAZAPI `/send/text` com destino = JID
  de grupo). Retorna o id da mensagem (`wa_message_id`).
- **Depende de:** config da instância (`config.uazapi.url` + `token`), igual `whatsapp.js`.

### 2. Linkagem do JID (setup v1)
- Script pontual: `listGroups()` → acha o grupo Financeiro pelo nome/subject → grava em
  `work_groups.wa_group_jid` o JID. Rodado uma vez na implementação. UI de linkar grupos
  fica para depois (fora do v1).

### 3. `src/services/group-chat-bridge-in.js` (novo) — WhatsApp → App
Recebe do webhook `{ chatid (JID), sender (telefone), text, wa_message_id, pushName }`:
1. Acha `work_group` por `wa_group_jid = chatid`. Sem match → ignora (grupo não linkado).
2. **Dedup:** se já existe `group_chat_messages` com esse `wa_message_id` → pula.
3. Mapeia telefone → colaborador (`collaborators.phone`, com/sem '55'). Achou → `sender_id`;
   não achou → `sender_id=null` + `wa_sender_name = pushName`.
4. Insere: `group_id, sender_id, role='member', kind='text', content=text,
   channel='whatsapp', wa_message_id, wa_sender_name`. `tom_seen_at` fica null.
5. O **watcher** pega e o TOM responde pelas regras normais (silêncio até "fala tom" /
   sessão engajada). Nada de spam no grupo.

### 4. `src/webhook.js` (modificado) — roteamento de grupo
- Hoje descarta todo `isGroup`. Passa a: se `isGroup` E o JID casa com um `work_group`
  linkado → manda pro `bridge-in`. Senão → ignora (1:1 e outros grupos intactos).
- `fromMe` / `wasSentByApi` continuam barrados.

### 5. `src/services/group-chat-bridge-out.js` (novo) + poller — App → WhatsApp
- Poller (intervalo próprio ou acoplado ao tick do watcher) seleciona
  `group_chat_messages` onde: o grupo tem `wa_group_jid`, `channel='app'`,
  `wa_message_id IS NULL`, `role IN ('member','tom')`, `kind='text'`.
- Monta o texto:
  - `role='member'` → **"💬 *{primeiro nome}*: {content}"** (relay com autoria).
  - `role='tom'` → **só a prosa** (remove o bloco `‹‹ACTIONS››…` e, se for `kind='report'`,
    não espelha o HTML do card — v1 manda um resumo curto ou ignora o card).
- Posta via `sendGroupText(jid, texto)` → grava o `wa_message_id` retornado.
- **Mídia (kind != text) no v1:** não espelha (fica pro v2).

## Anti-loop + identidade

- **UAZAPI exclui `wasSentByApi`** → o que o bot posta não volta pro webhook (anti-loop raiz).
- **Entrada:** dedup por `wa_message_id` (não reinsere o que já espelhou).
- **Saída:** só processa `channel='app'` com `wa_message_id IS NULL`; ao postar, grava o
  `wa_message_id` (= "já espelhada", nunca reposta). Mensagem `channel='whatsapp'` nunca é
  reenviada pro WhatsApp.
- **`fromMe`** também barrado no webhook (cinto e suspensório).
- **Identidade:** `collaborators.phone` faz o de-para. Sem match → exibe `wa_sender_name`.

## Tratamento de erro (hibernação / 503)

- **Saída em 503 (instância hibernando):** o poller captura, deixa `wa_message_id` null →
  re-tenta no próximo ciclo. Não perde mensagem. Loga o status.
- **Entrada com falha de insert:** loga e responde 200 ao webhook (sem retry-storm da UAZAPI).
- **Grupo não linkado:** ignora em silêncio.

## Validação

- **Testes puros (vitest/node:test):** mapeamento JID→grupo, telefone→colaborador, dedup
  por `wa_message_id`, formatação da saída (prefixo "💬 Nome:" do membro; prosa do TOM sem
  `‹‹ACTIONS››`).
- **E2e (instância real):** gravar o `wa_group_jid` do Financeiro → mandar no grupo do
  WhatsApp → confere que aparece no app **e** o TOM responde nos dois lados → digitar no app
  → confere que aparece no WhatsApp como "💬 Rose: …" → confirmar zero duplicata e zero eco.
- **Memória unificada:** mandar contexto no WhatsApp e, em seguida, perguntar no app sobre
  esse contexto (e vice-versa) — o TOM tem que lembrar, provando banco/memória única.

## Fora do escopo do v1 (YAGNI)

- Mídia (imagem/áudio/PDF) nos dois sentidos → **v2**.
- UI para linkar grupos (Diretor escolhe qual grupo do app ↔ qual grupo do WhatsApp) → depois.
- Criação automática de colaborador a partir de número desconhecido → não.
- Espelhar o HTML do card de fechamento no WhatsApp → não (v1 manda resumo curto ou nada).
