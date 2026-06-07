# Fatia H — Hardening do Provider Claude (anti-E2BIG + timeout) — Design

**Data:** 2026-06-07
**Status:** aprovado (brainstorming) → pronto pro plano
**Contexto:** 1ª fatia da remediação da auditoria 07/06 (dossiê: `docs/superpowers/audits/2026-06-07-auditoria-completa-achados.md`). Escolhida primeiro porque habilita as outras com segurança (destruncar skills aumenta o prompt → precisa do provider robusto antes).

## Problema (confirmado na auditoria + VPS)

`src/ai/claude.js` passa o system prompt (~90KB) por **argv** (`--append-system-prompt <90KB>`, linha 90). Em janelas de carga isso estoura `ARG_MAX` do Linux → `spawn E2BIG` → **17 casos** em que o Claude nem rodou (caía no fallback ou o TOM ficava mudo). Além disso, o `.env` da VPS tem `CLAUDE_TIMEOUT_MS=60000` que **sobrepõe silenciosamente** o default do código (120000, linha 26) — o comentário diz 120s mas a realidade são 60s, e **47 timeouts** batiam nesse limite.

## Objetivo

Eliminar o `spawn E2BIG` e alinhar o timeout, sem mudar o comportamento do modelo nem reduzir a inteligência do TOM. Mudança puramente de *como* o prompt é entregue ao CLI.

## Decisões (fechadas)

1. **System prompt via arquivo:** usar `--append-system-prompt-file <tmp>` em vez de `--append-system-prompt <conteúdo>`. **Confirmado empiricamente na VPS** (07/06): `--append-system-prompt-file /tmp/sp_test.txt` retornou `{"is_error":false,"result":"PONG"}` em 2068ms, com `cache_read_input_tokens` presente (cache preservado). Preserva o tratamento de system-role (≠ dobrar no stdin como o openai.js faz).
2. **Timeout:** 120s (alinhar código e `.env`).
3. **Mutex:** manter como está. Consertou corrupção real do `.claude.json` (Sprint 26). Não paralelizar agora.
4. **Fora de escopo (vai pra Fatia J):** guard de expiração do OAuth.

## Mudanças (exatas)

### `src/ai/claude.js`
- No topo: `const os = require('os'); const fs = require('fs'); const path = require('path');`
- `CLAUDE_TIMEOUT_MS`: manter `Number(process.env.CLAUDE_TIMEOUT_MS) || 120000` (o código já é 120000; o que muda é o `.env` — ver abaixo). Atualizar o comentário enganoso.
- Em `_chatInner`, ANTES do `spawn`: escrever `systemPrompt` num arquivo temporário único e trocar o arg.
  - Nome do tmp: `path.join(os.tmpdir(), 'tom-sysprompt-' + process.pid + '-' + Date.now() + '.txt')`. (Runtime normal do engine — `Date.now()` disponível; a proibição é só em scripts de Workflow.)
  - `fs.writeFileSync(tmpFile, systemPrompt, 'utf8')`.
  - Trocar no array `args`: remover `'--append-system-prompt', systemPrompt` e pôr `'--append-system-prompt-file', tmpFile`.
- Limpeza: apagar o tmp em TODOS os caminhos de saída (resolve, reject, timeout, close, error). Implementar via `cleanup()` chamado no `finally` lógico:
  - adicionar `const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };`
  - chamar `cleanup()` dentro de `reject_` e logo antes de cada `resolve(...)`. (O processo Claude já leu o arquivo na inicialização; apagar após o close é seguro.)
- Extrair a montagem do array `args` para uma função pura `buildArgs(userPrompt, sysPromptFile)` (exportada) pra ser testável sem spawn.

### `.env` na VPS (`/opt/LA-Organizer/.env`)
- Trocar `CLAUDE_TIMEOUT_MS=60000` → `CLAUDE_TIMEOUT_MS=120000` (ou remover a linha pra cair no default do código). Editar via `ssh tom` (sed) + restart. (Não há `.env` no repo — é só na VPS.)

## Componentes / interfaces
- `buildArgs(userPrompt: string, sysPromptFile: string) → string[]` — função pura, sem I/O. Retorna o array de args do CLI com `--append-system-prompt-file sysPromptFile` e SEM o conteúdo do system prompt. Único ponto testável do empacotamento.
- `chat()` / `_chatInner()` — inalterados na assinatura e no retorno (`{text, provider, meta}`). Só muda a entrega do prompt + cleanup do tmp.

## Tratamento de erro
- Falha ao escrever o tmp → reject `kind='spawn'` com msg clara (não deixa silencioso).
- `cleanup()` é best-effort (try/catch vazio) — não pode derrubar a resposta.
- Sanitizer, parsing JSON e mutex permanecem idênticos.

## Testes
1. **Unit (`claude.test.js`, node:test):** `buildArgs('oi','/tmp/x.txt')` → array contém `'--append-system-prompt-file'` seguido de `/tmp/x.txt`; NÃO contém nenhuma string longa de system prompt; contém `-p`, `--output-format json`, `--strict-mcp-config`, `--tools ''`.
2. **Smoke anti-E2BIG (VPS):** chamar `claude.chat()` com um systemPrompt **>250KB** (string sintética) + user curto. ANTES: `E2BIG`. DEPOIS: resolve com texto. Prova a correção no limite que quebrava.
3. **Regressão (VPS):** chamada normal (system real ~90KB) volta `{text}` com marker válido; sanitizer ainda funciona; tmp foi apagado (conferir `ls /tmp/tom-sysprompt-*` = vazio após).
4. **Concorrência (VPS):** 2 `chat()` simultâneos → ambos resolvem, sem corromper `.claude.json` (mutex intacto), 2 tmps distintos criados e apagados.

## Risco
Baixíssimo. Não altera modelo, prompt (conteúdo), markers, voz nem mutex. Só move o system prompt de argv→arquivo e corrige um número de timeout. Reversível (voltar a string no argv).

## Arquivos
- Modificar: `src/ai/claude.js`
- Criar: `src/ai/claude.test.js`
- Criar: `scripts/smoke-claude-e2big.js` (smoke 250KB no VPS)
- Editar na VPS: `/opt/LA-Organizer/.env` (CLAUDE_TIMEOUT_MS)
