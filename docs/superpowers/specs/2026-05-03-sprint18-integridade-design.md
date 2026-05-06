# Spec: Sprint 18 — Integridade de Agenda e Execução
**Data:** 2026-05-03
**Status:** Proposta — aguardando aprovação
**Referência:** docs/prd-sprint18-integridade-agenda-execucao.md
**Base:** Sprints 13-17

---

## 1. Diagnóstico do estado atual

### 1.1 Banco de dados — o que já existe que ajuda

**`events`** — tabela central para Frente A. Tem `start_at`, `end_at` (com CHECK `end_at > start_at`), `modality` (online/presencial/hibrido), `location_text`, `meeting_url`, `category`, `context`, `status` (scheduled/done/cancelled). A coluna `status` permite filtrar eventos cancelados. O par `start_at`/`end_at` como `timestamptz` habilita queries de interseção de intervalos via operador `&&` do Postgres (tstzrange). Tudo que o detector temporal precisa já está no schema — nenhuma coluna nova.

**`tasks`** — suficiente para deduplicação semântica e detecção de stale. Campos relevantes: `title`, `description`, `assigned_to`, `due_date`, `status`, `created_at`, `updated_at`. O campo `updated_at` (atualizado por trigger) é o sinal de "vida" para o score de stale (14d sem atualização). Campos Sprint 14/15 (`support_team`, `department_id`, `request_type_id`) enriquecem o score de similaridade inter-tasks. Sem coluna nova necessária.

**`school_events`** — agenda institucional paralela com `event_date`, `start_time`, `unit`, `status` (active/cancelled). Não tem `end_time` — isso limita overlap exato, mas permite alerta soft "coincide com evento escolar às HH:MM". Suficiente para Frente A §2.2.2.

**`daily_plans`** — tem `plan_date`, `items_planned` e `collaborator_id` (UNIQUE). Permite query "quantos itens já planejados neste dia" sem varrer `daily_plan_items`. Útil para o alerta "dia carregado" ao criar task com due_date num dia já cheio.

**`weekly_plans`** — `week_start` + `tasks_planned` por collab. Contexto de carga semanal para alertas enriched via ACC (Sprint 17).

**`notifications`** — fila completa com `notification_type`, `channel`, `status`. Os tipos existentes (deadline_alert, overdue_alert, etc.) não cobrem alertas de integridade, mas a tabela aceita qualquer string em `notification_type` — basta criar novos tipos sem migration. Canal `whatsapp` já funcional.

**`ritual_logs`** — mecanismo de idempotência para varreduras periódicas. `ritual_type` é texto livre — novos tipos `hygiene_stale_tasks` e `hygiene_unclosed_events` podem ser usados sem alteração de schema. Campo `reference_date` garante exatamente 1 disparo por dia por tipo por collab.

**`task_comments`** — auditoria de mudanças com `comment_type` (manual, agent_note, status_change, delegation, deadline_extension). Serve para registrar "alerta dispensado pelo usuário" quando TOM decide não criar por duplicidade — apenas inserir uma linha `agent_note` na task existente. Sem migration.

### 1.2 Engine / TOM — pontos de entrada existentes

**`applyEventActions(collaborator, events)`** (engine.js ~linha 1556) — função que recebe array de objetos evento e faz INSERT em `events`. O loop `for (const e of events)` é o ponto exato onde chamar `detectTemporalConflict` e `detectDuplicateSemanticEvent` **antes** do INSERT. Padrão: se detector retorna achados relevantes, retornar `{ ok: false, reason: 'integrity_temporal_conflict', payload: {...} }` em vez de inserir.

**`applyTaskActions` — branch `create`** (engine.js ~linha 2143) — após todas as validações existentes (role, requestTypeId, dedupe de 60s) e antes do INSERT final. É o local natural para chamar `detectDuplicateSemanticTask`. A estrutura de `failCount++; continue;` já suporta o padrão de rejeição com reason.

**`findCollaboratorByName` / `findCollaboratorByPhone`** — modelo de helper reaproveitável para os detectores: funções assíncronas focadas, com tratamento de null, que retornam o objeto necessário ou null. Os novos `detectTemporalConflict`, `detectDuplicateSemanticEvent`, `detectDuplicateSemanticTask` seguem este padrão — puras, sem side-effects.

**Skill loader em `system.js`** — `buildSystemPrompt(collaborator, opts = {})` já aceita `opts` arbitrários (padrão Sprint 16/17). A skill nova `integridade-agenda.md` será carregada via `pickSkill` por role (todos os roles), exatamente como `coordenacao-conversacional.md`.

**Dedupe defensivo existente** (engine.js ~linha 2257) — Sprint 11.2 já implementou um dedupe de 60s para tasks (title + assigned_to + due_date em janela recente). A Sprint 18 complementa isso com detecção semântica de mais longo alcance (30d) e similaridade textual — não substitui o dedupe existente.

### 1.3 Skills existentes que se aproximam do tema

O diretório `src/prompts/` contém apenas `system.js` — as skills são carregadas dinamicamente de `skills/`. As mais relevantes para referência de estilo:

- **`rituais-diarios.md`** (briefing/fechamento) — o briefing matinal é o veículo natural para alertas de higiene. Sprint 18 instrui esta skill (não cria outra) a mencionar findings se houver, como seção opcional ao fim do briefing.
- **`coordenacao-conversacional.md`** (Sprint 16/17) — modelo de skill multi-modo com tabela de heurísticas e exemplos concretos por cenário. A skill `integridade-agenda.md` segue exatamente este estilo: 3 modos, tabela de severidade, exemplos por caso do PRD.
- O padrão de instrução "NUNCA bloquear X sem confirmar Y" (presente em coordenacao-conversacional) é replicado em integridade: só HARD conflict bloqueia explicitamente.

### 1.4 O que ainda falta (é a Sprint 18)

Lista objetiva, sem inflação:

