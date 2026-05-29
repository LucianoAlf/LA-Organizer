# Design — Monitor de Saúde do Provider de IA (observabilidade)

**Data:** 2026-05-29
**Status:** aguardando revisão do usuário.
**Escopo:** observabilidade pura. NÃO reduz latência — só expõe o dado pra decidir depois.

## Problema

O TOM demora pra responder (medido: **mediana 22,6s, P95 72,5s, máx 180s** nas últimas 48h),
mas isso é **invisível** — ninguém olha. A tabela `tom_metrics` **já coleta** latência, provider,
fallback e erro por mensagem, só que nada exibe esse dado. Resultado: decisões sobre agir
(enxugar prompt, load-balancer, trocar provider) acabam sendo tomadas no susto de um pico isolado,
não com tendência real.

Além disso, há um erro recorrente no log: o insert de `marker_logs` com `result='fallback'`
(quando o Claude cai pro Codex) viola o CHECK constraint `marker_logs_result_check`
(`executed/rejected/skipped/redirected`) → a linha de auditoria do fallback é descartada e o log
cospe `[marker_logs] insert err type=PROVIDER result=fallback` toda vez.

## Escopo (e não-escopo)

- **No escopo:**
  1. Novo health-check `checkProviderHealth` que lê `tom_metrics` (24h) e mostra latência
     (mediana/P95/máx), nº de mensagens, % fallback, nº de falhas totais e nº acima de 60s — no
     relatório diário das 07:00 que já existe.
  2. Migration que adiciona `'fallback'` ao CHECK constraint `marker_logs_result_check`, encerrando
     o erro recorrente e fechando o registro de auditoria do fallback.
- **Fora do escopo (passos futuros, decididos COM esse dado):**
  - Reduzir a latência (enxugar o system prompt de ~100KB).
  - Load-balancer Sonnet+Codex / trocar provider primário.
  - Alerta/paging proativo — por ora é só uma linha no relatório diário (mesmo padrão dos outros checks).

## Arquitetura

Reusa 100% a infra existente. Sem tabela nova, sem serviço novo, sem coleta nova de telemetria.

- **Fonte de dado:** `tom_metrics` (já populada por `metricsService.recordMessage` no fim de cada
  mensagem em `engine.js`). Colunas relevantes: `ts`, `latency_ms`, `provider_used`,
  `fallback_from`, `error_kind`.
- **Novo check:** `checkProviderHealth()` em `src/rituals/health-check.js`, seguindo o contrato dos
  demais checks: `async function` que retorna `{ status: 'ok'|'warning'|'error', detail: string }`.
  - Query: `tom_metrics` onde `ts > now() - 24h`.
  - Agrega: total de msgs; latência mediana/P95/máx; nº com `fallback_from` não-nulo; nº com
    `error_kind` não-nulo (falha total); nº com `latency_ms > 60000`.
  - Percentis: feitos no SQL (`percentile_cont`) numa única query agregada — evita puxar milhares de
    linhas pro Node. Helper retorna o objeto pronto.
  - **Threshold (warning):** mediana > 30s **ou** P95 > 90s **ou** %fallback > 10% **ou** qualquer
    falha total > 0. Senão `ok`. (Valores em `WARN_THRESHOLDS`, ajustáveis.)
  - `detail` (exemplo): `251 msgs · mediana 22.6s · P95 72.5s · máx 180s · fallback 3.2% · falhas 0`.
- **Registro:** adicionar `checkProviderHealth` ao array `ALL_CHECKS` (render automático no relatório).
- **Constraint fix:** migration `ALTER ... DROP CONSTRAINT marker_logs_result_check` +
  re-`ADD` incluindo `'fallback'`. Idempotente (drop if exists).

### Data flow
```
cron 07:00 → runHealthCheck() → checkProviderHealth() → query agregada tom_metrics(24h)
  → { status, detail } → sendHealthReport() renderiza a linha no WhatsApp do Alf
```

## Error handling

Telemetria/health NUNCA pode quebrar o relatório. `checkProviderHealth` é try/catch:
se a query falhar, retorna `{ status: 'error', detail: 'provider-health indisponível: <msg>' }`
— o relatório continua com os outros checks (mesmo padrão de `checkMemoriesEmbedding`).
Se não houver mensagens em 24h, retorna `{ status: 'ok', detail: 'Sem mensagens nas últimas 24h' }`.

## Testes

Sem framework formal — smoke determinístico + checagem manual.
1. **Smoke** `scripts/smoke-provider-health.js`: chama `checkProviderHealth()` real contra o banco
   no VPS e imprime `{ status, detail }`. PASS = retorna objeto com `detail` contendo
   `mediana`/`fallback`/`falhas` e `status` ∈ {ok,warning,error}.
2. **Conferência cruzada:** rodar a query agregada manual (a mesma do design) e bater os números
   com o `detail` do smoke.
3. **Constraint:** após a migration, `INSERT` de teste com `result='fallback'` em `marker_logs`
   deve passar; `pg_get_constraintdef` deve listar `'fallback'`. (Insert de teste removido em
   seguida, ou usa transação com rollback.)

## Riscos / mitigações

- **Percentil pesado em tabela grande:** mitigado fazendo no SQL com filtro de 24h (poucos milhares
  de linhas no máximo) + a query roda 1×/dia.
- **Threshold mal calibrado (warning demais/de menos):** valores em `WARN_THRESHOLDS`, fáceis de
  ajustar; "lançar e observar" como combinado.
- **Constraint migration:** drop+add do CHECK é seguro (não mexe em dados); idempotente.

## Não faz parte (adiado consciente)

- Redução de latência (enxugar prompt) — próximo esforço, guiado por este monitor.
- Dashboard/gráfico — por ora a linha no relatório diário basta.
- Alerta em tempo real (fora da janela das 07:00).
