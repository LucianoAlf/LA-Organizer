# Spec: Sprint 17 — Active Coordination Context (ACC)
**Data:** 2026-05-03
**Status:** Proposta — aguardando aprovação
**Referência:** docs/la-organizer-sprint17-acc-prd.md
**Base:** Sprint 16 (commits 5a02562 + 027d660 + 484d708 + 7614997)

---

## 1. Diagnóstico do estado atual

### 1.1 Onde a Sprint 16 bateu no teto cognitivo

A Sprint 16 entregou o motor de coordenação funcional: TOM cria `coordination_requests`, dispara WhatsApp ao recipient, detecta respostas via `<<COORDINATION_RESPONSE>>`, aplica hierarquia de alçada. A validação E2E com uso real (AlfBot, 2026-05-03) confirmou que a feature funciona — mas revelou **7 fragilidades cognitivas**. Quatro delas ficam para a Sprint 17:

| # | Problema | Sintoma observado | Prioridade |
|---|---|---|---|
| **#1** | **Perda de referente anafórico** | Alf: "Agradece a ele!" após TOM mostrar resposta do Rafinha → TOM perguntou "agradecer a quem? a conversa era com a Anne" | P1 |
| **#2** | **Mistura de threads paralelas** | Com 4 requests abertos (Rafinha-teclado, Yuri-criativos, Anne-Recreio, Rafinha-Staner), TOM confundiu contextos quando Alf disse "Diz pra ela que está autorizado" | P2 |
| **#6 (causa secundária)** | **Loop de mediação incompleto** | Causa primária resolvida (027d660 — `extractText` agora aceita `ExtendedTextMessage`), mas TOM ainda precisa de contexto explícito do `request_id` para emitir `<<COORDINATION_RESPONSE>>` com precisão | P3 |
| **#7** | **Sem thread ativa dominante** | Generalização de #1 + #2: quando Alf usa pronomes ou comandos elípticos ("ele/ela/isso/manda/agradece"), TOM não tem um candidato natural resolvível | P1 |

Bugs já resolvidos antes da Sprint 17:
- **#3** Over-clarification → tweak na skill (regra "quando confirmar")
- **#4** Grounding temporal → próximo commit no `system.js`
- **#5** Duplicação de cabeçalho → `484d708` (REGRA CRÍTICA na skill)
- **#6** (causa primária) → `027d660` (extractText ExtendedTextMessage)

**Frase do diagnóstico:** "O motor está vivo, mas a camada de contexto conversacional ainda está fraca."

### 1.2 Componentes existentes reaproveitáveis

A Sprint 17 **não cria** nada dos itens abaixo:

| Componente | Origem | Localização |
|---|---|---|
| Tabela `coordination_requests` + 9 estados + RLS | Sprint 16 F1 | Supabase (migration aplicada) |
| `applyCoordinationRequestAction(collab, parsed)` | Sprint 16 F2 | `src/engine.js` linha ~1231 |
| `applyCoordinationResponseAction(collab, parsed)` | Sprint 16 F4 | `src/engine.js` linha ~1146 |
| `_buildRecipientMessage(displayName, mode, body)` | Sprint 16 F2 | `src/engine.js` linha ~1197 |
| `parseCoordinationResponseMarker(text)` | Sprint 16 F4 | `src/engine.js` linha ~1146 |
| Skill `coordenacao-conversacional.md` (3 modos + REGRA CRÍTICA + regra "quando confirmar") | Sprint 16 F3 + 484d708 | `skills/coordenacao-conversacional.md` |
| Mecanismo COORD_HINT: query + montagem do bloco + injeção via `opts.coordHint` | Sprint 16 F4 | `src/engine.js` linha ~2992; `src/prompts/system.js` linhas 813 + 986-989 + 1019-1022 |
| `buildSystemPrompt(collaborator, opts = {})` — signature já aceita `opts` arbitrário | Sprint 16 F4 | `src/prompts/system.js` linha 810 |
| Temporal grounding parcial: `**Data/hora agora (BRT):**` + `**Amanhã (BRT):**` | Sprint 10.1 | `src/prompts/system.js` linhas 190-191 |

### 1.3 O que a Sprint 17 precisa acrescentar

