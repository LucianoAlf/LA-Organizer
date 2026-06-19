# Design — Latência do TOM (investigação + combo de infra)

**Data:** 2026-06-19
**Tipo:** Investigação + design de combo (aprovado no brainstorm com o Alf). Próximo passo: plano de implementação.
**Status:** design aprovado · aguardando plano · **HOLD de deploy ativo** (não implementar/deployar sem tirar o hold).
**Gatilho:** msg da Juliana 19/06 14:08 — `[Prompt] size: 139783 chars` + `[AI] Claude respondeu em 46361ms` (~57s percebidos).

---

## Restrições do dono (Alf) — invioláveis nesta linha de trabalho

1. **NÃO mexer no comportamento, tom, jeito ou tamanho das respostas do TOM.** "O TOM tá perfeito." O combo é **100% infra/roteamento**. (Isso exclui: reduzir `max_tokens`, instruir brevidade, mexer em SOUL/skills de personalidade.)
2. **NÃO migrar pro modelo de custo por token (API SDK direta).** O TOM roda na assinatura Max (custo fixo); a equipe inteira "pendurada" numa assinatura não dá problema (validado pelo mentor Bruno). Trocar por custo-por-token é risco financeiro injustificado — ainda mais porque **o cache que justificaria a migração já existe** (ver abaixo).
3. Não tocar no Balde A (recorrência, sob observação).

---

## TL;DR — diagnóstico final (o que a investigação provou)

A lentidão **não** vem de onde a intuição aponta. Medições em produção + na VPS:

| Suspeito | Veredito | Evidência |
|---|---|---|
| Tamanho do prompt (140KB) | ❌ **inocente** | `corr(tamanho, duração) = 0,01`; 140KB de prompt processa em **+2s** (3,3s total no teste) |
| Falta de cache | ❌ **inocente** | o CLI `claude` **já cacheia** o system prompt (`cache_read=54K tokens` medido) |
| Geração de resposta longa | ❌ **inocente** | respostas do TOM são curtas: **p50=138 chars, p95=424**; a resposta da Juliana que levou 46s tinha **59 caracteres** |
| Conta/assinatura sobrecarregada | ❌ **inocente** | a conta aguenta concorrência (Bruno); a serialização é auto-imposta |
| **Overload/latência da API Anthropic (TTFT) + overhead do CLI** | ✅ **culpado (mensagem isolada)** | 59 chars em 46s só se explica por API lenta/retry; floor do CLI ~3-5s; 70 timeouts + 62 "exit" episódicos |
| **Fila serializada (`_claudeQueue`)** | ✅ **culpado (pico/rajada)** | mutex de 1-por-vez; toda msg espera atrás da anterior |

**Combo aprovado (100% infra):** (1) **paralelismo K=2** na fila · (2) **build assíncrono** do prompt · (3) **fail-fast conservador** (Claude padrão, Codex só no extremo).

---

## Como o prompt é montado (mapa)

`buildSystemPrompt(collaborator)` em [system.js:2588](../../../src/prompts/system.js):

```
blocks = [ BLOCK_RULES, BLOCK_IDENTITY, ctxBlock, organogramaBlock, skillBlock, projectStatusContextBlock ]
systemPrompt = blocks.join('---')  +=  LÍNGUA  +=  [role-gated]…  +=  [always-on]…  +=  [contexto]…
```

- Provider = **CLI `claude -p` headless** (spawn por mensagem), serializado por `_claudeQueue`, timeout 60s, fallback Codex/OpenAI. [claude.js](../../../src/ai/claude.js) · [provider.js](../../../src/ai/provider.js).
- O **history (30 msgs) NÃO está no systemPrompt** — vai no `userPrompt` via `-p`, truncado a 1000 chars/msg ([history-truncate.js](../../../src/utils/history-truncate.js)).
- O provider loga `[AI] Claude respondeu em ${duration_ms}ms` — `duration_ms` é spawn→close, **não** inclui espera na fila.