- Função `detectTemporalConflict(collab, candidate)` — query de interseção em `events`, scoring por severidade, retorno `{ hardConflicts, softConflicts }`.
- Função `detectDuplicateSemanticEvent(collab, candidate)` — query ±48h + score por similaridade textual + boosts, threshold 0.7.
- Função `detectDuplicateSemanticTask(collab, candidate)` — query tasks abertas últimas 30d + score, threshold 0.7.
- Helper `jaro(a, b)` (Jaro-Winkler) — único algoritmo de similaridade necessário; implementação pura em JS (~40 linhas), sem dependência nova.
- Wiring no engine — antes do INSERT em `applyEventActions` e `applyTaskActions create`, chamar os detectores e retornar payload de integridade se score > threshold.
- Skill `integridade-agenda.md` — ensina TOM a interpretar payloads `integrity_*`, formatar alertas naturalmente e oferecer micro-actions.
- Dois novos blocos em `dispatcher.js run()`: `detectStaleTasks` (varredura tasks abertas 14d+ sem update) e `detectUnclosedPastEvents` (eventos com `end_at < now-24h` e status != done/cancelled). Idempotência via `ritual_logs`.
- Instruções adicionais em `rituais-diarios.md` (briefing) para mencionar hygiene findings se existirem.

---

## 2. Proposta arquitetural da Sprint 18

### 2.0 Comportamento global de bloqueio (ajustes Alf 2026-05-03)

Antes da arquitetura técnica, 3 regras globais que governam toda a Sprint 18 e sobrescrevem qualquer pseudocódigo posterior:

| Detecção | Behavior obrigatório |
|---|---|
| **Duplicidade semântica (eventos OU tasks)** | **Nunca bloqueia automaticamente.** Mesmo com score ≥ 0.7, sempre entra como suspeita/alerta para decisão humana. TOM mostra o item parecido e pergunta "é o mesmo? quer criar mesmo assim?". User decide. |
| **Soft conflict temporal** | **NÃO cria silenciosamente.** TOM faz microconfirmação leve: "tem X às 9h, sobreposição de Nmin — quer criar mesmo assim?". Aguarda "sim/manda/pode" antes de emitir o INSERT. |
| **HARD conflict temporal** | **Bloqueia + 1 confirmação explícita.** TOM exibe alerta forte e exige UMA confirmação ("criar mesmo assim?" → "sim, cria"). Não duas rodadas extras. Apenas overlap ≥50% + presencial + locais diferentes confirmados (ambos `location_text` preenchidos e distintos). Sem dado em qualquer lado degrada para SOFT. |
| **Dia carregado / daily_plan check** | **Observação leve, não central.** Mencionar como complemento em alerta já existente (ex: "tem 6 tasks pra hoje, dia carregado — quer marcar?"), não como gatilho próprio de bloqueio. NÃO cria fluxo de confirmação dedicado. |

**Decorrência prática para os pseudocódigos abaixo:**
- Onde aparecer `failCount++; continue;` para DUP → trocar por retorno de suspect-payload pro skill, INSERT só acontece após confirmação humana via novo turno do TOM
- Onde aparecer "soft não bloqueia, INSERT prossegue" → trocar por "soft retorna microconfirm-payload pro skill, aguarda confirmação"
- HARD continua bloqueando, mas com path explícito de 1-shot confirmation

**Princípio mãe da sprint:** `alertar > sugerir > confirmar > criar`. Bloqueio só em impossibilidade física confirmada.

---

### 2.1 Decisão fundamental: zero schema novo

Análise honesta de cada feature da sprint versus o schema existente:

| Feature | Precisa de schema novo? | Por quê não |
|---|---|---|
| Detecção de conflito temporal | Não | Query `tstzrange` sobre `events` existente |
| Detecção de duplicidade evento | Não | Query `events` com janela ±48h + score JS |
| Detecção de duplicidade task | Não | Query `tasks` aberto últimas 30d + score JS |
| Alerta de stale tasks | Não | `notifications` aceita tipo novo sem migration |
| Alerta de eventos sem fechamento | Não | Query `events` status check + `notifications` |
| Idempotência das varreduras | Não | `ritual_logs` com `ritual_type` texto livre |
| Audit trail de "alerta dispensado" | Não | INSERT em `task_comments` type `agent_note` |

**Exceção que justificaria schema:** nenhuma para o MVP. Se surgir demanda real de "histórico de todos os alertas dispensados por usuário com timestamp e motivo" (para analytics ou configuração de threshold por user), criar `integrity_alert_log` na Sprint 19+. Por ora: zero schema novo. Déficit de schema deliberado e defensável.

### 2.2 Frente A — Conflict Awareness

#### 2.2.1 Conflito temporal de eventos

