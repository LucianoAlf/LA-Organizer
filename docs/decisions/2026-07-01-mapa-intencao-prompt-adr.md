# ADR — "O Mapa": montagem de prompt por intenção no TOM

**Data:** 2026-07-01
**Status:** 🟢 ATIVO / EM TRANSIÇÃO (design aprovado → implementação faseada)
**Decisor:** Alf (Luciano) · **Executor + catraca:** chat de revisão

---

## ⚠️ LEIA PRIMEIRO SE ALGO QUEBROU

Se você é um chat (este ou qualquer outro) investigando, a partir de **01/07/2026**, qualquer um destes sintomas no TOM:
- latência estranha, "TOM lento" ou "rápido demais / pulou etapa"
- prompt / skill / contexto se comportando diferente
- "TOM ficou burro", ignorou pedido, respondeu papo quando era tarefa (ou vice-versa)
- voz/tom diferente do de sempre
- fallback pro Codex, timeout, Claude morto

→ **Provavelmente está relacionado a ESTA decisão. NÃO trate como bug isolado antes de ler isto.** A causa provável não é um bug novo — é uma virada de arquitetura que fizemos de propósito. O fio pra puxar (rollback) está no fim deste documento.

---

## Contexto — a zona de conforto que abandonamos

O TOM **funciona e todo mundo gosta** do que ele faz. Mas duas dores reais:

1. **Latência.** A resposta é *output-bound* (~100 tok/s), e há um **floor de ~80KB de contexto sempre-ligado** (histórico de 30 msgs + ~24 blocos de banco) que pesa em TODA mensagem, até no "fala Tom". No cache frio isso dói. "Fala Tom" levando 25-30s irrita — pra um agente conversacional, é inaceitável.
2. **Burrice de formato.** O prompt inchado (uma skill inteira + 24 blocos de DB, sempre) às vezes **atropela o pedido explícito do usuário**. Caso-âncora (01/07): Alf pediu uma lista numerada de nomes + grade; recebeu só a grade-resumo. **Provado:** o MESMO modelo (Sonnet 5), com prompt ENXUTO, fez a lista numerada 1-71 perfeita; com os 132KB de produção, errou. O modelo é capaz — o prompt inchado o desvia.

**Raiz única das duas:** a montagem do prompt é **cega** — carrega tudo, independente do que a mensagem precisa.

Estávamos na zona de conforto de **consertar um bug por dia**. Decisão do Alf (01/07): **sair dela, de forma responsável**, por um TOM mais **ágil, inteligente, humano e conversacional** — **sem perder nenhuma habilidade que ele já tem e que funciona.** Coragem com rede de segurança, não imprudência.

---

## A decisão — "O Mapa"

Montagem de prompt **dirigida por intenção**. Um classificador (`classifyIntent`, função pura/testável) decide, por mensagem, **o que entra no prompt** (qual skill + quais blocos de contexto). 
- **Papo** → prompt mínimo (só a voz + histórico curto) → 2-4s.
- **Tarefa** → só o contexto/skill que aquela intenção precisa → rápido **e** o pedido do usuário não é afogado.

Faseado (cada fase = spec + plano próprios, com catraca/TDD/zero-regressão):
- **Fase 1:** fast-path conversacional. Tabela de loadout com 2 linhas: `conversational` (mínimo) e `operational` (= caminho de HOJE, byte a byte). Gated por flag.
- **Fase 2:** contexto preguiçoso por intenção (corta o floor de 80KB pra todos).
- **Fase 3:** dieta + des-prescrição das skills gigantes (mata a burrice de formato) + limpeza do AGENTS stale ([[project_agents_stale_operational]]).

**A voz (SOUL.md) NÃO se toca.** Foi auditada (01/07) e está sólida. O inchaço está no contexto sempre-ligado e nas skills, não na personalidade.

**Meta de latência acordada:** 2-3s conversacional. Sub-segundo ("estilo Alfredo") NÃO é meta — exigiria trocar o CLI `claude` pela API (decisão de custo separada, fora de escopo agora).

---

## Mudanças de infra que PRECEDERAM o mapa (01/07) — suspeitos nº1 se algo quebrar

No mesmo dia, pra atacar latência/timeout, ligamos (tudo reversível por env no `.env` da VPS + `pm2 restart tom`):

| Mudança | De → Para | Env |
|---|---|---|
| Modelo | alias `sonnet` (4.6) → Sonnet 5 | `CLAUDE_MODEL=claude-sonnet-5` |
| Paralelismo CLI | serial → K=2 | `TOM_CLAUDE_PARALLEL=1` |
| Keep-alive do CANON | inexistente → ativo (evita token morrer de madrugada; regressão 20/06) | `TOM_CANON_KEEPALIVE_*` |
| Timeout | 45s → 60s | `CLAUDE_TIMEOUT_MS=60000` |

---

## Se quebrar — o fio pra puxar (rollback responsável, em segundos)

Cada peça é **independente e reversível** no `.env` da VPS (`/opt/LA-Organizer/.env`) + `pm2 restart tom`. Backups: `.env.bak-*` na VPS.

- **Mapa desviou msg errado / papo-vs-tarefa furou** → `TOM_MAPA=0` (volta 100% pra montagem de hoje).
- **Latência/fallback pro Codex voltou, ou Claude morto de madrugada** → `TOM_CLAUDE_PARALLEL=0`.
- **Voz destoou / "não parece o TOM"** → `CLAUDE_MODEL=sonnet` (volta pro 4.6).
- **Cortou caso legítimo demais (muito fallback)** → `CLAUDE_TIMEOUT_MS=45000`.

Regra: reverter é **responsável**, não derrota. Reverte, registra o que quebrou aqui e no `tom_known_issues`, e a gente reavalia o rumo. O objetivo é um TOM melhor — não um TOM diferente por diferença.

---

## Onde está o resto
- **Spec:** `docs/superpowers/specs/2026-07-01-mapa-intencao-prompt-design.md`
- **Plano:** `docs/superpowers/plans/2026-07-01-mapa-intencao-prompt.md` (após writing-plans)
- **Memórias:** `project_mapa_intencao_prompt`, `project_paralelismo_cli_fase0`, `project_motor_tom_sonnet_vs_gpt55`, `project_agents_stale_operational`
