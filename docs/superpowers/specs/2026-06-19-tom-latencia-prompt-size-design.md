# Design — Latência & Tamanho de Prompt do TOM (investigação + opções)

**Data:** 2026-06-19
**Tipo:** Investigação read-only + spec de opções (NÃO é plano de implementação).
**Status:** aguardando review/brainstorm do Alf. Nada implementado. HOLD de deploy ativo.
**Gatilho:** msg da Juliana em 19/06 14:08 — `[Prompt] size: 139783 chars (skill: financeiro-pessoal, history: 30, memories: 9, tasks: 4)` e `[AI] Claude respondeu em 46361ms`. Tempo total percebido ~57,5s.

---

## TL;DR (e recomendação)

1. **O tamanho do prompt NÃO é o que causa a lentidão.** Medi 151 prompts × 190 chamadas reais de produção: a correlação entre tamanho do prompt e duração da chamada é **0,01** (ou seja, ~zero). Prompts de 137–160KB responderam em 5–14s; o da Juliana, de 139KB, levou 46s. "Prompt gigante → 57s" é intuitivo mas **falso**.
2. **A latência real vem de 3 coisas:** (a) variabilidade da própria chamada CLI+API (p50=12s, mas **p90=35s, p95=42s, max=116s**); (b) a **fila serializada** (`_claudeQueue`) que faz toda mensagem esperar atrás de uma chamada lenta; (c) **episódios** de timeout/overload da Anthropic (cada um trava 60s e enche a fila).
3. **O prompt está gordo mesmo** (média 116KB, p95 150KB) e vale enxugar — mas por **custo de tokens, foco do modelo e \$**, não para "consertar a latência". ~83% do prompt da Juliana eram corpos de skill estáticos; ~58KB eram skills irrelevantes para uma pergunta financeira (comunicados institucionais, operações técnicas, pedagogia, criar-compromisso).

**Recomendação (sequência, do mais barato/seguro ao mais estrutural):**
- **A2** — gatear skills *role-gated* por relevância da mensagem (não só por papel). Padrão já provado (a `coordenacao-conversacional` já faz isso). Alivia 68% da equipe. Risco baixo.
- **B2 + C1** — *fail-fast* em overload (não esperar 60s pra cair no Codex) + tornar o `getEmbedding` assíncrono no build. Cortes baratos na cauda e no overhead fixo.
- **B1** — ligar paralelismo da fila CLI (K=2), já com Fase 0 validada (19/06). **Maior alavanca de latência percebida.**
- **Fundo (decisão do Alf):** **B4** — migrar do CLI headless para a API SDK direta (prompt caching + streaming + sem race), que resolve fila + cache + cold-start de uma vez.

---

## Problema

O TOM "parece lento/quebrado". O caso âncora (Juliana, 19/06) levou ~57s. A leitura natural — "prompt de 140KB é o culpado" — precisa ser testada antes de virar plano, porque otimizar a coisa errada não move o ponteiro. Esta investigação separa **fato de intuição** e lista opções com impacto/risco reais.

Esta é uma camada **separada** da dor de recorrência (Balde A, sob observação) — não toca nesses arquivos.

---

## Como o prompt é montado (mapa do terreno)

`buildSystemPrompt(collaborator)` em [system.js:2588](../../../src/prompts/system.js). Ordem de montagem:

```
blocks = [ BLOCK_RULES, BLOCK_IDENTITY, ctxBlock, organogramaBlock, skillBlock, projectStatusContextBlock ]
systemPrompt = blocks.join('---')
  += LÍNGUA E TOM
  += [role-gated] comunicados / eventos-institucionais / aprovacao-comunicados   (hasCoordLevel)
  += [todos]      configurar-preferencias
  += [role-gated] operacoes-tecnicas (isOpsRole) / marketing (isMarketingRole)
  += [keyword]    coordenacao-conversacional (só com hint/keyword de relay)
  += [todos]      reagir-mensagens + coach-usabilidade  (+ responder-por-audio se voice on)
  += [todos]      integridade-agenda + criar-compromisso
  += [role-gated] pedagogico (isPedagogicoRole)
  += [contexto]   perfil, semana passada, eventos passados, inventário, journey, ...
```

Pontos de arquitetura que importam pra latência:
- O **history (30 msgs) NÃO está no `systemPrompt`** — ele vai no `userPrompt` via `-p`, montado em [claude.js:89](../../../src/ai/claude.js) (`Conversa recente: …`). É input **adicional** aos 140KB (truncado a 1000 chars/msg por [history-truncate.js](../../../src/utils/history-truncate.js)).
- O provider é o **CLI `claude -p` headless** (spawn de processo por mensagem), serializado por mutex `_claudeQueue`, timeout 60s, fallback Codex/OpenAI. [provider.js](../../../src/ai/provider.js) loga `[AI] Claude respondeu em ${duration_ms}ms` — e `duration_ms` é tempo do **spawn→close**, **não** inclui espera na fila.

