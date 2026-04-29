# Observabilidade do TOM (Sprint 10)

Telemetria operacional do motor. Sem dashboard nesta sprint — só tabela + endpoint JSON.

## Tabela `tom_metrics`

Uma linha por `processMessage`. Service-role only (RLS).

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid | PK auto |
| `ts` | timestamptz | quando processou |
| `collaborator_id` | uuid | FK collaborators |
| `message_kind` | text | text / audio / ritual / internal |
| `provider_used` | text | claude / openai / none |
| `fallback_from` | text | "claude" se Codex respondeu após Claude falhar |
| `latency_ms` | integer | tempo total `processMessage` |
| `input_tokens` | integer | do meta do provider |
| `output_tokens` | integer | do meta do provider |
| `sanitized_chars` | integer | quantos chars o sanitizer da camada 3 stripou |
| `leak_blocked` | bool | regex anti-leak (segunda linha) bateu? |
| `leak_match` | text | trecho que casou (debug) |
| `marker_emitted` | text | se 1+ marker rolou (preenchimento futuro) |
| `marker_result` | text | executed / rejected (preenchimento futuro) |
| `error_kind` | text | se all_providers_failed |
| `skill_active` | text | skill name (preenchimento futuro) |

Insert via `src/services/metrics.js#recordMessage(payload)` — fail-silent, nunca quebra fluxo principal.

## Endpoint `GET /internal/metrics`

Auth: header `x-internal-secret` (mesma porta do `/internal/project-created`).

Resposta JSON com agregados 24h e 7d:

```json
{
  "generated_at": "...",
  "windows": {
    "24h": {
      "total": 0,
      "latency": { "median_ms": null, "p95_ms": null, "p99_ms": null },
      "provider": { "claude": N, "openai": N },
      "fallback_count": 0,
      "leak_blocked_count": 0,
      "sanitized_chars_total": 0,
      "sanitized_messages_count": 0,
      "error_count": 0,
      "kind": { "text": N, "audio": N },
      "tokens": { "input_total": N, "output_total": N }
    },
    "7d": { ... }
  },
  "markers_24h": { "TASK_UPDATE.executed": N, "EVENT_CREATE.executed": N, "PROVIDER.fallback": N }
}
```

## Como consultar

```bash
SECRET=$(grep INTERNAL_API_SECRET /opt/LA-Organizer/.env | cut -d= -f2)
curl -s -H "x-internal-secret: $SECRET" http://localhost/internal/metrics | jq
```

## Pendências Sprint 11+

- Popular `marker_emitted`/`marker_result`/`skill_active` (precisa instrumentar ainda mais o pipeline).
- Snapshot diário (cron 23h) gravando agregados em `marker_logs` com `marker_type=METRIC_SNAPSHOT`.
- Dashboard no PWA (longe — só quando tiver demanda).
