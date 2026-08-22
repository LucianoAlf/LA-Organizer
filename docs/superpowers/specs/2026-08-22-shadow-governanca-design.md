# Shadow test na governança — sonda-viva antes do carimbo

**Data:** 2026-08-22
**Autor:** catraca (chat) + Alf (decisões de desenho)
**Status:** design aprovado; pronto pra plano de implementação

## Problema

O agente de governança escreve TDD e roda a suíte, mas **não reproduz o turno real
pelo engine + LLM vivo depois de corrigir**. Teste determinístico prova o CÓDIGO;
não mede **qual marker o LLM escolhe** nem a fala final do TOM.

Provado hoje (22/08): o fix `T2H-ONEOFF-OFFER` passou no TDD e, no shadow test, com
tarefa limpa o LLM emitiu `TASK_TO_HABIT` → oferta honesta (2/2, correto). Mas em
variação de contexto o LLM emitiu `PREFS_UPDATE` e **confabulou "lembrete diário
ativado"** sem criar nada — e o chokepoint não pegou (um marker errado "deu certo").
Esse confab (`bad1c55e`) **só aparece com o LLM vivo**. É o gap que esta fatia fecha.

Lição-mãe: **fix determinístico verde ≠ comportamento correto em produção.**

## Decisões (Alf, 22/08)

1. **Gatilho:** a sombra roda em **fixados + promoções a KI** — dois portões de
   verificação antes de "carimbar corrigido".
2. **Veredito reprovado BARRA o carimbo** e reabre o finding com a evidência da sombra.
3. **Judge = agente SEPARADO do corretor, no Codex** (já é fallback do TOM →
   diversidade de modelo sem credencial nova). Grok/GPT novo fica pro passo 2, se provar.
4. **Irreproduzível → `inconclusivo` → NÃO barra** (cai no gate determinístico). A
   sombra só barra quando **reproduziu E reprovou**. Nunca dá falso-passe nem
   falso-bloqueio.
5. **Arquitetura A:** módulo de sombra dentro do gov-runner (mesmo processo), não um
   OS-process separado. A independência que importa é **papel + modelo** (judge no
   Codex, ≠ corretor), não processo físico — processo à parte é YAGNI e mais superfície
   de auth ([[project_dispatcher_flock_exit_trap]], [[project_relogin_so_metade_pool]]).

## Componentes

Três unidades puras/isoláveis + um ponto de plugue no `gov-runner`.

### `src/governance/shadow-reproducibility.js` (puro)
`isReproducible(finding) → { ok: boolean, motivo: string }`

Decide se o finding é encenável barato. **v1 aceita** quando o incidente é 1 fala do
usuário (ou troca de 2 turnos), categoria de turno curto (`confabulation`,
`dropped_request`), **sem** dependência de cron nem estado multi-dia. **Rejeita**
(→ `inconclusivo`) findings de grupo, cron (cobrança/ritual), fluxo multi-turno
(fatura, dup-menu encadeado). Conservador: na dúvida, `ok:false` (a sombra não finge
cobrir o que não cobre).

- Consome: `finding` (category, summary, evidence, incident_at, grupo?).
- Produz: `{ ok, motivo }`.

### `src/governance/shadow-runner.js` (determinístico, sem modelo)
`async runShadow(finding, { supabase, engine, whatsapp, turnClaim }) → transcript`

1. **Encena** o estado mínimo no perfil QA (`TOM_QA_PHONES`, faixa 5500): cria a
   tarefa/hábito/evento descartável que o cenário exige (`created_by` setado — é
   NOT NULL).
2. **Roda** o(s) turno(s) reais: `turnClaim.runInTurn({ qa:true }, () =>
   engine.processMessage(qaPhone, userText, {}))`, com `whatsapp.sendMessage`
   **stubado** (captura, não envia; ReplayLab bloqueia a faixa 5500 como 2ª barreira).
3. **Captura** por turno: `reply` (do stub), `markers` (`marker_logs` do intervalo),
   e o **persistido** relevante (habit/task/event criado/alterado).
4. **Cleanup** no `finally`: apaga tudo do QA por `collaborator_id`
   (`conversation_history`, `marker_logs`, `pending_intents`, `habits`+`habit_reminders`,
   `tasks`, listas). Cleanup é obrigatório mesmo em erro.

- Consome: `finding` + deps injetadas (testável).
- Produz: `transcript = { turns: [{ userText, reply, markers, persisted }], erro? }`.

> A derivação "finding → userText(s) + estado a encenar" mora aqui, guiada pelo
> `evidence`/`summary` do finding. v1: um extrator simples por categoria; findings sem
> fala clara caem em não-reproduzível (a `reproducibility` barra antes).