```js
/**
 * Sprint 18 — detecta conflitos temporais antes de criar evento.
 * @param {object} collab - Row de collaborators
 * @param {object} candidate - { start_at: ISO, end_at: ISO, modality, location_text, category, context }
 * @returns {{ hardConflicts: object[], softConflicts: object[] }}
 */
async function detectTemporalConflict(collab, candidate) {
  if (!candidate.start_at || !candidate.end_at) return { hardConflicts: [], softConflicts: [] };

  // Busca todos os eventos do collab que interceptam o intervalo candidato.
  // tstzrange usa operador && (overlap) — nativo Postgres, O(log n) com índice GiST.
  const { data: overlaps, error } = await supabase
    .from('events')
    .select('id, title, start_at, end_at, modality, location_text, category, status')
    .eq('collaborator_id', collab.id)
    .neq('status', 'cancelled')
    // Filtro de janela aproximado para otimizar: eventos que começam antes do fim
    // do candidato E terminam depois do início — equivalente ao operador &&
    .lt('start_at', candidate.end_at)
    .gt('end_at', candidate.start_at)
    .limit(20);

  if (error) {
    console.error('[detectTemporalConflict] query err:', error.message);
    return { hardConflicts: [], softConflicts: [] };
  }

  const hardConflicts = [];
  const softConflicts = [];

  const candStart = new Date(candidate.start_at).getTime();
  const candEnd   = new Date(candidate.end_at).getTime();
  const candDur   = candEnd - candStart;

  for (const ev of (overlaps || [])) {
    const evStart = new Date(ev.start_at).getTime();
    const evEnd   = new Date(ev.end_at).getTime();

    // Calcula sobreposição em ms
    const overlapMs = Math.min(candEnd, evEnd) - Math.max(candStart, evStart);
    const overlapRatio = overlapMs / candDur; // proporção do candidato coberta

    // Caso especial: mesmo start_at E título muito similar → trata como duplicidade
    // (delegado para detectDuplicateSemanticEvent — aqui apenas flag)
    if (Math.abs(evStart - candStart) < 60_000 /* <1min */) {
      // Detectado na Frente B — não duplicar alerta aqui
      continue;
    }

    // Heurística de severidade
    const bothPresencial = (ev.modality === 'presencial' || ev.modality === 'hibrido')
                        && (candidate.modality === 'presencial' || candidate.modality === 'hibrido');
    const bothOnline     = ev.modality === 'online' && candidate.modality === 'online';
    const diffLocation   = ev.location_text && candidate.location_text
                        && ev.location_text.toLowerCase() !== candidate.location_text.toLowerCase();

    if (overlapRatio >= 0.5 && bothPresencial && diffLocation) {
      // HARD: overlap total ou majoritário, presencial em locais diferentes
      hardConflicts.push({ ...ev, overlapRatio, reason: 'presencial_diff_location' });
    } else if (overlapRatio >= 0.5 && bothPresencial && !diffLocation) {
      // MEDIUM (soft): pode ser mesma sala (recital + ensaio)
      softConflicts.push({ ...ev, overlapRatio, reason: 'presencial_same_location' });
    } else if (overlapRatio >= 0.5 && bothOnline) {
      // MEDIUM (soft): dois online simultâneos — geralmente gerenciável mas vale alertar
      softConflicts.push({ ...ev, overlapRatio, reason: 'online_simultaneous' });
    } else if (overlapRatio < 0.5 && overlapRatio > 0) {
      // SOFT: sobreposição parcial (<50%)
      const overlapMin = Math.round(overlapMs / 60_000);
      softConflicts.push({ ...ev, overlapRatio, overlapMin, reason: 'partial_overlap' });
    } else if (overlapRatio >= 0.5 && !bothPresencial && !bothOnline) {
      // online + presencial: possível mas vale alertar
      softConflicts.push({ ...ev, overlapRatio, reason: 'online_presencial_mixed' });
    }
  }

  return { hardConflicts, softConflicts };
}
```

**Tabela de heurística de severidade:**

| Cenário | Severidade | Behavior do TOM |
|---|---|---|
| Overlap ≥50% + presencial/híbrido + locations diferentes | **HARD** | Bloqueia o INSERT; exige confirmação explícita ("criar assim mesmo?") |
| Overlap ≥50% + presencial + same location | MEDIUM (soft) | "Já tem X nesse horário na mesma sala — é para o mesmo espaço?" |
| Overlap ≥50% + online + online | MEDIUM (soft) | "Vai ter 2 compromissos online ao mesmo tempo, ok?" |
| Overlap parcial (<50% do candidato) | SOFT | "Termina às HH:MM, esse começa HH:MM — sobreposição de N min" |
| Online + presencial simultâneos (overlap ≥50%) | SOFT | "Vai conseguir estar presencial estando online ao mesmo tempo?" |
| Mesmo `start_at` exato + título similar | Duplicidade (Frente B) | Trata como `detectDuplicateSemanticEvent`, não como conflito temporal |

**Justificativa dos thresholds:**
- `overlapRatio ≥ 0.5` para HARD/MEDIUM porque sobreposição menor que metade do evento candidato ainda permite "sair de um e chegar no outro" — conservador e mais próximo de inviabilidade real.
- Diferença de location é o fator crítico para HARD: presencial em dois lugares distintos é fisicamente impossível. Sem `location_text` nos dois lados, degrada para MEDIUM (não temos certeza dos locais).

#### 2.2.2 Conflito com `school_events` ou daily_plan carregado

**School event no mesmo horário:**

```js
async function detectSchoolEventConflict(collab, candidate) {
  // school_events tem event_date (date) + start_time (time) mas NÃO end_time.
  // Alerta soft apenas se cair no mesmo dia e start_time dentro da janela candidata.
  const candDate = candidate.start_at.slice(0, 10); // YYYY-MM-DD
  const { data: schoolEvs } = await supabase
    .from('school_events')
    .select('id, title, event_date, start_time, location, unit')
    .eq('event_date', candDate)
    .eq('status', 'active')
    .not('start_time', 'is', null)
    .limit(5);

  const candStartHHMM = candidate.start_at.slice(11, 16); // 'HH:MM'
  return (schoolEvs || []).filter(se => se.start_time >= candStartHHMM);
}
```

**Daily plan carregado (alerta ao criar task):**

```js
async function detectOverloadedDay(collab, candidateDueDate) {
  if (!candidateDueDate) return null;
  const { data: plan } = await supabase
    .from('daily_plans')
    .select('items_planned')
    .eq('collaborator_id', collab.id)
    .eq('plan_date', candidateDueDate)
    .maybeSingle();
  // Threshold: 6+ items planejados no dia → dia carregado
  // (user_preferences.max_daily_tasks default 3, mas o plan pode acumular)
  return plan && plan.items_planned >= 6 ? plan.items_planned : null;
}
```

### 2.3 Frente B — Duplicidade semântica

#### 2.3.1 Helper Jaro-Winkler (sem dependência externa)

```js
/**
 * Jaro-Winkler similarity — retorna 0..1.
 * Implementação pura, ~40 linhas, sem dependência npm.
 */
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

  // Winkler prefix boost (max 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Normaliza string para comparação: lowercase, remove pontuação, trim */
function normalizeForSim(s) {
  return String(s || '').toLowerCase().replace(/[^a-záàãâéêíóôõúüç\s]/g, '').replace(/\s+/g, ' ').trim();
}
```

**Justificativa da escolha:** Jaro-Winkler é ideal para strings curtas (títulos de eventos e tasks) porque penaliza transposições de caracteres e bônus prefixo. Levenshtein normalizado seria equivalente para strings longas mas pior para títulos curtos. Sem ML, sem LLM-as-judge — determinístico e ajustável.