---

## Tarefa 1 — Composição dos ~140KB (medido, chars)

Tamanhos reais dos arquivos em `skills/` + blocos hardcoded:

| Bloco | Chars | Quando entra | % da equipe afetada |
|---|---:|---|---|
| `BLOCK_RULES` (hardcoded) | **11.116** | sempre | 100% |
| `BLOCK_IDENTITY` (hardcoded) | 2.154 | sempre | 100% |
| `LÍNGUA E TOM` (inline) | 652 | sempre | 100% |
| `configurar-preferencias` | 7.279 | todos | 100% |
| `reagir-mensagens` | 3.583 | todos | 100% |
| `coach-usabilidade` | 6.434 | todos | 100% |
| `integridade-agenda` | 5.567 | todos (aux) | 100% |
| `criar-compromisso` | **17.255** | todos (aux) | 100% |
| **→ piso fixo "always-on"** | **~54.040** | **toda mensagem** | **100%** |
| `comunicados` | 8.050 | `hasCoordLevel` | **68%** (21/31) |
| `eventos-institucionais` | 5.244 | `hasCoordLevel` | 68% |
| `aprovacao-comunicados` | 3.624 | `hasCoordLevel` | 68% |
| `operacoes-tecnicas` | 10.595 | `isOpsRole` | **45%** (14/31) |
| `pedagogico` | 7.397 | `isPedagogicoRole` | **42%** (13/31) |
| `marketing` | 8.511 | `isMarketingRole` | 13% (4/31) |
| `coordenacao-conversacional` | 15.171 | hint/keyword relay | por-msg |
| `responder-por-audio` | 3.032 | `TOM_VOICE_ENABLED` | env |
| `priorizacao-inteligente` | 8.194 | só se primária ∈ {checklist, criar-compromisso, projeto} | por-msg |
| **skill primária** (ex.) | 17–26k | roteada por `pickSkill` | por-msg |
| `financeiro-pessoal` | 26.212 | (primária do caso) | — |
| `checklist-tarefas` | 24.999 | maior skill comum | — |

**Reconstrução exata do prompt da Juliana** (`coordinator` + `function_role=pedagogico` + `unit=all`, fluxo financeiro):

| Camada | Chars |
|---|---:|
| Hardcoded (rules+identity+língua) | 13.922 |
| Always-on (prefs+reagir+coach+integridade+criar-compromisso) | 40.118 |
| hasCoordLevel (comunicados+eventos+aprovação) | 16.918 |
| isOpsRole (operações-técnicas) | 10.595 |
| isPedagogicoRole (pedagógico) | 7.397 |
| Skill primária (financeiro-pessoal) | 26.212 |
| **Subtotal estático (skills)** | **115.162** (**~83%**) |
| Contexto dinâmico (4 tasks, 9 memories, perfil, projetos, fontes, separadores) | ~24.621 (~17%) |
| **Total medido** | **139.783** ✓ |

**Achado 1:** o prompt é dominado por **corpos de skill estáticos** (~83%), não por contexto dinâmico. Para responder *"guardei 500 no Nubank"*, o TOM carregou **~58KB de skills irrelevantes** (comunicados institucionais, operações técnicas, pedagogia, criar-compromisso de 17KB).

**Achado 2:** existe um **piso fixo de ~54KB always-on** em TODA mensagem (até um "oi"), antes de skill primária ou contexto. O menor prompt observado em produção foi 71.624 chars (`skill: none`) — ou seja, ninguém nunca tem um prompt "pequeno".

**Achado 3:** o inchaço *role-gated* atinge a maioria — **68% da equipe** carrega os ~17KB de comunicados/eventos/aprovação em toda mensagem; um líder que é coord+ops+pedagógico carrega **+34,9KB** de skills role-gated sempre, relevantes ou não.

---

## Tarefa 2 — Caminho de latência (medido em produção)

Amostra: `pm2 logs tom` (31 dias de stderr / ~2,5 dias de stdout), 190 chamadas bem-sucedidas, 151 prompts.

### Distribuição de latência (chamada CLI, `duration_ms`)
```
n=190   min=1,7s   p50=12,0s   p90=34,8s   p95=42,1s   max=116,0s   avg=16,2s
>30s: 13%    >20s: 28%    <5s: 21%
```

