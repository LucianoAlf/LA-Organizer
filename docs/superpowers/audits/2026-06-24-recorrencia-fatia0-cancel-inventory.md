# Inventário de paths de CANCEL — Fatia 0 (Raiz 1, recorrência)

- **Data:** 2026-06-24
- **Fatia:** 0 (rede de segurança) — Parte 2
- **Spec:** `docs/superpowers/specs/2026-06-24-recorrencia-ciclo-de-vida-design.md`
- **Por que existe:** escapar um path de cancel é o vetor de regressão nº 1 da Fatia 2/3. Aqui está TODO lugar que escreve `status='cancelled'` que pode atingir um MOLDE recorrente, classificado. Sem este inventário completo, a Fatia 2 não sobe.

## Legenda
- **❶ ENCERRA SÉRIE** (toca o MOLDE / nível-série) → na **Fatia 3** tem que passar a setar `series_ended_at` no template.
- **❷ CANCELA SÓ A OCORRÊNCIA** (mira a instância / protege o molde) → **NÃO** seta `series_ended_at`.
- **⚠ RISCO** = intent ❷ mas pode atingir o molde sem proteção (verificar).
- **▢ FORA DE ESCOPO** = não é molde de tarefa/evento recorrente.

---

## ❶ ENCERRA SÉRIE — worklist da Fatia 3 (setar `series_ended_at`)

| # | Local | O que faz | Nota |
|---|---|---|---|
| 1 | `src/engine.js:4344-4364` (ramo `a.scope === 'series'`) | Resolve `templateId` (rule!=null ? id : parent_id), cancela o **molde** (4352-4355) + instâncias **futuras** não-done (4356-4360, `.gte('due_date', hoje)`). | 1:1 canônico "encerrar série". **Na spec §4.5.** ✅ |
| 2 | `src/services/group-chat-tasks.js:293-297` (`endSeries`) | Cancela o **molde** (294) + **TODAS** as instâncias não-done (295, **sem** filtro de data). | Grupo "encerrar série". **Na spec §4.5.** ⚠ **Discrepância c/ #1:** cancela passado também (engine 1:1 só futuras). Caracterizado em `GM8`. Decidir na Fatia 3 se uniformiza. |
| 3 | `web/src/lib/editTaskSeries.ts:55-94` (`this_and_future`, `newRule !== undefined`) | Cancela futuras pendentes incl. o **molde** se for futuro (57-62, via `futurePendingIds` que inclui a linha do template); seta `recurrence_rule` (65-66); se `newRule===null` (**desligar**) desvincula sobreviventes (78-83). | **PWA "editar/desligar série" — NÃO está na spec §4.5 (gap fechado por esta Fatia 0).** O sinal de "desligar" no PWA é `recurrence_rule=null`, não `status=cancelled`. **Fatia 3:** ao desligar (`newRule===null`), setar TAMBÉM `series_ended_at` p/ consistência com o modelo novo (o rule=null já trava o `materializeAll`, mas o ciclo fica explícito). |

> **Forward-only cobre #1/#2/#3 nos dados atuais:** o backfill (Fatia 1) marca todo molde já `cancelled` com `series_ended_at` → nenhuma série encerrada hoje muda de comportamento no deploy.

---

## ❷ CANCELA SÓ A OCORRÊNCIA — não tocar (não setar `series_ended_at`)

| # | Local | O que faz | Nota |
|---|---|---|---|
| 4 | `src/engine.js:4366-4370` (cancel default, sem scope) | Cancela `tCan.id` (a tarefa resolvida). | Intent = cancelar ESTA ocorrência. ⚠ **Conflação latente:** se o usuário cancela a 1ª ocorrência e essa linha É o molde (molde=1ª ocorrência), hoje **congela a série**. **Pós-Fatia-2 o guard keia `series_ended_at` (segue null) → NÃO congela** → a Fatia 2 conserta isso de brinde também. |
| 5 | `src/services/group-chat-tasks.js:234-258` (action `cancel`) | `pickInstanceTarget(hit)` (nunca o molde, filtra rule==null) → cancela a **instância** (254) + filhas se mãe-grupo (256). | Protege o molde por construção. ✅ |
| 6 | `src/services/group-chat-tasks.js:156-170` (dedup recorrente) | Antes de re-materializar com regra nova, cancela instâncias **futuras** não-done (`recurrence_parent_id=dup.id`, 165-166). | Churn interno, mira instâncias. ✅ |

---

## ⚠ RISCO — verificar na Fatia 2/3

