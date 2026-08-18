# Recorrência de grupo — UMA verdade por ciclo — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ou superpowers:executing-plans. Passos usam checkbox (`- [ ]`).

**Goal:** Colapsar a dupla verdade (blueprint × instância) dos pacotes recorrentes de grupo numa fonte única, marcando o blueprint com um flag intrínseco que TODO consumidor usa — travado por um replay integral que assere contagens no banco.

**Architecture:** Nova coluna `tasks.is_recurrence_template` marca molde + filhas-blueprint. Predicado único `is_recurrence_template = false` = "vivo", usado em todos os handlers de grupo. Motor de recorrência (`materializeSeries`/`series_ended_at`) **intocado**. Nova ação `derecur` (para de repetir, mantém ciclo atual). Trilho = `replay-lab-cenario-grupo-recorrencia-*.js`, asserção = contagem no banco.

**Tech Stack:** Node.js, Supabase (Postgres), node:test, replay-lab (webhook → engine efêmero porta 3199 → banco).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-17-recorrencia-grupo-verdade-unica-design.md` (fonte de verdade das invariantes).
- **Motor de recorrência intocado:** NÃO alterar `materializeSeries`/`series_ended_at` além de setar o flag. Regressão de geração = pior cenário.
- **Deploy por fatia:** `.deploy-hold` na raiz E em `_remote/` ANTES de editar `src/` → TDD → suíte VPS baseline **fail 3** (`ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/"`, TAP `# tests`) → deploy cirúrgico (md5 local×VPS) → `pm2 restart tom` provado (`restarts` +1, `ps -o lstart=`) → registrar KI em `tom_known_issues`.
- **Baseline da suíte = fail 3** (env local ausente é pré-existente). Testes puros usam reporter `ℹ`; suíte VPS usa `# tests`.
- **Grupo de teste:** grupo QA dedicado no banco TOM (`cesnbnrynvxvgdhfmaua`); NUNCA rodar o replay contra o grupo Financeiro real `d95f63af`.
- **Zero-regressão por construção:** coluna default `false`; sem backfill/flag, comportamento idêntico ao de hoje.
- **Verificar no BANCO:** critério de "pronto" = contagem no banco, nunca "helper puro verde".
- **Bash = git-bash**, caminhos `D:/…`; `cd` é strip-ado por hook → usar `git -C` / caminhos absolutos / `ssh tom "cd … && …"`.

## File Structure

- `supabase/migrations/` — migration da coluna (aplicada via MCP `apply_migration`, NÃO commitada; `.gitignore` exclui).
- `src/services/task-groups.js` — `createTaskGroup` seta `is_recurrence_template=true` no molde + filhas-blueprint.
- `src/services/recurrence-engine.js` — `_cloneTemplate`/materialização NÃO propaga o flag pra instâncias (garante `false`).
- `src/services/group-chat-tasks.js` — `complete`/`cancel`/`reschedule`/resolvers excluem template; nova `derecur`; `endSeries` limpa órfãs.
- `src/services/group-chat-engine.js` — `loadContext` + `TASK_SERIES` (add `derecur`).
- `src/services/group-report-builder.js` + `src/utils/group-task-visibility.js` — predicado único.
- `scripts/replay-lab-cenario-grupo-recorrencia.js` — harness dos 8 cenários (NÃO commitado; `.gitignore` cobre `e2e-*`/scratch — usar prefixo coberto ou rodar da VPS sob `/opt`).
- `src/services/group-recurrence-invariants.js` (NOVO, PURO) — funções de asserção reutilizáveis (contagem por título/ciclo) usadas pelo replay e por testes unitários.

---

## Task 0: Replay integral que reproduz o bug (VERMELHO)

**Files:**
- Create: `scripts/replay-lab-cenario-grupo-recorrencia.js` (harness, roda na VPS sob `/opt/LA-Organizer/`)
- Create: `src/services/group-recurrence-invariants.js` (puro — asserções)
- Test: `src/services/group-recurrence-invariants.test.js`

**Interfaces:**
- Produces: `contarVivasPorCicloTitulo(rows, {titulo, ymdMesInicio, ymdMesFim}) → number` (conta linhas `is_recurrence_template !== true`, status pending, due no intervalo, título casado); `temTemplateVivoNoResolver(rows) → boolean`.

