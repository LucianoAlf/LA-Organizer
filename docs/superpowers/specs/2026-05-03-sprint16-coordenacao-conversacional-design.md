# Spec: Sprint 16 — Coordenação Conversacional via TOM
**Data:** 2026-05-03
**Status:** Proposta — aguardando aprovação
**Referência:** docs/la-organizer-coordenacao-conversacional-prd.md

---

## 1. Diagnóstico do estado atual

### 1.1 Banco de dados (relevante)

Tabelas que serão reutilizadas ou servem de referência direta:

| Tabela | Relevância |
|---|---|
| `collaborators` | fonte dos atores (requester_id, recipient_id); campos: id, full_name, phone, role, is_active |
| `conversation_history` | log bruto de cada mensagem recebida/enviada por colaborador — fonte para detecção de resposta |
| `notifications` | fila de saída genérica; modelo de referência para sent_at + read_at |
| `tasks` | referência de padrão create-for-other; **NÃO** será reutilizada para requests de coordenação |
| `marker_logs` | auditoria de todos os markers — `coordination_requests` deve gerar entradas aqui também |
| `ritual_logs` | padrão de idempotência para dispatcher blocks |

RLS pattern: `current_collab_role()` e `current_collab_id()` (helpers Postgres em todas as tabelas sensíveis). O engine usa service role key (bypassa RLS); o PWA usa anon key + `set_config('app.current_user_id', ...)` antes de mutações.

Colaboradores ativos relevantes: Anne Susan, Juliana, Quintela, Luciano Alf (director), Rafinha (técnico), Yuri.

### 1.2 Engine / TOM

Padrão de markers existente:

```
<<MARKER_TYPE>>
{ JSON payload }
<<END>>
```

(Não `<</MARKER_TYPE>>` — bug recente corrigido. Todo marker novo segue `<<END>>` como fechamento.)

Pipeline no `processMessage()`:
1. LLM gera `reply` com zero ou mais blocks `<<MARKER>>...<<END>>`
2. Engine executa cada bloco em sequência: `parseXxxMarker(reply)` → `applyXxxAction(collab, parsed)`
3. Cada execução gera entrada em `marker_logs` com status `executed` ou `rejected`
4. `reply` é limpo dos markers antes de retornar ao usuário

Markers existentes (Sprint 14/15):
- `<<TASK_UPDATE>>` — criar/completar/reagendar tasks (inclui create-for-other)
- `<<ANNOUNCEMENT>>` — criar/cancelar comunicados internos
- `<<ANNOUNCEMENT_APPROVAL>>` — director aprova/rejeita
- `<<SCHOOL_EVENT_ACTION>>` — criar/cancelar eventos institucionais
- `<<ONBOARDING>>`, `<<MEMORY>>`, `<<PROJECT>>`, `<<WEEKLY_PLAN>>`, `<<HABIT>>`, `<<DND>>`

Helper functions reutilizáveis:
- `findCollaboratorByName(name)` — resolução best-effort por primeiro nome (case-insensitive, rejeita ambíguo)
- `findCollaboratorByPhone(phone)` — resolve por número limpo
- `logMarker(collabId, type, status, reason, raw)` — auditoria unificada

### 1.3 Dispatcher

`run()` no `src/rituals/dispatcher.js` tem ~14 blocos cron executados a cada tick (cron PM2). Padrões de referência:

| Bloco | Padrão relevante |
|---|---|
| `remindEventTasks` | T-1 reminder com janela de horas; idempotência via `ritual_logs` |
| `notifyCoordinators` | observa mudança de status e envia WhatsApp; query com `.lte/.is.null` |
| `dispatchAnnouncements` | FIFO queue, 1 job/tick, retry_count <= 3, status machine (pending→sent→failed) |
| `checkDepartmentOperational` | briefing semanal por departamento; `departments.default_responsible_id` como single-source-of-truth |
| `checkChecklistConsequences` | gera tasks automáticas quando checklist item não concluído |

Todos os blocos são wrapped em `try/catch` independente para não travar o tick. Idempotência via `ritual_logs` ou campo de status da própria entidade.

