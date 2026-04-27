# Provider Fallback — Sprint de Resiliência (Bloco 3)

Data: 2026-04-27. Cobre o que acontece quando o provider de IA falha.

## Arquitetura

```
processMessage
   └─ ai.chat (provider.js)
        ├─ claude.js   (primário; CLAUDE_TIMEOUT_MS, default 60s)
        └─ openai.js   (fallback; CODEX_TIMEOUT_MS, default 120s)
```

`provider.chat` tenta Claude primeiro; se falhar, tenta Codex; se ambos falham, lança `Error` com `.kind='all_failed'` e `.errors=[claudeErr, codexErr]`.

## Classificação de erros

Cada provider rejeita com um `Error` que carrega `.kind` e `.provider`:

| `kind` | Significa | Provider gera quando |
|---|---|---|
| `timeout` | tempo esgotado | watchdog SIGKILL após CLAUDE_TIMEOUT_MS / CODEX_TIMEOUT_MS |
| `exit` | exit code != 0 | CLI saiu com erro (auth, modelo offline, etc.) |
| `empty` | stdout vazio | exit 0 mas sem texto (modelo não retornou nada) |
| `spawn` | processo não subiu | binário ausente, EACCES, ENOENT |
| `unknown` | qualquer outro | catch-all |

`provider.js` agrega: lança `kind='all_failed'` quando os DOIS falharam.

## Comportamento por tipo de falha

### Caso 1 — Claude falha, Codex responde

- Codex devolve `{ text, provider: 'openai', fallbackFrom: 'claude', primaryError: {kind, message} }`
- Engine processa normalmente os markers que o Codex emitir (TASK_UPDATE, etc.)
- Engine grava `marker_logs(PROVIDER/fallback, reason="fallback_from=claude kind=...")`
- Usuário recebe a resposta normalmente
- **Risco de side effect indevido**: baixo. Codex tem prompt menor (sem `--append-system-prompt`), markers podem vir mal formatados. **Mitigação existente**: Guard 3 (schema validation) rejeita markers inválidos. Side effect só executa se passar no schema.

### Caso 2 — Ambos falham (`all_failed`)

- Engine grava `marker_logs(PROVIDER/rejected, reason="all_failed: [claude:..., openai:...]")`
- Engine **rejeita o promise** (não envia mensagem ao usuário)
- Webhook handler já respondeu HTTP 200 — UAZAPI não reentrega
- Queue handler (`per-user-queue.enqueue`) captura o throw e imprime no console
- **Usuário recebe silêncio**

### Caso 3 — Provider mata-se mid-stream

- Claude timeout → SIGKILL → stdout pode ter saída parcial → mas código reject já disparou
- O stdout coletado até o SIGKILL é **descartado** (resolve nunca é chamado)
- Não há risco de marker meio-emitido ser processado

### Caso 4 — sendRitual (cron) falha

- `dispatcher.fireRitual` já trata: insere `ritual_logs(canonical, 'error', err.message, ymd)` (Sprint Observabilidade)
- Cron retenta na próxima slot? Não — slot já passou. Briefing daquele dia não acontece. **Logado, auditável.**

## Logs estruturados

Para cada chamada que envolveu fallback ou falha total, há entradas em `marker_logs`:

```sql
SELECT marker_type, result, reason, created_at
FROM marker_logs
WHERE marker_type = 'PROVIDER'
ORDER BY created_at DESC LIMIT 50;
```

| `marker_type` | `result` | `reason` |
|---|---|---|
| `PROVIDER` | `fallback` | `fallback_from=claude kind=timeout|exit|empty|spawn` |
| `PROVIDER` | `rejected` | `all_failed: [{provider:claude,kind:...},{provider:openai,kind:...}]` |

## UX proposta para o caso 2 (REQUER APROVAÇÃO ANTES DE IMPLEMENTAR)

Hoje o usuário recebe silêncio quando ambos falham. Proposta:

> ⚠️ Tô com lentidão na IA agora. Tenta de novo em uns minutos? Se persistir, me chama.

**Justificativas:**
- Dá feedback ao usuário (silêncio gera mais ansiedade)
- Não inventa promessa que não pode cumprir (não diz "vou processar mais tarde")
- Convida o retry natural

**Por que NÃO fizemos ainda:**
- O usuário pediu explicitamente: "não inventar UX nova de timeout sem necessidade. Se for propor resposta padrão ao usuário, documentar e justificar antes."
- Fica documentada aqui para decisão. Para ativar, descomentar bloco em `engine.js` (TODO marker presente) ou adicionar env flag `TOM_PROVIDER_FAILURE_MSG=on`.

**Riscos da UX proposta:**
- Loop de retry pode amplificar a falha do provider (usuário renvia 3x → 3 timeouts)
- Aceitável: Claude API é suficiente robusto que falha total é rara

## Configuração (env)

| Variável | Default | Efeito |
|---|---|---|
| `CLAUDE_TIMEOUT_MS` | 60000 | timeout do Claude CLI |
| `CODEX_TIMEOUT_MS` | 120000 | timeout do Codex CLI |
| `ANTHROPIC_API_KEY` | (oauth) | bypassa OAuth do Claude |
| `CLAUDE_CODE_OAUTH_TOKEN` | (none) | token OAuth alternativo |

**Risco já encontrado e documentado**: `CLAUDE_CODE_OAUTH_TOKEN` expirado fazia Claude CLI sair com exit 1 silenciosamente. Hoje resolvido via OAuth persistido em `/root/.claude/.credentials.json`. Se reaparecer: `kind='exit'` em marker_logs com mensagem incluindo "auth" ou "expired".

## Auditoria rápida

```sql
-- últimas 50 falhas de provider
SELECT created_at, result, reason
FROM marker_logs WHERE marker_type='PROVIDER' ORDER BY created_at DESC LIMIT 50;

-- contagem por dia
SELECT DATE(created_at) AS dia, result, count(*)
FROM marker_logs WHERE marker_type='PROVIDER' GROUP BY 1,2 ORDER BY 1 DESC;

-- taxa de fallback nos últimos 7 dias
SELECT
  COUNT(*) FILTER (WHERE result='fallback') AS fallbacks,
  COUNT(*) FILTER (WHERE result='rejected') AS total_failures
FROM marker_logs WHERE marker_type='PROVIDER' AND created_at > NOW() - INTERVAL '7 days';
```

## Verdict

**Para piloto controlado**: aceitável. Erros classificados, fallback funciona, observabilidade existe.

**Para produção plena**, adicionar (em sprint futura):
1. UX message para `all_failed` (após aprovação)
2. Backoff/retry interno de Claude antes de cair pro Codex (evita fallback desnecessário em transients)
3. Monitor/alarme: se `all_failed` > 3 em 1h, notificar coordenador
