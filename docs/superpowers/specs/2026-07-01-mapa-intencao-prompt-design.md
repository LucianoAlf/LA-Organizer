# O Mapa — Montagem de Prompt por Intenção (Design)

**Data:** 2026-07-01 · **Status:** aprovado (design) → writing-plans
**Contexto/decisão durável:** `docs/decisions/2026-07-01-mapa-intencao-prompt-adr.md`

## Objetivo

Trocar a montagem de prompt **cega** do TOM (carrega tudo em toda mensagem) por uma montagem **dirigida por intenção**, matando latência conversacional e a "burrice de formato" — **sem perder nenhuma habilidade atual e sem tocar a voz (SOUL)**.

## Problema (medido em 01/07)

- Prompt de **80-145KB por mensagem**. `skill:none` já é ~80KB. A voz (SOUL+AGENTS) = só 10,7KB. O resto (~70KB) é **contexto sempre-ligado**: histórico de 30 msgs + ~24 blocos de DB (`fetchCollaboratorContext`), carregados até no "fala Tom".
- Latência é **output-bound** (~100 tok/s); mas o prompt gordo dói no **cache frio** (msg após pausa >5min) e **afoga o pedido do usuário** → o modelo segue o formato da skill em vez do que foi pedido. Provado: mesmo Sonnet 5, prompt enxuto → lista numerada 1-71 perfeita; 132KB de produção → só grade-resumo.
- Raiz única: **a montagem não olha o que a mensagem precisa.**

## Arquitetura — o Mapa

```
msg → classifyIntent(texto, históricoRecente) → { intent, loadout }
    → assembleByLoadout(loadout)  // monta SÓ o que o loadout pede
    → claude.chat → parsing de markers (INALTERADO)
```

Três peças novas + um gate:

### 1. `classifyIntent(text, recentHistory)` — função PURA (novo módulo `src/prompts/intent-map.js`)
- Retorna `{ intent: string, loadout: Loadout }`.
- **Heurística determinística** (regex/sinais), NÃO chama LLM (round-trip mataria o ganho). Mesma família do `pickSkill`.
- **Fase 1 — 2 intenções:**
  - `conversational` — saudação, agradecimento, reação, afirmação curta sem ação ("essa lista é X", "bom dia", "valeu", "beleza"), sem verbo de ação/tarefa, sem `?` sobre dado, sem mídia/áudio.
  - `operational` — **default/fallback**: qualquer verbo de ação (criar, fechar, reagendar, delega, cobra…), pergunta sobre dado do sistema, referência a tarefa/projeto/evento, áudio, mídia, reply-quote, ou **qualquer dúvida** → operational.
- **Precisão primeiro:** na menor dúvida → `operational`. Falso-conversational é o único erro que degrada (usuário recebe papo e reformula); falso-operational só perde o ganho de latência, sem dano.

### 2. Tabela de loadout (o "mapa") — dado declarativo no mesmo módulo
```
const LOADOUTS = {
  conversational: { skill: null, contextBlocks: 'minimal', decompose: false },
  operational:    { skill: 'auto', contextBlocks: 'full',    decompose: 'auto' },
};
```
- `contextBlocks: 'minimal'` = só voz (SOUL+AGENTS) + histórico curto (ex.: últimas 8 msgs). SEM os ~24 blocos de DB.
- `contextBlocks: 'full'` = `fetchCollaboratorContext` de hoje, intacto.
- `skill: 'auto'` = `pickSkill` de hoje. `skill: null` = sem skill.
- Extensível: Fase 2 adiciona linhas com `contextBlocks` scoped (ex.: `['tasks']`).

### 3. Gate na montagem (`engine.js` / `system.js`, atrás da flag `TOM_MAPA`)
- Roda `classifyIntent` ANTES de `fetchCollaboratorContext`/`pickSkill`/decompositor.
- `operational` OU flag off → **caminho de hoje, byte a byte** (zero-regressão).
- `conversational` → monta prompt mínimo (voz + histórico curto), pula os 24 queries + skill + decompose.

### 4. Telemetria
- Log: `[Mapa] intent=<x> loadout=<y> promptChars=<n>` + reusar o `[AI] ... dur=` existente.
- Permite medir % de msgs no fast-path, latência antes/depois, e **auditar erro de rota** (conversational que era tarefa).

## Fluxo de erro / fallback
- `classifyIntent` lança/incerto → `operational` (seguro).
- Flag `TOM_MAPA` off → `operational` (100% hoje).
- Msg conversational que "deveria" ter contexto: responde só papo (ok pra papo); se o usuário emendar um pedido, a PRÓXIMA msg classifica `operational`. Sem fallback no meio do turno (mantém simples).

## Zero-regressão (o miolo da segurança)
- O ramo `operational` produz o **prompt idêntico** ao de hoje. **Golden test:** com `TOM_MAPA=1`, uma msg operational monta o mesmo prompt que com a flag off (mesma skill, mesmos blocos).
- Só `conversational` diverge — e diverge pra um prompt **mais enxuto porém com a voz completa**.
- Flag `TOM_MAPA` desliga tudo em 1s (`.env` + `pm2 restart`).

## Testes
- **TDD `classifyIntent` (puro):** saudação/agradecimento/reação/afirmação-curta → `conversational`; verbo de ação/tarefa/pergunta-sobre-dado/áudio/mídia/reply-quote/ambíguo → `operational`. Casos-armadilha reais (ex.: "essa lista é X" = conversational; "fecha o projeto X" = operational).
- **Golden de zero-regressão:** prompt operational com flag on == prompt com flag off.
- **Medição:** latência de msgs conversational antes/depois (meta 2-4s) + % fast-path.

## Faseamento
- **Fase 1 (esta spec):** classifier + tabela + gate + fast-path conversacional + telemetria. Entrega: papo em 2-4s, framework pronto.
- **Fase 2 (spec futura):** loadouts scoped por intenção operacional (contexto preguiçoso por tipo).
- **Fase 3 (spec futura):** dieta/des-prescrição das skills gigantes + limpeza do AGENTS stale.

## Fora de escopo (YAGNI)
- Classificador via LLM (round-trip mata latência).
- Trocar CLI `claude` → API (o teto do sub-segundo; decisão de custo separada).
- Reescrever/dietar skills (Fase 3).
- Mexer no SOUL (voz sagrada, auditada e sólida).

## Rollback
`TOM_MAPA=0` + `pm2 restart tom` → volta 100% pra montagem de hoje. Ver ADR pros outros flags de infra (Sonnet 5 / paralelismo / timeout).