| Novo componente | Arquivo | Descrição |
|---|---|---|
| `buildActiveCoordinationContext(collab)` | `src/engine.js` | Função assíncrona: 4 queries + scoring + retorno `{block, focusCandidate, focusConfidence}` |
| Wiring em `processMessage` | `src/engine.js` linha ~2991 | Chamada a `buildActiveCoordinationContext` antes de `buildSystemPrompt`; passa `acc.block` como `opts.coordContext` |
| Injeção de `opts.coordContext` em `buildSystemPrompt` | `src/prompts/system.js` | Receber e injetar logo após o COORD_HINT — padrão idêntico ao `opts.coordHint` (linhas 813 + 986-989) |
| Nova seção "Como consumir [ACTIVE_COORDINATION_CONTEXT]" | `skills/coordenacao-conversacional.md` | Tabela de heurísticas de resolução de pronomes/elipse + exemplos concretos |
| Defense-in-depth: strip de cabeçalho duplicado | `src/engine.js` — dentro de `applyCoordinationRequestAction`, antes de `whatsapp.sendMessage` | Regex strip de prefixo de origem no `message_body` antes do envio |
| Reforço temporal: linha "Esta semana" | `src/prompts/system.js` linha ~191 | Adicionar linha com segunda→domingo com datas explícitas |

---

## 2. Proposta arquitetural da Sprint 17

### 2.1 Função `buildActiveCoordinationContext(collab)` — núcleo

**Signature:**
```js
/**
 * Sprint 17 — Active Coordination Context.
 * Seleciona, prioriza e formata os coordination_requests mais relevantes
 * para o turno atual do collab, retornando um bloco estruturado para injeção no prompt.
 *
 * @param {object} collab - Row de collaborators (id, full_name, role, phone, ...)
 * @returns {{ block: string|null, focusCandidate: object|null, focusConfidence: 'high'|'medium'|'low'|'none' }}
 */
async function buildActiveCoordinationContext(collab)
```

**Estrutura de retorno:**
```js
{
  block: string | null,           // texto formatado para inserir no prompt; null se não há requests relevantes
  focusCandidate: {               // candidato dominante identificado pela heurística
    requestId: string,
    role: 'requester' | 'recipient',  // papel do collab neste request
    actorName: string,            // nome do outro ator (requester ou recipient)
    mode: string,
    reason: string,               // motivo da seleção (ex: 'última resposta recebida')
  } | null,
  focusConfidence: 'high' | 'medium' | 'low' | 'none',
}
```

#### 2.1.1 Seleção de requests relevantes — 4 queries

**Query Q1** — último request criado pelo collab (últimos 7 dias, qualquer status):
```sql
SELECT cr.id, cr.recipient_id, cr.mode, cr.message_body, cr.status, cr.created_at,
       c.full_name AS recipient_name
FROM coordination_requests cr
LEFT JOIN collaborators c ON c.id = cr.recipient_id
WHERE cr.requester_id = $collab.id
  AND cr.created_at > now() - interval '7 days'
ORDER BY cr.created_at DESC
LIMIT 1
```

**Query Q2** — último request onde collab é recipient (últimas 24h, status em aberto):
```sql
SELECT cr.id, cr.requester_id, cr.mode, cr.message_body, cr.status, cr.created_at,
       c.full_name AS requester_name
FROM coordination_requests cr
LEFT JOIN collaborators c ON c.id = cr.requester_id
WHERE cr.recipient_id = $collab.id
  AND cr.status IN ('pending', 'sent', 'responded')
  AND cr.created_at > now() - interval '24 hours'
ORDER BY cr.created_at DESC
LIMIT 1
```

**Query Q3** — última resposta recebida pelo collab como requester (últimos 7 dias):
```sql
SELECT cr.id, cr.recipient_id, cr.mode, cr.response_summary, cr.responded_at,
       c.full_name AS responder_name
FROM coordination_requests cr
LEFT JOIN collaborators c ON c.id = cr.recipient_id
WHERE cr.requester_id = $collab.id
  AND cr.status = 'responded'
  AND cr.responded_at > now() - interval '7 days'
ORDER BY cr.responded_at DESC
LIMIT 1
```

**Query Q4** — requests abertos envolvendo collab em qualquer lado (últimas 48h, máx 5):
```sql
SELECT cr.id, cr.requester_id, cr.recipient_id, cr.mode, cr.message_body,
       cr.status, cr.created_at,
       req.full_name AS requester_name,
       rec.full_name AS recipient_name
FROM coordination_requests cr
LEFT JOIN collaborators req ON req.id = cr.requester_id
LEFT JOIN collaborators rec ON rec.id = cr.recipient_id
WHERE (cr.requester_id = $collab.id OR cr.recipient_id = $collab.id)
  AND cr.status IN ('pending', 'sent')
  AND cr.created_at > now() - interval '48 hours'
ORDER BY cr.created_at DESC
LIMIT 5
```