### 1.4 PWA

19 telas existentes. Relevantes para referência:

- `/mais/comunicados` — lista de announcements com status, polling de jobs, FAB para criar
- `/mais/checklists-templates` — padrão de lista em `/mais/*` com gate de role
- `/time/:id` (Pessoa Detalhe) — visão de colaborador individual (coord/director)
- `Mais.tsx` — menu de itens com `requireRoles` gate

O padrão de adicionar uma tela nova é: novo `import` + `<Route>` em `App.tsx` + novo item com `requireRoles` em `Mais.tsx`.

### 1.5 Sprint 14/15 reutilizamento direto

- **create-for-other** (Sprint 14 F1): padrão completo de `to_name`/`to_phone` no marker, gating por role (só coordinator/director), `findCollaboratorByName`, notificação WhatsApp ao recipient. O `applyCoordinationRequestAction` seguirá o mesmo fluxo.
- **event_team_map** (Sprint 14 F2): config-based responsibility — modelo para como associar responsáveis sem hardcode.
- **departments.default_responsible_id** (Sprint 15): single-source-of-truth de quem recebe notificação operacional — mesmo conceito para `coordination_requests.recipient_id`.
- **priorizacao-inteligente** skill (Sprint 14/15): parsing de intent do usuário — referência de como a skill instrui o TOM a classificar a intenção antes de emitir o marker.
- **system.js skill loader pattern**: condicional por role, `fs.existsSync` + `readFileSync` + `systemPrompt +=`. Novo skill `coordenacao-conversacional.md` seguirá o mesmo padrão, carregado para TODOS os roles.

---

## 2. Proposta arquitetural da Sprint 16

### 2.1 Decisão fundamental: nova entidade `coordination_requests`

**Justificativa:** o PRD §12.5 explicitamente abre a questão. Decisão: **CRIAR** entidade própria.

Razões contra reutilizar entidades existentes:

| Candidato | Por que não serve |
|---|---|
| `tasks` | domínio de execução — tem prazo, checklist, prioridade, department_id. "Uma task fala com X" é semantic-overload; uma task não "espera resposta" do recipient |
| `notifications` | fila de saída unidirecional — não tem semântica de "aguardando resposta", sem sender/recipient como par relacional |
| `conversation_history` | log bruto por colaborador; não modela interação 2-way nem tem estado de máquina |
| `task_comments` | child de task — não existe sem task pai; não modela interação direta entre 2 pessoas |
| `announcements` | broadcast 1-para-muitos sem resposta esperada; `coordination_requests` é 1-para-1 com possível follow-up |

`coordination_requests` modela um domínio novo: **interação mediada com origem, destino, modo, estado, timeout, resposta e auditoria**. Nenhuma tabela existente carrega esses 8 atributos simultaneamente.

### 2.2 Schema novo

