# Trava de dedup determinística no create de NOTA — Design

- **Data:** 2026-06-21
- **Status:** Aprovado (design) — aguardando plano de implementação
- **Autor:** Claude + Alf
- **Contexto relacionado:** `CODEX-FALLBACK-DUP` (known issue aberto), `project_motor_tom_sonnet_vs_gpt55`, eval ampliado 16 casos (1:1) de 21/06

## Problema

No eval ampliado (16 casos, caminho 1:1), o GPT-5.5 (fallback Codex) **duplicou uma nota pessoal que já existia** (C7: nota *"Lista de compras — mercado"* já salva; o GPT criou outra *"Lista de compras"*) mesmo com a nota no contexto. O Sonnet leu e não duplicou. As **tarefas** passaram em todas as armadilhas de dup (D1/D2/D3) porque **já têm** dedup determinística no engine:

- `detectDuplicateSemanticTask` (`engine.js:6604-6681`) — Jaro-Winkler em tarefas abertas dos últimos 30 dias, com boosts; dup `probable` → não insere, grava `pending_intent`, retorna `integrityPayload {type:'dup_task'}`.
- Dedupe defensivo de 60s (`engine.js:~4825`) — título exato + mesmo dono nos últimos 60s.

**As NOTAS não têm nada disso.** O create de nota (`NOTE_ACTION` → `engine.js:9567` → `notes.js:33`) faz `INSERT` direto, sem checar nota existente. Resultado: a anti-duplicação de nota depende 100% do LLM ler o contexto — frágil e variável por modelo. Essa é a causa do C7 e o último pré-requisito real pra cogitar o Codex como primário.

## Objetivo

Dedup **determinística no engine**, ANTES de persistir um create de nota, espelhando o nível que as tarefas já têm. O resultado não depende do modelo. Fecha o `CODEX-FALLBACK-DUP`.

## Escopo

**Dentro:** notas **pessoais** criadas via `NOTE_ACTION` (`action:"create"`, tabela `notes`).
**Comportamento (decidido com Alf):** ao detectar duplicata → **não cria**, **avisa que já existe** (mostrando o conteúdo) e **oferece anexar** o conteúdo novo na nota existente.
**Match (decidido com Alf):** espelhar o motor de similaridade das tarefas — título normalizado + Jaro-Winkler + overlap de keywords/corpo (não match exato; o C7 tem títulos diferentes).

**Fora (fast-follow / YAGNI):** tarefas (já cobertas); notas de **grupo** (`group_notes`) — mesmo risco, não testado, reusa o mesmo helper depois; nota de fatura/Pluggy (`engine.js:8377`) — não deve deduplicar igual.

## Design — 3 unidades isoladas

Princípio: o que é compartilhado vira helper puro único (DRY), igual fizemos no fallback (sanitize/prompt).

### 1. `src/services/text-similarity.js` (novo — primitivas puras compartilhadas)
Extrai **verbatim** as primitivas que hoje vivem inline no caminho de dedup de tarefa (`engine.js`): `normalizeForSim`, `stripVerbPrefix`, `jaroWinkler`, `keywordOverlap`. Sem I/O — string→número/string. Passam a ser consumidas tanto pela dedup de tarefa quanto pela de nota.
**Risco controlado:** extrair toca o caminho de tarefa que funciona → **teste de fixação** (golden capturado ANTES da extração sobre um corpus de pares de tarefa, asserta `detectDuplicateSemanticTask` idêntico depois). Mesma disciplina do refactor do `claude.js`.

### 2. `src/services/note-dedup.js` (novo — scorer puro + 1 query)
- `scoreNoteSimilarity(candidate, existing) → number` — **puro**, usa as primitivas; combina similaridade de título normalizado + overlap de keywords do corpo.
- `findDuplicateNote(supabase, collaboratorId, {title, body}) → nota|null` — consulta notas **não-arquivadas do mesmo dono** (`collaborator_id`, `archived=false`), pontua cada uma com `scoreNoteSimilarity`, retorna a melhor acima do limiar (ou null). Limiar inicial espelhando o de tarefa (`probable`: score ≥ 0.95 com sinal compartilhado, ou > 0.85 com 2+ keywords), **tunável**. O único I/O é a query; o scoring é puro e testável.