### Tamanho × latência — sem relação
```
corr(tamanho_prompt, duração) = 0,01      # ~zero
bucket  0–90k:   mediana 12,0s
bucket 90–120k:  mediana 16,9s
bucket 120–140k: mediana 11,6s   ← MENOR que o bucket anterior
bucket 140–300k: mediana 18,8s
```
A latência **não** sobe com o tamanho de forma utilizável. A variância é da chamada CLI+API (carga da Anthropic, geração, retries internos), não do prefill do prompt.

### Decomposição dos ~57s da Juliana
| Fatia | Tempo | O que é |
|---|---:|---|
| Chamada CLI (`duration_ms`) | **46,4s** | spawn + chamada à API + geração. **Dominante.** |
| Build do prompt + envio | ~11s | queries Supabase do `fetchCollaboratorContext` + **`getEmbedding` síncrono (OpenAI)** + `match_memories` + parse de markers + envio WhatsApp |
| Espera na fila | ~0 (neste caso) | ela foi a 1ª; mas **CAUSOU** ~46s de espera pra próxima msg (que respondeu em 3,8s mas o usuário esperou ~50s) |

### A fila é o amplificador
`_claudeQueue` ([claude.js:79](../../../src/ai/claude.js)) serializa **todas** as chamadas (foi posta pra evitar corrupção do `.claude.json` em chamadas paralelas — Sprint 26). Efeito: quando uma chamada entra na cauda (35–46s) ou trava num timeout (60s), **todas as mensagens atrás esperam**. A cauda individual vira cauda sistêmica — é isso que produz a sensação de "TOM travado / escrevendo a vida toda".

### Falhas / timeouts — episódicas, não crônicas
31 dias: **174 falhas** (`exit`=62, `timeout`=70, `cli_error`=24, `unknown`=17) e **79 timeouts** (43×60s + 36×120s — confirma que o fix 120→60s de 15/06 está ativo). **Não é 48% de falha** (interpretação errada inicial: stderr tem retenção muito maior que stdout no buffer de logs). No período com dados sobrepostos a taxa real é **~2%**, mas com **episódios** concentrados (ex.: 11/06 02–05h: 46 falhas em 3h). Cada timeout custa 60s **e** trava a fila inteira.

**Achado 4:** o gargalo é a **chamada CLI+API (volátil) amplificada pela fila serializada**, com **episódios de overload**. O tamanho do prompt é figurante, não protagonista.

---

## Diagnóstico (mitos × fatos)

| Hipótese | Veredito | Evidência |
|---|---|---|
| "Prompt de 140KB causa os 57s" | ❌ **Mito** | corr 0,01; prompts maiores foram mais rápidos |
| "É a fila serializada" | ⚠️ **Parcial** | não foi a causa neste caso (ela foi 1ª), mas é o amplificador que trava os vizinhos |
| "É a chamada do LLM/CLI em si" | ✅ **Fato** | `duration_ms=46,4s` de 57s; p95=42s mostra cauda gorda crônica |
| "É overload episódico da Anthropic" | ✅ **Fato (em janelas)** | 70 timeouts + 62 exits; picos concentrados |
| "O prompt está gordo demais" | ✅ **Fato** | ~83% skill estática, ~58KB irrelevante, piso 54KB — mas é problema de **custo/foco**, não de latência |

---

## Tarefa 3 — Opções de redução

### Eixo A — Enxugar o prompt
*(reduz tokens/custo/foco do modelo; NÃO reduz latência diretamente — corr 0,01)*

| # | Opção | Economia | Risco | Esforço |
|---|---|---|---|---|
| **A1** | Gatear as **auxiliares always-on** (`criar-compromisso` 17KB, `integridade-agenda` 5,6KB, etc.) por keyword/contexto em vez de sempre | até **~40KB** no piso | **Médio-Alto** — foram tornadas always-on por regressões multi-turno (Sprint 18/23.5); exige gating fino + testes de continuidade | Médio |
| **A2** | Gatear os **role-gated** (`comunicados`/`eventos`/`aprovacao`/`operacoes`/`marketing`) por **keyword da mensagem**, não só por papel | **~17–35KB** para 45–68% da equipe | **Baixo** — a `coordenacao-conversacional` já faz exatamente isso (Sprint 23.15) com sucesso documentado | Baixo |
| **A3** | Comprimir/dividir skills primárias gigantes (`financeiro` 26KB, `checklist` 25KB) em core+detalhe | ~10–15KB/skill | **Alto** — mexe no comportamento da skill | Alto |
| **A4** | Reordenar blocos (todo estático primeiro, dinâmico por último) p/ habilitar caching de prefixo | — (habilita B4) | Baixo-Médio | Baixo |

