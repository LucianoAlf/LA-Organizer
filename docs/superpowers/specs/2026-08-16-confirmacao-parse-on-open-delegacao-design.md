# Fatia 5 — Confirmação não resolve: parse-on-open (delegação)

**Data:** 2026-08-16 · **Família:** `dropped_request` (dor #1) · **Slice:** delegação (fecha a família)
· **Segue:** [[project_confirmacao_nao_resolve_parse_on_open]] (coordenação + complete já NO AR)

## Sintoma

Mesmo padrão: o usuário confirma uma **delegação** que o TOM perguntou em prosa ("Delego pra Mayra
— '…'. Confirma?" / "Delego a tarefa *X* pro Alf? Confirma?") e a ação se perde. 3 casos
`CONFIRM_NOEXEC` de delegação em 45d (16/08 ×2, 28/07).

## Raiz

Idêntica às outras superfícies: pergunta **em prosa sem o marker de delegação**; hook genérico abre
intent só-texto; no "sim", sem executor, cai no `!hasConcrete` → LLM desiste.

**Diferença:** não existe executor determinístico de delegação na resolução da confirmação (só
`anchor`, `batch_complete`, `coordination.items`). Essa branch é a **peça nova** desta fatia.

## Design

1. **Novo módulo puro** `src/utils/delegate-question-parse.js`:
   `parseDelegateConfirmQuestion(reply) → { task_title, to_name } | null`. Título = 1º bloco em
   `*negrito*` (strip de aspas); destinatário = nome próprio após `pra/pro/para` (busca feita com
   os blocos em negrito REMOVIDOS, pra não casar nome dentro do título). Âncora "delego"; guard de
   negação. Null se faltar título OU destinatário.
2. **Reuso** `complete-titles-resolve.js` (título único) pra resolver `task_title → short-id`
   (fail-closed via `resolveTaskTarget`).
3. **Fiação no engine** (hook genérico, junto de coord/complete): se parse + resolução do título
   ok, `payload.delegation = { task_id, to_name }`. Skip se coord/complete já estagiaram.
4. **NOVA branch determinística** na resolução da confirmação (após `coordination.items` @10221):
   se `userConfirm==='yes' && payload.delegation` → `applyTaskActions(collab, [{ action:'delegate',
   id: task_id, to_name }], { inboundText })` (reusa o handler existente @5835, que resolve dono +
   destinatário, fail-closa em ambíguo/não-achado, notifica o destinatário). Resolve o intent e
   responde.

## Freios obrigatórios

1. **FAIL-CLOSED.** Só estagia se o título resolver `exato` E o destinatário for extraído. A
   resolução do destinatário fica no executor (`applyTaskActions` delegate: ambíguo → pergunta;
   não-achado → não delega). Delegar a tarefa/pessoa errada é o risco.
2. **Dono.** O handler delegate já checa `resolveTaskByShortId` (assigned_to) — delegar tarefa
   alheia é impossível.
3. **Reusa `resolveTaskTarget`** (série/linhagem) e o **handler delegate existente** — sem
   reinventar execução.
4. **Parse na fala do TOM** (templada), nunca no texto do user.
5. **Zero-regressão por construção.** Sem estágio → payload só-texto de hoje.
6. **VOZ — linha nova (precisa do teu OK):** no "sim" com sucesso, a resposta ao requester é
   determinística `📋 Delegado pra *{Nome}*.` (não existe reply determinística de delegação pra
   reusar, diferente do "📨 Recado enviado!" da coordenação). Ambíguo → pergunta de desambiguação
   (buildAmbiguityQuestion, já existe); falha → "Não consegui delegar '{Nome}' — confere o nome?".

## Prova de aceite

- Puros: `delegate-question-parse.test.js` (extrai título+nome nos 2 templates; null em
  não-delegação/negação/faltando um).
- Replay VERDE: tarefa pending do QA01 → intent `delegation` (task_id+to_name QA02) → "Confirma" →
  tarefa vira `delegated`/`assigned_to=QA02`, resposta "📋 Delegado", sem "perdi o fio".
- Replay VERMELHO / fail-closed: título de tarefa AMBÍGUO (2 mesmo nome) → não estagia → "sim" NÃO
  delega tarefa errada.
- Suíte VPS fail 3 + restart provado.