- [ ] **Step 1 — helper puro + teste (asserções do replay).** Escrever `group-recurrence-invariants.js` com `contarVivasPorCicloTitulo` e `temBlueprintNoConjunto(rows)` (retorna true se algum `is_recurrence_template===true`). Teste cobre: 2 filhas mesma data (1 blueprint + 1 instância) → `contarVivasPorCicloTitulo`=1 quando o flag existe; =2 quando flag ausente (estado de hoje). RED→GREEN local (`node --test`).
- [ ] **Step 2 — harness dos 8 cenários** (`replay-lab-cenario-grupo-recorrencia.js`): cria grupo QA temporário + membro QA, envia as mensagens de cada cenário via webhook (porta 3199), e após cada um roda uma query no banco e imprime `CENARIO N: <invariante> = <valor> (esperado <X>) → PASS/FAIL`. Cenários 1–8 da spec §6. Limpeza no fim (cancela/apaga as tarefas QA criadas).
- [ ] **Step 3 — rodar na VPS, capturar o VERMELHO.** `ssh tom "cd /opt/LA-Organizer && node --env-file=.env replay-lab-cenario-grupo-recorrencia.js"`. Esperado: Cenário 1 FAIL (conta 2, esperado 1); Cenário 2 FAIL (derecur não existe); Cenário 5 FAIL (órfãs). Documentar o baseline vermelho.
- [ ] **Step 4 — commit** (só o helper puro + teste; o script de replay é scratch/local). `git add src/services/group-recurrence-invariants.js src/services/group-recurrence-invariants.test.js && git commit -m "test(grupo-recur): invariantes puras + replay integral (baseline VERMELHO)"`.

**Deliverable:** o replay roda e mostra VERMELHO nos cenários do bug — o trilho existe antes de qualquer conserto.

---

## Task 1: Migração + marcador do blueprint

**Files:**
- Migration (via MCP `apply_migration`, nome `tasks_is_recurrence_template`)
- Modify: `src/services/task-groups.js:96-134` (ramo mensal do `createTaskGroup`)
- Modify: `src/services/recurrence-engine.js` (`_cloneTemplate` / materialização — garantir instâncias com flag `false`)

**Interfaces:**
- Produces: coluna `tasks.is_recurrence_template boolean NOT NULL DEFAULT false`; molde e filhas-blueprint nascem `true`.

- [ ] **Step 1 — dry-run da migração de dados (contagem, sem gravar).** Rodar SELECT que conta quantas linhas cada UPDATE marcaria (moldes; filhas-blueprint = `parent_task_id ∈ moldes AND recurrence_parent_id IS NULL`). Conferir que filha-instância (`recurrence_parent_id≠null`) fica de fora. Revisar os números antes de aplicar.
- [ ] **Step 2 — aplicar migração (DDL + backfill).** `apply_migration`: `ALTER TABLE tasks ADD COLUMN is_recurrence_template boolean NOT NULL DEFAULT false;` + os 2 UPDATEs da spec §2. Verificar contagem pós-migração.
- [ ] **Step 3 — teste (create seta o flag).** Teste unitário do `createTaskGroup` (com dublê de supabase que captura os inserts): asserta que o molde e as filhas-blueprint recebem `is_recurrence_template:true` e a mãe-instância/filhas-instância recebem `false`/ausente. RED (código ainda não seta).
- [ ] **Step 4 — implementar no `createTaskGroup`.** Nos inserts `:103` (molde) e `:107-114` (filhas-blueprint), adicionar `is_recurrence_template: true`. Nos inserts `:116` (mãe-instância) e `:119-126` (filhas-instância), garantir ausência/`false`. Em `recurrence-engine.js` `_cloneTemplate`: NÃO copiar `is_recurrence_template` do molde pra instância (senão instância nasce marcada) — setar `false` explícito.
- [ ] **Step 5 — GREEN + suíte.** `node --check` nos arquivos; teste do create verde; `node --test src/services/task-groups.test.js`.
- [ ] **Step 6 — deploy cirúrgico + replay Cenário 1.** `.deploy-hold` 2 pontas → commit → push → VPS reset + md5 → restart provado → rodar replay: Cenário 1 agora **VERDE** (conta 1). Suíte VPS fail 3.
- [ ] **Step 7 — registrar KI** `GROUPRECUR-TEMPLATE-FLAG` (status corrigido, fatia 1).

---

## Task 2: Handlers usam o predicado único

**Files:**
- Modify: `src/services/group-chat-tasks.js` (`complete` `:342`, `cancel` `:447`, `reschedule` `:479`, `_resolveByPhraseFallback`)
- Modify: `src/services/group-chat-engine.js:29-86` (`loadContext`)
- Modify: `src/services/group-report-builder.js:204-227` + `src/utils/group-task-visibility.js`

**Interfaces:**
- Consumes: coluna `is_recurrence_template` (Task 1).
- Produces: nenhum resolvedor de ação por título retorna linha `is_recurrence_template=true`.

