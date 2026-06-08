# BRIEF — Redesenho "Dashboard time" (`/time`)

> Base para o brainstorming de redesenho. Fonte: 5 auditorias paralelas (frontend, backend/dados, realidade dos números, inteligência do TOM, missão/gaps). Data: 2026-06-08.
> Arquivo único hoje: `web/src/screens/DashboardTime.tsx` (227 linhas) + `web/src/lib/events.ts`. Drill-down: `PessoaDetalhe.tsx`.

## 1. Estado atual
- **Uma página, uma query.** Tudo sai de `fetchTeamSnapshot(myId)`, client-side direto no Supabase via JWT. Sem serviço/edge — a segurança real é a **RLS**, não o React.
- **5 StatCards + 4 listas.** NO TIME (headcount), CONCLUÍDAS / PRA HOJE / ATRASADAS (`context='work'`), COMPROMISSOS, + listas Compromissos-hoje / Respondeu-briefing / Sem-resposta / Atrasos-por-pessoa.
- **Os 5 StatCards NÃO são clicáveis** (`:135-139`) — números mortos. Único clique = nome da pessoa → `/time/:id`, **100% read-only** (não reatribui, não comenta, não age).
- **Data cravada em "hoje"**, sem período/busca/filtro/ordenação.
- **Sem layout desktop** (viola o Guardrail Desktop). Desvio de token: horário usa `text-brand` (rosa) onde devia ser `text-tom` (`:150`).
- **Privacidade OK:** resposta a briefing vem por RPC `briefing_response_count` (SECURITY DEFINER) — coord/director nunca leem `conversation_history.content`.

## 2. Realidade dos dados (o que o CEO vê)
| Métrica | Valor | Confiável? | Diagnóstico |
|---|---|---|---|
| **ATRASADAS** | 32 | Sim, com ressalva | Filtro certo. Mas 4 = fan-out de 1 recorrência do Jhonatan; 1 atribuída ao **Kinho (inativo)**. Real ≈ 28. |
| **PRA HOJE** | 40 | **FALSO POSITIVO** | A query **não exclui `cancelled`**: 31 reais + 9 canceladas = 40. Bug de filtro. |
| **NO TIME** | 28 | Não é métrica de atividade | Headcount de ativos. Só **17-18 têm trabalho real**; 10 sem nenhuma tarefa aberta. |
| **CONCLUÍDAS / outras** | — | Escopo enganoso | Contagem da **empresa inteira**, não do time exibido. |

- **Caso Jhonatan:** 8 atrasadas, 4 são a mesma rotina "Dar presença" (`FREQ=WEEKLY`, mãe `done`, filhas `pending`). Gerador também produziu dezenas de linhas `cancelled` (ruído).
- **`.limit(50)`** em ATRASADAS/ATRASOS — usa `array.length`, não count real → subconta silenciosa acima de 50.
- **Implicação:** antes de "deixar bonito", a página precisa **contar certo** + **rotular escopo** (time vs empresa). Número errado mata a confiança.

## 3. Modelo líder → time (bloqueador do multi-tenant)
- **A página não tem recorte de time.** Mostra a empresa inteira pra qualquer coord/director. Jereh e Quintela veem **os mesmos números**.
- **A RLS também não tem escopo de time.** `current_collab_role()` é binária (coord/director vê tudo). Filtro no client seria **cosmético** — o dado completo já trafega pro browser. Multi-tenant real exige `is_my_report(collab_id)` na RLS.
- **Não há campo de liderança canônico usável.** Só `supervisor_id` (preenchido ~15-17/31, **11 apontam pro CEO**). **Time do Jereh: 0 no banco. Quintela: 1.** Os agrupamentos do enunciado não existem como dado.
- **Backend já resolve líder→time por heurística** (`src/services/leader-routing.js` `resolveLeadersOf`): `function_role` + `unit` + override `supervisor_id`. **Duas réguas divergentes:** o que o TOM cobra ≠ o que a tela mostra.
- **Decisão de fundo:** (a) popular `supervisor_id` 100%; (b) tabela `team_memberships`; ou (c) **reusar `leader-routing.js`** como fonte única (rápido, alinha tela ↔ TOM).

