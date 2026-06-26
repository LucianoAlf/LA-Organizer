# Camada-2 Fase 0 (Observabilidade) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provar (ou refutar) que existe resíduo não-recuperável de **confab de falha parcial** — um marker rejeitado coexistindo com outro executado, com a frase de alegação do rejeitado vazando — sem tocar em nenhuma reply.

**Architecture:** Um *velocímetro* observe-only no fim do turno (`processMessage`), irmão da Camada-1. Lê os markers DO TURNO via uma query já provada (janela `collaborator_id` + `_t0-1000ms`), aplica um detector **estrutural puro** (sem léxico de alegação) e, quando dispara, registra a reply **inteira** numa tabela **descartável** (`confab_partial_observations`), fora do `marker_logs`. Nenhuma mutação de reply → risco de voz/regressão = zero.

**Tech Stack:** Node.js CommonJS, `node:test`, Supabase (Postgres, project `cesnbnrynvxvgdhfmaua`), VPS `tom` (`/opt/LA-Organizer`).

**Spec homologada:** `_remote/docs/superpowers/specs/2026-06-26-camada2-confab-falha-parcial-design.md`

## Global Constraints

- **Escopo = SÓ a Fase 0.** A Fase 1 (léxico por domínio) tem ciclo próprio (brainstorm→spec→plano) DEPOIS dos dados. Nada de léxico/sanitização de reply neste plano.
- **Observe-only:** nenhum passo pode alterar `reply`. Se um passo mexe no texto, está errado.
- **PT-BR** em todo log/comentário. **Nunca Haiku** em subagente (Sonnet/Opus).
- **Precisão > recall** é da Fase 1; na Fase 0 o gate é estrutural e a amostra é lida a olho.
- **NÃO escrever no `marker_logs`.** Dois furos confirmados (design §5.3): (A) `marker_logs_result_check` (`20260529180000_marker_logs_allow_fallback.sql:6-7`) não tem `'observed'`; (B) `evaluate_known_issues()` (`20260529150000_tom_known_issues.sql:56`) casa `(marker_type||' '||coalesce(reason,'')) ILIKE sinal_padrao` SEM filtrar `result`. A tabela à parte sidesteppa os dois estruturalmente.
- **Convenção de deploy/commit (CLAUDE.md OVERRIDE — vence o "frequent commits" do skill):** NÃO commitar entre tasks. O auto-deploy Stop hook commita+pusha `_remote/` no fim do turno. Engine/lib hot-deploy via `scp` + `pm2 restart tom`. Migrations aplicadas via Supabase MCP/`execute_sql`. Antes de editar `src/`, criar `.deploy-hold`; liberar após o deploy. Cada task termina no **teste passando**, não num commit.
- **`malformed` não existe em `marker_logs.result`** (CHECK só `executed/rejected/skipped/redirected/fallback`). Marker malformado → `result='rejected'` (reason `schema_invalid`). O detector gateia em `'rejected'`.

## Desvio do spec a sinalizar ao revisor

O spec §5.1 esboçou coletar markers no **sink** (`logMarker`, engine.js:201) com acumulador turn-scoped. **O plano NÃO faz isso** — o spec deferiu o mecanismo ao plano ("Mecanismo exato = decisão do plano") e o aterramento no código achou opção estritamente melhor:

- `logMarker` é função module-level chamada **111×**; acumular nela exigiria `AsyncLocalStorage` ou trocar a assinatura em 111 sítios.
- **Já existe** (engine.js:11271-11283) uma query da janela-de-turno (`collaborator_id` + `created_at >= _t0-1000ms`) que lê os markers DO TURNO. Está em produção há sprints.
- O plano **reusa esse padrão** num bloco isolado: zero edição de `logMarker`, zero edição dos ~14 handlers, removível em uma única exclusão de bloco — sem plumbing nova.

