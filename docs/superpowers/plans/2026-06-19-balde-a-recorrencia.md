# Balde A — Ciclo de vida da recorrência — Plano de Implementação

> **Para workers:** executar inline (executing-plans). Steps com checkbox.

**Goal:** Matar a dor #1 (tarefa feita "volta" / mesma tarefa Nx no check / "concluí" mentiroso) corrigindo as 3 falhas da camada cron+recorrência+conclusão — só código, sem migração de dado.

**Architecture:** 3 helpers puros testáveis em `src/utils/` (dedup de série, classificação ocorrência-vs-série, leitura de rowcount) plugados nos 3 rituais (check-in/briefing/fechamento) + 2 pontos do `applyTaskActions` (complete pessoal com rowcount, encerrar-série) + regra nas skills.

**Tech Stack:** Node.js CommonJS, `node:test`, Supabase JS, marcadores `<<TASK_UPDATE>>`.

**Spec:** `docs/superpowers/specs/2026-06-19-balde-a-recorrencia.md`

---

## File Structure

- Create: `src/utils/recurring-dedup.js` (+ `.test.js`) — dedup de instâncias da mesma série + remove molde.
- Create: `src/utils/completion-scope.js` (+ `.test.js`) — `classifyCompletionScope(text)` → occurrence|series|ambiguous; `updateAffected(res)` → bool.
- Modify: `src/services/recurrence-engine.js:367` — filtro de status em `materializeAll`.
- Modify: `src/rituals/dispatcher.js:5307` — dedup no check-in.
- Modify: `src/prompts/system.js:~1690-1695` — dedup no briefing/fechamento (origem do `ctx.workTasks`/`personalTasks`).
- Modify: `src/engine.js` — complete pessoal com rowcount (~4187); ramo `scope:"series"` (encerra série) no complete/cancel; permitir `scope` em `validateTaskAction`.
- Modify: `skills/checklist-tarefas.md` + `skills/criar-recorrencia.md` — regra ocorrência-vs-série + pergunta de desambiguação.

---

## Task 1: Helper puro `recurring-dedup`

**Files:** Create `src/utils/recurring-dedup.js`, Test `src/utils/recurring-dedup.test.js`

Regra: remove molde (`recurrence_rule != null && recurrence_parent_id == null`); para instâncias com mesmo `recurrence_parent_id`, mantém só a PRIMEIRA na ordem recebida (a query já vem ordenada por `due_date` asc → a mais próxima); não-recorrentes (`recurrence_parent_id == null`) passam intactas, ordem preservada.

- [ ] Step 1: escrever teste falhando (6 casos: 2 instâncias→1; molde+instâncias→1; não-recorrentes intactas; séries intercaladas→1/série; vazio→[]; entradas null puladas).
- [ ] Step 2: rodar `node --test src/utils/recurring-dedup.test.js` → FAIL (module not found).
- [ ] Step 3: implementar `dedupRecurringSeries(tasks)` (first-wins, order-preserving).
- [ ] Step 4: rodar → PASS.

## Task 2: Helper puro `completion-scope`

**Files:** Create `src/utils/completion-scope.js` (+ test)

- `classifyCompletionScope(text)`: regex PT — "para de me lembrar|encerra|não preciso mais|cancela essa recorrência" → `series`; "feito|concluí|fiz|terminei|pronto" → `occurrence`; recorrente sem sinal claro → `ambiguous`.
- `updateAffected(res)`: true se `res && Array.isArray(res.data) && res.data.length >= 1`.

- [ ] Step 1: teste falhando (series/occurrence/ambiguous + updateAffected 0 vs 1).
- [ ] Step 2: rodar → FAIL.
- [ ] Step 3: implementar.
- [ ] Step 4: rodar → PASS.

## Task 3: `materializeAll` não gera de molde fechado

**Files:** Modify `src/services/recurrence-engine.js:367`

- [ ] Step 1: adicionar `.not('status', 'in', '("done","cancelled")')` na query de templates (após `.eq('data_classification','real')`).
- [ ] Step 2: `node --check`. (Cobertura: teste seco mostra template done ⇒ 0 novas.)

## Task 4: Dedup nos 3 rituais

**Files:** Modify `dispatcher.js:5307`, `system.js:~1690-1695`

- [ ] Check-in: após buscar `tasks`, `tasks = dedupRecurringSeries(tasks)` antes do split personal/work.
- [ ] Briefing/fechamento: aplicar `dedupRecurringSeries` em `personalRes.data` e `workRes.data` (origem de `personalTasks`/`workTasks`), preservando o filtro de is_group existente.
- [ ] Fechamento: piso de data = hoje (no ponto que monta `buildClosingItems`, filtrar `due_date == today`). `node --check`.

## Task 5: Conclusão pessoal honesta (rowcount)

**Files:** Modify `src/engine.js:~4187`

- [ ] Adicionar `.select('id')` no UPDATE pessoal; se `!updateAffected(rP)` → NÃO conta okCount, empurra failMessage honesto ("não consegui fechar X — confirma?"), `failCount++`. Espelha o caminho de grupo. `node --check`.

## Task 6: Encerrar série (`scope:"series"`)

**Files:** Modify `src/engine.js` (validateTaskAction + handler), skills

- [ ] Permitir campo opcional `scope` em `validateTaskAction`.
- [ ] No complete/cancel: se `scope==="series"`, resolve template (self se `recurrence_rule!=null`, senão via `recurrence_parent_id`), UPDATE template `status='cancelled'` + UPDATE filhas `recurrence_parent_id=template AND due_date>=hoje AND status='pending'` → `cancelled` (com rowcount). Mensagem: "encerrei a recorrência".
- [ ] Skills `checklist-tarefas.md`/`criar-recorrencia.md`: recorrente + "feito" → complete da INSTÂNCIA (occurrence); "para de me lembrar/encerra/não preciso mais" → `scope:"series"`; ambíguo → perguntar "só a de hoje ou encerro de vez?".

## Task 7: Suíte + dry-run + entregáveis

- [ ] `node --test "src/**/*.test.js"` verde (mesma baseline; 2 falhas de ambiente conhecidas).
- [ ] Dry-run read-only (SELECT) Gabi/Fabi/Quintela/Anne/Kailane: antes N → depois 1.
- [ ] Montar diff, rollback, confirmar Balde B intocado. Enviar os 5 ao Alf. **NÃO deployar antes do OK.**

---

## Self-review
- Cobre os 4 root-causes do spec (materializeAll, dedup, rowcount, série). ✓
- Sem placeholders; helpers com regra explícita. ✓
- Nomes consistentes: `dedupRecurringSeries`, `classifyCompletionScope`, `updateAffected`. ✓