```sql
CREATE TABLE coordination_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id          uuid NOT NULL REFERENCES collaborators(id),
  recipient_id          uuid NOT NULL REFERENCES collaborators(id),
  mode                  text NOT NULL
                          CHECK (mode IN ('relay_literal', 'relay_assisted', 'followup')),
  message_body          text NOT NULL,      -- mensagem enviada ao recipient (literal ou parafraseada)
  message_original      text,               -- o que o requester pediu ao TOM (para modo assisted)
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending',        -- criado, ainda não enviado
                            'sent',           -- WhatsApp enviado ao recipient
                            'responded',      -- recipient respondeu, requester notificado
                            'timeout',        -- response_deadline expirado sem resposta
                            'cancelled',      -- cancelado pelo requester ou pelo sistema
                            'rejected_by_tom' -- TOM recusou antes de criar (autorização)
                          )),
  expects_response      boolean NOT NULL DEFAULT false,
  response_deadline     timestamptz,         -- preenchido quando expects_response = true
  sent_at               timestamptz,
  read_at               timestamptz,         -- opportunistic: webhook UAZAPI se disponível
  responded_at          timestamptz,
  response_summary      text,               -- TOM resume a resposta do recipient
  recipient_message_id  uuid REFERENCES conversation_history(id),
  cancelled_at          timestamptz,
  cancelled_reason      text,
  parent_request_id     uuid REFERENCES coordination_requests(id), -- escalação / retry chain
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX coord_req_recipient_status_idx
  ON coordination_requests(recipient_id, status);

CREATE INDEX coord_req_requester_created_idx
  ON coordination_requests(requester_id, created_at DESC);

CREATE INDEX coord_req_pending_response_idx
  ON coordination_requests(response_deadline)
  WHERE expects_response = true AND status = 'sent';

-- RLS
ALTER TABLE coordination_requests ENABLE ROW LEVEL SECURITY;

-- Director vê tudo
CREATE POLICY coord_req_director_all ON coordination_requests
  FOR ALL USING (current_collab_role() = 'director');

-- Qualquer colaborador vê o que pediu E o que recebeu
CREATE POLICY coord_req_collab_self ON coordination_requests
  FOR SELECT USING (
    requester_id = current_collab_id()
    OR recipient_id = current_collab_id()
  );

-- Insert: requester deve ser o próprio (autorização de role é validada no engine)
CREATE POLICY coord_req_insert_self ON coordination_requests
  FOR INSERT WITH CHECK (requester_id = current_collab_id());

-- Update restrito ao engine (service role bypassa RLS)
-- PWA só lê; engine escreve via service role key
```

**Trigger `updated_at`** — padrão já existente em outras tabelas:

```sql
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON coordination_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 2.3 Estados (state machine)

```
[criação]
  pending
    │
    ├─→ rejected_by_tom   (TOM detecta autorização inválida ANTES de enviar)
    │
    ├─→ cancelled         (requester cancela antes do envio)
    │
    └─→ sent ──────────── read_at (opportunistic, NÃO muda status)
          │
          ├─→ responded   (recipient envia msg; engine detecta + notifica requester)
          ├─→ timeout     (dispatcher detecta response_deadline expirado)
          └─→ cancelled   (requester cancela após envio)
```

**Regras de transição:**

| De → Para | Quem transita | Condição |
|---|---|---|
| `pending → sent` | engine `applyCoordinationRequestAction` | WhatsApp enviado com sucesso |
| `sent → read_at` | webhook UAZAPI (se disponível) | EventType de read receipt |
| `sent → responded` | engine (in-message, recipient envia msg) | LLM detecta como resposta |
| `sent → timeout` | dispatcher `checkCoordinationTimeouts` | `response_deadline < now()` |
| `pending\|sent → cancelled` | requester via TOM ("cancela o recado pro X") | requester confirma |
| `pending → rejected_by_tom` | engine (gating de autorização) | role/mode inválido |

### 2.4 Política de autorização (gating no engine)

**Regra-mãe (PRD §8.4):** em caso de dúvida de alçada, TOM prefere mediação leve ou recusa clara com explicação institucional. Jamais executa cobrança fora de alçada.

**Matriz de autorização:**

| requester_role | relay_literal | relay_assisted | followup (cobrança) |
|---|---|---|---|
| `director` | qualquer recipient | qualquer recipient | qualquer recipient |
| `coordinator` | qualquer collab ativo | qualquer collab ativo | qualquer collab ativo (exceto director) |
| `manager` | qualquer collab ativo | qualquer collab ativo | qualquer collab ativo (exceto director) |
| `collaborator` | qualquer collab ativo | qualquer collab ativo | **RECUSADO** |

**Lógica de gating no engine (pseudocódigo):**

```js
// 1. Lookup recipient
const recipient = await findCollaboratorByName(parsed.recipient_name);
if (!recipient || !recipient.is_active) → recusa "não encontrei ninguém com esse nome ativo"

// 2. Self-relay? → recusa graciosamente
if (recipient.id === collab.id) → recusa "você quer mandar uma mensagem pra si mesmo?"

// 3. Mode = followup + role = collaborator → recusa institucional
if (parsed.mode === 'followup' && collab.role === 'collaborator') {
  → status = rejected_by_tom, cancelled_reason = "role_insufficient"
  → reply = "Não vou cobrar o {recipient.first_name} por você. Esse tipo de cobrança
    precisa vir do coordenador ou diretor. Quer que eu te ajude a formular para
    mandar pro teu coordenador?"
}

