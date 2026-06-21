# Paridade do fallback Codex/GPT-5.5 — Design

- **Data:** 2026-06-21
- **Status:** Aprovado (design, rev. 2 pós-review do Alf) — aguardando plano de implementação
- **Autor:** Claude + Alf
- **Contexto relacionado:** `project_motor_tom_sonnet_vs_gpt55` (comparativo 10 casos), `project_paralelismo_cli_fase0` (crise de auth 20/06)

## Problema

O TOM usa Claude (Sonnet 4.6, `src/ai/claude.js`) como motor primário e Codex (GPT-5.5, `src/ai/openai.js`) como **fallback automático** quando o Claude falha (`src/ai/provider.js`). Na crise de auth de 20/06 o Codex segurou o dia inteiro — mas **degradado**, porque o fallback foi escrito como "rede de segurança de resposta isolada", não como motor com paridade.

Três gaps reais, confirmados no código (rev. 2):

1. **Sem histórico de conversa.** `openai.js:8` pega só a última mensagem (`messages.filter(m => m.role === 'user').pop()`). O Claude (`claude.js:164-173`) monta `"Conversa recente:\n{history}\n\nMensagem atual do usuário:\n{lastUser}"`. → No fallback, o TOM fica **amnésico** em conversa multi-turno.

2. **Sem sanitizador de output (defesa em profundidade).** O `claude.js` filtra a resposta (~linhas 276-320) contra narração de tool em inglês ("Now let me…"), cercas de código (` ``` `) e qualquer infra que escape. O `openai.js` faz só `out.trim()`. **Re-fundamentação (corrige a rev. 1):** o risco NÃO vem do system prompt — verificado empiricamente, `buildSystemPrompt` real tem **0 hits** de infra (é SOUL + AGENTS de negócio + contexto do banco). O sanitizer vale como **higiene de saída provider-agnóstica**: o GPT também narra em inglês e adora cercas de código. As regras de `<invoke>`/`<tool_call>` são específicas do Claude CLI — no Codex ficam inertes (inofensivas, só não casam).

3. **Sem cwd limpo (defesa na fonte).** O `claude.js` spawna com **`cwd: os.tmpdir()`** (linha 213) justamente pra impedir o CLI de auto-carregar o `/opt/LA-Organizer/CLAUDE.md` (DevOps: `ssh tom`, `cat .env`, `setup-vps-key`) como "project memory" — causa-raiz do vazamento da Rose 12/06 (GROUPCHAT-INFRA-LEAK). O `openai.js` spawna **sem cwd** → o codex herda `/opt/LA-Organizer` (confirmado: `exec cwd` do pm2). **Verificado:** rodando o codex desse cwd e perguntando sobre infra, ele **regurgitou `/opt/LA-Organizer`** (não respondeu "NENHUMA"). Vetor real, fechado na fonte com o mesmo cwd do Claude.

O parser de markers do engine já trata os dois providers igual (só vê `{text}`) — não é um gap.

## Objetivo

Deixar o fallback Codex pronto pra assumir com **paridade de contexto e segurança** — sem virar primário e **sem mudar o jeito/tom do TOM** (mesmo system prompt). Quando o Claude cair, o Codex responde com histórico, sem vazar infra no chat.

## Escopo (decidido com Alf)

**Núcleo: histórico + sanitizer + cwd limpo.** A trava anti-duplicação (o GPT às vezes re-executa ação já feita — visto no comparativo) fica **fora do código por ora**: o E2E mede duplicação **ativamente** e documenta; só vira trava se confirmada com histórico real. (A dedup determinística já vive no engine, pós-parse de marker, e vale pros dois providers.)

Fora de escopo: virar primário; paridade fina (limite de tokens, system separado, mídia); qualquer mudança no system prompt ou no comportamento do TOM.

## Design

Unidades isoladas e testáveis. Princípio: **o que é compartilhado vira um helper único** (paridade estrutural, não duas cópias que apodrecem).

### 1. `src/ai/prompt.js` (novo — função pura compartilhada)
`buildUserPrompt(messages) → string`. Copiado **verbatim** da lógica do `claude.js:164-173`: `lastUser = messages.filter(role==='user').pop()`, `history = messages.slice(0,-1).map("Usuário: "/"TOM: ").join("\n")`, e o embrulho `"Conversa recente:\n{history}\n\nMensagem atual do usuário:\n{lastUser}"` (ou só `lastUser` quando não há histórico). **Sutileza preservada:** `slice(0,-1)` (histórico) e `.pop()` do último user podem desalinhar se a última msg do array não for do user — o comportamento já é esse hoje no `claude.js`; copiamos idêntico e **documentamos** (consertar seria mudar o primário, fora de escopo).

### 2. `src/ai/sanitize.js` (novo — função pura compartilhada)
`sanitizeOutput(text) → string`. Encapsula a cadeia de `.replace` que hoje vive inline no `claude.js` (regras 1-6, ~276-320). Sem I/O, string → string. Retorna **só a string**; quem chama calcula o delta pra observabilidade (ver unit 4).

### 3. `src/ai/openai.js` (a paridade)
- **Input:** usar `buildUserPrompt(messages)` no lugar do `lastUser` solitário. System prompt continua indo como hoje.
- **Output:** aplicar `sanitizeOutput()` sobre `out.trim()`; calcular e logar `sanitized_chars` (paridade do sensor).
- **Fonte:** adicionar `cwd: require('os').tmpdir()` ao `spawn('codex', …)` — fecha a auto-carga de infra do cwd, igual ao Claude.

### 4. `src/ai/claude.js` (refactor mínimo, risco controlado)
- Trocar a montagem inline do `userPrompt` por `buildUserPrompt(messages)`.
- Trocar a cadeia inline de `.replace` por `const limpo = sanitizeOutput(rawResult)`, **preservando** `sanitized_chars = rawResult.length - limpo.length`, o `console.warn` (linhas 322-324) e `meta.sanitized_chars`.
- **Mesma lógica, mesmas regexes/strings** — o caminho primário (Claude) **não muda de comportamento** (garantido por teste de fixação).

## Data flow

```
engine → provider.chat(systemPrompt, messages)
  → claude.chat(...)  [primário]   buildUserPrompt + spawn(cwd=tmp) + sanitizeOutput
      falhou? →
  → openai.chat(systemPrompt, messages)  [fallback]
        buildUserPrompt(messages)  +  systemPrompt
        → spawn `codex exec` (cwd=os.tmpdir()) → stdout
        → sanitizeOutput(trim) → { text, provider:'openai' }
  → engine parseia markers do text  (igual pros dois)
```

## Testing

- **TDD do `sanitize.js`** (`node --test`): vazamentos removidos (cerca de código, narração EN "Now let me update…", e por garantia `ssh tom`/`service_role`) e texto legítimo do TOM + markers **intactos**.
- **TDD do `prompt.js`**: com histórico vira "Conversa recente: …"; sem histórico, só a mensagem; ordem e rótulos ("Usuário:"/"TOM:") idênticos ao claude.js de hoje.
- **Teste de fixação do `claude.js`**: a saída de `sanitizeOutput` + `buildUserPrompt` reproduz o comportamento atual (primário inalterado).
- **E2E com harness versionado** (`_remote/scripts/compare-models-batch.js`, roda só na VPS com `node --env-file=.env`, HOME isolado em `/tmp`, NÃO toca o CANON): rodar os 10 casos com o `openai.js` novo e confirmar (a) Codex agora enxerga o histórico, (b) nenhuma resposta legítima cortada pelo sanitizer, (c) **medir duplicação ativamente** (re-executa ação já feita?) e documentar.
- **Sanidade:** `node --check` nos arquivos tocados.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Refactor do `claude.js` altera o primário | Helpers extraídos **idênticos** + teste de fixação; primário inalterado |
| Sanitizer corta resposta legítima do Codex | Regras miram infra/comando/narração, não conteúdo de negócio; E2E confirma respostas intactas |
| `cwd=tmpdir` quebra algo no codex | O codex usa caminhos absolutos pro resto; sandbox já lista `/tmp` permitido; validar no E2E |
| Prompt do Codex maior (histórico) = custo/latência | Só roda no fallback; Codex é assinatura ChatGPT (provável custo fixo) |
| Codex re-executa ação já feita (duplicação) | Fora do escopo de código; E2E mede e documenta; trava só se confirmado |

## Critérios de sucesso

1. `prompt.js` e `sanitize.js` criados, testes verdes; `claude.js` consumindo-os com comportamento primário **inalterado** (teste de fixação) e `sanitized_chars` preservado.
2. `openai.js`: histórico no input, `sanitizeOutput` + `sanitized_chars` no output, `cwd: os.tmpdir()` no spawn.
3. Harness versionado em `_remote/scripts/`; E2E nos 10 casos: Codex com histórico, sem corte legítimo, **duplicação medida e documentada**.
4. `node --check` limpo; `provider.js` intacto (fallback automático preservado).
