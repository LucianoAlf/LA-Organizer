# Precisão da Auditoria do TOM — Design

- **Data:** 2026-06-19
- **Autor:** Claude (brainstorm com Alf)
- **Status:** Spec aprovada para virar plano — **NÃO implementada** (HOLD de deploy ativo)
- **Item de programa:** "F" do audit 15/06 (precisão da auditoria) — ver `project_audit_0615_lotes`, `project_auditoria_tom_0609`
- **Escopo decidido com o Alf:** as 2 camadas (janela + casamento) · casamento por matching semântico (LLM)

---

## 1. Problema

O relatório diário das 07h re-levanta findings de bugs **já corrigidos** → falsos positivos → ansiedade (palavras do Alf). A hipótese inicial era que `occurred_at` em `tom_audit_findings` ≈ a hora em que o auditor rodou, impedindo distinguir um finding pré-fix de um novo.

A investigação (código + dados ao vivo de 19/06) confirma o sintoma mas **recalibra a raiz**: a hipótese do `occurred_at` é real porém secundária. A causa dominante é estrutural.

## 2. Diagnóstico (com evidência)

### Raiz 1 — O relatório não filtra por tempo nem auto-tria (causa dominante)
`checkConversationQuality` ([src/rituals/health-check.js:500-506](../../../src/rituals/health-check.js)) faz:
```js
.select(...).in('status', ['novo', 'confirmado']).order('occurrences', {ascending:false}).limit(200)
```
**Sem nenhum filtro de data.** A única forma de um finding sair do relatório é a triagem **manual** mudar seu `status` para um `CLOSED_STATUSES`.

Snapshot ao vivo (19/06) de `tom_audit_findings`:

| status | n | criado_min | criado_max | occurred_at NULL |
|---|---|---|---|---|
| novo | 72 | 2026-06-10 | 2026-06-19 | 11 |
| corrigido | 59 | 2026-06-07 | 2026-06-15 | 52 |
| resolvido | 4 | 2026-06-08 | 2026-06-08 | 4 |
| falso_positivo | 3 | 2026-06-08 | 2026-06-09 | 3 |

Os **72 findings `novo`** (os mais antigos de 10/06, 9 dias atrás) reaparecem no relatório **todo dia**. Os 59 `corrigido` foram triados **na mão** (provavelmente Claude em sessões passadas, casando com known-issues manualmente) — exatamente o trabalho que esta spec automatiza. Não há findings `confirmado` nem `promovido` em uso.

### Raiz 2 — `occurred_at` é proxy grosseiro ou nulo
`occurred_at` **não** é a hora do auditor: é o `created_at` da **última mensagem da janela de 24h** (fix AUDIT-NO-OCCURRED-AT, [src/services/conversation-audit.js:38-41,59,76-77](../../../src/services/conversation-audit.js)). Antes de 12/06 ficava `NULL`. O LLM nunca recebe timestamps por mensagem no texto auditado ([conversation-audit.js:78-81](../../../src/services/conversation-audit.js)), então não consegue inferir o momento fino. Resultado: campo grosseiro (±24h) e frequentemente nulo (11/72 abertos, 52/59 corrigidos) → não distingue pré-fix de pós-fix com confiança.

### Raiz 3 — Não existe casamento finding↔known-issue (e é difícil)
As tabelas não compartilham chave nem vocabulário:
- `tom_audit_findings` casa por `signature` = `sha1(category : collaboratorId : normalizeSummary(summary))` ([conversation-audit.js:31-36](../../../src/services/conversation-audit.js)); categorias = `confabulation, wrong_refusal, media_fail, dropped_request, frustration, proactive_overreach`.
- `tom_known_issues` casa por `codigo` (único) e `sinal_padrao` (ILIKE em `marker_logs`); `area` = `marker, realtime, dispatcher, financeiro, ai, prompt, …`.

