# Salvar nota VERBATIM (anti-truncação do corpo) — Design

**Data:** 2026-06-26 · **Status:** aprovado (determinístico + skill; cobre texto colado E referência a msg anterior)

## Problema
`<<NOTE_ACTION>>` create grava `body` **composto pelo LLM**. Em texto longo/estruturado (fechamento financeiro do Alf), o LLM **parafraseia e corta linhas** (cortou "…e mais 468…" e "Maior alavanca…"). Mesma classe do `GROUPCHAT-DOC-FATURA-FX`, resolvido com **corpo determinístico**. O `Formatar com o TOM` foi inocentado (testado, preserva 100%); a perda é no SALVAR.

## Decisão
**Determinístico + skill.** Quando o usuário manda guardar um conteúdo que JÁ EXISTE (colado na mensagem OU numa mensagem anterior), o corpo da ficha vira o **texto-fonte original inteiro**, não a reescrita do LLM. O LLM só escolhe o **título** e sinaliza `verbatim`. Nota curta digitada na hora ("anota: comprar leite") segue composta pelo LLM (não há fonte pra truncar).

## Mecanismo
1. **Marker:** `<<NOTE_ACTION>>{action:"create", title, body, verbatim:true}`. O LLM seta `verbatim:true` quando o usuário quer guardar conteúdo fornecido/referenciado; `body` = melhor cópia dele (o motor reconcilia pro original exato).
2. **Engine (quando `verbatim===true`):**
   - Monta **candidatos de fonte**: `[text]` (mensagem atual do usuário) + últimas K mensagens de `conversation_history` do colaborador (texto COMPLETO do banco — não a versão truncada do prompt), ambas as direções.
   - `pickVerbatimSource(llmBody, candidates)` → escolhe o candidato com maior **contenção** do corpo do LLM (fração dos tokens do `body` presentes no candidato) ≥ limiar (~0.6). É a fonte que o LLM estava copiando.
   - Achou fonte → `body = stripSaveCommand(fonte)` (remove só linhas de comando "salva isso/guarda/anota/com o nome…" nas BORDAS; conteúdo no meio nunca é tocado). É o original COMPLETO.
   - Não achou (< limiar) → **fallback** pro `body` do LLM (comportamento de hoje). Seguro.
3. **Skill `anotacoes.md`:** instruir — ao guardar texto colado ou referenciado ("guarda isso", "salva o que você mandou", "anota aquele relatório"), setar `verbatim:true` e copiar o conteúdo no `body` (o motor garante o original exato). Anti-confab inalterado.

## Helpers puros (`src/services/verbatim-note.js`, TDD)
- `normalizeForMatch(s)`: lowercase, NFD sem acento, colapsa espaço, remove pontuação/emoji (só p/ comparar).
- `containmentRatio(body, source)`: fração dos tokens (de `body`) presentes em `source` (0..1).
- `pickVerbatimSource(llmBody, candidates, {threshold=0.6})`: `{text, score, index}` do melhor candidato ≥ threshold, senão `null`.
- `stripSaveCommand(text)`: remove linhas de comando nas BORDAS (regex conservadora: `salva|guarda|anota|com o nome|por favor|nas (minhas )?anota…`), nunca no meio. Devolve o conteúdo.

## Integração engine
No ramo create do handler NOTE_ACTION (engine.js ~9912, antes do `createNote`): se `a.verbatim`, buscar candidatos + `pickVerbatimSource` + `stripSaveCommand`; usar como `body`. `logMarker` registra a fonte escolhida (`verbatim:src=current|history|none`) p/ telemetria honesta.

## Fora de escopo
- Anexar (append) verbatim — v1 só create (append é menos sujeito; estender depois se precisar).
- Multi-fonte (juntar 2 mensagens) — não.
- Grupo (`<<GROUP_NOTE>>`) — o grupo já tem corpo determinístico no caminho de doc (fatura/FX); 1:1 é o gap. v1 = 1:1 (`NOTE_ACTION`).

## Zero-regressão
- `verbatim` ausente/false → caminho idêntico ao de hoje (LLM body). Só ativa com a flag.
- Fallback quando nenhuma fonte casa → LLM body. Nunca pior que hoje.
- Helpers puros, TDD. Anti-confab (`sanitizeOptimisticConfirm`) e dedup intactos.
