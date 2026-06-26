# Proposta — Jhonatan: PREFS/DND marker errado → confab "fico quieto" (auditoria 26/06)

> Documento auto-contido para o revisor (catraca) avaliar contrapontos **antes** de codar.

---

## Contexto mínimo

O TOM pausa notificações ("fico quieto / não perturba") via um marker dedicado **`<<DND_SET>>`** — `{ until: ISO, reason? }`, com **validação** (futuro + **cap de 24h**, `parseDndMarker` engine ~3322-3364). Há também o `<<PREFS_UPDATE>>` (briefing, intensity, quiet hours, etc.). O parser do PREFS **dropa de propósito** os campos `do_not_disturb_until/_reason` (engine 3903-3908, `use_DND_SET_marker_instead`) porque um path antigo setava DND **sem cap** → bug "Jhonatan pausado até julho". Esse drop está **certo**; não mexer nele sem preservar o cap.

## Causa-raiz (evidência)

Jhonatan (25/06 23:42, turno caiu no **Codex** por Claude timeout 23:41) pediu "joga pra amanhã **e não perturba ninguém hoje**". Markers do turno:
- `TASK_UPDATE executed ok=1` → moveu a tarefa (**sucesso real**)
- `PREFS_UPDATE rejected schema_invalid` → a config de silêncio **falhou**

O payload do PREFS (raw_excerpt):
```json
{"do_not_disturb_until":"2026-06-26T11:00:00Z","do_not_disturb_reason":"silêncio solicitado pro resto do dia"}
```
→ o LLM emitiu o **marker errado** (`PREFS_UPDATE` com campos de DND, em vez de `<<DND_SET>>`). O parser dropa os 2 campos → `update` vazio → `malformed` → `schema_invalid`. O TOM disse *"Movi pra amanhã e **fico quieto** pro resto da noite"* — `fico quieto` é falso (DND não aplicou). Confab.

> Nota: o valor `2026-06-26T11:00:00Z` está a ~8h no futuro → **passaria** no cap de 24h do DND. Ou seja, era um pedido legítimo, só roteado pelo marker errado.

## Por que o chokepoint não pegou
`nothingPersisted = !marker_emitted`. O `TASK_UPDATE` **persistiu** no turno → `nothingPersisted = false` → a Camada 1 não dispara. Esta é uma **classe nova**: confab de **falha PARCIAL** (N markers, alguns falham) que o chokepoint binário não cobre.

## Patch proposto — Camada 1 (raiz): rotear DND-via-PREFS, reusando a validação

1. **Extrair** a validação do DND numa função pura `validateDndWindow({ until, reason })` → `{ ok:true, until, reason }` (com **cap 24h** + futuro) ou `{ ok:false, code }`. Refatorar `parseDndMarker` pra usá-la (sem mudar comportamento — TDD de paridade).
2. No parser do PREFS (3903), trocar o **drop** por **roteamento**:
   ```js
   } else if (k === 'do_not_disturb_until') {
     const r = validateDndWindow({ until: v, reason: parsed.do_not_disturb_reason });
     if (r.ok) dnd = { until: r.until, reason: r.reason };   // rota pro DND, COM cap
     else dropped.push(`${k}:${r.code}`);
   } else if (k === 'do_not_disturb_reason') {
     /* consumido junto com until — não dropa, não é "unknown_field" */
   }
   ```
   Retornar `dnd` no objeto; `malformed` só se `update` vazio **E** sem `dnd`.
3. No handler do PREFS (9544+): se `parsedPrefs.dnd`, chamar `applyDnd(collab, parsedPrefs.dnd)` (mesma função do `<<DND_SET>>`) além do `applyPrefsUpdate` do resto.

**Efeito:** o pedido do Jhonatan vira DND real (cap aplicado) → "fico quieto" passa a ser **verdade**, sem confab. Provider-agnóstico (resolve no engine, independe de Claude/Codex).

## Análise de risco / regressão
- **NÃO reintroduz "pausado até julho"**: o roteamento passa pela MESMA `validateDndWindow` (cap 24h + futuro). Esse é o ponto-chave que peço ao revisor pra cravar.
- Borda: PREFS com `do_not_disturb_until` **+** outros campos válidos (ex. `coaching_intensity`) — aplica os dois (update normal + applyDnd). Conferir que ambos persistem.
- `do_not_disturb_reason` sem `until` → hoje cai em `unknown`/drop; proposta ignora (sem until não há janela). Confirmar que não vira `malformed` sozinho.

## Camada 2 (sanitize na falha) — NÃO copiar o NOTE cegamente
O handler do PREFS (9541) tem o **mesmo gap** do NOTE de ontem (pega `cleanText` cru). **MAS** sanitizar aqui é arriscado: a reply do Jhonatan **mistura** `Movi pra amanhã` (TASK ok = verdade) + `fico quieto` (PREFS falho). `sanitizeOptimisticConfirm('failed')` removeria **as duas** (`movi` casa o `COMPLETION_CORE`) → apagaria a verdade do TASK. É o problema da **falha parcial** — precisa de abordagem por-ação, não por-reply. **Recomendo NÃO mexer no sanitize do PREFS agora** (a Camada 1 já tira a confab deste caso) e tratar "confab de falha parcial" como item próprio, com brainstorm.

## Plano de teste (TDD)
- `validateDndWindow`: futuro→ok; passado→`not_future`; >24h→capped; bad ISO→`bad_iso`. (paridade com o comportamento atual do `parseDndMarker`).
- parser do PREFS: `{do_not_disturb_until: <+8h>}` → retorna `dnd` (não malformed); `+48h` → `dnd` capado a 24h; só `do_not_disturb_reason` → não vira dnd nem quebra; `do_not_disturb_until` + `coaching_intensity` → ambos.
- E2E/VPS + KI (ex.: `PREFS-DND-ROUTE` ou `DND-VIA-PREFS-DROPPED`). `.deploy-hold` no ciclo.

## Perguntas pro revisor
1. O roteamento via `validateDndWindow` fecha 100% o risco "pausado até julho", ou há caminho que escape o cap?
2. Camada 1 (roteamento, durável) sozinha, ou Camada 1 **+** reforço de prompt (ensinar o LLM a usar `<<DND_SET>>`)? Pelo padrão de ontem, prompt sozinho vaza — mas vale pra log limpo?
3. Concorda em deixar "confab de falha parcial" (sanitize por-ação) como item separado, fora desta proposta?