#### 2.3.2 Detecção de duplicidade de eventos

```js
/**
 * Sprint 18 — detecta duplicidade semântica antes de criar evento.
 * @param {object} collab
 * @param {object} candidate - { title, start_at, category, location_text, description }
 * @returns {{ probable: object[], possible: object[] }}
 *   probable: score > 0.7 (duplicado provável)
 *   possible: 0.5 < score <= 0.7 (alerta leve)
 */
async function detectDuplicateSemanticEvent(collab, candidate) {
  if (!candidate.title) return { probable: [], possible: [] };

  const candDate = candidate.start_at ? candidate.start_at.slice(0, 10) : null;
  const windowStart = candDate
    ? new Date(new Date(candDate).getTime() - 48 * 3600_000).toISOString()
    : null;
  const windowEnd = candDate
    ? new Date(new Date(candDate).getTime() + 48 * 3600_000).toISOString()
    : null;

  let query = supabase
    .from('events')
    .select('id, title, start_at, end_at, category, location_text, status, created_at')
    .eq('collaborator_id', collab.id)
    .neq('status', 'cancelled');

  if (windowStart && windowEnd) {
    query = query.gte('start_at', windowStart).lte('start_at', windowEnd);
  }
  const { data: candidates, error } = await query.limit(30);
  if (error) {
    console.error('[detectDuplicateSemanticEvent] query err:', error.message);
    return { probable: [], possible: [] };
  }

  const candTitleNorm = normalizeForSim(candidate.title);
  const probable = [], possible = [];

  for (const ev of (candidates || [])) {
    const evTitleNorm = normalizeForSim(ev.title);
    let score = jaroWinkler(candTitleNorm, evTitleNorm);

    // Boosts adicionais:
    const evDate = ev.start_at ? ev.start_at.slice(0, 10) : null;
    if (candDate && evDate && candDate === evDate) score += 0.3;   // mesmo dia
    if (candidate.category && ev.category === candidate.category) score += 0.1; // mesma categoria
    if (candidate.location_text && ev.location_text &&
        normalizeForSim(candidate.location_text) === normalizeForSim(ev.location_text)) {
      score += 0.1; // mesmo local
    }
    // Cap em 1.0
    score = Math.min(score, 1.0);

    if (score > 0.7) probable.push({ ...ev, _score: score });
    else if (score > 0.5) possible.push({ ...ev, _score: score });
  }

  // Ordena por score decrescente
  probable.sort((a, b) => b._score - a._score);
  possible.sort((a, b) => b._score - a._score);

  return { probable: probable.slice(0, 3), possible: possible.slice(0, 3) };
}
```

**Justificativa dos thresholds:**
- Base Jaro-Winkler: 0.7 como limiar "duplicado provável" é conservador para títulos curtos (~5-8 palavras). Títulos completamente diferentes raramente excedem 0.5. O boost `+0.3` por mesmo dia é o diferencial mais importante: "Reunião Levi" + "Apresentação Levi Hugo" no mesmo dia é altamente suspeito mesmo com JW < 0.5.
- 0.5–0.7: "possível" — alerta soft sem bloquear. Usuário pode ignorar com "cria mesmo assim".

#### 2.3.3 Detecção de duplicidade de tasks

```js
/**
 * Sprint 18 — detecta task similar já aberta antes de criar.
 * @param {object} collab
 * @param {object} candidate - { title, description, assigned_to, department_id, request_type_id }
 * @returns {{ probable: object[], possible: object[] }}
 */
async function detectDuplicateSemanticTask(collab, candidate) {
  if (!candidate.title) return { probable: [], possible: [] };

  // Janela: tasks abertas dos últimos 30d. Status != done, cancelled.
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: openTasks, error } = await supabase
    .from('tasks')
    .select('id, title, description, assigned_to, department_id, request_type_id, status, created_at, due_date')
    .eq('assigned_to', candidate.assigned_to || collab.id)
    .not('status', 'in', '("done","cancelled")')
    .gte('created_at', cutoff)
    .limit(50);

  if (error) {
    console.error('[detectDuplicateSemanticTask] query err:', error.message);
    return { probable: [], possible: [] };
  }

  const candTitleNorm = normalizeForSim(candidate.title);
  const probable = [], possible = [];

  for (const task of (openTasks || [])) {
    const taskTitleNorm = normalizeForSim(task.title);
    let score = jaroWinkler(candTitleNorm, taskTitleNorm);

    // Boosts:
    if (candidate.department_id && task.department_id === candidate.department_id) score += 0.2;
    if (candidate.request_type_id && task.request_type_id === candidate.request_type_id) score += 0.2;
    // Keywords overlap: nomes próprios (tokens ≥4 chars que começam com maiúscula no título original)
    const candKeywords = (candidate.title || '').match(/\b[A-ZÁÀÃÂÉÊÍÓÔÕÚ][a-záàãâéêíóôõúç]{3,}\b/g) || [];
    const taskKeywords = (task.title || '').match(/\b[A-ZÁÀÃÂÉÊÍÓÔÕÚ][a-záàãâéêíóôõúç]{3,}\b/g) || [];
    const shared = candKeywords.filter(k => taskKeywords.includes(k));
    if (shared.length > 0) score += 0.1 * Math.min(shared.length, 2); // max +0.2 por keywords

    score = Math.min(score, 1.0);

    if (score > 0.7) probable.push({ ...task, _score: score });
    else if (score > 0.5) possible.push({ ...task, _score: score });
  }

  probable.sort((a, b) => b._score - a._score);
  possible.sort((a, b) => b._score - a._score);
  return { probable: probable.slice(0, 3), possible: possible.slice(0, 3) };
}
```

**Janela de 30 dias:** tasks criadas há mais de 30d já são candidatas a stale (Frente B) — duplicidade de tasks muito antigas é menos relevante operacionalmente.

### 2.4 Frente B — Higiene de execução (background scan)

#### 2.4.1 Tasks zumbis (stale)

Novo bloco no `run()` do dispatcher:

```js
// Sprint 18 — detectStaleTasks: segunda-feira às 09:00 BRT.
// Idempotência: ritual_type='hygiene_stale_tasks', reference_date=segunda corrente.
async function detectStaleTasks(now = new Date()) {
  const hourBRT = /* ...nowSaoPaulo().hour... */;
  const dowBRT  = /* ...nowSaoPaulo().dow... */ ; // 1 = segunda
  if (dowBRT !== 1 || hourBRT !== 9) return; // slot 09:00

  const whatsapp = require('../services/whatsapp');
  const STALE_DAYS = 14;
  const MAX_ALERTS = 5;
  const staleCutoff = new Date(now.getTime() - STALE_DAYS * 24 * 3600_000).toISOString();

  const collabs = await listCollaborators();
  for (const collab of collabs) {
    const ymdRef = nowSaoPaulo().ymd; // segunda-feira atual
    if (await alreadySent(collab.id, 'hygiene_stale_tasks', ymdRef)) continue;

    const { data: staleTasks, error } = await supabase
      .from('tasks')
      .select('id, title, due_date, created_at, updated_at, status')
      .eq('assigned_to', collab.id)
      .not('status', 'in', '("done","cancelled")')
      .lt('updated_at', staleCutoff)
      .order('updated_at', { ascending: true })
      .limit(MAX_ALERTS);

    if (error) { console.error('[detectStaleTasks] query err:', error.message); continue; }
    if (!staleTasks || staleTasks.length === 0) {
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'skipped', 'no_stale_tasks', ymdRef);
      continue;
    }

    const count = staleTasks.length;
    const listText = staleTasks
      .slice(0, 3)
      .map(t => `• _${t.title.slice(0, 60)}_`)
      .join('\n');
    const msg = `👻 *Higiene de tarefas*\n\nEncontrei *${count}* tarefa${count > 1 ? 's' : ''} abertas há mais de ${STALE_DAYS} dias sem atualização:\n${listText}${count > 3 ? `\n_...e mais ${count - 3}_` : ''}\n\nQuer revisar agora? Só dizer "abre minhas tarefas paradas".`;

    try {
      await whatsapp.sendMessage(collab.phone, msg);
      await logRitualEvent(collab.id, 'hygiene_stale_tasks', 'sent', `count=${count}`, ymdRef);
    } catch (err) {
      console.error(`[detectStaleTasks] send err ${collab.phone.slice(-4)}:`, err.message);
    }
  }
}
```

**Idempotência:** `ritual_logs` com `ritual_type='hygiene_stale_tasks'` e `reference_date` igual à segunda-feira corrente garante exatamente 1 envio por semana.

#### 2.4.2 Compromissos passados sem fechamento

```js
// Sprint 18 — detectUnclosedPastEvents: todos os dias às 09:30 BRT.
// Idempotência: ritual_type='hygiene_unclosed_events', reference_date=hoje.
async function detectUnclosedPastEvents(now = new Date()) {
  const { hour, ymd } = nowSaoPaulo();
  if (hour !== 9) return; // slot 09:30 (dispatcher roda a cada 15min; ajuste para timeToSlot(9:30))
  // Ajuste fino: usar timeToSlot('09:30') === currentSlot(nowSaoPaulo()) na chamada em run()

  const whatsapp = require('../services/whatsapp');
  const MAX_ALERTS = 3;
  const cutoff24h = new Date(now.getTime() - 24 * 3600_000).toISOString();

  const collabs = await listCollaborators();
  for (const collab of collabs) {
    if (await alreadySent(collab.id, 'hygiene_unclosed_events', ymd)) continue;

    const { data: unclosed, error } = await supabase
      .from('events')
      .select('id, title, start_at, end_at, category')
      .eq('collaborator_id', collab.id)
      .not('status', 'in', '("done","cancelled")')
      .lt('end_at', cutoff24h) // acabou há mais de 24h
      .order('end_at', { ascending: false })
      .limit(MAX_ALERTS);

    if (error) { console.error('[detectUnclosedPastEvents] query err:', error.message); continue; }
    if (!unclosed || unclosed.length === 0) {
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'skipped', 'none_found', ymd);
      continue;
    }

    const count = unclosed.length;
    const listText = unclosed
      .map(e => {
        const dateStr = new Date(e.end_at).toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        });
        return `• _${e.title.slice(0, 60)}_ (${dateStr})`;
      })
      .join('\n');

    const msg = `📌 *Compromissos sem fechamento*\n\nTinha *${count}* compromisso${count > 1 ? 's' : ''} que já aconteceu${count > 1 ? 'ram' : ''} e ainda está${count > 1 ? 'o' : ''} em aberto:\n${listText}\n\nQuer fechar agora? Só responder "fecha" ou me dizer o que aconteceu.`;

    try {
      await whatsapp.sendMessage(collab.phone, msg);
      await logRitualEvent(collab.id, 'hygiene_unclosed_events', 'sent', `count=${count}`, ymd);
    } catch (err) {
      console.error(`[detectUnclosedPastEvents] send err ${collab.phone.slice(-4)}:`, err.message);
    }
  }
}
```

#### 2.4.3 Alertas leves no briefing matinal

A skill `rituais-diarios.md` já inclui seção de contexto do dia. Sprint 18 adiciona instrução ao final:

```markdown
## Integração com higiene operacional (Sprint 18)

Ao gerar o briefing matinal (`[RITUAL: briefing_diario]`), **APENAS SE** o sistema prompt
incluir um bloco `[INTEGRITY_HYGIENE_CONTEXT]` com findings, mencione-os ao final do briefing
com tom leve e micro-ação:

- Tasks paradas há mais de 14 dias → "Encontrei N tarefas paradas há um tempo — quer dar uma passada nelas hoje?"
- Compromissos passados sem fechar → "Tem N compromissos que aconteceram mas ainda estão abertos — quer fechar agora?"

**NÃO incluir esta seção se o bloco `[INTEGRITY_HYGIENE_CONTEXT]` estiver ausente ou vazio.**
Tom: direto, leve, nunca alarmista. Microação clara em uma frase.
```

