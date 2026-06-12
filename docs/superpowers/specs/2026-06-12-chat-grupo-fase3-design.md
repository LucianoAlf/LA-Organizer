# Chat de Grupo — Fase 3 (TOM completo: memória, janela deslizante, todas as ferramentas, proativo de fechamento) — Design

**Data:** 2026-06-12 · **Aprovado por:** Alf (decisões abaixo) · **Base:** Fase 2 entregue (`group-chat-watcher.js` poll + engine + triggers). Estende, não reescreve.

## Decisões do Alf (12/06)

1. **Gatilho de entrada AMPLO:** o TOM acorda com qualquer menção dirigida — "fala tom", "tom, ...", "@tom", "ô tom", "tom?". (mantém o regex da Fase 2, que já cobre isso.)
2. **Sai de cena com 8 min de SILÊNCIO** (janela **deslizante**, não fixa): cada mensagem de membro com o TOM engajado renova a janela; 8 min sem ninguém falar → ele sai e precisa ser chamado de novo.
3. **Todas as ferramentas que fazem sentido e são seguras no grupo** (ver escopo abaixo — "tudo do WhatsApp" filtrado pelo que cabe num chat de grupo).
4. **Memória curto / médio / longo prazo** (ver abaixo).
5. **Proativo de fechamento:** ao detectar que a sessão esfriou (perto dos 8 min), posta UMA vez o card de fechamento (resumo HTML + oferta de tarefas) e desengaja.

## 1. Janela deslizante + saída por silêncio

**Hoje (Fase 2):** `tom_chat_engaged_at` é setado no "fala tom" e `isEngaged` usa janela de 10 min a partir desse instante (FIXA). Problema: ele sai 10 min depois do *primeiro* "fala tom", mesmo no meio da conversa.

**Fase 3:**
- Constante muda pra **8 min** (`ENGAGE_WINDOW_MIN = 8`).
- **Renovação (slide):** com o TOM engajado, TODA mensagem de membro renova `tom_chat_engaged_at = now()` (a conversa "mantém ele na sala"). Já fazemos isso implicitamente ao processar; passa a ser explícito mesmo quando ele fica em silêncio na vez.
- **Saída por silêncio (novo):** o poller (`group-chat-watcher.js`) ganha uma **varredura periódica** (a cada tick de 4s, barata) que acha grupos com `tom_chat_engaged_at` não-nulo e **idle ≥ 8 min** → dispara o **fechamento proativo** (seção 4) e limpa `tom_chat_engaged_at`. Sem isso, nada dispararia a saída quando ninguém fala (o poll só reage a mensagens novas).
- **Anti-chatice:** com o TOM engajado, ele NÃO responde a toda linha. O prompt instrui: *responda só quando for dirigido a você OU quando tiver algo útil/acionável; senão fique em silêncio*. O engine respeita silêncio: se a IA devolver vazio/marcador `[SILENCIO]`, **não grava** linha role='tom' (mas a janela desliza mesmo assim — ele continua "ouvindo").

## 2. Memória curto / médio / longo prazo

- **Curto:** as últimas ~20 msgs do grupo já entram no prompt (Fase 2). Aumentar p/ ~30 e incluir `media_extracted_text`.
- **Médio:** todo o histórico do grupo está em `group_chat_messages` (a tabela É a memória). Quando o histórico recente não basta, o engine pode puxar um resumo do grupo (ver longo prazo).
- **Longo:** os cards de fechamento (`kind='report'`) viram o **registro durável** da sessão. Além disso, um campo novo `work_groups.tom_chat_memory` (texto) guarda um **resumo rolante** do grupo, atualizado a cada fechamento (o TOM condensa "o que esse grupo vem fazendo"). Esse resumo entra no topo do prompt como memória de longo prazo. Barato, sem ritual extra.

## 3. Todas as ferramentas (escopo honesto de "tudo do WhatsApp")

Arquitetura: **aditivo, reusando os parsers/appliers já EXPORTADOS do `engine.js`** (como a Fase 2 fez com `parseTaskUpdateMarker`/`applyTaskActions`). NÃO mexer no `processMessage` (caminho do WhatsApp intacto). O engine do chat passa a varrer, em sequência, os markers abaixo.