> **Nota de implementação:** As 4 queries podem ser executadas em paralelo com `Promise.all([q1, q2, q3, q4])` para reduzir latência. Custo estimado: ~30ms total em paralelo vs ~120ms sequencial.

#### 2.1.2 FOCUS_CANDIDATE — heurística de seleção

Avaliada em ordem de prioridade decrescente. A primeira regra que satisfaz retorna o candidato.

| Prioridade | Condição | focusCandidate | focusConfidence |
|---|---|---|---|
| **1** | Q3 retorna resultado **e** `responded_at` < 30 min atrás | Actor = recipiente daquela resposta (quem respondeu); reason = "última resposta recebida" | `high` |
| **2** | Q1 retorna resultado **e** `created_at` < 30 min atrás **e** `status = 'sent'` | Actor = recipient daquele request; reason = "request recém-criado" | `high` |
| **3** | Q4 retorna exatamente **1** request aberto | Actor = o único outro ator desse request; reason = "único request aberto" | `high` |
| **4** | Q4 retorna 2+ requests, **todos com o mesmo** outro ator (clustering por actor) | Actor = esse ator recorrente; reason = "múltiplos requests com mesmo ator" | `medium` |
| **5** | Q3 retorna resultado **mas** `responded_at` entre 30-120 min | Actor = recipiente daquela resposta; reason = "resposta recente (> 30min)" | `medium` |
| **6** | Q4 retorna 2+ requests com **atores distintos** | focusCandidate = null; reason = "múltiplos candidatos sem foco claro" | `low` |
| **7** | Q1 + Q2 + Q3 + Q4 todos vazios | focusCandidate = null | `none` |

> Regra de desempate entre prioridades 1 e 2 quando ambas satisfeitas: usar a mais recente por timestamp.

#### 2.1.3 FOCUS_CONFIDENCE — política de ação da skill

| Nível | Quando | Comportamento da skill |
|---|---|---|
| `high` | 1 candidato claro, recente (< 30 min), ação elíptica esperada | Resolve pronomes/elipse diretamente, sem confirmar |
| `medium` | 1 candidato com ruído temporal ou outros candidatos próximos | Resolve, mas inclui microconfirmação na resposta (ex: "Vou avisar o Rafinha — pode mandar?") — **ver §5.1** |
| `low` | 2+ candidatos com plausibilidade similar | Pergunta citando candidatos pelo nome ("Pra Anne ou pro Rafinha?") |
| `none` | 0 requests abertos relevantes | Segue fluxo padrão sem ACC; COORD_HINT da Sprint 16 ainda ativo para detecção de resposta |

#### 2.1.4 Construção do bloco `block`

**Formato exato** (linhas omitidas quando dado é null; limite duro de 500 chars):

```
[ACTIVE_COORDINATION_CONTEXT]
- Último request criado por você: {id_short} | recipient={first_name} | "{preview60}" | há {min}min
- Último request onde você é recipient: {id_short} | from={first_name} | "{preview60}" | há {min}min
- Última resposta recebida: {id_short} | de={first_name} | "{summary60}" | há {min}min
- Requests abertos:
  • {id_short} ↔ {actor_first_name} | mode={mode} | "{preview40}"
  • ...

FOCUS_CANDIDATE: {actor_first_name} (req {id_short}, você={role}, reason={reason})
FOCUS_CONFIDENCE: {high|medium|low|none}

Use isso para resolver pronomes/elipsis. Se confidence=low, pergunte citando candidatos pelo nome.
```

**Regras de formatação:**
- `id_short` = primeiros 8 chars do UUID
- `preview60` / `summary60` = slice(0, 60) + "…" se truncado
- `preview40` = slice(0, 40) + "…" se truncado
- Linha omitida se Q1/Q2/Q3 retornar null (não incluir `- Último request criado por você: —`)
- Lista "Requests abertos" omitida se Q4 vazia
- `FOCUS_CANDIDATE` linha omitida se `focusCandidate = null` (substituída por: `FOCUS_CONFIDENCE: none — sem requests ativos`)
- Se `block` ultrapassar 500 chars após montagem: truncar "Requests abertos" para os 3 mais recentes

