# Design — Ledger de Incidentes do TOM (`tom_known_issues`)

**Data:** 2026-05-29
**Pilar:** 1 de 4 da visão "TOM coach autoaperfeiçoável" (este spec cobre SÓ o Pilar 1).
**Status:** aguardando revisão do usuário.

## Problema

A cada compactação de conversa o contexto some, e a auditoria diária das 07:00 vira "lista de
alarmes que se repetem" sem memória. Não há como saber se um bug *corrigido voltou* ("mexe uma
coisa, quebra outra"). Com a base de usuários crescendo (22→+), isso vira dor estrutural.

Já existe sinal cru (`marker_logs`, `notifications`, health-check), mas falta uma **camada curada**:
1 linha por *classe* de incidente, com causa-raiz, fix, status e detecção de reincidência.

## Escopo (e não-escopo)

- **No escopo:** ledger de incidentes técnicos/operacionais + radar de regressão via auditoria diária.
- **Fora do escopo (outros pilares):** conhecimento de "mau uso → boa prática" que o TOM usa pra
  ensinar (Pilar 2 — coach); anti-cobrança-vazia (Pilar 3); autoaperfeiçoamento (Pilar 4).
- **Sem UI nova** (YAGNI). Consulta via Claude no início da sessão + seção no relatório das 07:00.

## Arquitetura

Componente único: tabela `tom_known_issues` + um avaliador read-only acoplado à auditoria diária
(`health-check.js`). Sem serviço novo, sem cron novo (reusa o slot das 07:00).

### Schema `tom_known_issues`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `codigo` | text UNIQUE NOT NULL | Código curto (ex: `B2`, `DUP-SOURCE`) |
| `titulo` | text NOT NULL | |
| `area` | text NOT NULL | `marker`/`dispatcher`/`audio`/`realtime`/`coordination`/`health-check`/... |
| `severidade` | text NOT NULL | CHECK in (`critico`,`alto`,`medio`,`baixo`) |
| `status` | text NOT NULL default `aberto` | CHECK in (`aberto`,`corrigido`,`wontfix`) |
| `causa_raiz` | text | |
| `fix_resumo` | text | inclui commit/sprint se relevante |
| `sinal_tipo` | text NOT NULL default `manual` | CHECK in (`marker_log`,`manual`) |
| `sinal_padrao` | text | ILIKE aplicado a `marker_type || ' ' || coalesce(reason,'')`. Null se manual |
| `colaboradores_afetados` | text[] default '{}' | nomes (dedupe); auto via auditoria, manual por mim |
| `primeira_vez` | timestamptz | |
| `ultima_vez` | timestamptz | |
| `ocorrencias` | int NOT NULL default 0 | |
| `corrigido_em` | timestamptz | setado ao virar `corrigido` |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | |

**Índices:** `codigo` (unique), `(status, severidade)`, `(ultima_vez desc)`.
**RLS:** service-role full (dado operacional interno, sem PII além de nomes — stance de dev;
travar pra produção quando expor).
**Regressão é query, não coluna:** `status='corrigido' AND ultima_vez > corrigido_em`.

### Avaliador (na auditoria diária — health-check.js)

Novo check `checkKnownIssuesRegression()`, roda no slot das 07:00. Para cada issue com
`sinal_tipo='marker_log'` e `sinal_padrao` não-nulo:

```sql
SELECT count(*) n, max(created_at) last_seen, array_agg(distinct collaborator_id) collabs
FROM marker_logs
WHERE (marker_type || ' ' || coalesce(reason,'')) ILIKE :sinal_padrao
  AND created_at > now() - interval '24 hours'
```

- Se `n > 0`: `ocorrencias += n`, `ultima_vez = last_seen`, mescla nomes resolvidos em
  `colaboradores_afetados`, `updated_at = now()`.
- Se `status='corrigido' AND last_seen > corrigido_em` → **REGRESSÃO** → entra na seção nova do
  relatório das 07:00.
- Cada issue roda em try/catch isolado (um sinal ruim não derruba a auditoria).
- Read-only em `marker_logs`; escreve só em `tom_known_issues`.

### Saída no relatório das 07:00 (sendHealthReport)

Seção nova quando houver regressões:
```
🔁 Regressões (corrigido mas voltou):
• B2 Dup-task — corrigido 29/05, reincidiu hoje (3×, afetou: Quintela, Léo)
```
(Abertos críticos podem listar numa linha-resumo; sem inflar o relatório.)

## Ciclo de vida

- `aberto` → identificado, não corrigido.
- `corrigido` → fix deployado (`corrigido_em` setado); sob vigilância automática do radar.
- `wontfix` → decidido não corrigir (comportamento esperado ou risco > benefício).

**Quem escreve:** Claude (entrada principal, ao identificar/corrigir). A auditoria SÓ atualiza
contadores/última-vez/afetados das linhas com sinal — nunca cria linha (curadoria é humana/Claude).

**Consulta:** Claude roda "abertos + regressões" no início de cada sessão (memória entre
compactações). Usuário vê via relatório das 07:00.

## Seed inicial (casos de 29/05)

Inserir os ~12 incidentes do Sprint 31.6 + 2 anteriores, status `corrigido`, `corrigido_em`=hoje:

| código | sinal_tipo | sinal_padrao | afetados |
|---|---|---|---|
| B1 EVENT_UPDATE edita | marker_log | `%EVENT_UPDATE%schema_invalid%` | — |
| B2 dup-task sufixo | marker_log | `%integrity_dup_task%` | Quintela |
| B3 HABIT_ACTION schema | marker_log | `%HABIT_ACTION%schema_invalid%` | — |
| B4 STICKER ruído | marker_log | `%STICKER%` | — |
| B5 coordination claro | marker_log | `%recipient_not_found%` | — |
| C1 ACTIONABLE inflado | marker_log | `%ACTIONABLE_NO_MARKER%` | — |
| E2 reschedule delegado | manual | — | Krissya, Arthur |
| DUP-SOURCE (`source='tom'`) | manual | — | Quintela |
| AUDIO-RETRY | manual | — | Krissya |
| D1 métrica overdue | manual | — | — |
| D2 realtime log | manual | — | — |
| D3 Admin na métrica | manual | — | — |

## Testes

1. Migration aplica limpo (tabela + índices + checks).
2. Seed inserido — contar linhas (~12).
3. Avaliador rodado contra `marker_logs` real → confirma bump de `ocorrencias` onde há match em 24h.
4. **Radar (o ponto central):** caso controlado — issue `corrigido` com `corrigido_em` no passado +
   um `marker_log` que casa o sinal → a query de regressão DEVE retorná-lo. Limpar o caso de teste.

## Riscos / mitigações

- **Falso positivo de regressão:** um sinal largo demais (ex: `%schema_invalid%`) pega ruído de
  outros markers. Mitigação: sinais sempre incluem o `marker_type` (ex: `%EVENT_UPDATE%schema_invalid%`).
- **Crescimento descontrolado:** a auditoria nunca cria linhas; só Claude/humano. Sem explosão.
- **Lixo manual:** incidentes manuais dependem de disciplina — aceitável, é curadoria.

## Não faz parte (decisões adiadas conscientes)

- UI / comando `/casos` (adicionar quando houver dor real de consultar fora das conversas).
- Sinais via grep de logs (audio/realtime) — ficam `manual` por ora.
- Integração com Pilares 2-4 (cada um terá seu próprio spec).
