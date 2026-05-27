# Governança Inteligente — Visão Geral (3 Sprints)

> **Driver:** Alf recebe todo dia as mesmas 2 mensagens de governança e elas viraram ruído. TOM lista pendências antigas como se fossem inéditas, repete sugestão de delegação sem efeito, e separa "compromissos" de "tarefas" quando pra Alf é tudo "time enrolando".
>
> **Norte:** TOM deixa de ser listador e vira **chief of staff** — identifica padrões, propõe ação concreta, escala tática (não volume) e ajuda Alf a desenvolver seus líderes, que por sua vez desenvolvem seus liderados.

## Os 3 sprints

### Sprint 1 — Sanitizar, Analisar, Escalar (3-4 dias)
**Plano:** [`2026-05-27-sprint-1-governanca-sanitizar-analisar-escalar.md`](./2026-05-27-sprint-1-governanca-sanitizar-analisar-escalar.md)

Ataca os 3 vícios mais urgentes:
- **Sanitização aprendida** — Alf diz "Tom, isso aí é teste" → marker `<<DATA_CLASSIFY>>` persiste tag + aprende padrão pra próximos casos.
- **Auto-arquivamento** — item parado 5+ dias → TOM pergunta uma vez; sem resposta em 24h → arquiva.
- **Análise por pessoa** — em vez de 2 listas chapadas, 1 mensagem agrupada por dono com diagnóstico curto.
- **Escalada tática** — quando cobrança não funciona, TOM muda de abordagem (não repete).

### Sprint 2 — Timeline do Líder (2-3 dias)
**Plano:** [`2026-05-27-sprint-2-timeline-do-lider.md`](./2026-05-27-sprint-2-timeline-do-lider.md)

Memória estruturada por líder + briefing pré-1:1:
- Nova tabela `leader_timeline` com eventos categorizados (1:1, decisão, bottleneck, milestone).
- Hook em event_create detecta evento tipo "1:1" e agenda briefing automático.
- Job a cada 5min varre próximos 35min e gera briefing 30min antes da reunião.

### Sprint 3 — Scorecard do Líder (3-5 dias)
**Plano:** [`2026-05-27-sprint-3-scorecard-do-lider.md`](./2026-05-27-sprint-3-scorecard-do-lider.md)

Loop de desenvolvimento via scorecards semanais:
- Nova tabela `leader_scorecards` (snapshot semanal por líder).
- Ritual segunda 8h BRT gera scorecard de cada líder.
- 2 templates: versão Alf (consolidada todos líderes) + versão privada pro próprio líder.
- Comparativo semana atual vs anterior — evolução visível.

## Ordem de implementação

**Sequencial, não paralelo.** Cada sprint depende do anterior:
- Sprint 1 sanitiza os dados → Sprint 2 só faz sentido com dados limpos.
- Sprint 2 alimenta o timeline → Sprint 3 lê o timeline pra gerar scorecard.

## Tabelas novas

| Tabela | Sprint | Função |
|---|---|---|
| `task_classifications` | 1 | Padrões aprendidos de teste/real |
| `leader_timeline` | 2 | Eventos de governança por líder |
| `leader_scorecards` | 3 | Snapshot semanal de performance |

## Colunas novas em tabelas existentes

| Tabela | Colunas | Sprint |
|---|---|---|
| `tasks` | `data_classification`, `staleness_check_sent_at`, `coordination_request_count` | 1 |
| `events` | mesmas 3 colunas | 1 |

## Markers novos

| Marker | Sprint | Função |
|---|---|---|
| `<<DATA_CLASSIFY>>` | 1 | Alf marca task como teste/real/arquivar |

## Skills novas

| Skill | Sprint | Função |
|---|---|---|
| `governanca-sanitizar.md` | 1 | Como TOM classifica + aprende padrões |
| `governanca-diagnosticar.md` | 1 | Como TOM gera diagnóstico por pessoa |
| `governanca-escalar.md` | 1 | Quando TOM muda tática de cobrança |
| `briefing-pre-1on1.md` | 2 | Briefing antes de 1:1 |
| `scorecard-semanal.md` | 3 | Geração de scorecard |

## Critérios de sucesso (todos os 3 sprints juntos)

- **Sprint 1:** Mensagem de governança matinal tem ≤ 3 itens no topo (vs 12 hoje). Itens com 5+ dias parados sem ação devem sumir da lista após auto-arquivar.
- **Sprint 2:** Quando Alf marca "1:1 com Quintela 14h", recebe briefing automático às 13:30 com pendências + histórico de 1:1s passadas.
- **Sprint 3:** Toda segunda 8h, Alf recebe 1 mensagem consolidada de scorecard. Cada líder recebe a versão dele às 9h.
- **Geral:** Alf relata que governança "vale a pena ler" em vez de "todo dia é isso".
