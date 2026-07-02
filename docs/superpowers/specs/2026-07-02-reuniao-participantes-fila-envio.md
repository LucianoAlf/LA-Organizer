# Reunião: edição de participantes por chat + fila de envio durável — Design

**Data:** 2026-07-02
**Autor:** chat catraca (revisor)
**Status:** aprovado (Alf, 02/07)

## Problema

Dois pendentes da feature "reunião de grupo" (ver `project_reuniao_grupo`), mais um risco de infra descoberto no caminho:

1. **Editar participantes por chat** não existe. Depois que a reunião é criada (1 evento + N `event_participants`), não há como adicionar ou remover gente pelo WhatsApp. Só resta o picker do PWA.
2. **Reagendar não avisa ninguém.** `EVENT_UPDATE {action:"reschedule"}` muda o horário mas os participantes que contavam com o horário antigo não são notificados.
3. **Fan-out sem throttle = risco de ban.** O loop de convites da criação (`engine.js:2582`) dispara `whatsapp.sendMessage(...).catch()` sem `await` — os N convites saem quase simultâneos. Passou com 8 no teste, mas envio em rajada é gatilho de restrição/ban do número no WhatsApp. Qualquer novo fan-out (reschedule) herdaria o mesmo risco.

## Decisões (Alf, 02/07)

- **Escopo:** as três peças, numa spec só, três fases.
- **Add/remove:** confirma antes de agir (nos dois).
- **Remover:** silencioso pra pessoa removida; o organizador recebe a confirmação.
- **Reagendar:** avisa **todos os convidados** (invited + confirmed + tentative), exclui quem recusou (declined). Automático (sem confirmar o aviso).
- **Fila de envio:** **durável** (tabela no banco), espaçamento ~30s **com jitter** entre envios, sobrevive a restart do pm2.

## Arquitetura

Três fases, construídas em ordem de dependência. A Fase 0 é fundação e entrega valor sozinha (retrofita o F1).

### Fase 0 — Fila de envio durável (`outbound_queue`)

Generaliza o padrão anti-ban **já provado** no broadcaster de announcements (`dispatcher.js:1758`: "rate limit anti-ban Meta", mini-batch por tick com `sleep` 3–6s, drenagem por `scheduled_at`). Em vez de acoplar convites ao domínio de announcements, cria-se uma fila genérica.

**Tabela `outbound_queue`** (única migration desta spec):

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `phone` | text not null | destino E.164/JID |
| `body` | text not null | mensagem já renderizada |
| `meta` | jsonb not null default '{}' | `{collaborator_id, kind, event_id, sender_name}` — rastreio/log |
| `scheduled_at` | timestamptz not null default now() | quando pode enviar (escalonado no enqueue) |
| `status` | text not null default 'pending' | CHECK IN ('pending','sent','failed','canceled') |
| `attempts` | int not null default 0 | |
| `max_attempts` | int not null default 3 | |
| `last_error` | text | |
| `created_at` | timestamptz not null default now() | |
| `sent_at` | timestamptz | |

Índice: `(status, scheduled_at)` para o dreno.
RLS: sem policy pública — a engine escreve/lê via service_role (ver `feedback_sensitive_data_service_role`).

**Módulo `src/lib/outbound-queue.js`** (helper puro + I/O fino):
- `planSchedule(count, {baseGapMs, jitterMs, startAt})` → `number[]` de offsets em ms (PURO, testável). Linha *i* = `i * baseGapMs + rand(-jitterMs, +jitterMs)`, clamp ≥ 0, **monotônico** (nunca decresce). Recebe um `rng` injetável pra teste determinístico.
- `enqueueOutbound(supabase, rows, opts)` → insere N linhas com `scheduled_at = startAt + offset[i]`. `rows = [{phone, body, meta}]`. Defaults: `baseGapMs=30000`, `jitterMs=8000`.

**Dreno `drainOutboundQueue()`** — novo tick no `dispatcher.js`, espelhando o broadcaster:
- Seleciona `pending` com `scheduled_at <= now`, ordenado por `scheduled_at`, cap `MAX_PER_TICK` (ex. 8).
- Para cada: checa **quiet-hours/DND** do `meta.collaborator_id` (reusa o gate dos rituais). Em silêncio → adia (`scheduled_at = fim do quiet`), não envia, não conta tentativa.
- Envia via `whatsapp.sendMessage`; sucesso → `status='sent', sent_at=now`; falha transitória → `attempts++`, reagenda com backoff se `< max_attempts`, senão `status='failed', last_error`.
- Guarda intra-tick: `sleep(rand(3–6s))` entre envios do mesmo tick (defesa extra além do escalonamento).
- Log estruturado em `ritual_logs` (falha de log nunca derruba o tick).

**Retrofit F1:** o loop `attendees` (`engine.js:~2582`) troca o disparo fire-and-forget por `enqueueOutbound`. Comportamento observável muda de "8 convites juntos" para "8 convites espaçados", mas todos chegam.

### Fase 1 — Reschedule avisa todos (via fila)

