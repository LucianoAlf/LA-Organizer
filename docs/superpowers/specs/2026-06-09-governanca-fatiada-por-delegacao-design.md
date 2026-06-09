# Governança fatiada por delegação — Design

> **Status:** aprovado no brainstorm (Alf, 09/06/2026). Próximo passo: plano de implementação (writing-plans).
> **Contexto anterior:** Fase 1 entregou a matriz de governança editável (quem reporta a quem — `governance_edges` + `governance_leaders`). Esta é a **Fase 2**, deixada deferida.

## Problema

Hoje, no relatório de governança (digest do TOM + Dashboard time no PWA), **cada líder de uma pessoa vê TODAS as tarefas dessa pessoa**. Quando alguém tem múltiplos líderes (ex.: a Gabi reporta ao Jereh = gerente da unidade, à Rose = financeiro, à Fabíola = sucesso do cliente), todos recebem tudo dela. O Jereh acaba vendo o financeiro da Rose, a Rose vê operacional que não é dela, etc. O relatório fica poluído e a cobrança fica difusa ("de quem é essa tarefa, afinal?").

## Decisão central: a fatia = QUEM DELEGOU (não o tema)

Descartada a ideia de classificar a tarefa por **tema/categoria** (financeiro, comercial, operacional). Motivo: é ambíguo e geraria erro crônico — "cobrar mensalidade" é financeiro ou operacional? Depende de quem mandou. Exemplos do Alf:
- A Rose delega uma cobrança pra Gabi → a tarefa fica **presa na Rose** (ela cobra), não importa o tema.
- O Jereh (gerente) delega "cobrar mensalidades atrasadas" pra Gabi → fica **presa no Jereh**, **mesmo sendo financeiro por tema**, porque foi ele que delegou.

**Regra de ouro:** a governança fica amarrada na **delegação**. Quem delegou é dono da cobrança. O tema da tarefa é irrelevante para o roteamento.

## Modelo de dados

Nova coluna em `tasks`:
- `governance_owner_id uuid NULL` — FK lógica para `collaborators(id)`. O **líder dono da cobrança** (quem delegou).
- `NULL` = tarefa **não-delegada** (a pessoa criou pra si / dia a dia) → catch-all: cai no **gerente da unidade** do dono (computado no roteamento, não armazenado).
- Índice em `governance_owner_id` para o filtro dos relatórios.

Sem novo enum de "grupo/tema". A coluna guarda uma **pessoa** (o líder), não uma categoria. Reaproveita `governance_leaders` apenas para resolver "re-delegar pra um departamento" → o líder daquele departamento.

**Por que assim:** zero ambiguidade, uma coluna só, e as 905 tarefas existentes continuam funcionando (NULL = cai no gerente, exatamente como hoje). Migração de dados é opcional (backfill leve, abaixo).

## Como `governance_owner_id` é preenchido

1. **Criação automática (90% dos casos, zero fricção):**
   - Tarefa criada por alguém **para outra pessoa** (`assigned_to ≠ created_by`) → `governance_owner_id = created_by` (o delegador).
   - Tarefa criada pela própria pessoa (`assigned_to = created_by`) → `NULL` (dia a dia → gerente da unidade).
   - Vale tanto no **TOM** (ex.: "Rose: cria tarefa pra Gabi cobrar X" → posse = Rose) quanto no **PWA** (atribuiu a outro → posse de quem atribuiu).

2. **Re-delegação explícita (passa a posse):**
   - **TOM (WhatsApp):** o dono atual responde "isso é da Rose" / "manda pro financeiro" → o engine resolve o novo dono (a pessoa citada, ou o líder do departamento via `governance_leaders` para a unidade do dono da tarefa) e atualiza `governance_owner_id`. O dono anterior some da cobrança.
   - **PWA:** botão "Passar cobrança pra…" no card da tarefa → escolhe um líder/departamento → atualiza `governance_owner_id`.

3. **Backfill leve (opcional, recomendado pra já nascer povoado):** nas tarefas atuais, `governance_owner_id = created_by` onde `assigned_to ≠ created_by` (já era delegada). As soltas (`assigned_to = created_by`) ficam NULL → caem no gerente.

## Roteamento (a função pura, espelhada)