**LIGADO (cabe e é seguro no grupo):**
| Marker | Ação no chat |
|---|---|
| `TASK_UPDATE` | criar/concluir/reagendar/cancelar tarefa **no pool do grupo** (Fase 2 ✅) |
| `PROJECT_CREATE` | criar projeto (contexto do grupo) |
| `EVENT_CREATE` / `EVENT_UPDATE` | criar/editar evento na agenda |
| `CHECKPOINT_BATCH` | checklist estruturado de um projeto |
| `CHECKLIST_ACTION` | marcar/anexar item de checklist |

**FORA (com motivo — honestidade):**
- `COORDINATION_REQUEST/RESPONSE`, `ANNOUNCEMENT_*`, `SCHOOL_EVENT RSVP` → **disparam mensagens no WhatsApp** internamente; ligar no chat enviaria zap indevido. Roteamento cross-pessoa não cabe num pool de grupo.
- `HABIT_ACTION`, `PREFS_UPDATE`, `FINANCE`, `MEMORY`, `ONBOARDING_DONE`, `DATA_CLASSIFY` → **pessoais/single-user**; um pool de grupo não é o lugar (e finança é sensível).

> Antes de ligar cada applier: **auditar se ele faz `whatsapp.sendMessage` internamente**. Se fizer, ou isolar o send (gate por canal) ou não ligar. Os de criação pura (task/project/event/checkpoint) persistem e retornam — seguros. Cada um cria com `created_by = remetente` e, quando aplicável, `assigned_group_id = grupo`.

**Confirmação honesta:** como na Fase 2, a fala do TOM = persistência. Marker rejeitado → não confirma sucesso falso; anexa aviso honesto.

## 4. Proativo de fechamento (o coração da Fase 3)

Disparado pela varredura de silêncio (seção 1) quando um grupo engajado fica idle ≥ 8 min, **uma única vez** por sessão:
- O TOM compõe um **card de fechamento** (`kind='report'`, HTML sanitizado no render) com: resumo do que rolou na sessão + tarefas/decisões detectadas + oferta *"querem que eu transforme algo disso em tarefa? quer o resumo salvo?"*.
- Atualiza `work_groups.tom_chat_memory` (resumo rolante de longo prazo).
- Limpa `tom_chat_engaged_at` (sai de cena).
- Idempotência: guard por `work_groups.tom_chat_closed_session_at` (não re-posta fechamento da mesma sessão; reseta quando ele reengaja).

Se elas responderem ao card ("sim, cria as tarefas") **dentro de uma nova janela** (re-engaja), o TOM executa os markers normalmente.

## Modelo de dados (Fase 3)

`work_groups` ganha:
- `tom_chat_memory text null` — resumo rolante de longo prazo do grupo.
- `tom_chat_closed_session_at timestamptz null` — guard de idempotência do card de fechamento.

(`tom_chat_engaged_at` e `group_chat_messages.tom_seen_at` já existem da Fase 2.)

## Arquivos

- **Migration (MCP):** as 2 colunas em `work_groups`.
- **Modificar** `src/services/group-chat-triggers.js`: `ENGAGE_WINDOW_MIN` 10→8.
- **Modificar** `src/services/group-chat-engine.js`: varrer todos os markers LIGADOS (não só TASK); suporte a silêncio (retorno vazio/`[SILENCIO]` → não grava); incluir `tom_chat_memory` no prompt; helper `composeClosingReport({...})` que gera o `kind='report'` + atualiza `tom_chat_memory`.
- **Modificar** `src/services/group-chat-prompt.js`: bloco de memória de longo prazo + regra de silêncio + instruções dos markers novos (projeto/evento/checkpoint/checklist).
- **Modificar** `src/realtime/group-chat-watcher.js`: (a) slide da janela em msg engajada; (b) varredura de silêncio → `processGroupChatClosing()`.
- **Criar** `src/services/group-chat-closing.js`: detecção de idle + composição/persistência do card de fechamento (idempotente).
- **Testes puros:** janela deslizante (`isEngaged` com renovação), detecção de idle, guard de idempotência.

## Validação
Funções puras com testes. Integração valida na VPS (poll, não preview): e2e no Financeiro — (1) janela desliza (conversa de >8min total mantém engajado enquanto há mensagens); (2) silêncio de 8min → card de fechamento posta UMA vez + desengaja; (3) criar projeto e evento pelo chat; (4) re-engajar respondendo ao card. Limpar dados de teste.

## Fora de escopo (radar)
- Markers de WhatsApp-send no chat (coordenação/comunicados) — exigiriam gate de canal no engine.
- Espelho WhatsApp bidirecional.
- Ritual dedicado de consolidação de memória (o resumo rolante no fechamento cobre o essencial).