### 3. Hook no engine (`engine.js:9567`, handler do `NOTE_ACTION` create)
Antes do `notesService.createNote(...)`:
- `const dup = await findDuplicateNote(supabase, collab.id, {title, body})`
- **Sem dup** → cria como hoje.
- **Com dup** → NÃO cria; grava `pending_intent` (`kind:'note_append'`, com `{existing_note_id, blocked_title, blocked_body}`); retorna sinal de integridade `{type:'dup_note', severity:'soft', existing}` pra prosa do TOM avisar "essa lista já existe: […]. Quer que eu adicione os itens novos?".
- **Erro na dedup** → **não-fatal**: cai pro create normal (espelha o `catch` da dedup de tarefa em `engine.js:4811`). Nunca bloquear nota legítima por erro de query.

### Resolução do "anexar"
Quando o usuário confirma ("pode anexar"), o `pending_intent` resolve (mesma máquina de auto-resolve da Sprint 30.3) → `appendToNote(existing_note_id, blocked_body)` (função **já existente** em `notes.js`). O `pending_intent` garante que o conteúdo novo não se perca entre turnos.

⚠️ **Pré-requisito de banco:** se usar um `kind` novo (`note_append`), a **CHECK constraint** de `pending_intents` precisa incluí-lo via migration **ANTES** de usar — senão o insert do intent falha em silêncio (`openIntent` retorna null sem throw) e vira "confirma mas não anexa". Alternativa: reusar um `kind` já permitido. Ref: `FIN-INVOICE-INTENT-KIND-CONSTRAINT` (drift código-vs-DB já mordeu antes).

## Data flow

```
NOTE_ACTION create
  → parseNoteActionMarker (note-marker.js)
  → handler engine.js:9549
  → findDuplicateNote(supabase, collab.id, {title, body})        [NOVO]
       ├─ null  → notesService.createNote(...)            (igual a hoje)
       └─ nota  → NÃO cria
                 → pending_intent {note_append, existing_id, blocked_body}
                 → integrity {type:'dup_note'} → TOM avisa + oferece anexar
  → (usuário confirma) → resolve intent → appendToNote(existing_id, blocked_body)
```

## Error handling
- `findDuplicateNote` lança → log + segue pro create (não-fatal).
- `appendToNote` na resolução lança → TOM avisa honesto que não conseguiu anexar (sem prometer falso), mantém o `pending_intent` pra retry.
- Dono é SEMPRE `collab.id` do remetente, nunca do marker (regra de dado sensível no caminho service_role).

## Testing
- **TDD `text-similarity.js`** — unit nas primitivas extraídas.
- **Teste de fixação** — `detectDuplicateSemanticTask` produz saída idêntica pré/pós extração (corpus de pares de tarefa).
- **TDD `note-dedup.js`** — `scoreNoteSimilarity`: pega o C7 ("Lista de compras" vs "Lista de compras — mercado"); **não** pega notas legítimas parecidas ("Reunião 12/06" vs "Reunião 19/06", "Ideias projeto A" vs "Ideias projeto B").
- **Teste de integração no engine** — com uma nota duplicada presente, o handler `NOTE_ACTION` create **não insere** + emite `integrity dup_note` (prova provider-agnóstica; **o harness de modelos NÃO cobre isto** — ele compara texto e não executa markers, então a trava se prova no engine, não no harness).
- **Smoke real** — enviar um create duplicado via fluxo real com nota descartável; confirmar bloqueio + oferta de anexar; confirmar append.
- `node --check` + `node --test` verdes nos arquivos tocados.

## Riscos e mitigações
| Risco | Mitigação |
|---|---|
| Extrair primitivas altera a dedup de tarefa | Extração verbatim + teste de fixação (golden antes/depois) |
| Falso "já existe" em nota legítima | Custo baixo (comportamento A = pergunta, não bloqueia); limiar tunável; TDD com casos negativos |
| Append perde conteúdo entre turnos | `pending_intent` guarda o conteúdo bloqueado |
| Dedup derruba create por erro de query | `catch` não-fatal → cria normal |
| Novo `kind` de pending_intent sem migration da CHECK constraint | Intent não grava em silêncio → "confirma mas não anexa". Migration do `kind` ANTES de usar (ou reusar kind existente). Ref `FIN-INVOICE-INTENT-KIND-CONSTRAINT` |

## Critérios de sucesso
1. `text-similarity.js` extraído, primitivas testadas, **dedup de tarefa inalterada** (fixação).
2. `note-dedup.js` com scorer puro testado (C7 pega; falsos-positivos não) + `findDuplicateNote`.
3. Hook no `engine.js:9567`: dup → não cria + `pending_intent` + integrity; sem dup → cria igual; erro → não-fatal.
4. Anexar resolve via `appendToNote` na confirmação.
5. Teste de integração prova nota dup **não inserida** (independe do modelo).
6. `node --check`/`node --test` limpos; caminho de tarefa intacto.