| # | Local | O que faz | Risco |
|---|---|---|---|
| 7 | `web/src/hooks/useGroupWorkspace.ts:149-156` (`cancelTask`) | `update({status:'cancelled'}).eq('id', id)` — `id` vem CRU do card (`GrupoWorkspace` → `onCancelTask`). **Sem** `pickInstanceTarget`. | Se a UI do grupo renderizar um **molde** como card e o user clicar cancelar, cancela o molde → congela a série. **Verificar se o pool do grupo expõe id de molde.** Se sim, é bug latente "cancelar-ocorrência congela série" que a Fatia 2 conserta (guard passa a keiar `series_ended_at`). |

---

## ▢ EVENTOS — fronteira de escopo (NÃO coberto por `series_ended_at`)

A spec é **tasks-only** (`ALTER TABLE tasks`, §4.1). Eventos também têm molde recorrente (`materializeSeries('events', …)`), e cancelar o molde de evento **congela a série de evento igual**. Fora do escopo desta Raiz 1 — registrar como fronteira:

- `src/engine.js:1414/1420` (cancel de evento), `3159-3161` (patch de status do evento).
- `web/src/components/EditEventSheet.tsx:274`, `web/src/screens/Hoje.tsx:424`, `web/src/screens/AgendaEscolar.tsx:225/230`, `web/src/components/ConvertToEventSheet.tsx:85` (task→event seta task `cancelled`).

> **Decisão:** se a conflação de evento aparecer em uso, abrir Raiz 1-bis (espelhar `series_ended_at` em `events`). Hoje sem evidência de dor → não ampliar o escopo.

---

## ▢ FORA DE ESCOPO — não é recorrência de tarefa/evento

- **Comunicados/announcement_jobs:** `engine.js:967, 1090, 1995`; `dispatcher.js:1022`.
- **Cascata de coordenação** (`cancelled_reason`): `engine.js:1694, 1840`.
- **Projetos** (reject): `engine.js:2841`; `web/ProjetosDesktop.tsx:152`.
- **Fila de operações** (LA Report): `web/OperacaoDetalhe.tsx:135`, `web/OperacoesFilaTecnica.tsx:284` — tarefas operacionais one-off, sem recorrência.

---

## Conclusão (critério de aceite da Parte 2)

- **3 paths ❶** que encerram série (a spec §4.5 listava **2** — o `editTaskSeries.ts` do PWA é o 3º, achado da Fatia 0).
- **1 path ⚠** a verificar (`useGroupWorkspace.cancelTask`, id cru sem proteção de molde).
- **1 discrepância** de comportamento entre os dois ❶ canônicos (endSeries cancela passado; engine 1:1 só futuras).
- **Fronteira de eventos** explicitada (fora de escopo, registrada).

Sem esses 3 paths cobertos na Fatia 3, "encerrar série" não setaria `series_ended_at` por algum caminho → série encerrada voltaria a gerar na Fatia 2 (regressão). Por isso viram trabalho explícito e verificável.

---

## FECHAMENTO (Fatias 2 + 3, 24/06)

**Fatia 2 (flip + writes acoplados):** o flip de leitura (guard/materializeAll/PWA) e os writes de fim-de-série eram um ÁTOMO — separar regrediria "para de me lembrar". Então os ❶ #1 (engine `scope:'series'` → `endSeries1on1`) e #2 (grupo `endSeries`) já gravam `series_ended_at` na F2; `reviveSeries` limpa. Provado: E2E real VPS 10/10.

**Fatia 3 (faxina):**
- **❶ #3 `editTaskSeries.ts` (PWA):** RESOLVIDO — desligar (`newRule===null`) agora seta `series_ended_at=now()` (re-ativar com regra nova limpa). Cinto-e-suspensório (já parava via `rule=null`).
- **Discrepância passado×futuro (❶ #1 vs #2):** RESOLVIDA — **uniformizado para TUDO não-done**. `endSeries1on1` deixou de filtrar `.gte('due_date', hoje)` → cancela o overdue passado também (igual ao grupo `endSeries`). Razão: "não preciso mais" tem que matar o atraso, senão vira nag fantasma de série encerrada. Soft/reversível via revive. Golden cobre (instância passada cancelada).
- **⚠ #7 `useGroupWorkspace.cancelTask`:** RESOLVIDO pelo flip da F2 (sem código novo). Ele seta só `status='cancelled'` (não `series_ended_at`) → pós-flip o guard ignora status → cancelar a ocorrência-molde **NÃO congela** a série (a série segue ativa, `series_ended_at` null). É exatamente o teste golden "PAR — molde cancelled mas não encerrado → gera". O bug latente "cancelar-ocorrência congela série" morreu de brinde.
- **153 congelados (§9-D):** heal sob demanda quando um dono reclamar (por design, não regressão) — drenam via guard.