**Pseudocódigo de montagem:**
```js
async function buildActiveCoordinationContext(collab) {
  const [q1, q2, q3, q4] = await Promise.all([runQ1(collab.id), runQ2(collab.id), runQ3(collab.id), runQ4(collab.id)]);

  const { focusCandidate, focusConfidence } = scoreFocus(q1, q2, q3, q4);

  const lines = ['[ACTIVE_COORDINATION_CONTEXT]'];

  if (q1) {
    const min = minutesAgo(q1.created_at);
    lines.push(`- Último request criado por você: ${short(q1.id)} | recipient=${firstName(q1.recipient_name)} | "${trunc(q1.message_body, 60)}" | há ${min}min`);
  }
  if (q2) {
    const min = minutesAgo(q2.created_at);
    lines.push(`- Último request onde você é recipient: ${short(q2.id)} | from=${firstName(q2.requester_name)} | "${trunc(q2.message_body, 60)}" | há ${min}min`);
  }
  if (q3) {
    const min = minutesAgo(q3.responded_at);
    lines.push(`- Última resposta recebida: ${short(q3.id)} | de=${firstName(q3.responder_name)} | "${trunc(q3.response_summary, 60)}" | há ${min}min`);
  }
  if (q4 && q4.length > 0) {
    lines.push('- Requests abertos:');
    const toShow = q4.slice(0, 5);
    for (const r of toShow) {
      const other = r.requester_id === collab.id ? firstName(r.recipient_name) : firstName(r.requester_name);
      lines.push(`  • ${short(r.id)} ↔ ${other} | mode=${r.mode} | "${trunc(r.message_body, 40)}"`);
    }
  }
  lines.push('');
  if (focusCandidate) {
    lines.push(`FOCUS_CANDIDATE: ${focusCandidate.actorName} (req ${short(focusCandidate.requestId)}, você=${focusCandidate.role}, reason=${focusCandidate.reason})`);
    lines.push(`FOCUS_CONFIDENCE: ${focusConfidence}`);
  } else {
    lines.push(`FOCUS_CONFIDENCE: ${focusConfidence} — sem requests ativos`);
  }
  lines.push('');
  lines.push('Use isso para resolver pronomes/elipsis. Se confidence=low, pergunte citando candidatos pelo nome.');

  let block = lines.join('\n');
  if (block.length > 500) {
    // fallback: rebuild com max 3 requests abertos
    block = rebuildWithMaxOpenRequests(collab, q1, q2, q3, q4.slice(0, 3), focusCandidate, focusConfidence);
  }

  // Se tudo vazio (nenhuma linha de dados), retorna null
  if (!q1 && !q2 && !q3 && (!q4 || q4.length === 0)) {
    return { block: null, focusCandidate: null, focusConfidence: 'none' };
  }

  return { block, focusCandidate, focusConfidence };
}
```

### 2.2 Wiring em `processMessage` (engine.js)

Localização: imediatamente antes da chamada `buildSystemPrompt` (linha ~3025). O bloco COORD_HINT da Sprint 16 permanece inalterado — ACC é adicionado em sequência:

```js
// Sprint 16 — COORD_HINT: verifica recados abertos onde collab é recipient
let coordHint = null;
{
  // ... código existente Sprint 16 (não alterar) ...
}

// Sprint 17 — ACC: contexto ativo de coordenação (foco dominante + pronomes)
let coordContext = null;
{
  const acc = await buildActiveCoordinationContext(collab);
  if (acc.block) {
    coordContext = acc.block;
    // Log para observabilidade
    console.log(`[ACC] focusConfidence=${acc.focusConfidence} focusCandidate=${acc.focusCandidate?.actorName ?? 'none'}`);
  }
}

// Constrói o system prompt 4-block (regras → identidade → contexto → skill ativa).
let { systemPrompt, ctx } = await buildSystemPrompt(collab, { lastUserMessage: text, coordHint, coordContext });
```

### 2.3 Injeção em `system.js`

**Receber `opts.coordContext`** em `buildSystemPrompt` — mesma posição e padrão do `opts.coordHint`:

```js
// linha ~813 (fetchCollaboratorContext):
async function buildSystemPrompt(collaborator, opts = {}) {
  const lastUserMessage = opts.lastUserMessage || '';
  const ctx = await fetchCollaboratorContext(collaborator);
  if (opts.coordHint) ctx.coordHint = opts.coordHint;
  if (opts.coordContext) ctx.coordContext = opts.coordContext;   // Sprint 17 ADD
  // ...
```

**Injeção no prompt assíncrono** (após o bloco COORD_HINT, linhas ~986-989):
```js
// Sprint 16 — COORD_HINT injection (só presente quando recipient tem recados abertos)
if (ctx && ctx.coordHint) {
  systemPrompt += '\n\n' + ctx.coordHint;
}

// Sprint 17 — ACC injection (contexto ativo de coordenação)
if (ctx && ctx.coordContext) {
  systemPrompt += '\n\n' + ctx.coordContext;
}
```