---

## Tarefa 1 — Composição do prompt (medido)

Mesmo sendo **inocente da latência**, o prompt é grande e vale documentar (custo/foco). Tamanhos reais (chars):

| Bloco | Chars | Gate | % equipe (31 ativos) |
|---|---:|---|---|
| `BLOCK_RULES` | 11.116 | sempre | 100% |
| `BLOCK_IDENTITY` + `LÍNGUA` | 2.806 | sempre | 100% |
| `configurar-preferencias` + `reagir-mensagens` + `coach-usabilidade` + `integridade-agenda` + `criar-compromisso` | 40.118 | sempre (aux) | 100% |
| **→ piso fixo always-on** | **~54.040** | **toda msg** | **100%** |
| `comunicados`+`eventos`+`aprovacao` | 16.918 | hasCoordLevel | **68%** (21) |
| `operacoes-tecnicas` | 10.595 | isOpsRole | 45% (14) |
| `pedagogico` | 7.397 | isPedagogicoRole | 42% (13) |
| `marketing` | 8.511 | isMarketingRole | 13% (4) |
| `coordenacao-conversacional` | 15.171 | keyword/hint | por-msg |
| skill primária (ex. `financeiro-pessoal`) | 17–26k | `pickSkill` | por-msg |

**Prompt da Juliana (139.783):** ~115KB (83%) é skill estática; ~24KB (17%) é contexto dinâmico. Ou seja, o prompt é dominado por corpos de skill. **Para a latência isso é irrelevante** (corr 0,01 + o CLI cacheia); só importaria para **custo de tokens** — e como o cache já cobre boa parte, o ganho seria pequeno. **Fora do escopo desta rodada.**

---

## Tarefa 2 — Caminho de latência (medido)

### Distribuição em produção (190 chamadas)
```
duration_ms:  p50=12,0s   p90=34,8s   p95=42,1s   max=116s   avg=16,2s
```

### Medição controlada na VPS (CLI real, mesmo ambiente do TOM)
| Cenário | duration_api_ms | output |
|---|---:|---|
| sem system prompt | ~2,4s | 4 tok |
| **system 140KB** (skills reais) | **~3,3s** (cacheado ~2,7s) | 4 tok |
| system 140KB + **geração de 1.300 tok** | **~28s** | 1.326 tok |

→ Prefill de 140KB custa **+1-2s**. O que escala o tempo é o **output** — mas em produção o output é pequeno (ver abaixo), então a geração **não** explica os casos lentos.

### Respostas reais do TOM (1.593, últimos 7 dias)
```
p50=138 chars   p90=350   p95=424   max=8619   (só 0,4% acima de 1500 chars)
```

### O caso Juliana, decomposto
- Resposta enviada: *"Boa! E foi quanto a manutenção? Se quiser registro o gasto."* — **59 chars** (~15 tokens).
- Chamada CLI: **46,4s** para gerar 15 tokens. Geração de 15 tokens = ~1s → **~45s foram TTFT/espera da API** (overload e/ou retry interno do CLI que infla `duration_ms` sem aparecer como erro).
- Build do prompt + envio: ~11s (queries Supabase + **`getEmbedding` síncrono** + parse + envio).
- Fila: ~0 (ela foi a 1ª) — mas **causou** ~46s de espera pra mensagem seguinte.

### Falhas (31 dias)
174 falhas (`exit`=62, `timeout`=70, `cli_error`=24, `unknown`=17), 79 timeouts (43×60s + 36×120s → fix 120→60s de 15/06 está ativo). **Episódicas**, não crônicas (pico 11/06: 46 em 3h). Cada timeout custa 60s **e** trava a fila.

**Conclusão:** a mensagem isolada lenta = **TTFT/overload da Anthropic + overhead de spawn do CLI** (parcialmente irredutível, é externo). O pico = **fila serializada**. Nenhum dos dois é o prompt, o cache, a geração ou a conta.