O bloco `[INTEGRITY_HYGIENE_CONTEXT]` é injetado via `opts.integrityHygiene` em `buildSystemPrompt` — padrão idêntico ao `opts.coordContext` (Sprint 17, mesmo wiring).

### 2.5 Skill nova: `integridade-agenda.md`

Carregada para todos os roles via `pickSkill` em `system.js`. Instrui TOM em 3 modos:

**Modo 1 — Pre-create check (Frente A + B no momento de criar):**

O engine retorna um objeto especial quando detectores encontram algo:
```js
// Formato de payload de integridade (retornado pelo engine antes do INSERT)
{
  ok: false,
  reason: 'integrity_temporal_conflict',   // ou 'integrity_duplicate_event' / 'integrity_duplicate_task'
  payload: {
    severity: 'hard' | 'soft',            // hard = bloqueia até confirmação; soft = informa e propõe
    conflicts: [                           // lista de conflitos encontrados (temporal ou semântico)
      { id, title, start_at, end_at, reason, overlapMin? }
    ],
    candidateTitle: string,               // título do que o usuário estava tentando criar
  },
  replyText: string,                       // texto pré-formatado para TOM mostrar ao usuário
}
```

Comportamento da skill por severidade:

| Severity | Behavior |
|---|---|
| `hard` | TOM mostra o conflito, NÃO emite o marker de create. Aguarda "cria mesmo assim" (confirmação explícita) ou "cancela" |
| `soft` (conflict) | TOM informa ("Tem X nesse horário, sobreposição de N min"), cria na sequência AUTOMATICAMENTE a menos que usuário diga "não" |
| `soft` (duplicate) | TOM pergunta "Já existe algo parecido — '...' (criado em DD/MM). É duplicidade?" — aguarda resposta antes de criar |
| `possible` (score 0.5–0.7) | TOM menciona casualmente ao confirmar criação: "Criado! Só avisar: achei '...' que parece relacionado" |

**Modo 2 — Hygiene response:**

Quando usuário diz "tô com muita coisa aberta", "limpa minha agenda", "o que tenho parado", "mostra minhas tarefas velhas" — TOM consulta `detectStaleTasks` e `detectUnclosedPastEvents` diretamente (fora do ciclo de dispatcher) e propõe limpeza item a item.

**Modo 3 — Briefing integration:**

Já coberto em §2.4.3 — referência ao bloco `[INTEGRITY_HYGIENE_CONTEXT]`.

**REGRA CRÍTICA da skill:**

```
NUNCA bloquear criação apenas por suspeita. Apenas `severity: hard` bloqueia
explicitamente até confirmação dupla. Tudo o mais é alerta informativo.
Se usuário disser "cria mesmo assim", "manda", "pode fazer", "tudo bem",
"ignora isso" ou qualquer variante afirmativa → emitir o marker normalmente.
```

### 2.6 Engine — pre-check hooks

**Hook em `applyEventActions`** (engine.js ~linha 1580, dentro do loop `for (const e of events)`):

```js
// Sprint 18 — pre-check de integridade ANTES do INSERT
// Não-destrutivo: apenas retorna decisão, nunca cria registros.
const [temporalResult, dupResult] = await Promise.all([
  detectTemporalConflict(collaborator, e),
  detectDuplicateSemanticEvent(collaborator, e),
]);

const hardConflicts = temporalResult.hardConflicts;
const softConflicts = temporalResult.softConflicts;
const probableDups  = dupResult.probable;

// Hard conflict: rejeita com payload — TOM decide na camada de skill
if (hardConflicts.length > 0) {
  const c = hardConflicts[0];
  const startStr = new Date(c.start_at).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  });
  const endStr = new Date(c.end_at).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  });
  console.warn(`[IntegrityCheck] HARD conflict for "${e.title.slice(0,40)}" — overlaps "${c.title.slice(0,40)}" ${startStr}–${endStr}`);
  failCount++;
  // Retornar payload para camada superior (processMessage) via throw estruturado
  // ou via objeto especial — ver §2.6.1 sobre o padrão de retorno
  continue;
}

// Probable duplicate: rejeita com payload para TOM confirmar
if (probableDups.length > 0) {
  const d = probableDups[0];
  console.warn(`[IntegrityCheck] DUP_EVENT score=${d._score.toFixed(2)} "${e.title.slice(0,40)}" ~ "${d.title.slice(0,40)}"`);
  failCount++;
  continue;
}

// Soft conflicts: loga para observabilidade, NÃO bloqueia
if (softConflicts.length > 0) {
  const c = softConflicts[0];
  console.log(`[IntegrityCheck] SOFT conflict "${e.title.slice(0,40)}" ~ "${c.title.slice(0,40)}" ratio=${c.overlapRatio?.toFixed(2)}`);
  // Soft não bloqueia — INSERT prossegue normalmente
  // A skill recebe o aviso via replyText pré-injetado pelo parseEventCreateMarker
}

// [INSERT NORMAL abaixo — código existente inalterado]
```

**Hook em `applyTaskActions` create** (engine.js ~linha 2280, após as validações existentes e antes do dedupe de 60s):

```js
// Sprint 18 — pre-check de duplicidade semântica ANTES do INSERT
// Ocorre APÓS validações de role, requestTypeId — ANTES do dedupe de 60s
const taskDupResult = await detectDuplicateSemanticTask(collaborator, {
  title: a.title,
  description: a.description,
  assigned_to: assignedTo,
  department_id: departmentId,
  request_type_id: requestTypeId,
});

if (taskDupResult.probable.length > 0) {
  const d = taskDupResult.probable[0];
  console.warn(`[IntegrityCheck] DUP_TASK score=${d._score.toFixed(2)} "${a.title.slice(0,40)}" ~ "${d.title.slice(0,40)}" (${d.status})`);
  // Retornar payload via mecanismo de retorno estruturado (ver §2.6.1)
  failCount++;
  continue;
}
// [código existente de dedupe de 60s + INSERT continua normalmente]
```

**§2.6.1 — Padrão de retorno de payload ao processMessage:**