**Injeção no prompt síncrono** (após linha ~1022, mesmo padrão):
```js
// Sprint 16 — COORD_HINT injection
if (ctx && ctx.coordHint) {
  syncPrompt += '\n\n' + ctx.coordHint;
}

// Sprint 17 — ACC injection
if (ctx && ctx.coordContext) {
  syncPrompt += '\n\n' + ctx.coordContext;
}
return syncPrompt;
```

### 2.4 Adaptação da skill `coordenacao-conversacional.md`

Adicionar nova seção ao final do arquivo atual (após a seção `## Detecção de resposta`):

```markdown
## Como consumir [ACTIVE_COORDINATION_CONTEXT]

Quando o system prompt contiver um bloco `[ACTIVE_COORDINATION_CONTEXT]`, use-o para
resolver referências implícitas antes de pedir confirmação.

### Tabela de resolução por tipo de frase

| Frase do usuário | Como resolver |
|---|---|
| "agradece a ele/ela por mim" | Actor = `FOCUS_CANDIDATE` (último de quem recebeu resposta em Q3) |
| "manda" / "confirma" / "autorizado" / "responde" sem objeto explícito | Request = mais recente em Q1 ou Q4 com status aberto |
| "ele/ela/esse/aquele" sem antecedente claro na conversa | → `FOCUS_CANDIDATE.actorName` |
| Pronome + 2+ candidatos com confiança similar (`confidence=low`) | PERGUNTAR: "Pra [nome1] ou pro [nome2]?" |

### Política por nível de confiança

**`FOCUS_CONFIDENCE: high`** — age diretamente, sem confirmar.
- Input: "Agradece a ele!" (após TOM exibir "Rafinha respondeu: vai verificar amanhã cedo.")
- Output: TOM envia mensagem de agradecimento ao Rafinha sem perguntar.

**`FOCUS_CONFIDENCE: medium`** — resolve, mas inclui microconfirmação na resposta.
- Input: "Diz que está autorizado." (request aberto com Rafinha, criado há 45min)
- Output: "Vou avisar o Rafinha que está autorizado — pode mandar?"

**`FOCUS_CONFIDENCE: low`** — pergunta citando candidatos pelo nome.
- Input: "Diz que está autorizado." (requests abertos com Anne E Rafinha, ambos recentes)
- Output: "Pra Anne ou pro Rafinha?"

**`FOCUS_CONFIDENCE: none`** — sem ACC ativo; segue fluxo padrão de coordenação.

### Exemplos concretos por cenário do PRD

**Cenário A — Agradecimento anafórico:**
TOM: "Rafinha respondeu que vai verificar amanhã cedo."
Alf: "Agradece a ele por mim."
→ ACC: `FOCUS_CANDIDATE: Rafinha (req ab12cd34, você=requester, reason=última resposta recebida)`, `FOCUS_CONFIDENCE: high`
→ TOM envia "O Alf manda agradecer!" ao Rafinha sem confirmar.

**Cenário B — Elipse com múltiplos abertos:**
ACC: requests abertos com Anne (45min atrás) e Rafinha (1h atrás). `FOCUS_CONFIDENCE: low`
Alf: "Diz que está autorizado."
→ TOM: "Pra Anne ou pro Rafinha?"

**Cenário C — Comando claro (sem ACC necessário):**
Alf: "fala com Anne sobre o briefing de amanhã"
→ Recipient explícito, objetivo claro → emita relay_assisted diretamente. REGRA "quando confirmar" ainda se aplica.

**Cenário D — Loop de mediação (fechamento de resposta):**
ACC: `FOCUS_CANDIDATE: Anne (req ef56ab78, você=requester, reason=único request aberto)`, `FOCUS_CONFIDENCE: high`
Anne responde ao TOM via WhatsApp.
→ TOM usa request_id do FOCUS_CANDIDATE para emitir `<<COORDINATION_RESPONSE>>` com precisão.
```

### 2.5 Defense-in-depth: strip de cabeçalho duplicado

Em `applyCoordinationRequestAction`, **antes da chamada `_buildRecipientMessage`** (linha ~1326):