- [ ] **Step 1 — grep de TODOS os leitores de `tasks` do grupo** (`assigned_group_id`) — listar cada query que resolve tarefa por título/pool. Garantir cobertura (memória: varrer READERS por grep quando o contrato muda).
- [ ] **Step 2 — teste transversal** (replay Cenários 3,4,7,8): concluir/remarcar/template-only/re-emitir → asserta `temBlueprintNoConjunto` = false no alvo e contagens da spec. RED onde o handler ainda vê blueprint.
- [ ] **Step 3 — implementar predicado.** Adicionar `.eq('is_recurrence_template', false)` nas queries de `complete`/`cancel`/`reschedule`/`_resolveByPhraseFallback`. Em `loadContext`/report, trocar/reforçar o filtro de parentesco pelo flag (equivalente, mais barato). Manter `pickInstanceTarget`/`pickVisibleCompletionTarget` (escolhem entre instâncias legítimas).
- [ ] **Step 4 — GREEN + suíte + deploy.** Testes verdes; deploy cirúrgico; replay Cenários 3,4,7,8 + transversal VERDES. Suíte fail 3.
- [ ] **Step 5 — KI** `GROUPRECUR-PREDICADO-UNICO`.

---

## Task 3: `derecur` — "só o primeiro mês" (COMPORTAMENTO — OK do Alf na redação)

**Files:**
- Modify: `src/services/group-chat-tasks.js` (nova `derecurSeries({supabase, templateId, cicloYmd})`)
- Modify: `src/services/group-chat-engine.js:393-425` (`TASK_SERIES` aceita `action:'derecur'`)
- Modify: skill/prompt do grupo (mapear intenção "não precisa ser mensal / para de repetir / só esse mês" → `derecur`) — **redação validada com o Alf**.

**Interfaces:**
- Produces: `derecurSeries` seta `series_ended_at` no molde, cancela instâncias futuras (`due_date > cicloYmd`), mantém o ciclo corrente + filhas.

- [ ] **Step 1 — teste `derecurSeries` (puro-ish com dublê).** Dado molde + instância corrente + instância futura: após `derecur`, molde `series_ended_at≠null`, instância futura cancelada, instância corrente + filhas **intactas**. RED.
- [ ] **Step 2 — implementar `derecurSeries`** (reusa padrão do `endSeries`, mas preserva o ciclo corrente). GREEN.
- [ ] **Step 3 — ligar no `TASK_SERIES`** (`action:'derecur'`, com confirmação — redação do Alf). Estágio em `group_chat_pending_confirms` (op `derecur_series`).
- [ ] **Step 4 — replay Cenário 2 VERDE** + deploy + KI `GROUPRECUR-DERECUR`.

---

## Task 4: `endSeries` limpa filhas-blueprint órfãs

**Files:**
- Modify: `src/services/group-chat-tasks.js:538` (`endSeries`)

- [ ] **Step 1 — teste:** após `endSeries`, `count(filha WHERE parent_task_id=molde AND status='pending')` = 0. RED (hoje só cancela `recurrence_parent_id=molde`).
- [ ] **Step 2 — implementar:** `endSeries` cancela também `parent_task_id=molde` não-done. GREEN.
- [ ] **Step 3 — replay Cenário 5 VERDE** + deploy + KI `GROUPRECUR-ENDSERIES-ORFA`.

---

## Task 5: Integral VERDE + limpeza dos legados

- [ ] **Step 1 — replay integral completo na VPS: 8 cenários VERDES** (contagens no banco batendo). Se algum vermelho, volta pra fatia dona.
- [ ] **Step 2 — varredura dos pacotes legados duplicados** (grupo Financeiro + outros): reusar o padrão da limpeza de 17/08 (ghosts/dups por bucket título|due), agora com o flag pra distinguir blueprint. Dry-run → mostrar ao Alf → aplicar (soft/reversível).
- [ ] **Step 3 — registrar KI-mãe** `GROUPRECUR-VERDADE-UNICA` (encerra a família), atualizar memória (`project_grupo_crud_roadmap`, `project_recurrence_lifecycle_rootcause`, `project_select_cego_helper_decide_por_campo`) com "modelo canônico + replay integral = o trilho".

---

## Self-Review

**Spec coverage:** §2 modelo/migração → Task 1 ✅; §3 consumidores → Task 2 ✅; §4 derecur → Task 3 ✅; §5 endSeries órfãs → Task 4 ✅; §6 replay 8 cenários → Task 0 (vermelho) + verdes distribuídos ✅; §7 fatias → Tasks 0–5 ✅. Sem lacuna.

**Placeholder scan:** sem TBD/genéricos; cada task tem arquivos + invariante concreta. Código exato do `createTaskGroup`/migração vem do spec §2 (copiado). Os steps de TDD referenciam o dublê de supabase já usado em `task-groups.test.js`/`group-chat-tasks.test.js`.

**Type consistency:** `is_recurrence_template` (nome único em toda parte); `contarVivasPorCicloTitulo`/`temBlueprintNoConjunto` consistentes entre Task 0 e Task 2; `derecurSeries` assinatura fixa Task 3.

**Nota:** file:line podem ter deslocado — reconfirmar com Read no início de cada fatia (a `group-chat-tasks.js` foi editada nesta sessão; o diagnóstico já reflete o estado atual).