A auto-supressão por `corrigido_em` prometida no comentário ([conversation-audit.js:39-41](../../../src/services/conversation-audit.js)) **nunca foi implementada**. Existe um bom modelo a copiar — a RPC `evaluate_known_issues` já aplica *"sinal posterior ao `corrigido_em` = regressão"*, mas **só sobre `marker_logs`**, não sobre findings de conversa:
```sql
-- trecho de evaluate_known_issues()
if rec.status = 'corrigido' and rec.corrigido_em is not null and v_last > rec.corrigido_em then
  -- retorna como regressão
```

**Conclusão:** a política pedida (tempo real > `corrigido_em`) é a peça de precisão fina, mas sozinha não mata a dor — porque (a) a maioria do ruído é acúmulo sem janela, (b) muitos findings não têm tempo confiável, e (c) o casamento nem existe.

## 3. Objetivos / Não-objetivos

**Objetivos**
1. O relatório das 07h para de reaparecer findings inativos e findings já cobertos por um fix posterior.
2. Findings que **reincidiram depois do fix** (regressões reais) continuam aparecendo — em destaque.
3. Tudo auditável e reversível; nenhuma supressão silenciosa.
4. A triagem humana (campo `status`) continua soberana — máquina nunca a sobrescreve.

**Não-objetivos (YAGNI)**
- Reescrever o auditor de qualidade (`conversation-audit.js` geração de findings) — fora de escopo, exceto gravar `incident_at`.
- Auto-arquivar `status` por idade (a janela é só filtro de leitura; mudar status fica para o futuro, se necessário).
- Casar findings com known-issues **não** corrigidos (`aberto`/`wontfix`) — só `corrigido` participa da supressão.
- Tocar qualquer arquivo do **Balde A (recorrência)**, sob observação.

## 4. Arquitetura — 2 estágios, ambos não-destrutivos

```
health-check 05h
  └─ Estágio 1: JANELA (determinístico, barato)
        filtra findings abertos por atividade recente (last_seen ≤ 7d)
        → pilha antiga inativa sai do corpo (vira contagem)
  └─ Estágio 2: CASAMENTO (LLM, preciso, só sobre o que sobrou)
        para cada finding na janela:
          a) incident_at = tempo real (evidence-anchored, determinístico)
          b) match conhecido? (LLM: finding ↔ known-issue corrigido)
          c) política temporal DETERMINÍSTICA decide: KEEP | SUPPRESS | REGRESSION
        grava veredito em auto_triage (jsonb) — não toca status
relatório 07h (checkConversationQuality)
  filtra por janela + auto_triage; mostra REGRESSION em destaque;
  emite contagens de inativos e já-corrigidos
```

Divisão de trabalho proposital: **o LLM só faz o casamento** (julgamento subjetivo "é o mesmo problema?"); **a decisão temporal é 100% determinística no código** (compara `incident_at`/`last_seen` vs `corrigido_em`). Isso mantém a salvaguarda determinística mesmo com um casador probabilístico.

A janela (Estágio 1) também é a rede de economia: o LLM (Estágio 2) processa só os findings ativos, não os 72.

## 5. Detalhamento

### 5.1 Estágio 1 — Janela de atividade
- **Regra:** finding entra no corpo do relatório se aberto (`status IN ('novo','confirmado')`) **e** `last_seen >= now() - INTERVAL '7 days'`.
- `last_seen` já é atualizado a cada reincidência pelo `upsertFinding` ([conversation-audit.js:152-162](../../../src/services/conversation-audit.js)), logo representa "atividade recente": finding que continua acontecendo fica; finding parado sai.
- Os fora da janela **não são apagados nem têm status mudado** — viram a contagem `🗃️ N inativos (sem reincidência há >7d)`.
- **Parâmetro:** `WINDOW_DAYS = 7` (configurável). Sozinho, este estágio já elimina a pilha de 10/06.

### 5.2 `incident_at` — tempo real do incidente
Nova coluna `incident_at timestamptz` + `incident_confidence text` (`'high' | 'low' | 'none'`).