```js
// Sprint 17 — defense-in-depth: strip de prefixo de origem no message_body.
// Garante que o engine não dobre o cabeçalho mesmo que a skill falhe na REGRA CRÍTICA.
const STRIP_HEADER_PATTERNS = [
  /^\s*o\s+[\wÀ-ú]+(?:\s+[\wÀ-ú]+)?\s*(?:\([^)]{0,40}\))?\s*(?:pediu|me pediu|disse|mandou|pediu pra mim).{0,40}:\s*/i,
  /^\s*alf(?:redo)?\s+pediu.{0,40}:\s*/i,
  /^\s*(?:o\s+)?requester\s+pediu.{0,40}:\s*/i,
];
let sanitizedBody = parsed.message_body;
let stripped = false;
for (const pattern of STRIP_HEADER_PATTERNS) {
  const before = sanitizedBody;
  sanitizedBody = sanitizedBody.replace(pattern, '').trim();
  if (sanitizedBody !== before) {
    stripped = true;
    console.warn(`[CoordinationRequest] strip cabeçalho duplicado detectado em req ${inserted?.id?.slice(0, 8) ?? 'unknown'}`);
  }
}
// Aplicar apenas se strip ocorreu e body resultante não está vazio
const finalBody = stripped && sanitizedBody.length > 0 ? sanitizedBody : parsed.message_body;

const requesterDisplayName = _requesterDisplayName(collab);
const recipientMsg = _buildRecipientMessage(requesterDisplayName, parsed.mode, finalBody);
```

> **Salvaguarda:** o regex aplica-se apenas aos primeiros ~80 chars do body (anchor `^`). Se `sanitizedBody` ficar vazio após strip (edge case: message_body era apenas um cabeçalho), mantém o `parsed.message_body` original e loga um `console.error`.

### 2.6 Reforço temporal em `system.js`

Em `src/prompts/system.js`, logo após a linha 191 (`**Amanhã (BRT):**`), adicionar a âncora semanal:

```js
// Sprint 17 — âncora semanal explícita (PRD §12)
// Calcula segunda e domingo da semana corrente em BRT
const todayDate = new Date(todayISO + 'T15:00:00.000Z'); // meio-dia BRT
const todayDOW = todayDate.getUTCDay(); // 0=dom, 1=seg, ..., 6=sáb
const diffToMonday = (todayDOW === 0 ? -6 : 1 - todayDOW); // dias até segunda
const monday = new Date(todayDate);
monday.setUTCDate(monday.getUTCDate() + diffToMonday);
const sunday = new Date(monday);
sunday.setUTCDate(sunday.getUTCDate() + 6);
const fmtDate = (d) => `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}`;
const weekDays = ['dom','seg','ter','qua','qui','sex','sáb'];
const weekDates = Array.from({length: 7}, (_, i) => {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + i);
  return `${weekDays[(d.getUTCDay())]} ${fmtDate(d)}`;
});
lines.push(`**Esta semana (BRT):** ${weekDates.join(' · ')}`);
```

Resultado no prompt (exemplo para semana de 2026-05-03):
```
**Data/hora agora (BRT):** 2026-05-03 14:30 (domingo)
**Amanhã (BRT):** 2026-05-04 (segunda)
**Esta semana (BRT):** seg 04/05 · ter 05/05 · qua 06/05 · qui 07/05 · sex 08/05 · sáb 09/05 · dom 10/05
```

### 2.7 Confirmação contextual — tabela explícita para a skill

A seção `### REGRA — Quando confirmar antes de emitir vs agir direto` da skill ganha tabela complementar (não substitui a existente):

| Situação | ACC presente | Ação |
|---|---|---|
| `relay_literal` sem texto entre aspas | qualquer | **Sempre perguntar** — pedir o texto verbatim |
| Destinatário ambíguo (2+ homônimos) | qualquer | **Sempre perguntar** — citar nomes completos |
| Request sem actor identificável no contexto | qualquer | **Sempre perguntar** |
| Modo ambíguo (relay vs followup) | qualquer | **Perguntar se ambíguo** |
| 2+ candidatos com confiança próxima | `confidence=low` | **Perguntar** citando candidatos |
| Comando claro + ACC com `confidence=high` | `confidence=high` | **Não perguntar** — age direto |
| Relay com recipient explícito + objetivo claro | qualquer | **Não perguntar** — emite direto |

---

## 3. Trade-offs e riscos

### 3.1 Risco: prompt bloat

ACC adiciona até ~500 chars por turno onde o collab tem requests ativos. O `systemPrompt` atual tem ~8-10KB (com skill + contexto). Impacto: ~5-6% de aumento por turno afetado.

**Mitigação:** limite duro de 500 chars na função `buildActiveCoordinationContext`; linhas null omitidas; lista "Requests abertos" truncada para 3 itens como fallback. Quando `focusConfidence = 'none'`, block é null e nada é injetado.