Espelhada em JS (TOM, `src/services/leader-routing.js` ou módulo próprio) e TS (PWA, `web/src/lib/team-routing.ts`), com testes nos dois — mesmo padrão da Fase 1.

Para o digest/visão de um líder **L**, ele vê a tarefa **T** (dona = pessoa P) se:
- `T.governance_owner_id = L.id` (L delegou a tarefa), **OU**
- `T.governance_owner_id IS NULL` **E** L é o **gerente da unidade** de P (catch-all do operacional solto). As arestas manuais `governance_edges` (L→P) também enxergam o catch-all (são "chefes extras" do dia a dia).

O **CEO vê tudo** (sem filtro) — inalterado.

Os líderes de tema (em `governance_leaders`, ex.: Rose=financeiro) **NÃO** veem mais "tudo da pessoa": veem só o que **eles** delegaram. `governance_leaders` passa a servir para (a) a matriz/UI de quem lidera cada departamento e (b) resolver "re-delegar pro departamento X" → líder de X.

### Tabela-verdade (exemplo do Alf — Gabi e Vitória, unidade Campo Grande, gerente Jereh)

| Tarefa | Dono | Quem delegou | `governance_owner_id` | Quem cobra na governança |
|---|---|---|---|---|
| Cobrar mensalidade do aluno X | Gabi | Rose | Rose | **Rose** |
| Cobrar mensalidades atrasadas | Gabi | Jereh | Jereh | **Jereh** (mesmo sendo financeiro) |
| Organizar a baia (criou sozinha) | Gabi | — | NULL | **Jereh** (gerente, catch-all) |
| Fechar matrícula (criou sozinha) | Vitória | — | NULL | **Jereh** (gerente, catch-all) |
| Fechar matrícula (Krissya mandou) | Vitória | Krissya | Krissya | **Krissya** |

## Onde aparece (superfícies)

- **Digest de governança do TOM** (`sendLeaderGovernanceDigest`, `ceoTeamUnclosedTasksReport`, `sendGovernanceDigest`): filtra as tarefas pela posse. Cada líder recebe só as dele + as soltas do time (se gerente). O bloco de **Diagnóstico 🔍 + Recomendação 💡** (governance-analyzer) continua, agora fatiado por dono-de-cobrança.
- **PWA Dashboard time:** a visão de cada líder filtra pela posse. Botão "Passar cobrança pra…" no card.

## Rollout — 3 sub-fases (cada uma entrega valor sozinha, sem quebrar)

1. **Coluna + backfill + roteamento fatiado.** Existentes soltas → gerente (como hoje); nada some. Função pura + testes JS/TS. Digests passam a filtrar.
2. **Captura no TOM:** criação delegada marca posse automaticamente + re-delegação por WhatsApp ("isso é da Rose").
3. **PWA:** filtro no Dashboard time + botão "Passar cobrança pra…".

## Casos de borda / erro

- `governance_owner_id` aponta para alguém **inativo / sem time** → cai no CEO (nunca some a tarefa do radar).
- Re-delegar para um **departamento sem líder cadastrado** (ex.: financeiro sem ninguém em `governance_leaders`) → avisa quem tentou + cai no CEO.
- Valor inconsistente / pessoa deletada → tratado como NULL (catch-all gerente), com log.
- Pessoa **sem unidade** e tarefa solta (NULL) → cai no CEO (não há gerente de unidade pra herdar).

## Testes

Função pura com os casos da tabela-verdade acima:
- Rose delega → Rose cobra; Jereh não vê.
- Jereh delega tarefa financeira → Jereh cobra (tema ignorado).
- Tarefa solta da Vitória → Jereh (gerente), não Krissya.
- Krissya delega → Krissya cobra.
- Posse de inativo → CEO.
Unit tests espelhados em JS (TOM) e TS (PWA), como na Fase 1.

## Fora de escopo (futuro)

- **Compromissos/eventos** fatiados (Fase 2 cobre só TAREFAS; eventos têm modelo próprio de RSVP/participantes — fase seguinte).
- Histórico/auditoria de re-delegações (quem passou a posse pra quem e quando).
- Relatório consolidado "minhas delegações em aberto" por líder fora do digest diário.