No caminho de sucesso do `reschedule` em `applyEventUpdates`:
- Se o evento tem participantes, busca `invited + confirmed + tentative` (exclui `declined` e exclui o próprio organizador).
- Renderiza o texto do novo horário e `enqueueOutbound`. Automático.
- Texto: `📅 A reunião *{title}* foi remarcada: agora *{novo horário}*.`

### Fase 2 — Add/remove participante por chat (confirm-first + executor determinístico)

**Marker:** duas ações novas no `EVENT_UPDATE`:
- `{action:"add_participants", id:"<8char>", names:["Marina", ...]}`
- `{action:"remove_participants", id:"<8char>", names:[...]}`

O LLM resolve *qual evento* (id/latest, como hoje) e *quais nomes* a partir da fala. Mas o engine **nunca aplica essas duas ações direto** — sempre confirma primeiro:

1. Engine resolve nomes → `resolve-attendees.js`. Nenhum resolvido → reporta, **não abre confirm**.
2. `planParticipantEdit({op, resolvedIds, existingIds})` → `{toAdd, toRemove, noops}` (PURO). Idempotente: add de quem já está = noop; remove de quem não está = noop; remover o organizador = rejeitado.
3. Se sobra algo real → `pendingIntents.openIntent(collab.id, 'confirmation', {participant_edit:{event_id, op, ids, names, summary}})` (kind `confirmation` reusado, **zero migration**). TOM pergunta.
4. No **"sim"** (janela de confirmação, espelha o closing-interceptor em `engine.js:~8429`) → executor determinístico aplica:
   - **add:** insert `event_participants` (status=invited, invited_by=organizador) + `enqueueOutbound` do convite (mesmo texto do F1).
   - **remove:** delete rows (**silencioso**, nenhum aviso à pessoa).
   - Fecha a intent. Reporta ao organizador o resultado real (nada de "✅" sem persistir — passa pelas redes de honestidade existentes).

**Componentes isolados:**
- `src/lib/outbound-queue.js` — `planSchedule` (puro) + `enqueueOutbound` (I/O).
- `src/lib/participant-edit.js` — `planParticipantEdit` (puro).
- Executor determinístico no engine (aplica plano da intent).
- Dreno no dispatcher.

## Fluxos

**ADD:** "põe a Marina na reunião de sexta" → resolve → confirm → *"Adicionar **Marina** à reunião *X* (sex 03/07 9h) e enviar o convite?"* → "sim" → insere + enfileira convite → *"✅ Marina adicionada · convite na fila"*.

**REMOVE:** "tira o Pedro da reunião X" → confirm → "sim" → deleta row (silencioso) → *"✅ Pedro removido da reunião X"* (só pro organizador).

**RESCHEDULE:** "adia a reunião X pra segunda 10h" → reschedule aplica (como hoje) → fan-out enfileirado a todos os convidados → cada um recebe, espaçado, *"📅 A reunião X foi remarcada: agora seg 06/07 · 10h"*.

## Casos de borda

- Nome não resolvido → reporta "não achei 'Xasta'", não abre confirm.
- Add de quem já está / remove de quem não está → noop honesto ("Marina já estava na lista").
- Remover o organizador → rejeitado ("você é o organizador, não dá pra se remover").
- Evento 1:1 ou solo → add transforma em grupo (ok); remove sem participantes = noop.
- Falha no insert/delete/enqueue → reporta a falha real, sem "✅" decorativo.
- Quiet-hours no destino → a fila adia; a mensagem nunca se perde, só atrasa pra fora do silêncio.
- Restart do pm2 no meio do drain → linhas `pending` continuam no banco, retomadas no próximo tick.

## Testes

- `outbound-queue.test.js`: `planSchedule` monotônico, respeita baseGap, jitter dentro do range (rng seedado), clamp ≥ 0; enqueue insere N com scheduled_at escalonado.
- `participant-edit.test.js`: add-novo, add-duplicado=noop, remove-existente, remove-ausente=noop, remover-organizador=rejeitado, mix.
- Dreno: quiet-defer não consome tentativa; retry incrementa attempts; max_attempts → failed.
- E2E live (checkpoint final): reunião descartável → add → remove → reschedule → conferir `event_participants` + recibos espaçados nos logs.

## Restrições

- **1 migration** (só `outbound_queue`); resto zero-migration (kind `confirmation` reusado).
- Voz do TOM **sagrada** — nada de mexer em SOUL/tom.
- `.deploy-hold` na raiz antes de editar `engine.js`/`dispatcher.js` (concorrência com a outra sessão, dona do engine).
- Catraca/TDD; toda ação de falha reportada honestamente.
- Deploy em produção (migration + SCP engine/dispatcher + pm2) **só com OK do Alf** no checkpoint.

## Não-objetivos (YAGNI)

- Editar participantes pelo PWA por drag/multi-select avançado (o picker do F5 já cobre o básico).
- Fila de envio com prioridades/dead-letter elaborado — retry simples com max_attempts basta.
- Notificar a pessoa removida (decisão explícita: silencioso).
- Confirmar o fan-out do reschedule (decisão explícita: automático).