**Fonte primária — evidence-anchored (determinística):** o finding grava `evidence` (trecho literal, até 1000 chars). Helper `resolveIncidentAt(sb, collaboratorId, evidence, occurredAt, windowSinceIso)`:
1. Extrai um trecho distintivo do `evidence` (remove prefixos `USUÁRIO:`/`TOM:`; pega a substring contígua mais longa, ~80-120 chars).
2. Busca em `conversation_history` a mensagem do mesmo `collaborator_id`, dentro da janela da conversa auditada, cujo `content` **ou** `media_extracted_text` contenha o trecho (ILIKE). Em empate, a mais recente.
3. Achou → `incident_at = created_at` da mensagem, `confidence = 'high'`.
4. Não achou → `incident_at = occurred_at` (proxy de janela), `confidence = 'low'`.
5. `occurred_at` também nulo → `incident_at = NULL`, `confidence = 'none'`.

**Onde calcular:**
- **Forward-fill:** no `upsertFinding`, ao inserir (a janela de 24h ainda está em mãos na geração). Backward na re-detecção não é necessário (incident_at do registro original é estável; regressão é tratada via `last_seen`).
- **Backfill** dos findings existentes: script único que reprocessa `evidence` contra `conversation_history` (janela de busca ≈ `created_at` do finding ± 24h). **Depende de `conversation_history` reter as mensagens antigas** — se podadas, esses findings ficam `confidence='low'/'none'` e são tratados conservadoramente (não suprimidos por tempo); a janela ainda os remove se inativos.

Escolha de evidence-anchored em vez de pedir `occurred_at` ao LLM: alinhado ao princípio de **rede de segurança determinística quando a extração do LLM é frágil** (`project_tom_nega_capacidade`). Melhoria opcional futura (não agora): injetar `[HH:MM]` por mensagem no texto auditado para enriquecer o sinal — fica como nota, não como requisito.

### 5.3 Estágio 2 — Casamento semântico (LLM)
Novo `src/services/finding-triage.js` + `src/prompts/finding-triage-prompt.js`.

**Entrada do LLM:**
- Findings da janela: `{id, category, summary, evidence}`.
- Known-issues candidatos: `tom_known_issues` com `status='corrigido'` e `corrigido_em >= now() - INTERVAL '45 days'` (recorta o prompt; configurável `KI_LOOKBACK_DAYS=45`), campos `{codigo, titulo, area, causa_raiz, fix_resumo, corrigido_em}`.

**Saída do LLM (JSON forçado):** por finding, `{finding_id, matched_code | null, confidence: 0..1, reason}`. O LLM responde **apenas** o casamento — não decide ocultar.

**Regras de robustez:**
- Threshold `MATCH_MIN_CONFIDENCE = 0.7`: abaixo → tratado como "não casou" → KEEP.
- Parsing tolerante (mesmo padrão do `parseFindings`: extrai bloco `{...}`, nunca lança).
- Em lote único enquanto o conjunto da janela for pequeno (1x/dia); fatiar se crescer.
- `chat` (provider de IA) injetado, igual ao `conversation-audit.js` → testável.

### 5.4 Política temporal (determinística — o coração)
Função pura `decideTriage(finding, match, opts)` → `{decision, matched_code, reason}`, sem DB/LLM. Sejam `T_inc=finding.incident_at`, `T_last=finding.last_seen`, `T_fix=match.corrigido_em`.

| # | Condição | Decisão |
|---|---|---|
| 1 | `match` ausente ou `match.confidence < 0.7` | **KEEP** (mostra normal) |
| 2 | known-issue casado não está `corrigido` | **KEEP** |
| 3 | `T_last > T_fix` (reincidência após o fix) | **REGRESSION** (destaque) |
| 4 | `incident_confidence='high'` e `T_inc > T_fix` | **REGRESSION** |
| 5 | `incident_confidence='high'` e `T_inc < (T_fix - MARGIN)` e `T_last ≤ T_fix` | **SUPPRESS** (oculta como já-corrigido) |
| 6 | `incident_confidence ∈ {'low','none'}` (tempo não confiável) | **KEEP** (na dúvida, mostra) |
| 7 | borda: `T_inc` dentro de `MARGIN` de `T_fix` | **KEEP** |

