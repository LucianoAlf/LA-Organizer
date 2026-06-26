# Proposta — Matheus: briefing lista tarefa futura como "hoje" (auditoria 26/06)

> Documento auto-contido pro revisor (catraca). Pino já cravado no código real; quero contraponto antes de codar.

## Causa-raiz (cravada)

O briefing matinal (`sendRitual('daily_briefing')` → `buildSystemPrompt` → `ai.chat`) é **renderizado pelo LLM** a partir de `ctx.workTasks`/`ctx.personalTasks`. Essas listas vêm da query de contexto (`system.js` ~1432/1442):
```js
.eq('assigned_to', id).lte('due_date', next7days).eq('context', 'work')   // janela de 7 DIAS
.not('status', 'in', '(done,cancelled)')
```
→ traz tarefas dos **próximos 7 dias** (correto pro chat: "o que tenho essa semana"). O briefing (`system.js` ~2745-2748, `rt === 'briefing_diario'`) passa essas listas **inteiras** ao LLM **sem filtrar pra hoje**. O `buildContext` rotula cada tarefa `(HOJE)`/`(em Nd)`, mas o LLM **ignorou o rótulo** e listou a futura como hoje.

**Contraste que confirma o furo:** o **fechamento** já corta futuras deterministicamente (`engine.js` 11618-11620, Balde A / caso Quintela):
```js
const _closingPool = (ctx.workTasks||[]).filter(t => !t.due_date || String(t.due_date) <= _todayYmd);
```
O briefing **não tem** esse filtro.

## Evidência (Matheus, 25/06)
Tarefa `Falar com a Bia sobre a mentoria` → `due 2026-06-29` / `remind 29/06 13:00` (segunda). O briefing de **25/06** listou "TRABALHO · hoje: 1. ⏰ 13h — Falar com a Bia". O Matheus estranhou ("Falar com a Bia HOJE?") e o TOM admitiu: *"o briefing mostrou errado... é segunda (29/06)"*. (O `EVENT "REUNIAO COM A BIA"` 29/06 NÃO vazou — `todayEvents` já é filtrado; só as **tarefas** vazam, pela janela de 7d.)

## ⚠️ ACHADO dos 2 checks que o revisor pediu (muda o cutoff)

**Check de escopo:** além dos 3 briefings (2741/2744/2747), só o `allTasks` (2845) lê `ctx.*Tasks` cru — mas é `inferActiveThread` (resolução de pronome, INTERNO), não conta/lista tarefas no texto. 3742/3745 é só log. → filtro só em `tasksForCtx`, **sem tocar `ctx.workTasks`** (o activeThread precisa da lista completa). ✅

**Check da skill (`rituais-diarios.md`):** NÃO há seção separada de "próximos dias", **MAS** a skill define `⏳` = "vence amanhã / muito próxima" **inline** na lista de hoje (l.56/75; exemplo l.162 "⏳ Material teatro — vence amanhã"). O briefing **intencionalmente mostra o que vence amanhã** como heads-up. → `due <= hoje` (do fechamento) **regrediria** isso. Cutoff certo pro briefing = **amanhã**.

## Fix proposto (ajustado — predicado único, cutoff parametrizado)
Predicado puro compartilhado (trava #2 do revisor), reusado pelo fechamento E pelo briefing com cutoff diferente:
```js
// lib pura
function isVisibleForDay(t, cutoffYmd) { return !t || !t.due_date || String(t.due_date) <= cutoffYmd; }
```
- **Fechamento** (engine 11620): passa a chamar `isVisibleForDay(t, todaySaoPaulo())` — cutoff = HOJE (comportamento atual preservado).
- **Briefing** (system.js ~2741/2744/2747): `cutoff = amanhã` (todaySaoPaulo()+1 em BRT) — corta +2d (a Bia de 29/06 sai) mas mantém hoje+atrasadas+**amanhã (⏳)**+sem-due:
```js
const _briefCutoff = tomorrowSaoPaulo(); // YMD BRT de amanhã (mesma família do next7days/fechamento — NUNCA UTC)
tasksForCtx = { personal: ctx.personalTasks.filter(t => isVisibleForDay(t, _briefCutoff)),
                work:     ctx.workTasks.filter(t => isVisibleForDay(t, _briefCutoff)) }; // idem nos 3 ramos
```
Fonte de "hoje/amanhã" = `todaySaoPaulo()` (system.js:240) — trava #1, sem fuso UTC. Tira a dependência do LLM acertar; provider-agnóstico.

## Análise de risco / regressão
- **Atrasadas (due < hoje) DEVEM continuar aparecendo** — o filtro é `due <= hoje`, não `due == hoje`. ✓
- **Sem-due DEVEM aparecer** (tarefa sem prazo) — `!due_date` passa. ✓
- Corta só **futuras** (due > hoje). A Bia (29/06) sai do briefing de hoje.
- **Escopo:** o mesmo furo existe nos irmãos `briefing_pessoal` (2740) e `briefing_trabalho` (2742) — passam as listas sem filtro. Proponho aplicar o mesmo `_briefVis` nos três (o `fechamento` já está coberto no engine; não tocar). Confirmar com o revisor se inclui os 3 agora ou só o `briefing_diario` (o caso real).
- O briefing é "do dia" — não mostra "essa semana", então cortar futuras não perde nada que ele deva exibir (as de 7d seguem no chat normal).

## Plano de teste (TDD)
- Helper puro `briefingVisibleTasks(tasks, todayYmd)` (ou reusar a regra do fechamento): hoje→passa; atrasada→passa; sem-due→passa; futura→corta.
- Smoke/VPS com o caso Matheus (Bia 29/06 não aparece no briefing de 25/06; uma tarefa de hoje aparece).
- `.deploy-hold` no ciclo + KI (ex.: `BRIEFING-FUTURE-TASK-AS-TODAY`).

## Perguntas pro revisor
1. Filtro nos **3** briefings (diario/pessoal/trabalho) ou só no `briefing_diario`?
2. `todayISO_main` está disponível no escopo do filtro (system.js ~2826 calcula depois)? Se não, uso `todaySaoPaulo()` — confirmar a fonte única de "hoje" pra não reintroduzir fuso.
3. Algum briefing que **deva** mostrar futuras (ex.: "amanhã você tem X")? Se sim, é seção separada, não a lista de "hoje" — confirmar.