### 3.2 Risco: foco errado dominante

Se a heurística escolher o candidato errado com `confidence=high`, TOM age sem confirmar, resultando em envio para ator errado.

**Mitigação principal:** confidence `high` só é atribuída para eventos com menos de 30 minutos (muito fresca, difícil de ser ambígua). Confidence `medium` — que cobre casos entre 30-120min — força microconfirmação na resposta. A skill só age em silêncio quando o timing é inequívoco.

**Mitigação secundária:** o log `[ACC] focusConfidence=... focusCandidate=...` permite auditoria rápida em produção.

### 3.3 Risco: regressão na Sprint 16

ACC adiciona comportamento — não substitui. COORD_HINT continua operando para detecção de `<<COORDINATION_RESPONSE>>`. Os dois mecanismos coexistem no mesmo turno: COORD_HINT para "você tem recados para responder", ACC para "qual é o contexto dominante agora".

**Mitigação:** Fatia 5 inclui smoke tests explícitos dos 4 casos da Sprint 16 original antes de declarar aprovação.

### 3.4 Risco: TOM passa a chutar em vez de perguntar

Com ACC, TOM tem mais contexto e tenderá a agir mais. Risco de chutes com contexto falso-positivo.

**Mitigação:** a política de `confidence=low` força pergunta quando há ambiguidade real. A heurística foi calibrada para ser conservadora: `high` exige timestamp < 30min, `medium` exige timestamp < 120min — qualquer coisa além disso resulta em `low` se houver outros candidatos.

### 3.5 Risco: latência das 4 queries

4 queries adicionais por turno do TOM. Em paralelo (`Promise.all`) → ~30-50ms total. Já há múltiplas queries no caminho crítico de `processMessage` (context fetch, tasks, memories, events, notifications). Incremento aceitável.

**Mitigação se virar gargalo:** consolidar Q1+Q2+Q3+Q4 em 1 query UNION com flag de tipo. Não implementar agora — otimização pós-uso real.

### 3.6 Risco: defense-in-depth strip falso-positivo

O regex de strip pode incorretamente remover texto legítimo que comece com padrão similar a um cabeçalho (ex: "O Yuri disse que..." como conteúdo intencional de relay_literal).

**Mitigação:** (a) regex ancorado em `^` com `\s*` — só strip no início absoluto do body; (b) limite máximo de 80 chars de match para o padrão; (c) se `sanitizedBody` ficar vazio, mantém original; (d) `console.warn` quando strip ocorrer — visível em logs de produção.

---

## 4. Plano de implementação por fatias

### Fatia 1 — `buildActiveCoordinationContext` core (engine.js)

**Entregável:** função pura em `src/engine.js` — 4 queries + `scoreFocus` + `buildBlock` + retorno tipado  
**Arquivos:** `src/engine.js`  
**Sem wiring ainda** — a função existe mas não é chamada  
**Helpers internos:** `short(id)`, `firstName(name)`, `trunc(str, n)`, `minutesAgo(ts)`, `scoreFocus(q1, q2, q3, q4)`  
**Validação manual:** criar 5 fixtures de `coordination_requests` em dev, chamar `buildActiveCoordinationContext` diretamente, verificar `block`, `focusCandidate`, `focusConfidence` para cada cenário:
1. 1 request aberto há 10min onde collab é requester → confidence=high, focusCandidate=recipient
2. Resposta recebida há 5min → confidence=high, focusCandidate=quem respondeu
3. 2 requests abertos com atores distintos → confidence=low, focusCandidate=null
4. Nenhum request → block=null, confidence=none
5. 2 requests com mesmo ator → confidence=medium, focusCandidate=esse ator

### Fatia 2 — Wiring em `processMessage` + injeção em `system.js`

**Entregável:** ACC injetado no system prompt  
**Arquivos:** `src/engine.js` (bloco após COORD_HINT), `src/prompts/system.js` (receber `opts.coordContext`, injetar em ambos os caminhos async e sync)  
**Smoke test:** logar system prompt completo num turno com request aberto → verificar que `[ACTIVE_COORDINATION_CONTEXT]` aparece após `[COORD_HINT]` e antes do fim do prompt  
**Verificar:** `systemPrompt.length` nos logs — confirmar que não ultrapassou threshold alarmante (ex: > 15KB)

### Fatia 3 — Skill: nova seção de consumo do ACC