O `applyEventActions` e `applyTaskActions` atualmente retornam apenas `{ okCount, failCount }`. Para passar payload de integridade ao nível de `processMessage` (onde o `replyText` é construído), usar um objeto de resultado estendido:

```js
// Assinatura estendida sem quebrar callers existentes:
// { okCount, failCount, integrityPayload?: { severity, conflicts, candidateTitle, type } }
return { okCount, failCount, integrityPayload };
```

Em `processMessage` (bloco `2.65` EVENT_CREATE e bloco TASK_UPDATE create), verificar `integrityPayload` e construir `reply` com o texto de alerta antes de enviar ao usuário. Se `severity === 'hard'`, o `replyText` substitui a resposta normal e nenhum marker é emitido.

**Padrão NÃO-DESTRUTIVO:** os pré-checks nunca criam registros, nunca modificam estado. São funções de leitura pura seguidas de decisão. Falhas de query nos detectores são non-fatal: `catch` loga e continua com INSERT normal (fail-open para não degradar criação).

### 2.7 Dispatcher — blocos novos em `run()`

Posição na função `run()` em `src/rituals/dispatcher.js`: após os blocos existentes de `checkAdherenceNudge` e `checkCoordinationTimeouts`, antes do `decayExpiredMemories`:

```js
// Sprint 18 — Higiene de execução (Frente B)
try {
  // stale tasks: segundas às 09:00
  if (now.dow === 1 && timeToSlot('09:00') === slotNow) {
    await detectStaleTasks(nowDate);
  }
  // eventos sem fechamento: todos os dias às 09:30
  if (timeToSlot('09:30') === slotNow) {
    await detectUnclosedPastEvents(nowDate);
  }
} catch (err) {
  console.error('[Dispatcher] Sprint18 hygiene err:', err.message);
}
```

Ambas as funções são self-contained com idempotência interna via `alreadySent`. O `try/catch` externo garante que falha na higiene nunca derruba o tick do dispatcher.

---

## 3. Trade-offs e riscos

| Risco | Mitigação |
|---|---|
| **Falso positivo de conflito** (alerta em casos válidos, ex: dois online paralelos intencionais) | Threshold HARD conservador (overlap ≥50% + presencial + locais diferentes). SOFT é apenas informativo — não bloqueia. Usuário silencia com "cria mesmo assim" |
| **Falso positivo de duplicidade** (eventos parecidos mas distintos, ex: reunião semanal recorrente com mesmo nome) | Threshold 0.7 com múltiplos boosts requeridos. Score < 0.5 não alerta. TOM sempre mostra qual evento foi flagged com data/hora para usuário decidir. Considerar: se title idêntico for recorrente, sprint 19 pode adicionar `recurrence_id` |
| **Excesso de confirmação** (TOM vira chato) | Soft conflicts não bloqueiam — apenas mencionam. Hard conflict é raro (presencial em locais físicos diferentes). Limite: usuário pode dizer "pode fazer" e TOM age imediatamente. Meta: < 1 bloqueio por dia por usuário |
| **Limpeza agressiva** | Sprint 18 NÃO deleta, NÃO fecha automaticamente. Apenas alerta e propõe. Toda ação destrutiva exige confirmação do usuário |
| **Heurística fraca** (falsos negativos: não detecta o óbvio) | Log `[IntegrityCheck]` obrigatório em todo check — permite auditoria rápida. Sprint 19 pode ajustar threshold por observação do log |
| **Confiança do usuário erodida** se alertas erram demais | Limit de 5 stale tasks e 3 eventos no digest semanal/diário. Pre-check: máximo 1 alerta por criação. Falha-aberta: se detectors quebram, INSERT prossegue normalmente |
| **Latência das queries de pre-check** | 2 queries em paralelo via `Promise.all` por trigger. Ambas window-bounded. Estimativa: ~40-60ms total. O caminho crítico de `processMessage` já tem 8-12 queries — incremento ~5-8% |
| **Confusão TOM entre `integrityPayload` e resposta normal** | Skill `integridade-agenda.md` inclui exemplos concretos por caso. Engine constrói `replyText` pré-formatado — TOM não precisa inferir o texto do payload raw |
| **Stale task de task que Alf sabe que está parada intencionalmente** | Alerta 1x/semana, via WhatsApp. Usuário pode responder "ignora" ou simplesmente não fazer nada. Sem penalidade. Sprint 19: "silenciar por N semanas" |

---

## 4. Plano de implementação por fatias

### Fatia 1 — Helpers de detecção (sem wiring)

**Entregável:** funções puras em `src/engine.js` — `jaroWinkler`, `normalizeForSim`, `detectTemporalConflict`, `detectDuplicateSemanticEvent`, `detectDuplicateSemanticTask`, `detectSchoolEventConflict`, `detectOverloadedDay`.

**Arquivos:** `src/engine.js`

**Sem wiring ainda** — funções existem mas não são chamadas pelo processMessage.

**Validação manual via node REPL:**
1. `detectTemporalConflict(collab, { start_at: '2026-05-04T09:00:00-03:00', end_at: '2026-05-04T10:30:00-03:00', modality: 'presencial', location_text: 'Recreio' })` — collab com evento existente das 08:30–10:00 no Recreio → hardConflicts.length === 1
2. `detectTemporalConflict(collab, { ..., modality: 'online' })` — mesmo evento base, candidato online → softConflicts.length === 1, reason = 'online_presencial_mixed'
3. `detectDuplicateSemanticEvent(collab, { title: 'Apresentação Sistema Gestão Levi', start_at: '2026-05-04T09:00:00-03:00' })` — evento existente "Apresentação Sistema de Gestão — Levi + Hugo" no mesmo dia → probable.length === 1, score > 0.7
4. `detectDuplicateSemanticTask(collab, { title: 'Falar com Renan sobre NF' })` — task aberta "Renan — NF pendente" → probable ou possible dependendo do score
5. `jaroWinkler('reunião levi', 'reunião levi hugo')` → verificar que retorna > 0.8

### Fatia 2 — Pre-check hook em `applyEventActions` + `applyTaskActions` create

