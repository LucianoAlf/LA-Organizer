# 📌 AUDITORIA DO TOM (27/07/2026) — PONTO DE ENTRADA

> **Se você é um chat/agente novo neste projeto: comece por aqui antes de propor qualquer mudança no TOM.**
>
> 👤 **Alfredo (auditor cruzado):** seu briefing é o **[Briefing Alfredo — 02/08](2026-08-02-briefing-alfredo.md)** (papéis, regras do jogo e o plano da fatia Agenda). Leia este README depois dele.

## Decisão vigente (Alf, 27/07/2026)

1. **FEATURE FREEZE.** Nenhuma feature nova. Pedido de feature (do Alf ou do time) → **dizer NÃO** e oferecer o caminho que já existe.
2. **NADA DE MICROAJUSTE.** O Alf recusou explicitamente a estratégia de "correções pontuais baratas que mexem na raiz" — palavras dele: *"a gente vai fazer mais um microajuste, aí mais um detalhezinho... 'isso aqui é barato, mexe na raiz' e continua quebrando. Assim não vai resolver."* Ele está certo: o histórico são **391 known-issues corrigidos** e o sistema seguindo instável.
3. **REFATORAÇÃO GRANDE E FATIADA.** Pegar as funcionalidades **uma por uma**, com etapas bem definidas, e refatorar de verdade — não remendar. O `engine.js` (14.671 linhas, `processMessage` com 4.587, **zero testes internos**) é o alvo central: *"perdeu o controle"*.
4. **Provável agente novo no Hermes**, construído em paralelo ao TOM (que segue rodando), com testes controlados por funcionalidade e migração das mais usadas primeiro. O **Alfredo** (que domina OpenClaw/Hermes e construiu os outros agentes que funcionam bem) entra como revisor/contraponto.
5. **Recesso escolar é real** e explica parte da queda de engajamento — **mas não toda** (avaliação do Alf).

## Os documentos (leia nesta ordem)

| # | Documento | O que tem |
|---|---|---|
| 1 | **[SÍNTESE](2026-07-27-auditoria-tom-SINTESE.md)** | **Comece aqui.** O que funciona, o que quebra, causas-raiz e plano. |
| 2 | [Parte 1 — Dados](2026-07-27-auditoria-tom-parte1-dados.md) | Uso × falha medidos em produção; queda de engajamento; reincidência por família |
| 3 | [Fatia A — engine.js](2026-07-27-fatia-A-engine.md) | Mapa estrutural do monolito, pontos de quebra, proposta de fatiamento |
| 4 | [Fatia B — skills/soul](2026-07-27-fatia-B-skills-soul.md) | Divergências entre o que o prompt ensina e o que o código aceita; skills órfãs |
| 5 | [Fatia C — caminho da mensagem](2026-07-27-fatia-C-caminho-mensagem.md) | Entrada, filas, provedor de IA, envio; pontos de perda e reentrada |

## O essencial em 6 fatos (com prova)

1. **A ação mais usada do sistema falha por não achar o alvo.** `TASK_UPDATE`: 411 usos/30d, 14,1% rejeitada; motivo campeão `all_failed` (36×). O resolver **rejeita tudo quando acha mais de uma candidata** em vez de perguntar (`engine.js:3852`). E **60% das tarefas pendentes têm título duplicado** (337/561; "marcar endócrino" tem 40 cópias).
2. **O prompt ensina ações que não existem no código** (`system.js:81` × `engine.js:172-177`): `DND_UPDATE` (o parser é `DND_SET`), `approve`, `deny`. Explica os 21 `schema_invalid`.
3. **Falha vira silêncio**: envio final sem `try/catch` (`engine.js:13024`) + **51 `catch` vazios** no engine + 10 no webhook.
4. **"Confirmei e não aconteceu"**: 30 `ACTIONABLE_NO_MARKER` em 30 dias, com textos que são literalmente respostas de confirmação (`"Isso"`).
5. **O financeiro é a área mais confiável** (1,3% de falha) **apesar de ter mais bugs históricos (57)** — porque é a única com **executor determinístico**. **É o modelo arquitetural a copiar, não a refazer.**
6. **Peso morto**: 18 das 64 skills (~25% das linhas) nunca são carregadas; `inventario.md` é citada no prompt mas nunca injetada.

## Ressalva registrada (não é para reabrir discussão)

A catraca havia recomendado 2 correções pontuais antes da refatoração (alinhar prompt↔código e desambiguar tarefa). **O Alf recusou** — e a razão dele é sólida. Fica **registrado como débito conhecido**: enquanto a refatoração não chega naquelas áreas, o TOM segue sendo ensinado a emitir 3 ações inexistentes e segue desistindo calado quando acha tarefas homônimas. **Quem for refatorar essas áreas deve resolver isso dentro da fatia**, não como remendo avulso.

## Estado técnico no momento da auditoria

- `_remote/` é **clone git** de `origin/main` (migração de 21/07); deploy = commit/push + VPS `reset --hard` + `pm2 restart`.
- Suíte: ~2.000 testes; baseline de ambiente local = 3 falhas (`system-loadout`, `pending-intents-detect`, `group-chat-tasks` — todas por falta de `.env`/`SUPABASE_URL` na máquina local).
- Produção: `TOM_CLAUDE_PARALLEL=1`, `CLAUDE_MODEL=sonnet`, `CLAUDE_TIMEOUT_MS=90000`, **`TOM_MAPA=0`** (montagem de prompt por intenção DESLIGADA — decisão pendente do Alf).
- Known-issues: tabela `tom_known_issues` no Supabase `cesnbnrynvxvgdhfmaua` (391 registros). **Todo bug começa consultando ela.**