## 4. Inventário de inteligência do TOM (sinais prontos → alerta)
| Sinal | Fonte | Vira o alerta | Granularidade |
|---|---|---|---|
| Cobranças enviadas (646/30d) | `notifications` | "TOM cobrando: N hoje" — alta = backlog crescendo | Pessoa+Time |
| **Cobrança FALHANDO** | `health-check.js:128` | 🔴 "N atrasadas 2d+ sem chase 48h" | Time→pessoas |
| Escalada sem efeito | `escalation-tracker.js` | 🟠 "cobrada 5x sem efeito → 1:1" | Pessoa |
| Audit findings | `tom_audit_findings` | 🔴 "falha de conversa com {pessoa}" | Pessoa |
| Scorecard semanal | `leader_scorecards` | 🚦 semáforo de líderes + delta | Líder+Time |
| Backlog por pessoa | `governance-analyzer.js` | 🔴 "{pessoa}: N pendências + recomendação" | Pessoa |
| Sumiço 7d | `health-check.js:287` | 🟡 "{pessoa} sumiu 7+ dias" | Pessoa |

Ressalvas: silêncio crônico está wired mas frio (computar por query); `read_at` é cego (proxy = inbound após `sent_at`); tempos de resposta a ritual não instrumentados (fora do MVP).

## 5. Missão por persona + Jobs-to-be-Done
- **CEO:** *"Em 30s, descobrir onde o negócio trava entre os times e sair com uma ação tomada (reunião, cobrança ou comunicado) sem abrir mais nada."* Age sobre **líderes e padrões**.
- **Líder:** *"Ver só o meu time, entender quem está afogado/enrolando/bem, e agir na pessoa certa antes da bola de neve."* Age sobre **indivíduos**.
- → **Mesma página, escopo e granularidade diferentes — não duas páginas.**

**Jobs:** (1) me diga onde olhar primeiro; (2) deixe eu abrir e entender o porquê; (3) me diga com quem falar e por quê; (4) deixe eu agir daqui mesmo; (5) me mostre se o TOM funciona (cobrou? respondeu?); (6) separe problema real de falso-positivo; (7) munição pro 1:1 (CEO).

## 6. Gaps & oportunidades (impacto × esforço)
| # | Oportunidade | Impacto | Esforço | Nota |
|---|---|---|---|---|
| 1 | StatCards clicáveis → drill-down | Alto | Baixo | ⭐ UAU sem overkill |
| 2 | Corrigir contagem (cancelled/dedupe/inativo/count real) | Alto | Baixo | ⭐ credibilidade |
| 3 | Rotular escopo (time vs empresa) | Médio | Baixo | quick win |
| 4 | "Próxima ação sugerida" (nome + motivo, dos sinais §4) | Alto | Médio | ⭐ UAU |
| 5 | Escopo por líder (multi-tenant) | Alto | Alto | pré-requisito estrutural |
| 6 | Botão de ação TOM no contexto + status da cobrança | Alto | Médio-Alto | fecha o loop |
| 7 | Marcar falso-positivo / resolvido fora do app | Médio | Baixo | anti-descrédito |
| 8 | Seletor de período | Médio | Baixo | tira o "hoje" cravado |
| 9 | Layout desktop + `Promise.all` no N+1 + queryKey c/ myId | Médio | Médio | dívida/perf |

**Sequência mínima do "uau":** 1+2+3 (drill-down + números honestos) → 4 (próxima ação) → 5 (multi-tenant) → 6+7 (agir + auditar).

## 7. Veredito: MELHORAR (não matar)
Está na **altitude errada**, não é o ativo errado. Parou no nível 1 (medir) de uma escada que precisa chegar a **diagnosticar → direcionar → agir → auditar**. Dado bruto já existe; o custo está em navegação, atribuição e ação. Multi-tenant **multiplica o valor** (mesma engenharia serve CEO + todos os líderes).
**Régua de cada incremento:** *"isto faz alguém marcar reunião, cobrar uma pessoa ou disparar um comunicado que não disparia sem a página?"* Se não, corta.
**O "uau" real:** abrir a página e ela dizer *"fale com o Jordão — 6 atrasadas, TOM cobrou 3x sem resposta"*, e disparar a cobrança ali mesmo.

## 8. Perguntas abertas pro CEO
1. Fonte canônica do time: `supervisor_id` 100% / `team_memberships` / reusar `leader-routing.js`?
2. Isolamento real (RLS `is_my_report`) ou cosmético (filtro só na UI)?
3. "Agir embutido" no MVP (botão TOM v1) ou só leva ao foco?
4. Números globais viram "do meu time" ou continuam "da empresa" com rótulo?
5. Trava em "hoje" no MVP ou seletor hoje/semana já?