### Eixo B — Atacar a latência (a cauda é o problema real)

| # | Opção | Impacto | Risco | Esforço |
|---|---|---|---|---|
| **B1** | **Paralelizar a fila CLI** (K=2–3 workers; HOME isolado por worker já resolve o race do `.claude.json`) | **Alto** — mata o efeito-fila que trava a equipe | **Médio** — Fase 0 já validada 19/06 (`project_paralelismo_cli_fase0`) | Médio |
| **B2** | **Fail-fast em overload**: ao detectar `kind=exit/429/529`, cair no Codex na hora em vez de esperar os 60s | **Médio** — corta os episódios | **Baixo** | Baixo |
| **B3** | Early-ack / melhorar percepção ("✍️ tô vendo aqui…") enquanto processa | Percepção | Baixo | Baixo |
| **B4** | **Migrar CLI headless → API SDK direta** (Messages API): prompt caching nativo (`cache_control` no prefixo estável de ~115KB → -90% prefill/\$ nos blocos repetidos), streaming, paralelismo trivial, sem race | **Alto** — resolve fila + cache + cold-start + race de uma vez | **Alto** — reescreve o provider; re-testar sanitizer anti-leak (hoje depende do `--output-format json` do CLI) e o isolamento `--tools ""` | Alto |

### Eixo C — Build do prompt (~11s de overhead fixo)

| # | Opção | Impacto | Risco | Esforço |
|---|---|---|---|---|
| **C1** | Tornar `getEmbedding` (OpenAI, síncrono em todo turno — [system.js:2604](../../../src/prompts/system.js)) assíncrono/cacheado ou paralelo às queries | **Médio** no overhead de build | Baixo | Baixo |
| **C2** | Paralelizar as queries sequenciais do `fetchCollaboratorContext` | Baixo-Médio | Baixo | Médio |

---

## Recomendação (combo sequenciado)

1. **A2** (gate role-gated por keyword) — rápido, padrão já provado, alivia 68% da equipe. Começar por aqui.
2. **B2 + C1** (fail-fast em overload + embedding async) — cortes baratos na cauda e no overhead de build.
3. **B1** (paralelismo K=2) — Fase 1, já com Fase 0 validada. **Maior ganho de latência percebida.**
4. **Reavaliar A1** com medição cuidadosa de regressão multi-turno (é o maior corte de prompt, mas o mais arriscado).
5. **Decisão de fundo do Alf:** **B4** (API SDK + cache) como reescrita estratégica do provider — endereça a raiz, mas é projeto grande e merece brainstorm próprio.

**Mensagem central pro brainstorm:** enxugar o prompt (Eixo A) é bom por **custo e foco**, mas **não** vai resolver a latência sozinho. Quem move o ponteiro de UX é o **Eixo B** (fila + fail-fast + caching). Investir só em A e esperar que o TOM fique rápido seria otimizar a coisa errada.

---

## Não faz parte / decisões pro Alf

- **Não implementar nada** sem brainstorm/aprovação (HOLD de deploy ativo; flag `.deploy-hold` intacta).
- Não tocar nos arquivos do Balde A (recorrência).
- **Decisões que dependem do Alf:** (1) aceitar o risco multi-turno de A1? (2) topar o projeto B4 (API SDK)? (3) ligar B1 em produção (Fase 1 do paralelismo)?
- **A confirmar antes de codar:** valor real de `CLAUDE_TIMEOUT_MS` e `TOM_VOICE_ENABLED` no `.env` da VPS (o `pm2 env` veio vazio; os logs mostram timeouts de 60s **e** 120s coexistindo — checar se há instância/processo com env antigo).

---

## Apêndice — como reproduzir as medições

- **Tamanhos de skill:** `for f in skills/*.md: chars` (medido via sandbox; `financeiro-pessoal`=26.212, `BLOCK_RULES`=11.116 extraído de `system.js`).
- **Latência:** `ssh tom "pm2 logs tom --nostream --lines 8000"` → filtrar `respondeu em|[Prompt] size|falhou|timeout` → parsear pares `[Prompt] size`→`respondeu em` → stats + correlação de Pearson.
- **Composição da Juliana:** `SELECT role, function_role, has_coord_permissions, unit FROM collaborators WHERE full_name ILIKE '%juliana%'` (Supabase `cesnbnrynvxvgdhfmaua`) = `coordinator / pedagogico / false / all`.
- **Impacto na equipe:** contagem por gate sobre 31 colaboradores ativos (coord=21, ops=14, pedag=13, mkt=4).