---

## Combo aprovado (3 peças, 100% infra)

### 1. Paralelismo da fila CLI (K=2) — ataca o pico/rajada
- **O quê:** trocar o mutex `_claudeQueue` (1-por-vez) por um pool de K=2 workers, cada um com `HOME` isolado (resolve o race no `.claude.json` que motivou o mutex).
- **Base:** Fase 0 já validada (19/06) — HOME isolado/worker, refresh central, flag `TOM_CLAUDE_PARALLEL` (default OFF), K=2, latência 1,98×, CANON intacto por hash. Esta é a **Fase 1** (código) que aguardava aprovação.
- **Risco:** médio (auth/race) — mitigado pelo HOME isolado; flag reversível; rollout observado.
- **Não toca no TOM.**

### 2. Build assíncrono do prompt — corta segundos fixos
- **O quê:** o `getEmbedding` (OpenAI, síncrono em [system.js:2604](../../../src/prompts/system.js)) hoje segura todo o build. Rodar em paralelo com `fetchCollaboratorContext` (Promise.all) + timeout curto: se passar de ~1s, segue sem o "contexto recente" semântico (degradação graciosa). Paralelizar também as queries independentes do contexto (C2).
- **Risco:** baixo.
- **Não toca no TOM.**

### 3. Fail-fast conservador — ataca o overload (caso Juliana), preservando o jeito
- **Decisão do Alf:** *Claude padrão, Codex só no extremo.*
- **O quê:** baixar o teto do Claude de 60s → **~40-45s** para cair pro Codex antes nos casos travados. Manter o Claude como provider preferido em ~95%+ das mensagens (jeito do TOM preservado). Investigar se o stderr do CLI sinaliza overload/retry para abortar ainda mais cedo **sem** cortar respostas legítimas.
- **Risco:** baixo (mecanismo de fallback já existe; só ajusta o limiar). Custo OpenAI quase nulo (só nos extremos).
- **Não toca no TOM** (mesmo system prompt; Codex já é o fallback atual).

---

## Fora de escopo (com motivo)

- **Mexer no comportamento/tamanho de resposta do TOM** — vetado pelo dono. Também: baixar `max_tokens` arriscaria truncar markers `<<TASK>>` no meio.
- **Migrar pra API SDK (custo por token)** — vetado; o cache já existe no CLI, então não traria o ganho que justificaria.
- **Enxugar o prompt como fix de latência** — não move o ponteiro (corr 0,01). Fica como possível item **futuro de custo/foco**, não nesta rodada.

---

## Pendências a confirmar antes de codar

- Valor real de `CLAUDE_TIMEOUT_MS` no `.env` da VPS (logs mostram 60s **e** 120s coexistindo — checar processo/env com config antiga). `pm2 env` veio vazio na investigação.
- Confirmar que o stderr do CLI expõe sinal de overload/retry (decide se o fail-fast pode ser mais esperto que um simples timeout menor).
- Adicionar `output_tokens`/`duration_api_ms` ao log do provider (observabilidade barata; hoje só `duration_ms` é logado) — para medir o ganho do combo depois.

---

## Apêndice — como reproduzir

- **Latência por output:** `ssh tom`, `claude -p "<curto|longo>" --append-system-prompt-file <140KB> --output-format json --tools ""` → ler `duration_api_ms`, `num_turns`, `usage.output_tokens`, `usage.cache_read_input_tokens`.
- **Respostas reais:** `SELECT length(content) FROM conversation_history WHERE direction='outbound'` (Supabase `cesnbnrynvxvgdhfmaua`).
- **Caso Juliana:** `conversation_history` entre 14:00–14:15 de 19/06 → resposta de 59 chars.
- **Distribuição/falhas:** `pm2 logs tom --nostream --lines 8000` → parsear pares `[Prompt] size`→`respondeu em` + kinds de `Claude falhou`.