### `src/governance/shadow-judge.js` (Codex, papel separado)
`async judgeShadow({ finding, fixIntent, transcript }) → { verdict, reason }`

- **Entrada:** o que o finding dizia (o bug, `summary`/`evidence`) + **o que o fix
  deveria fazer** (`fix_resumo` do KI, quando pós-fix) + o `transcript`.
- **Pergunta ao judge:** *o comportamento observado é o CORRIGIDO, ou ainda é o bug?*
- **Saída (schema fixo):** `verdict ∈ {aprovado, reprovado, inconclusivo}` + `reason`.
- **Postura:** cético — só `reprovado` com evidência no transcript; na incerteza,
  `inconclusivo`. Roda no **Codex** (modelo ≠ Claude do corretor) e **não é** o
  corretor (independência de papel + modelo — princípio [[project_auditor_corretor_separacao]]).

## Fluxo

```
finding (fixado OU em promoção)
  └─ isReproducible?
       ├─ não  → verdict=inconclusivo (motivo) → NÃO barra → gate determinístico decide
       └─ sim  → runShadow → transcript → judgeShadow(Codex)
                    ├─ aprovado     → carimbo segue; anota o pass
                    ├─ reprovado    → BARRA o carimbo; reabre o finding;
                    │                 verified_note += evidência (reply+markers+reason)
                    └─ inconclusivo → NÃO barra; anota
```

## Integração no loop + ledger

`auditor → corretor → **shadow(run+judge)** → promotor`

- **Dois pontos de chamada** no `gov-runner`: (a) depois que o corretor aplica um fix,
  antes de marcar `corrigido`; (b) antes de promover um finding a KI.
- **Persistência do veredito:** grava a evidência no `verified_note` do finding
  (reply + markers + razão do judge, prefixado `[shadow YYYY-MM-DD]`) e emite um
  **marker `SHADOW`** (`aprovado`/`reprovado`/`inconclusivo` + motivo) pra telemetria
  — a curva de "quantos fixes a sombra reprovou" mede o valor da própria fatia.
  **Sem migration em v1** (reusa `verified_note` + `marker_logs`); coluna dedicada
  (`shadow_verdict`) é opção do plano só se a consulta pedir.
- **`reprovado` é o único caminho que bloqueia.** `inconclusivo` e `aprovado` deixam o
  fluxo seguir (o determinístico continua sendo o gate base).

## Segurança e custo

- **QA-only, sempre:** perfil faixa 5500, `sendMessage` stubado, ReplayLab bloqueia,
  cleanup garantido no `finally`. Nunca toca dado de gente real.
- **Custo:** só roda em fixados+promoções (não em todo finding). Teto de turnos por
  ciclo; se estourar, prioriza e **loga o que pulou** (nunca corta em silêncio —
  [[project_lote_parcial_nao_diz_quais]]).
- **Liveness:** qualquer erro do runner/judge degrada pra `inconclusivo` (não barra,
  não quebra o ciclo de governança) — freio-mestre.

## Testes + freios

- **Unit `shadow-reproducibility`:** classifica reproduzível vs não (casos: turno
  curto ✓; cron/grupo/multi-turno ✗).
- **Unit `shadow-runner`:** encena + captura reply/markers + **limpa** (deps
  mockadas ou QA real); prova que o `finally` limpa mesmo em erro.
- **Contrato `shadow-judge`:** schema do veredito (Codex mockado); postura cética
  (inconclusivo na dúvida).
- **Catraca de fonte:** o `gov-runner` chama a sombra nos 2 pontos e `reprovado`
  barra o carimbo (quebra se alguém desligar o gate).
- **Freios pinados por teste:** `inconclusivo` NUNCA barra · QA-only · cleanup
  garantido · erro → inconclusivo.

## Fora de escopo (v1)

- Replay integral de multi-turno a partir do histórico (caro/frágil) — fica pro
  passo 2 se os `inconclusivo` incomodarem.
- Judge no Grok/GPT-novo — passo 2, só se a diversidade do Codex provar insuficiente.
- Auto-correção a partir do `reprovado` — a sombra **barra e reabre**; quem corrige
  de novo é o corretor no próximo ciclo (mantém auditor ≠ corretor).

## Critério de pronto

O confab `bad1c55e` (PREFS_UPDATE "lembrete diário ativado" sem persistir), se
reproduzível, é **reprovado** pela sombra e o finding **não** recebe carimbo de
corrigido enquanto o comportamento ao vivo for o bug.