Princípios embutidos:
- **Na dúvida, mostra.** SUPPRESS exige tempo confiável **e** pré-fix **e** sem reincidência pós-fix.
- **`last_seen` pós-fix sempre vence** (regra 3, avaliada antes de SUPPRESS) — protege contra o dedup que congela `occurred_at`/`incident_at` no registro original: mesmo finding antigo, se reincidiu depois do fix, é REGRESSION.
- Comparação em **timestamp completo, UTC** (`incident_at`, `last_seen`, `corrigido_em` são `timestamptz`). Datas locais (America/Sao_Paulo) só na **exibição** — `project_localymd_utc_shift` vale para render, não para comparação de instantes.
- `MARGIN` (default: tratar mesmo-dia/algumas horas como ambíguo → KEEP). `corrigido_em` é setado à mão e pode aproximar o instante do deploy; a margem absorve isso. **Requisito operacional:** ao corrigir um bug, `corrigido_em` deve refletir o **deploy do fix**, não o início da investigação.

### 5.5 Anti-esconder-regressão (defesa em profundidade)
1. Política determinística separada do LLM (§5.4).
2. Threshold de confiança de casamento (§5.3).
3. Regra "na dúvida, mostra" (linhas 1,2,6,7).
4. `last_seen > corrigido_em` ⇒ REGRESSION (linha 3).
5. **Shadow mode de calibração:** rodar a triagem gravando `auto_triage` **sem** o relatório filtrar por uns dias; comparar o que *seria* suprimido contra julgamento humano; calibrar `MATCH_MIN_CONFIDENCE`/`MARGIN`. Só então ligar o filtro.
6. **Transparência permanente:** nada some sem contagem (§5.6).

### 5.6 Transparência no relatório
`checkConversationQuality` passa a:
- Excluir do corpo: inativos (fora da janela) e `auto_triage.decision='suppress'`.
- Destacar `auto_triage.decision='regression'` com `🔁 REGRESSÃO [<codigo>]`.
- Emitir linha-resumo auditável: `🗃️ N inativos · 🔇 M já-corrigidos (cód: ABC, DEF…)`.
- Detalhe sob demanda (lista completa permanece consultável no banco). O Alf nunca fica cego: vê que houve supressão, quantas e por qual known-issue.

## 6. Mudanças de esquema (migração — não aplicar agora)
```sql
ALTER TABLE public.tom_audit_findings
  ADD COLUMN incident_at         timestamptz,
  ADD COLUMN incident_confidence text,   -- 'high' | 'low' | 'none'
  ADD COLUMN auto_triage         jsonb;  -- {decision, matched_code, match_confidence, reason, decided_at}
```
`decision ∈ {'keep','suppress','regression'}`. Sem CHECK rígido (consistente com o resto da tabela, validação na app). Aplicar via `apply_migration` na fase de implementação.

## 7. Onde aplicar no código (mapa)

| Arquivo | Mudança |
|---|---|
| `src/services/conversation-audit.js` | `upsertFinding`: calcular e gravar `incident_at`/`incident_confidence` na inserção. Novo helper `resolveIncidentAt(...)`. (Não mexer na lógica de dedup/`signature`.) |
| `src/services/finding-triage.js` *(novo)* | `triageOpenFindings(sb, chat, opts)`: carrega janela → carrega known-issues corrigidos recentes → LLM matching → `decideTriage` por finding → compõe `auto_triage = {...decideTriage, match_confidence, decided_at}` e grava. Retorna `{kept, suppressed, regressions, inactive}`. Inclui `decideTriage` (pura: retorna só `{decision, matched_code, reason}`). |
| `src/prompts/finding-triage-prompt.js` *(novo)* | Builder do prompt de matching (system + user), JSON forçado. |
| `src/rituals/health-check.js` | `checkConversationQuality`: filtro de janela + leitura de `auto_triage` + contagens/destaque. Chamar `triageOpenFindings` **antes** (novo check, ex.: CHECK 13.5, ordenado antes do 14) para que o veredito exista na leitura. |
| `src/rituals/dispatcher.js` | Nenhuma mudança de agendamento (reusa health-check 05h / relatório 07h). |
| `scripts/backfill-incident-at.js` *(novo, opcional)* | Backfill de `incident_at` nos findings existentes a partir de `conversation_history`. |