**Entregável:** seção "Como consumir [ACTIVE_COORDINATION_CONTEXT]" no final de `skills/coordenacao-conversacional.md`  
**Arquivos:** `skills/coordenacao-conversacional.md`  
**Conteúdo:** tabela de heurísticas (§2.4) + 4 exemplos concretos (Cenários A, B, C, D do PRD §18) + tabela de confirmação contextual (§2.7)  
**Smoke test:** E2E Cenário A (agradecimento anafórico): TOM exibe resposta do Rafinha → Alf: "Agradece a ele" → TOM age sem perguntar

### Fatia 4 — Defense-in-depth + reforço temporal

**Entregável:** strip patterns em `applyCoordinationRequestAction` + linha "Esta semana" em `system.js`  
**Arquivos:** `src/engine.js`, `src/prompts/system.js`  
**Smoke test strip:** criar request com `message_body = "Alf pediu pra te avisar: amanhã ele vai estar no Recreio"` → verificar que recipient recebe `"amanhã ele vai estar no Recreio"` (sem duplicação)  
**Smoke test temporal:** logar system prompt → verificar que "Esta semana (BRT):" aparece com 7 datas corretas para a semana atual

### Fatia 5 — Validação E2E

**Cenários obrigatórios (PRD §18 + critérios §16):**

| # | Cenário | Input | Resultado esperado |
|---|---|---|---|
| E1 | Agradecimento anafórico | TOM exibe "Rafinha respondeu: ..." → Alf: "Agradece a ele" | TOM envia agradecimento ao Rafinha sem perguntar |
| E2 | Elipse com 2 abertos | Requests abertos com Anne e Rafinha → Alf: "Diz que está autorizado" | TOM pergunta "Pra Anne ou pro Rafinha?" |
| E3 | Comando claro sem ACC | Alf: "fala com Anne sobre o briefing de amanhã" | TOM executa relay_assisted direto |
| E4 | Microconfirmação medium | Request aberto há 45min com Rafinha → Alf: "manda" | TOM: "Vou avisar o Rafinha — pode mandar?" |
| E5 | Loop fechamento preciso | Request aberto com Anne → Anne responde ao TOM | TOM emite `<<COORDINATION_RESPONSE>>` com request_id correto |

**Smoke tests de não-regressão Sprint 16 (obrigatórios antes de aprovar):**
1. director → "avisa a Anne que amanhã vou estar no Recreio" → Anne recebe WhatsApp com cabeçalho correto
2. collaborator tenta followup → TOM recusa com texto exato da skill
3. recipient recebe recado e responde → requester recebe "X respondeu: ..."
4. request sem resposta além do deadline → dispatcher envia alerta de timeout

---

## 5. Decisões fechadas (aprovadas pelo Alf — 2026-05-03)

| # | Decisão | Resolução |
|---|---|---|
| 5.1 | `confidence=medium` | **Microconfirmar.** "Vou avisar o Rafinha — pode mandar?". Reduz risco de ação errada silenciosa. |
| 5.2 | Limite de requests abertos | **LIMIT 5 com fallback para 3** se o block ultrapassar 500 chars. |
| 5.3 | COORD_HINT vs ACC | **Convivem na Sprint 17.** NÃO consolidar agora. |

### Justificativas

**5.1 (microconfirmar):** custo é 1 frase extra; benefício é proteger contra ação errada silenciosa nos casos com ruído (timestamp 30-120min, clustering). Revisar após 2 semanas de uso real — se microconfirmações dominarem sem ganho, promover para comportamento `high`.

**5.2 (LIMIT 5 + fallback 3):** mantém aderência ao PRD §5. Sem custo de query (LIMIT 5 vs 3 é negligível). Truncamento para 3 quando block > 500 chars preserva contexto sem inflar prompt.

**5.3 (convivência — divergência da recomendação inicial do spec):** A recomendação original era "ACC absorve COORD_HINT" pra reduzir duplicação. **Decisão final: convivem.** Motivos do Alf:
- COORD_HINT tem função específica: gatilho para emissão de `<<COORDINATION_RESPONSE>>` quando recipient responde
- ACC tem função mais ampla: foco conversacional, resolução de pronomes, thread dominante
- Fundir agora misturaria responsabilidades e dificultaria diagnóstico se algo quebrar
- Consolidação fica para Sprint futura, com base em uso real

**Implicação para o plano:** Fatia 3 (skill) precisa ensinar TOM a consumir os DOIS blocos sem confusão (COORD_HINT pra emitir COORDINATION_RESPONSE; ACC pra resolver pronomes e foco). Tabela de heurísticas no skill diferencia explicitamente os dois sinais.