// 4. Director não pode ser "cobrado" por coordinator/manager via followup
if (parsed.mode === 'followup'
    && recipient.role === 'director'
    && collab.role !== 'director') {
  → recusa "cobrar o diretor via TOM está fora da minha alçada — fala com ele diretamente"
}

// 5. Passou tudo → criar coordination_request + enviar WhatsApp
```

### 2.5 Skill TOM nova: `coordenacao-conversacional.md`

**Carregamento:** em `system.js`, carregada para **todos os roles** (mesmo padrão de `operacoes-tecnicas.md` — Sprint 15).

**Triggers de linguagem natural que ativam a skill:**
- "fala com X", "manda recado pra Y", "avisa o Z"
- "cobra a Anne", "pergunta pra X se Y", "manda exatamente isso pro Rafinha"
- "se o Yuri não responder até 16h, me avisa"
- "transmite isso pros líderes"

**Modos detectados pela skill:**

| Modo | Quando usar | Exemplo |
|---|---|---|
| `relay_literal` | usuário pede envio verbatim ("manda exatamente isso") | "Tom, manda exatamente: 'preciso do relatório até sexta'" |
| `relay_assisted` | usuário quer avisar mas não dita a mensagem | "Tom, avisa o Yuri que preciso dos criativos até 16h" |
| `followup` | usuário quer cobrança + monitoramento de resposta | "Tom, cobra o Rafinha e me avisa se ele não responder" |

**Marker emitido:** `<<COORDINATION_REQUEST>>`

**Schema do marker:**

```json
<<COORDINATION_REQUEST>>
{
  "recipient_name": "Rafinha",
  "mode": "relay_literal | relay_assisted | followup",
  "message_body": "texto que será enviado ao recipient",
  "message_original": "o que o requester pediu (só em relay_assisted)",
  "expects_response": true,
  "response_deadline_hours": 4
}
<<END>>
```

**Regras da skill para o LLM:**
1. Nunca emitir `followup` para `collaborator` — detectar o tom de cobrança e recusar antes de emitir marker.
2. Em `relay_literal`: preservar o texto verbatim, não reinterpretar.
3. Em `relay_assisted`: parafrasear para tom profissional, preservar intenção.
4. Quando ambíguo entre `relay_literal` e `relay_assisted`: perguntar ao usuário ANTES de emitir.
5. `response_deadline_hours`: inferir do contexto ("até 16h" → calcular delta a partir de `now()`); padrão 24h se não especificado.
6. Se `recipient_name` ambíguo: perguntar "tem mais de uma pessoa com esse nome na equipe — você quis dizer X ou Y?"

### 2.6 Engine: `applyCoordinationRequestAction` (NOVO)

```
async function applyCoordinationRequestAction(collab, parsed):
  1. findCollaboratorByName(parsed.recipient_name) → recipient
  2. Gating de autorização (§2.4)
     → se recusa: INSERT coordination_requests (status=rejected_by_tom)
                  return { ok: false, reason, reply_text }
  3. Calcular response_deadline
     = parsed.response_deadline_hours
       ? now() + interval '${hours} hours'
       : null (se !expects_response)
  4. INSERT coordination_requests (status='pending', todos os campos)
  5. Formatar mensagem ao recipient:
     "👋 {requester.first_name} pediu pra eu te avisar: {message_body}"
     (se relay_literal: "— mensagem literal, sem edição")
  6. whatsapp.sendMessage(recipient.phone, msg)
  7. UPDATE coordination_requests SET status='sent', sent_at=now()
  8. logMarker(collab.id, 'COORDINATION_REQUEST', 'executed', ...)
  9. Return { ok: true, id: request.id.slice(0,4), recipient_first_name }
     → reply ao requester: "✓ Avisei o {recipient.first_name}. [ID: {shortId}]
       {expects_response ? 'Te aviso quando ele responder.' : ''}"