**Entregável:** engine chama detectores antes do INSERT; retorna `integrityPayload` quando há finding. `processMessage` bloco `2.65` e bloco TASK_UPDATE detecta `integrityPayload` e substitui `reply` pelo texto de alerta.

**Arquivos:** `src/engine.js`

**Smoke test:**
- Criar evento que conflita HARD com existente → TOM exibe texto de alerta, evento NÃO é salvo, marker `EVENT_CREATE` logado como 'rejected' com reason 'integrity_hard_conflict'
- Criar task com título igual a task aberta → TOM exibe "já existe algo parecido", task NÃO é salva
- Verificar que `[IntegrityCheck]` aparece nos logs

### Fatia 3 — Skill `integridade-agenda.md` + wiring em `system.js`

**Entregável:** arquivo `src/skills/integridade-agenda.md` com os 3 modos + tabela de severidade + exemplos por cenário do PRD + REGRA CRÍTICA. `system.js`: carregamento para todos os roles, injeção de `opts.integrityHygiene`.

**Arquivos:** `src/skills/integridade-agenda.md`, `src/prompts/system.js`

**Smoke test E2E:**
- Cenário PRD §4 caso 1: "marca amanhã 10h no Recreio" com evento 09:00–10:30 existente → TOM responde "Você já tem [título] das 9h às 10h30. Quer marcar assim mesmo?"
- Usuário responde "pode marcar" → TOM emite `<<EVENT_CREATE>>` normalmente
- Cenário PRD §4 caso 3: "abre uma tarefa pra falar com Renan sobre a NF" com task aberta → TOM responde com alerta e oferece reutilizar

### Fatia 4 — Dispatcher: `detectStaleTasks` + `detectUnclosedPastEvents`

**Entregável:** 2 funções no `dispatcher.js` + gating temporal + idempotência via `ritual_logs`. Chamadas no `run()` nos slots corretos.

**Arquivos:** `src/rituals/dispatcher.js`

**Smoke test:**
- `--force`: adicionar `hygiene_stale_tasks` e `hygiene_unclosed_events` ao `RITUAL_BY_DIRECTIVE` (ou chamar diretamente com `node src/rituals/dispatcher.js --force=hygiene_stale`)
- Verificar que `ritual_logs` recebe linha com ritual_type correto após envio
- Verificar que segunda chamada no mesmo dia retorna 'skipped' imediatamente

### Fatia 5 — Validação E2E

| # | Cenário | Input | Resultado esperado |
|---|---|---|---|
| E1 | Conflito temporal HARD | Evento existente 09:00–10:30 presencial Recreio → "marca 10h no Recreio" | TOM alerta, não cria. Após "ok mesmo assim" → cria. |
| E2 | Conflito temporal SOFT online+online | Evento online 09:00–10:00 existente → "cria reunião online 09:30" | TOM informa sobreposição, cria automaticamente. |
| E3 | Duplicidade evento | Evento "Apresentação Levi Hugo" amanhã existente → "marca apresentação com Levi amanhã" | TOM pergunta sobre duplicidade antes de criar. |
| E4 | Duplicidade task | Task aberta "Renan — NF" → "abre tarefa falar com Renan sobre NF" | TOM mostra task existente e oferece reutilizar ou criar nova. |
| E5 | Stale tasks digest | Collab com 3+ tasks sem update há 15d → segunda 09:00 | WhatsApp com lista de até 5 stale tasks; ritual_log 'sent'. |
| E6 | Unclosed past events | Collab com evento que acabou há 36h, status=scheduled → dia seguinte 09:30 | WhatsApp com lista de até 3 unclosed events; ritual_log 'sent'. |
| E7 | Dia carregado | daily_plan com 7 items_planned → "cria tarefa pra amanhã" | TOM menciona "dia de amanhã já tem 7 itens planejados" em alerta soft. |
| E8 | Non-regression Sprint 17 | ACC ativo com request aberto → criar evento sem conflito | ACC e integridade coexistem sem interferência; evento criado normalmente. |

---

## 5. Decisões fechadas (aprovadas pelo Alf — 2026-05-03)

### 3 ajustes de produto obrigatórios (refletidos em §2.0)

| # | Ajuste | Onde aplica |
|---|---|---|
| A1 | **Duplicidade semântica nunca bloqueia automaticamente** — sempre suspeita/alerta para decisão humana, mesmo com score alto | Eventos + tasks. Reescrever pseudocódigo onde aparece `failCount++; continue;` para retornar suspect-payload pro skill |
| A2 | **Soft conflict NÃO cria silenciosamente** — pede confirmação leve antes de INSERT ("criar mesmo assim?") | Reescrever pseudocódigo onde aparece "soft não bloqueia, INSERT prossegue" |
| A3 | **Dia carregado é observação leve, não eixo central** — mencionar como complemento em alertas existentes, sem fluxo dedicado | §2.2.2 fica como nota complementar em alertas, sem bloqueio próprio |

### 6 decisões de parâmetros fechadas

| # | Decisão | Resolução |
|---|---|---|
| 5.1 | Limite digest de higiene | **5 stale / 3 unclosed** |
| 5.2 | Threshold de duplicidade | **0.7 fixo no MVP** |
| 5.3 | Janela de stale task | **14 dias** |
| 5.4 | Bloqueio HARD | **Só overlap ≥50% + presencial + ambos `location_text` preenchidos e distintos.** Sem dado = SOFT (nunca HARD por falta de informação) |
| 5.5 | Audit trail `integrity_alert_log` | **Não criar agora.** Rastreabilidade via `task_comments(comment_type='agent_note')`. Reavaliar Sprint 19+ |
| 5.6 | Hygiene no briefing | **Só se houver findings.** Bloco `[INTEGRITY_HYGIENE_CONTEXT]` ausente → silêncio |

### Esclarecimento sobre HARD

"Bloqueio até confirmação" = **alerta forte + 1 confirmação explícita do usuário** (ex: "criar mesmo assim?" → "sim, cria"). **NÃO** duas rodadas extras de confirmação. Após o "sim" do usuário, TOM cria sem novas perguntas.
