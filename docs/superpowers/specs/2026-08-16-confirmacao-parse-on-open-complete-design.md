# Fatia 4 — Confirmação não resolve: parse-on-open (complete/fechamento)

**Data:** 2026-08-16 · **Família:** `dropped_request` (dor #1) · **Slice:** complete/fechamento
· **Segue:** [[project_confirmacao_nao_resolve_parse_on_open]] (coordenação já NO AR)

## Sintoma

Mesmo padrão da coordenação: o usuário confirma um **fechamento** que o TOM perguntou em prosa
("Confirma o fechamento destas 2 tarefas: *Renovação*, *Report*?") e a ação se perde — "perdi o
fio" ou loop. 6 casos `CONFIRM_NOEXEC` de complete em 45d (11/08, 27/07 "Confirmado" 9 tarefas…).

## Raiz

Idêntica: a pergunta vem **em prosa, sem os markers de complete**. O A2 (`applyTaskActions`,
engine ~4435) só abre `batch_complete` com ids quando o LLM JÁ emitiu os completes (overcapture
guard). Quando o LLM pergunta em prosa pura, o hook genérico abre intent **só-texto** → no "sim",
sem `batch_complete`, cai no ramo `!hasConcrete` → LLM desiste.

## Design — parse-on-open, superfície complete

Diferente da coordenação (nome+texto na prosa), aqui a pergunta traz **títulos**, e completar a
tarefa errada é o risco (dor #1 do TASK_UPDATE). Por isso o miolo é **resolver título→id
determinístico e fail-closed**, reusando `resolveTaskTarget` (que já fail-closa em ambiguidade de
série/linhagem).

- **Novo módulo puro** `src/utils/complete-question-parse.js`:
  `parseCompleteConfirmQuestion(reply) → { titles: string[] } | null`. Extrai os títulos em
  negrito (`*…*`) após "Confirma o fechamento de(sta|stas N) tarefa(s): …?". Null se não for
  pergunta de fechamento ou sem títulos.
- **Novo helper testável** `src/utils/complete-titles-resolve.js`:
  `resolveTitlesToBatchComplete({ queryCandidatos, resolveTaskTarget, titles }) → { ids: string[] } | null`.
  Para cada título: `queryCandidatos(title)` (rows pending do dono) → `resolveTaskTarget`. Se
  **TODOS** derem `modo:'exato'` → `ids = [short-id de cada]` (8-char). Qualquer `ambiguo`/`nenhum`
  → **null** (fail-closed). `queryCandidatos` injetável (testa sem DB).
- **Fiação no engine** (hook genérico, junto do parse coord): se
  `parseCompleteConfirmQuestion(reply)` e `resolveTitlesToBatchComplete(...)` retornam ids,
  `payload.batch_complete = ids`. O `queryCandidatos` real: `tasks` `assigned_to=collab`,
  `ilike('%title%')`, `not status in (done,cancelled)`, campos de série. No "sim", o executor
  `batch_complete` (@engine 10199, já pronto) conclui via `executeBatchComplete` — que **re-checa
  o dono** (`resolveTaskByShortId`), defense-in-depth.

## Freios obrigatórios

1. **FAIL-CLOSED total.** Só estagia se **todos** os títulos resolverem `exato`. Um ambíguo/não-
   achado → não estagia NADA (cai no caminho de hoje). Fechar a tarefa errada é o risco.
2. **Dono.** Resolução escopada em `assigned_to=collab`; `executeBatchComplete` re-checa via
   `resolveTaskByShortId` (assigned_to + pool do grupo). Concluir tarefa alheia é impossível.
3. **Reusa `resolveTaskTarget`** — não reinventa desambiguação; ele já fail-closa em série/linhagem
   distinta e escolhe o ciclo corrente (menor due_date) quando é a mesma série.
4. **Parse na fala do TOM** (templada "Confirma o fechamento…: *títulos*?"), nunca no texto do user.
5. **Zero-regressão por construção.** Sem títulos / qualquer não-resolvido → payload só-texto de hoje.
6. **Voz intacta.** No "sim" sai o "✅ Concluí: X, Y." determinístico (10215) — a mesma do
   `batch_complete` nativo.

## Prova de aceite

- Puros: `complete-question-parse.test.js` (extrai títulos; null em não-fechamento/negação/vazio)
  + `complete-titles-resolve.test.js` (todos exato → ids; um ambíguo → null; um não-achado → null).
- Replay VERDE: 2 tarefas pending únicas do QA → intent `batch_complete` (resolvido pelo parse) →
  "Confirma" → **as 2 ficam done**, "✅ Concluí", sem "perdi o fio".
- Replay VERMELHO / fail-closed: título AMBÍGUO (2 tarefas pending com mesmo nome, linhagens
  distintas) → o parse NÃO estagia → "sim" NÃO fecha tarefa errada (cai no caminho honesto).
- Suíte VPS fail 3 + restart provado.