```

### 2.7 Detecção de resposta (engine + dispatcher)

#### 2.7.1 Engine in-message (quando recipient envia qualquer mensagem)

No início de `processMessage(phone, text)`, antes do LLM, verificar:

```js
// Existe coordination_request aberto para este collab como recipient?
const openRequests = await supabase
  .from('coordination_requests')
  .select('id, requester_id, message_body, created_at')
  .eq('recipient_id', collab.id)
  .eq('status', 'sent')
  .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: false })
  .limit(3);
```

Se houver requests abertos, injetar hint no system prompt:
```
[COORD_HINT] Há {n} recado(s) aguardando resposta sua:
- De: {requester.first_name} | "{message_body_preview}" | {time_ago}
Se a mensagem atual parecer resposta a um desses, emita <<COORDINATION_RESPONSE>>.
```

**Marker de resposta:** `<<COORDINATION_RESPONSE>>`

```json
<<COORDINATION_RESPONSE>>
{
  "request_id": "uuid-completo",
  "response_summary": "Rafinha disse que vai verificar o teclado amanhã cedo"
}
<<END>>
```

**`applyCoordinationResponseAction(collab, parsed)`:**
1. UPDATE `coordination_requests`: status='responded', responded_at=now(), response_summary, recipient_message_id
2. Buscar requester → `whatsapp.sendMessage(requester.phone, "👋 {recipient.first_name} respondeu ao seu recado: '{response_summary}'")`
3. logMarker

#### 2.7.2 Dispatcher block: `checkCoordinationTimeouts`

Executa em dias úteis, a cada tick (junto com os outros blocos do `run()`). Gating por horário: 8h–20h BRT.

```js
async function checkCoordinationTimeouts() {
  const now = new Date();
  const { data: expired } = await supabase
    .from('coordination_requests')
    .select('id, requester_id, recipient_id, message_body, response_deadline')
    .eq('expects_response', true)
    .eq('status', 'sent')
    .lt('response_deadline', now.toISOString())
    .limit(10); // processa em lotes

  for (const req of expired || []) {
    await supabase.from('coordination_requests')
      .update({ status: 'timeout', updated_at: now.toISOString() })
      .eq('id', req.id);

    const requester = await findCollaboratorById(req.requester_id);
    const recipient = await findCollaboratorById(req.recipient_id);
    if (requester?.phone) {
      await whatsapp.sendMessage(requester.phone,
        `⏳ O prazo do recado pro ${nameForCollab(recipient)} expirou sem resposta.\n` +
        `Mensagem: "${req.message_body.slice(0, 80)}"`
      );
    }
    console.log(`[checkCoordinationTimeouts] timeout req=${req.id.slice(0,8)}`);
  }
}
```

Idempotência: a query filtra `status = 'sent'` — um request em timeout já foi atualizado e não aparece de novo.

### 2.8 Read receipts (opportunistic)

O webhook UAZAPI em `src/webhook.js` filtra `isIgnorable(body)` que rejeita `EventType !== "messages"`. Isso significa que **eventos de status/delivery da UAZAPI são descartados atualmente**.

Decisão MVP: **não implementar**. `read_at` fica null. Se e quando quisermos capturar, a mudança é isolada: adicionar branch em `webhook.js` para `EventType === "ack"` (ou equivalente UAZAPI) e fazer UPDATE em `coordination_requests`.

Não bloquear nenhuma Fatia por read receipts.

### 2.9 PWA (mínimo)

**Recomendação: sem tela no MVP.** Coordenação é por natureza conversacional — o requester acompanha perguntando ao TOM ("TOM, e o recado pro Yuri?"). TOM responde com status do `coordination_requests` mais recente.

Se uso real evidenciar necessidade de visibilidade em lista, criar tela `/mais/coordenacao` na Fatia 7 (pós-uso) com:
- Aba "Enviados": requests onde `requester_id = eu` (status, recipient, modo, sent_at, responded_at, summary)
- Aba "Recebidos": requests onde `recipient_id = eu` (histórico, com contexto da mensagem)
- Botão "Cancelar" para requester quando `status IN ('pending', 'sent')`

### 2.10 Casos de uso (rastreados do PRD §6)

| Caso | Trigger | Modo | Resultado esperado |
|---|---|---|---|
| 6.1 Delegação monitorada | "Fala com o Rafinha sobre o teclado da sala 3 e me avisa se ele responder" | `relay_assisted` + `followup`, `expects_response=true` | TOM avisa Rafinha; quando Rafinha responder, TOM notifica requester |
| 6.2 Cobrança com rastreamento | "Cobra o Yuri sobre os criativos do anúncio de amanhã" | `followup` | TOM envia cobrança; se deadline expirar sem resposta, notifica requester |
| 6.3 Encaminhamento de aviso | "Avisa a Anne que amanhã vou estar no Recreio" | `relay_assisted`, `expects_response=false` | TOM manda aviso pra Anne; requester recebe "✓ Avisei a Anne" |
| 6.4 Pedido de confirmação | "Pergunta pra Juliana se o evento já foi alinhado" | `followup`, `expects_response=true` | TOM pergunta; quando Juliana responder, TOM resume pra requester |
| 6.5 Escalonamento por ausência | "Se o Rafinha não responder até 16h, me avisa" | `followup` com `response_deadline` explícito | `checkCoordinationTimeouts` marca timeout + notifica requester às 16h+ |
| 6.6 Collaborator tenta cobrar | "Cobra o Rafinha sobre o equipamento" | `followup` por `collaborator` | TOM recusa com mensagem institucional + sugere alternativa |

---

## 3. Trade-offs e riscos

### 3.1 Privacidade — transparência ao recipient

**Decisão:** recipient **sempre** sabe que veio via TOM (mensagem começa com "👋 {first_name} pediu pra eu te avisar:"). Isso é intencional:
- Evita que o recipient pense que é comunicação direta
- Mantém TOM como mediador explícito, não fantasma
- Alinha com PRD §12.4 ("o receptor sabe que veio via TOM?")

**Risco residual:** recipient pode se sentir "monitorado". Mitigação: linguagem do TOM deve ser neutra/amigável, nunca coercitiva.

### 3.2 Autorização — cobrança disfarçada de relay_assisted

Um collaborator poderia tentar formular uma cobrança como `relay_assisted` para burlar o gating. A skill precisa instruir o TOM a detectar **tom de cobrança** independente do modo declarado. Critérios: presença de prazo implícito + verbo de exigência + posição hierárquica inferior.

**Risco:** TOM bloquear demais e recusar relays legítimos de pares. Mitigação: skill deve diferenciar "aviso" de "cobrança" claramente. Em caso de dúvida, TOM pergunta ao usuário antes de emitir marker.

### 3.3 Ambiguidade entre relay_literal e relay_assisted

O usuário pode não deixar claro se quer envio verbatim ou paráfrase. Skill deve perguntar quando não está óbvio. Adicionar ao skill: "Se o usuário usar aspas ou 'manda exatamente' → relay_literal. Se descrever o recado sem citar texto exato → relay_assisted."

### 3.4 Detecção de resposta — falsos positivos

Recipient envia uma mensagem não relacionada (ex.: "bom dia TOM, o que tenho hoje?") e o hint no system prompt faz o LLM erroneamente associar como resposta ao coordination_request.

Mitigação:
- `<<COORDINATION_RESPONSE>>` só deve ser emitido quando a mensagem **semanticamente** responde à pergunta/aviso do request
- Adicionar instrução na skill: "só emita COORDINATION_RESPONSE se a mensagem claramente responde ao recado específico"
- Threshold conservador: em caso de dúvida, não emitir marker (o dispatcher vai capturar via timeout se necessário)

### 3.5 Cascata de coordenação

A pede pro TOM cobrar B. B responde "vou pedir ao C". A cadeia pode se tornar complexa. MVP não suporta cascata — mas `parent_request_id` foi incluído no schema para habilitar isso sem refactor de coluna. Valor: zero custo agora, evita ALTER TABLE futuro.

### 3.6 Risco político / abuso sistêmico

Mesmo com gating, coordinator pode usar `relay_assisted` repetidamente para criar pressão informal. Auditoria via `coordination_requests` (director vê tudo via RLS) e `marker_logs` cria trilha visível. Director pode consultar histórico de requests de qualquer membro via PWA (Fatia 7) ou SQL.

### 3.7 UAZAPI sem evento de leitura

A análise do `whatsapp.js` confirma que `isIgnorable()` descarta `EventType !== "messages"` — ou seja, eventos de delivery/read da UAZAPI já chegam mas são silenciosamente descartados. A opção de capturar `read_at` está a 1 commit de distância, mas não é necessária para o MVP funcionar.

---

## 4. Plano de implementação por fatias

### Fatia 1 — Schema + RLS (DB only)
**Entregável:** 1 migration SQL  
**Arquivos:** `supabase/migrations/YYYYMMDD_coordination_requests.sql`  
**Conteúdo:** CREATE TABLE + indexes + RLS policies + trigger updated_at  
**Validação:** SQL manual — INSERT como director (OK), INSERT como collaborator com recipient_id errado (falha RLS), SELECT cross-collab sem ser director (0 rows)  
**Sem mudança em:** engine, dispatcher, skills, PWA

### Fatia 2 — Engine: marker + parser + applyCoordinationRequestAction + gating
**Entregável:** novos blocos em `engine.js`  
**Arquivos:** `src/engine.js`  
**Conteúdo:**
- `parseCoordinationRequestMarker(reply)` — mesmo padrão dos outros parsers
- `applyCoordinationRequestAction(collab, parsed)` — lookup, gating, INSERT, sendMessage, UPDATE
- Integração no pipeline `processMessage()` (novo bloco na sequência de markers)
- Reuso de `findCollaboratorByName`, `logMarker`, `whatsapp.sendMessage`

**Smoke test:** director manda "fala com Rafinha que preciso do teclado da sala 3" → engine cria request em `coordination_requests`, Rafinha recebe WhatsApp  
**Sem skill ainda** (Fatia 3)

### Fatia 3 — Skill `coordenacao-conversacional.md` + loader em system.js
**Entregável:** nova skill + 1 linha em system.js  
**Arquivos:** `skills/coordenacao-conversacional.md`, `src/prompts/system.js`  
**Conteúdo da skill:**
- Definição dos 3 modos com exemplos
- Regra-mãe de alçada
- Recusas hierárquicas com texto exato
- Trigger phrases
- Schema do marker `<<COORDINATION_REQUEST>>`
- Instrução para emitir `<<COORDINATION_RESPONSE>>` quando recipient responde

**Loader:** mesmo bloco `if (collaborator)` de `operacoes-tecnicas.md` — carrega para todos  
**Smoke test E2E:** director digita trigger → TOM emite marker → applyCoordinationRequestAction executa → WhatsApp enviado

### Fatia 4 — Detecção de resposta (engine in-message)
**Entregável:** novo bloco em `processMessage()` + `applyCoordinationResponseAction`  
**Arquivos:** `src/engine.js`  
**Conteúdo:**
- Query de `openRequests` no início de `processMessage`
- Injeção de `COORD_HINT` no system prompt quando há requests abertos
- Parser de `<<COORDINATION_RESPONSE>>`
- `applyCoordinationResponseAction` — UPDATE status + notifica requester

**Smoke test:** Rafinha responde ao TOM após receber relay → Alf recebe "Rafinha respondeu: ..."

### Fatia 5 — Dispatcher block `checkCoordinationTimeouts`
**Entregável:** nova função + integração em `run()`  
**Arquivos:** `src/rituals/dispatcher.js`  
**Conteúdo:**
- `async function checkCoordinationTimeouts()`
- Adicionada ao `run()` com try/catch independente (padrão existente)
- Gating de horário: 8h–20h BRT (igual a `checkDeadlineAlerts`)

**Smoke test:** criar request com `response_deadline = now() - 5 minutes`, executar `dispatcher --force=checkCoordinationTimeouts` → status muda para `timeout`, requester recebe WhatsApp

### Fatia 6 — Validação E2E (casos do PRD §6)
**Roteiro:**
1. Caso 6.3: Alf → "avisa a Anne que amanhã vou estar no Recreio" → Anne recebe → Alf recebe confirmação
2. Caso 6.1: Alf → "fala com Rafinha sobre teclado e me avisa" → Rafinha responde → Alf recebe summary
3. Caso 6.5: Alf → "cobra Rafinha, prazo 1h" → 1h sem resposta → Alf recebe timeout
4. Caso 6.6: Collaborator → "cobra o Rafinha" → TOM recusa com texto institucional
5. Auditoria: `SELECT * FROM coordination_requests ORDER BY created_at DESC` — verificar todos os campos

### Fatia 7 (pós-uso real) — PWA tela `/mais/coordenacao`
**Entregável:** nova tela React  
**Gatilho para iniciar:** evidência de que o time pede visibilidade fora do WhatsApp (feedback orgânico)  
**Arquivos:** `web/src/screens/Coordenacao.tsx`, `web/src/App.tsx`, `web/src/screens/Mais.tsx`  
**Role gate:** todos os roles (cada um vê apenas o que enviou / recebeu)

---

## 5. Decisões fechadas (aprovadas pelo Alf — 2026-05-03)

| # | Decisão | Resolução |
|---|---|---|
| 1 | Read receipts no MVP | **NÃO.** `read_at = null` por enquanto. UAZAPI ack capture vira evolução pós-uso. |
| 2 | PWA Fatia 7 no MVP | **NÃO.** Pós-uso real. Acompanhamento 100% via TOM. |
| 3 | Collaborator followup peer-to-peer | **NÃO.** Mantém restrição do PRD §8.3. |
| 4 | `parent_request_id` no schema | **SIM.** Incluir desde já. Custo zero, retrofit caro. |
| 5 | Detecção de resposta — abordagem | **LLM via COORD_HINT.** Conservador, threshold no skill ("claramente responde"). |
| 6 | Coordinator → director (caso diagonal) | `relay_literal` e `relay_assisted` permitidos (aviso/recado). `followup` bloqueado (não cobra superior). |

---

## 6. Regra obrigatória de UX conversacional (decisão Alf — 2026-05-03)

O recipient **sempre** sabe (a) quem originou o pedido e (b) se o TOM está só repassando ou acompanhando resposta. Sem exceção.

**Templates obrigatórios para mensagem ao recipient:**

| Modo | Template do TOM ao recipient |
|---|---|
| `relay_literal` | `O {requester.first_name} pediu pra eu te repassar (literalmente):\n\n"{message_body}"` |
| `relay_assisted` | `O {requester.first_name} me pediu pra te avisar:\n\n{message_body}` |
| `followup` | `O {requester.first_name} me pediu pra te perguntar (e estou acompanhando tua resposta pra devolver pra ele/ela):\n\n{message_body}` |

**Frases de fallback se o nome do requester for ambíguo (homônimos):**
- Inclui `function_title` se houver: `O {first_name} ({function_title})...`
- Caso contrário, nome completo: `O {full_name}...`

**Quando TOM monitorar resposta (followup):** ao detectar a resposta, mande ao requester:
> `Boa! O {recipient.first_name} respondeu o que você pediu:\n\n"{response_summary}"`

**Quando TOM perder o prazo (timeout):** mande ao requester:
> `Heads up: pedi pro {recipient.first_name} {short_summary}, mas até agora ({deadline_relative}) não respondeu. Quer que eu insista ou prefere falar direto?`

**Skill `coordenacao-conversacional.md` deve carregar esses templates como REGRA NÃO-NEGOCIÁVEL.** O TOM nunca pode enviar mensagem ao recipient sem o cabeçalho de origem + indicação de modo. Logar `marker_logs[result='rejected', reason='missing_origin_header']` se a mensagem ao recipient não bater o pattern.

**Por que isso é não-negociável:** sem essa regra, TOM vira proxy opaco. Recipient não sabe se está respondendo a um amigo ou ao chefe. Quebra a tese central do PRD ("rastreabilidade + hierarquia humana respeitada").