**Por que a janela é aceitável (assimetria FP-only, NÃO "imunidade"):** a janela do mesmo colaborador não tem upper bound, então dois turnos sobrepostos *podem* contaminar a leitura. Mas o erro é **assimétrico e benigno**: uma linha extra só **adiciona** detecção — nunca **esconde** um par R+E genuíno do mesmo turno. Logo o pior caso é **falso-positivo** (ruído que o olho filtra na amostra), **nunca falso-negativo** → a barra de 14d nunca fecha a Camada-2 por engano. É isso (não imunidade a concorrência) que torna o mecanismo seguro pra um instrumento observe-only.

→ Mesma garantia que o sink prometia (turn-scoped, sem editar handlers), com menos superfície. Reply nunca é mutada (observe-only) → zero risco de voz. Sujeito à catraca.

## File Structure

- **Create** `src/lib/confab-partial-observe.js` — detector puro `detectPartialConfab(rows)` + `META_MARKER_TYPES`. Única responsabilidade: dado o conjunto de markers do turno, dizer se há o padrão estrutural de falha parcial cross-tipo. Sem I/O, sem texto de reply.
- **Create** `src/lib/confab-partial-observe.test.js` — testes unitários do detector.
- **Create** `supabase/migrations/20260626120000_confab_partial_observations.sql` — tabela descartável + índice + RLS-deny.
- **Modify** `src/engine.js` (inserir após :11506, o bloco DerrotismoWatch) — cola observe-only: recompõe a janela, query, detector, console + insert na tabela. Não toca `reply`.

---

### Task 1: Detector estrutural puro (`detectPartialConfab`)

**Files:**
- Create: `src/lib/confab-partial-observe.js`
- Test: `src/lib/confab-partial-observe.test.js`

**Interfaces:**
- Consumes: nada (função pura).
- Produces: `detectPartialConfab(rows: Array<{marker_type:string, result:string}>) → { rejected: string[], executed: string[] } | null`. Dispara só quando ∃ tipo rejeitado R e ∃ tipo executado E com R≠E, ignorando tipos META. Também exporta `META_MARKER_TYPES: Set<string>`.

- [ ] **Step 1: Escrever os testes que falham**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectPartialConfab } = require('./confab-partial-observe');

// ── DISPARA: falha parcial cross-tipo ──
test('dispara: PREFS rejeitado + TASK executado (caso Jhonatan)', () => {
  const hit = detectPartialConfab([
    { marker_type: 'TASK_UPDATE', result: 'executed' },
    { marker_type: 'PREFS_UPDATE', result: 'rejected' },
  ]);
  assert.deepEqual(hit, { rejected: ['PREFS_UPDATE'], executed: ['TASK_UPDATE'] });
});
test('dispara: malformed chega como rejected (schema_invalid)', () => {
  const hit = detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'NOTE_ACTION', result: 'rejected' }, // malformed → rejected
  ]);
  assert.ok(hit);
  assert.deepEqual(hit.rejected, ['NOTE_ACTION']);
  assert.deepEqual(hit.executed, ['TASK']);
});
test('dispara: vários executados, um rejeitado de outro tipo', () => {
  const hit = detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'EVENT', result: 'executed' },
    { marker_type: 'PREFS_UPDATE', result: 'rejected' },
  ]);
  assert.ok(hit);
  assert.deepEqual(hit.rejected, ['PREFS_UPDATE']);
  assert.deepEqual(hit.executed.sort(), ['EVENT', 'TASK']);
});

