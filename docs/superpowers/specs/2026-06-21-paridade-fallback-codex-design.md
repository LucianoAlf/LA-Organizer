# Paridade do fallback Codex/GPT-5.5 — Design

- **Data:** 2026-06-21
- **Status:** Aprovado (design) — aguardando plano de implementação
- **Autor:** Claude + Alf
- **Contexto relacionado:** `project_motor_tom_sonnet_vs_gpt55` (comparativo 10 casos), `project_paralelismo_cli_fase0` (crise de auth 20/06)

## Problema

O TOM usa Claude (Sonnet 4.6, `src/ai/claude.js`) como motor primário e Codex (GPT-5.5, `src/ai/openai.js`) como **fallback automático** quando o Claude falha (`src/ai/provider.js`). Na crise de auth de 20/06 o Codex segurou o dia inteiro — mas **degradado**, porque o fallback foi escrito como "rede de segurança de resposta isolada", não como motor com paridade.

Dois gaps reais, confirmados no código:

1. **Sem histórico de conversa.** `openai.js:8` pega só a última mensagem do usuário (`messages.filter(m => m.role === 'user').pop()`). O Claude (`claude.js:164-173`) monta `"Conversa recente:\n{history}\n\nMensagem atual:\n{lastUser}"`. → No fallback, o TOM fica **amnésico** em conversa multi-turno.
2. **Sem sanitizador de output.** O `claude.js` filtra a resposta (linhas ~280-320) pra não vazar `ssh tom`, `scp`, `pm2`, `service_role`, `/opt/LA-Organizer`, blocos de código e narração de tool no WhatsApp dos colaboradores (casos reais Rose 10-12/06). O `openai.js` faz só `out.trim()`. Como o Codex recebe **o mesmo system prompt** (que carrega paths/comandos do CLAUDE.md), o risco de vazamento é idêntico — mas **sem proteção**. É um buraco de **segurança**, não só de qualidade.

O parser de markers do engine já trata os dois providers igual (só vê `{text}`), então não é um gap.

## Objetivo

Deixar o fallback Codex pronto pra assumir com **paridade de contexto e segurança** — sem virar primário e **sem mudar o jeito/tom do TOM** (mesmo system prompt). Quando o Claude cair, o Codex responde com histórico e sem vazar infra.

## Escopo (decidido com Alf)

**Núcleo: histórico + sanitizer.** A trava anti-duplicação (o GPT às vezes re-executa ação já feita — visto no comparativo) fica **fora do código por ora**: será validada empiricamente no E2E e só vira trava se aparecer de verdade com histórico real.

Fora de escopo: virar primário; paridade fina (limite de tokens, system separado, mídia/imagem); qualquer mudança no system prompt ou no comportamento do TOM.

## Design

Três unidades isoladas e testáveis:

### 1. `src/ai/sanitize.js` (novo — função pura)
`sanitizeOutput(text) → text`. Encapsula a cadeia de `.replace` que hoje vive inline no `claude.js` (regras 1-6, ~linhas 280-320): tool tags/narração EN, paths de filesystem do CLI (`MEMORY.md`, `/root/.claude`, `.claude/projects`, `/opt/LA-Organizer`), promessas falsas de "salvar na memória", cercas de código (` ``` `), comandos de infra (`ssh tom`, `scp`, `pm2`, `cat .env`, `grep SUPABASE`, `service_role`, `/mnt/...`, `sudo`, `npm run`, `node --`) e colapso de linhas em branco. Sem I/O — string → string. Uma responsabilidade: limpar vazamentos do output do LLM.

### 2. `src/ai/openai.js` (a paridade)
- **Input:** substituir o `lastUser` solitário pelo mesmo `userPrompt` do Claude — `history` formatado (`"Usuário: " / "TOM: "`, `messages.slice(0,-1)`) embrulhado em `"Conversa recente:\n{history}\n\nMensagem atual do usuário:\n{lastUser}"`. Quando não há histórico, cai pro `lastUser` puro (igual ao Claude). O system prompt continua indo como hoje.
- **Output:** aplicar `sanitizeOutput()` sobre `out.trim()` antes de resolver `{text, provider:'openai'}`.

### 3. `src/ai/claude.js` (refactor mínimo, risco controlado)
Substituir a cadeia inline de `.replace` pela chamada `sanitizeOutput(rawResult)`. **Mesma lógica, mesmas regexes**, só extraída e coberta por teste — o caminho primário (Claude) **não muda de comportamento**.

## Data flow

```
engine → provider.chat(systemPrompt, messages)
  → claude.chat(...)  [primário]
      falhou? →
  → openai.chat(systemPrompt, messages)  [fallback]
        monta userPrompt COM histórico  +  systemPrompt
        → spawn `codex exec` → stdout
        → sanitizeOutput(trim) → { text, provider:'openai' }
  → engine parseia markers do text  (igual pros dois)
```

## Testing

- **TDD do `sanitize.js`** (`node --test`): vazamentos conhecidos removidos (`ssh tom ...`, `service_role`, cerca de código, "saving to memory"/"vou salvar na memória", narração EN tipo "Now let me update...") e texto legítimo do TOM **intacto** (não cortar conteúdo de negócio nem markers).
- **Paridade input** (`openai.js`): teste da montagem do `userPrompt` — com histórico vira "Conversa recente: ..."; sem histórico, só a mensagem.
- **E2E com o harness `compare-batch.js`** (já existe, HOME isolado, não toca o CANON): rodar os 10 casos com o `openai.js` novo e confirmar (a) o Codex agora enxerga o histórico (responde com contexto multi-turno), (b) nenhuma resposta legítima foi cortada pelo sanitizer, (c) **duplica ou não** ação já feita — decide a trava anti-dup.
- **Sanidade:** `node --check` nos 3 arquivos.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Refactor do `claude.js` altera o primário | Função extraída **idêntica** (mesmas regexes) + teste que fixa o comportamento; primário inalterado |
| Sanitizer corta resposta legítima do Codex | Regras miram infra/comando/narração, não conteúdo de negócio; E2E confirma respostas intactas |
| Prompt do Codex maior (histórico) = mais custo/latência | Só roda no fallback (Claude falhou); Codex é assinatura ChatGPT (provável custo fixo) |
| Codex re-executa ação já feita (duplicação) | Fora do escopo de código; validado no E2E e tratado depois se confirmado |

## Critérios de sucesso

1. `sanitize.js` criado, testes verdes; `claude.js` consumindo-o com comportamento primário **inalterado** (provado por teste).
2. `openai.js` monta histórico no input e sanitiza o output.
3. E2E nos 10 casos: Codex com histórico, sem corte de resposta legítima, comportamento de duplicação documentado.
4. `node --check` limpo nos 3 arquivos; fallback continua funcionando (provider.js intacto).