Ordem de execução no health-check: **triagem grava `auto_triage` → `checkConversationQuality` lê**. Ambos isolados em try/catch (padrão atual): falha na triagem nunca derruba o relatório — degrada para o comportamento de hoje (mostra tudo da janela).

## 8. Testes (TDD — escrever antes da implementação)
- **`resolveIncidentAt`** (unit): evidence casa → `high`; sem casar mas com `occurred_at` → `low`; ambos ausentes → `none`; evidence multi-linha; ILIKE com caracteres especiais.
- **`decideTriage`** (unit, pura — cobre a tabela §5.4): todas as 7 linhas + bordas; `T_last` pós-fix vence supressão; `confidence` baixo nunca suprime.
- **Parsing do matching** (unit): JSON malformado não lança; respeita threshold.
- **Integração dry-run:** rodar sobre os findings reais (snapshot dos 72) **sem gravar**, revisar decisões manualmente.
- **Shadow mode** (§5.5) antes de ligar o filtro de leitura.
- Validar no ambiente real (VPS/Supabase) — `project_local_vps_desync`: alguns arquivos só existem na VPS; E2E roda lá.

## 9. Casos de borda
- **Conversa podada** → `incident_at` cai p/ `low`/`none` → conservador (não suprime; janela ainda atua).
- **Finding sem match** → KEEP (comportamento de hoje, mas dentro da janela).
- **Known-issue reaberto** (volta a `aberto`) → deixa de suprimir (regra 2).
- **Vários known-issues casam o mesmo finding** → escolher o de `corrigido_em` mais recente; se algum sinaliza regressão (T_last/T_inc > seu T_fix), REGRESSION vence.
- **Reincidência no mesmo dia do fix** → MARGIN/borda → KEEP (evita falso "já-corrigido" e falso "regressão").
- **Finding fechado manualmente** (`CLOSED_STATUSES`) → já fora da query; triagem não atua sobre ele (status humano soberano).

## 10. Riscos e mitigações
| Risco | Mitigação |
|---|---|
| LLM casa errado e esconde bug real | política determinística separada · threshold · na-dúvida-mostra · `last_seen` vence · shadow mode · contagens transparentes |
| `conversation_history` podado | fallback `low`/`none` + janela |
| `corrigido_em` impreciso (humano) | MARGIN + requisito "corrigido_em = deploy do fix" |
| Custo de tokens | janela reduz o conjunto · known-issues recortados por recência · 1x/dia |
| Divergência local↔VPS | validar no ambiente real (`project_local_vps_desync`) |

## 11. Parâmetros (defaults; o Alf ajusta)
- `WINDOW_DAYS = 7`
- `KI_LOOKBACK_DAYS = 45`
- `MATCH_MIN_CONFIDENCE = 0.7`
- `MARGIN` = mesmo-dia ambíguo → KEEP

## 12. Restrições operacionais
- **HOLD de deploy ativo** (`D:\la-organizer\.deploy-hold`) — esta spec **não** é implementada nem deployada agora.
- **Não tocar Balde A (recorrência)** — sob observação. Os arquivos desta spec (`conversation-audit.js`, `health-check.js`, novos serviços) não são do Balde A; confirmar antes de codar.
- Rotacionar chaves Supabase antes de produção (`project_rotate_keys_before_prod`).
- Ao implementar e corrigir: registrar em `tom_known_issues` (protocolo de bugs do `CLAUDE.md`); código sugerido `AUDIT-PRECISION-WINDOW-MATCH`.

## 13. Critérios de aceite
1. Relatório das 07h deixa de listar findings inativos (>7d sem reincidência) e os já cobertos por fix posterior, substituindo-os por contagens.
2. Um finding que reincide **após** `corrigido_em` aparece como `🔁 REGRESSÃO`.
3. Nenhum `status` é alterado por máquina; CLOSED permanece fora.
4. Toda supressão é auditável (contagem + `auto_triage` no banco).
5. Shadow mode mostra taxa de falso-suprimido aceitável **antes** de o filtro entrar em produção.