// ── NÃO dispara ──
test('não dispara: mesmo tipo rejeitado+executado (handler já cobre o partial)', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'TASK', result: 'rejected' },
  ]), null);
});
test('não dispara: só executados', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'EVENT', result: 'executed' },
  ]), null);
});
test('não dispara: só rejeitados (Camada 1 cobre o nothingPersisted)', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'PREFS_UPDATE', result: 'rejected' },
  ]), null);
});
test('não dispara: rejected + skipped (skipped é não-ação legítima)', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'NOTE_ACTION', result: 'skipped' },
    { marker_type: 'PREFS_UPDATE', result: 'rejected' },
  ]), null);
});
test('não dispara: META rejeitado (CHOKEPOINT) + TASK executado → CHOKEPOINT fora', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'TASK', result: 'executed' },
    { marker_type: 'CHOKEPOINT', result: 'rejected' },
  ]), null);
});
test('não dispara: ACTIONABLE_NO_MARKER (META) rejeitado sem executado real', () => {
  assert.equal(detectPartialConfab([
    { marker_type: 'ACTIONABLE_NO_MARKER', result: 'rejected' },
  ]), null);
});
test('não dispara: entrada vazia/inválida', () => {
  assert.equal(detectPartialConfab([]), null);
  assert.equal(detectPartialConfab(null), null);
  assert.equal(detectPartialConfab([{ result: 'executed' }]), null); // sem marker_type
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test src/lib/confab-partial-observe.test.js`
Expected: FAIL — `Cannot find module './confab-partial-observe'`.

- [ ] **Step 3: Implementar o detector**

```js
'use strict';

// CONFAB-PARTIAL-LEAK (Fase 0, 26/06) — detector ESTRUTURAL puro de confab de falha parcial.
// Recebe as linhas de marker_logs DO TURNO ([{marker_type, result}]) e dispara quando
// coexistem um marker REJEITADO (R) e um EXECUTADO (E) de TIPOS DIFERENTES (R≠E) — a
// assinatura de "algo persistiu (Camada 1 não dispara) mas outra coisa falhou".
//
// NÃO olha o texto da reply: o design §4 provou que o léxico de confab (_isOptimisticLine)
// erra a classe-alvo ("fico quieto" é estado, não conclusão). Quem julga o vazamento é o
// olho humano lendo a amostra; o detector só entrega o conjunto estrutural.
//
// 'malformed' NÃO existe na coluna result (CHECK: executed/rejected/skipped/redirected/
// fallback) — marker malformado é logado como result='rejected' (reason schema_invalid).
// Então gatear em 'rejected' já cobre malformed.
//
// META: markers de telemetria/guard não são ação de domínio → fora de R e de E.
const META_MARKER_TYPES = new Set([
  'CHOKEPOINT', 'ACTIONABLE_NO_MARKER', 'PROVIDER', 'LEAK_BLOCKED',
  'UNKNOWN_MARKER_STRIPPED', 'TOOL_CALL_STRIPPED', 'CONFAB_PARTIAL_OBSERVE',
]);

function detectPartialConfab(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const rejected = new Set();
  const executed = new Set();
  for (const r of rows) {
    if (!r || !r.marker_type) continue;
    const type = String(r.marker_type);
    if (META_MARKER_TYPES.has(type)) continue;
    if (r.result === 'rejected') rejected.add(type);
    else if (r.result === 'executed') executed.add(type);
  }
  if (!rejected.size || !executed.size) return null;
  const rej = [...rejected];
  const exec = [...executed];
  // cross-tipo: ∃ R rejeitado e E executado com R≠E. Falha parcial MESMO-tipo (3 TASK,
  // 1 falha) já é coberta pelo sanitizeOptimisticConfirm('partial') do handler do TASK.
  const crossType = rej.some((R) => exec.some((E) => E !== R));
  if (!crossType) return null;
  return { rejected: rej, executed: exec };
}

module.exports = { detectPartialConfab, META_MARKER_TYPES };
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `node --test src/lib/confab-partial-observe.test.js`
Expected: PASS — 10 testes, 0 falhas.

---

### Task 2: Tabela descartável `confab_partial_observations`

**Files:**
- Create: `supabase/migrations/20260626120000_confab_partial_observations.sql`

**Interfaces:**
- Produces: tabela `public.confab_partial_observations(id, collaborator_id, reply, rejected_types text[], executed_types text[], reason, created_at)` + índice em `created_at`. Escrita só via service_role (engine). Consumida pela contagem da barra (Task 4) e pelo insert do engine (Task 3).

- [ ] **Step 1: Escrever a migration**

```sql
-- CONFAB-PARTIAL-LEAK (Fase 0, 26/06) — tabela DESCARTÁVEL de observação.
-- Fora do marker_logs DE PROPÓSITO (design §5.3):
--   (A) marker_logs.result tem CHECK sem 'observed' → INSERT falharia calado;
--   (B) evaluate_known_issues() varre marker_logs sem filtrar result e casaria sinal_padrao.
-- Tabela à parte é invisível ao auditor (evaluate_known_issues / checkConversationQuality
-- só leem marker_logs / conversation_history). DROPAR ao fechar o gate (design §6).
create table if not exists public.confab_partial_observations (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid references public.collaborators(id),
  reply text not null,                       -- reply INTEIRA (sem truncar): é o que o olho lê
  rejected_types text[] not null default '{}',
  executed_types text[] not null default '{}',
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists confab_partial_obs_created_idx
  on public.confab_partial_observations (created_at desc);

-- O engine escreve via service_role (bypassa RLS); ninguém mais precisa ler.
-- RLS ligado SEM policy = nega anon/authenticated → não vaza pra PWA.
alter table public.confab_partial_observations enable row level security;
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Aplicar via Supabase MCP `apply_migration` (project `cesnbnrynvxvgdhfmaua`, name `confab_partial_observations`) com o SQL acima. (CLAUDE.md: aplicar migration é sempre permitido.)

- [ ] **Step 3: Verificar a tabela e a coluna**

Run (Supabase MCP `execute_sql`, project `cesnbnrynvxvgdhfmaua`):
```sql
select column_name, data_type
from information_schema.columns
where table_name = 'confab_partial_observations'
order by ordinal_position;
```
Expected: 7 linhas — `id uuid`, `collaborator_id uuid`, `reply text`, `rejected_types ARRAY`, `executed_types ARRAY`, `reason text`, `created_at timestamptz`.

- [ ] **Step 4: Provar que o insert aceita `reply` longa e arrays (sem CHECK no caminho)**

Run (Supabase MCP `execute_sql`):
```sql
insert into public.confab_partial_observations (collaborator_id, reply, rejected_types, executed_types, reason)
values (null, repeat('x', 1200), array['PREFS_UPDATE'], array['TASK_UPDATE'], 'smoke')
returning id, length(reply), rejected_types, executed_types;
delete from public.confab_partial_observations where reason = 'smoke';
```
Expected: 1 linha retornada com `length=1200` (reply inteira, não truncada), arrays corretos; depois o delete remove o smoke. (Confirma: sem CHECK de `result`, reply sem limite de 500 chars.)

---

### Task 3: Bloco observe-only no engine (`processMessage`)

**Files:**
- Modify: `src/engine.js` — inserir após o bloco `[DerrotismoWatch]` (termina em :11506), antes do comentário `// SYNC-EXCUSE-CONFAB` (:11508).

**Interfaces:**
- Consumes: `detectPartialConfab` (Task 1); tabela `confab_partial_observations` (Task 2); variáveis em escopo no ponto de inserção — `_t0` (engine.js:7929), `collab` (7960), `supabase` (módulo), `reply` (corrente).
- Produces: linhas em `confab_partial_observations` quando o detector dispara + `console.warn('[ConfabPartial] OBSERVED ...')`. **Não** altera `reply`.

- [ ] **Step 1: Criar o `.deploy-hold` (protege edição concorrente do _remote)**

Run: `printf 'camada2-fase0 %s\n' "$(date)" > /d/la-organizer/_remote/.deploy-hold`
Expected: arquivo criado (o Stop hook respeita o hold e não empacota engine.js pela metade).

- [ ] **Step 2: Inserir o bloco observe-only**

No `src/engine.js`, logo após (linha 11506):
```js
  } catch (e) { console.warn('[DerrotismoWatch] non-fatal:', e.message); }
```
inserir:
```js

  // CONFAB-PARTIAL-LEAK (Fase 0, 26/06) — VELOCÍMETRO de confab de FALHA PARCIAL.
  // Só OBSERVA (não toca o reply). A Camada 1 (chokepoint) é BINÁRIA (dispara só se NADA
  // persistiu no turno); a falha PARCIAL — um marker rejeitado coexistindo com outro
  // executado — escapa dela. Mecanismo: reusa a janela-de-turno já provada do bloco de
  // métrica (collaborator_id + _t0-1000ms) pra ler os markers DO TURNO com result. Gate
  // ESTRUTURAL puro (sem léxico — o detector de confab erra "fico quieto", design §4).
  // Escreve numa tabela DESCARTÁVEL (confab_partial_observations), FORA do marker_logs:
  // sidesteppa o CHECK de result (sem 'observed') e o evaluate_known_issues (que varre
  // marker_logs sem filtrar result). Olho humano lê a reply inteira e julga o vazamento.
  // DROPAR este bloco + a tabela ao fechar o gate de 14 dias (design §6).
  try {
    const { detectPartialConfab } = require('./lib/confab-partial-observe');
    const _sinceTurn = new Date(_t0 - 1000).toISOString();
    const { data: _turnMarkers } = await supabase
      .from('marker_logs')
      .select('marker_type, result')
      .eq('collaborator_id', collab.id)
      .gte('created_at', _sinceTurn);
    const _hit = detectPartialConfab(_turnMarkers || []);
    if (_hit) {
      console.warn(`[ConfabPartial] OBSERVED rej=${_hit.rejected.join(',')} exec=${_hit.executed.join(',')} reply="${String(reply || '').slice(0, 200).replace(/\n/g, ' ')}"`);
      try {
        await supabase.from('confab_partial_observations').insert({
          collaborator_id: collab.id,
          reply: String(reply || ''),
          rejected_types: _hit.rejected,
          executed_types: _hit.executed,
          reason: `rej:${_hit.rejected.join(',')}|exec:${_hit.executed.join(',')}`,
        });
      } catch (e) { console.warn('[ConfabPartial] insert non-fatal:', e.message); }
    }
  } catch (e) { console.warn('[ConfabPartialWatch] non-fatal:', e.message); }
```

- [ ] **Step 3: Conferir a sintaxe**

Run: `node --check src/engine.js`
Expected: sem saída (exit 0).

- [ ] **Step 4: Conferir que o bloco NÃO altera `reply` (grep de revisão)**

Run: `grep -n "ConfabPartial" src/engine.js`
Expected: as 3 linhas do bloco (comentário-tag não conta) — `[ConfabPartial] OBSERVED`, `[ConfabPartial] insert non-fatal`, `[ConfabPartialWatch] non-fatal`. **Nenhuma** linha com `reply =` dentro do bloco. (Confirma observe-only.)

- [ ] **Step 5: Deploy no VPS**

Run:
```bash
scp /d/la-organizer/_remote/src/lib/confab-partial-observe.js tom:/opt/LA-Organizer/src/lib/confab-partial-observe.js
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
ssh tom "pm2 restart tom"
```
Expected: `pm2 restart` mostra o processo `tom` `online`.

- [ ] **Step 6: Smoke no VPS — o caminho de escrita funciona ponta-a-ponta**

Run:
```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e \"const {createClient}=require('@supabase/supabase-js'); const s=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); const {detectPartialConfab}=require('./src/lib/confab-partial-observe'); const hit=detectPartialConfab([{marker_type:'TASK_UPDATE',result:'executed'},{marker_type:'PREFS_UPDATE',result:'rejected'}]); (async()=>{ const {error}=await s.from('confab_partial_observations').insert({collaborator_id:null, reply:'smoke vps', rejected_types:hit.rejected, executed_types:hit.executed, reason:'smoke-vps'}); console.log('insert err:', error&&error.message); const {error:de}=await s.from('confab_partial_observations').delete().eq('reason','smoke-vps'); console.log('cleanup err:', de&&de.message); })();\""
```
Expected: `insert err: null` e `cleanup err: null` — o `require` do lib na VPS resolve, o detector dispara, o insert na tabela passa (sem CHECK, sem RLS bloqueando service_role).

- [ ] **Step 7: Liberar o `.deploy-hold`**

Run: `rm -f /d/la-organizer/_remote/.deploy-hold`
Expected: arquivo removido (o auto-deploy volta a empacotar; commitará no fim do turno).

---

### Task 4: Provar o invariante 07h + iniciar a janela de observação

**Files:** nenhum (verificação + kickoff). Encerra a Fase 0 de codar; abre os 14 dias de coleta.

**Interfaces:**
- Consumes: tabela viva (Task 2), engine deployado (Task 3).
- Produces: prova por query/grep de que a observação é invisível ao relatório das 07h; data de início da janela; query da barra de decisão.

- [ ] **Step 1: Provar que NENHUM caminho do auditor referencia a tabela (Furo B, query real ≠ prosa)**

Run: `grep -rn "confab_partial_observations" src/`
Expected: aparece SÓ em `src/engine.js` (o writer). **Não** aparece em `src/rituals/health-check.js`, nem em nada com `evaluate_known_issues`/`checkConversationQuality`. (Confirma: o auditor lê só `marker_logs`/`conversation_history` → a tabela é invisível pra ele.)

- [ ] **Step 2: Confirmar que `CONFAB_PARTIAL_OBSERVE` não entrou no `marker_logs` (não escrevemos lá)**

Run (Supabase MCP `execute_sql`, project `cesnbnrynvxvgdhfmaua`):
```sql
select count(*) from marker_logs where marker_type = 'CONFAB_PARTIAL_OBSERVE';
```
Expected: `0`. (A observação NÃO toca `marker_logs` — sidestep do Furo A/B confirmado em runtime.)

- [ ] **Step 3: Confirmar que nenhum `sinal_padrao` casaria a observação (defesa em profundidade do Furo B)**

Run (Supabase MCP `execute_sql`):
```sql
select codigo, sinal_padrao
from tom_known_issues
where sinal_tipo = 'marker_log'
  and 'CONFAB_PARTIAL_OBSERVE rej:PREFS_UPDATE|exec:TASK_UPDATE' ilike sinal_padrao;
```
Expected: `0 linhas`. (Mesmo se um dia algo vazasse pro marker_logs, nenhum known-issue o casaria.)

- [ ] **Step 4: Marcar o início da janela e registrar a query da barra**

Registrar no `tom_known_issues` o code `CONFAB-PARTIAL-LEAK` como observação aberta.

**Landmine (catraca, confirmada):** `tom_known_issues_status_check` = `status = ANY (ARRAY['aberto','corrigido','wontfix'])` — `'monitorando'` **quicaria** (mesma classe do Furo A). Usar **`status='aberto'`** (aceito + semanticamente = observação aberta), sem ALTER de constraint.

Run (Supabase MCP `execute_sql`):
```sql
insert into tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao, primeira_vez, ultima_vez, ocorrencias)
values
  ('CONFAB-PARTIAL-LEAK', 'Confab de falha parcial (marker rejeitado coexiste com executado)',
   'marker', 'medio', 'aberto',
   'Camada 1 é binária (nothingPersisted); falha parcial cross-tipo escapa e a frase do marker rejeitado vaza.',
   'Fase 0 observe-only (confab_partial_observations) ativa desde 26/06; barra=≥1 vazamento genuíno a olho em 14d → Fase 1; 0 → fecha e dropa. Spec/plano em docs/superpowers.',
   'manual', 'CONFAB-PARTIAL-LEAK-OBSERVE', now(), now(), 0)
returning codigo, status;
```
Expected: 1 linha — `CONFAB-PARTIAL-LEAK | aberto`. (`sinal_tipo='manual'` → `evaluate_known_issues`, que só varre `marker_log`, nunca toca essa linha → inerte.)

- [ ] **Step 5: Documentar a query da barra de decisão (rodar no fim dos 14 dias)**

A decisão (design §6) sai de:
```sql
select count(*) as observacoes_14d,
       array_agg(distinct (array_to_string(rejected_types,',') || '→' || array_to_string(executed_types,','))) as padroes
from confab_partial_observations
where created_at > now() - interval '14 days';
```
Interpretação: ler as `reply` das observações a olho. **≥1 vazamento genuíno** (frase afirma a ação do marker rejeitado, não coberta por handler, Camada 1 não disparou) → abrir Fase 1. **0** → fechar "observada, desnecessária": remover o bloco do engine + `drop table confab_partial_observations` + marcar `CONFAB-PARTIAL-LEAK` como `corrigido`.

Expected: query roda sem erro hoje (retorna `0` observações — janela recém-aberta).

---

## Self-Review

**1. Spec coverage:**
- §4 (gate estrutural, sem léxico) → Task 1 (detector não olha reply). ✅
- §5.1 (coleta turn-scoped, sem editar handlers) → Task 3 query reusa janela `collaborator_id`+`_t0-1000ms`; desvio do sink sinalizado. ✅
- §5.2 (gate R rejected, E executed, R≠E; skipped fora; malformed→rejected) → Task 1 testes cobrem todos. ✅
- §5.3 (tabela descartável, reply inteira, fora do marker_logs; Furos A/B) → Task 2 (tabela) + Task 3 (writer) + constraints. ✅
- §5.4 (barra 14d, ≥1 genuíno) → Task 4 Steps 4-5. ✅
- §6 (gate: dropar tabela+bloco se 0) → Task 4 Step 5 (instruções de fechamento). ✅
- §9 (testes: detector; coletor interleaved; invariante query real) → Task 1 (detector); invariante Task 4 Steps 1-3. **Coletor interleaved:** o coletor virou query por janela, então o teste de "turnos interleaved" do spec §9 não se aplica ao mecanismo escolhido. NÃO porque a janela seja imune a concorrência (não é — pode contaminar entre turnos sobrepostos do mesmo colaborador), mas porque o erro é **assimétrico e benigno**: contaminação só **adiciona** linhas → no máximo um **falso-positivo** que o olho filtra, **nunca** esconde um par genuíno (nunca falso-negativo). Como a barra de decisão só pode errar pra mais, jamais fecha a Camada-2 por engano. O teste unitário do detector (Task 1) já cobre o caso multi-marker. Desvio consciente, com a justificativa correta (FP-only, não imunidade). ✅
- §10 (riscos) → mitigações implementadas (tabela à parte; query window; observe-only). ✅

**2. Placeholder scan:** sem TBD/TODO; todo passo tem código/SQL/comando concreto + expected. ✅

**3. Type consistency:** `detectPartialConfab(rows)→{rejected,executed}|null` usado igual em Task 1 (def), Task 3 (`_hit.rejected`/`_hit.executed`) e Task 4 (smoke). Colunas da tabela (`rejected_types`/`executed_types`/`reply`/`reason`) idênticas em Task 2 (DDL), Task 3 (insert) e Task 4 (queries). ✅

**Gap consciente:** Fase 0 cobre o caminho `processMessage` (1:1) — o caso-mãe (Jhonatan) é 1:1. Chat de GRUPO é outro caminho do engine; fora do escopo da Fase 0 (estender só se os dados pedirem). Anotado pro revisor.
