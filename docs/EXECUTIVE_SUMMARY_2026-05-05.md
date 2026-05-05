# LA Organizer — Relatório Executivo (2026-05-05)

**Para:** OpenClaw + outros agentes / stakeholders
**De:** Luciano Alf + Claude (sessão de stress test pós-Sprint 20)
**Estado:** Sprints 0→20 fechadas. Decisão estratégica: encerrar fase de expansão de departamentos.

---

## TL;DR

Em 2 dias entregamos a Sprint 19 (Pedagógico) + Sprint 20 (Gerência) + 11 hotfixes UX/governança em produção. O sistema agora roteia 4 departamentos operacionais com hierarquia/alçada/escopo formais, coordenação conversacional madura (relay/followup/ACC), integridade de agenda e self-intro adaptativa.

**Decisão estratégica do PO (após stress test):** parar de expandir camadas operacionais. Os 4 departamentos cobrem a operação atual (Marketing, Operações Técnicas, Pedagógico, Gerência). Próxima fase é **governança e organização pessoal da liderança**.

---

## O que está em produção hoje

### 4 departamentos operacionais maduros
| Departamento | Sprint | Lead/Assignee |
|---|---|---|
| Marketing | (pré-existente) | Yuri |
| Operações Técnicas | 15 | Rafinha |
| Pedagógico | 19 | Juliana (LA Music School) / Quintela (LA Music Kids) + 6 assistentes + 3 mentores |
| **Gerência** (novo) | 20 | Jereh (CG) / Clayton (Recreio) / Krissya (Barra) |

### Hierarquia + alçada
- 16 colaboradores ativos com papéis formais (`role`, `unit`, `pedagogical_role`)
- Gate pedagógico não-negociável: DENY > ALLOW (manager NÃO faz followup pedagógico — encaminha via relay)
- Diferenciação manager+unit específica (gerente unidade) vs `unit='all'` (líder departamento, ex: Yuri)

### Camadas TOM (cumulativo)
1. **Sprint 15** — Camada operacional replicável (`departments`, `department_request_types`, `tasks.department_id/request_type_id`)
2. **Sprint 16** — Coordenação conversacional (relay_literal/relay_assisted/followup, `coordination_requests`, COORD_HINT)
3. **Sprint 17** — ACC (Active Coordination Context — FOCUS_CANDIDATE com confidence high/medium/low)
4. **Sprint 18** — Integridade de agenda (detectores de conflito temporal + duplicidade semântica jaroWinkler + hygiene de stale tasks/eventos)
5. **Sprint 19** — Pedagógico (hierarquia lead/assistant/mentor, subdomínio School/Kids, escopo unit/specialty/subdomain)
6. **Sprint 20** — Gerência (3 gerentes de unidade, fronteira com pedagógico, mensagem custom no gate)

### 11 hotfixes pós-Sprint 20 (radar UX/governança)
| # | Tema | Aprendizado |
|---|---|---|
| 1 | risco-de-evasao não cair em pedagógico | Skill primary precisa de exemplos verbatim |
| 2 | findCollaboratorBy* trazer onboarding_completed | Helpers downstream precisam campos completos |
| 3 | Microconfirmação numerada (1/2/3) | Pergunta livre era ambígua |
| 4 | Cadência self-intro (full/half/short) | Cadência > frequência fixa |
| 5 | Pergunta de tratamento Eisenhower | TOM passa governança ao recipient |
| 6 | Problema-de-atendimento ≠ incidente-tecnico | Skill diferencia humano vs equipamento |
| 7 | Skill exige UUIDs no marker | Warning imperativo evita NULL/NULL |
| 8 | Cooldown 6h em deadline alerts | Anti-loop reagendar↔lembrar |
| 9 | COORD_HINT como contexto natural | Não só gatilho de RESPONSE |
| 10 | Dedup defensivo coord_request 90s | Defesa em profundidade (skill + engine) |
| 11 | Unidade vem do aluno, não do assignee | Não inferir de lead global |

### TOM-LIMITES.md (formalizado)
Documento novo que define:
- O que TOM **faz** (governança liderança, organização pessoal, captura demanda, microconfirmação, sugestões)
- O que TOM **não faz** (canal genérico de comunicação, intermediação permanente, atuar fora de alçada, inventar contexto)
- Regras anti-banimento WhatsApp (frequência, padrões, tom)
- Hierarquia de fronteiras (quem fala com quem)

---

## Casos canônicos validados em produção

| Caso | Cenário | Resultado |
|---|---|---|
| **Marina** (Sprint 19 E2E) | "Alinhamento com responsável — frequência baixa" | dept=pedagogico, req_type=alinhamento-com-responsavel, subdomain=school, assignee=Juliana ✅ |
| **Felipe** (Sprint 20 P1) | "aluno em risco de evasão na Barra" | dept=gerencia, req_type=risco-de-evasao, assignee=Krissya ✅ |
| **Gustavo** (Sprint 20 P4) | "problema de atendimento — pai do Gustavo sem retorno" | dept=gerencia, req_type=problema-de-atendimento, assignee=Jereh ✅ |
| **Ricardo** (Sprint 20 P2) | relay → followup automático após detecção de recado pendente | TOM detectou contexto e converteu relay em cobrança ✅ |
| **Carlos Henrique** (Sprint 20 P3) | "pai reclamando que filho não aprende" | dept=pedagogico, req_type=alinhamento-com-responsavel, assignee=Quintela ✅ (após hotfix unidade) |
| **Lâmpadas/Rafinha** | Confirmação curta "Ok" do recipient | Engine bloqueou silenciosamente novo relay (dedup 90s + jaroWinkler 0.75) ✅ |

---

## Documentação atualizada (links GitHub `main`)

### Documentos principais
- **PRD v3.7:** [`docs/06-prd-la-organizer-v3.md`](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/06-prd-la-organizer-v3.md)
- **Roadmap (Sprint 0→20):** [`docs/roadmap-la-organizer.md`](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/roadmap-la-organizer.md)
- **Limites do TOM (NOVO):** [`docs/TOM-LIMITES.md`](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/TOM-LIMITES.md)
- **Schema do banco:** [`docs/03-esquema-banco-dados-la-organizer.md`](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/03-esquema-banco-dados-la-organizer.md)
- **Catálogo de skills v4.5:** [`docs/TOM-SKILLS-CATALOG.md`](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/TOM-SKILLS-CATALOG.md)

### Closure reports (mais recentes)
- **Sprint 20 closure:** [`docs/superpowers/reports/2026-05-05-sprint20-closure.md`](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/superpowers/reports/2026-05-05-sprint20-closure.md)
- **Sprint 19 closure:** [`docs/superpowers/reports/2026-05-05-sprint19-closure.md`](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/superpowers/reports/2026-05-05-sprint19-closure.md)

### Spec/Plan Sprint 19+20
- Sprint 19 (Pedagógico): [spec](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/superpowers/specs/2026-05-03-sprint19-pedagogico-design.md) · [plan](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/superpowers/plans/2026-05-03-sprint19-pedagogico.md)
- Sprint 20 (Gerência): [spec](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/superpowers/specs/2026-05-05-sprint20-gerencia-design.md) · [plan](https://github.com/LucianoAlf/LA-Organizer/blob/main/docs/superpowers/plans/2026-05-05-sprint20-gerencia.md)

### Skills (todas em `skills/`)
gerencia · pedagogico · operacoes-tecnicas · marketing · coordenacao-conversacional · integridade-agenda · checklist-tarefas · planejamento-semanal · rituais-diarios · habitos-pessoais · criar-compromisso · cadastro-projeto-5w2h · aprovar-projeto · onboarding · tratamento-audio · pausa-temporaria · priorizacao-inteligente

---

## Próximas frentes (não-compromisso, sugeridas)

| Sprint | Tema | Estimativa |
|---|---|---|
| **21** | Governança da liderança — rituais avançados, OKRs leves, checklists pessoais por papel | meio sprint |
| **22** | Active Thread Stack — TOM mantém N threads ativas em vez de 1 | sprint inteiro |
| **23** | Revisão de skills — consolidar regras inflada em princípios; reduzir prompt size de ~65KB para ~45KB | meio sprint |

### Fora de escopo (decisão 2026-05-05)
- ❌ Mais departamentos operacionais
- ❌ TOM como participante ativo em grupos WhatsApp
- ❌ Professor como collaborator (manter via assistente/coord)
- ❌ Auditoria/analytics avançado

---

## Métricas operacionais

- **Commits no dia 2026-05-05:** 14 (Sprint 20 + 11 hotfixes radar + docs)
- **Linhas de código produção:** +183 (engine + skills + PWA)
- **Linhas de documentação:** +495 (closure + TOM-LIMITES + roadmap + schema + skills catalog)
- **Memórias indexadas em `collaborator_memory`:** 5 (decision/lesson/fact, decay 90 dias)
- **Tempo médio de uptime do TOM:** estável (`pm2` reinicializou ~25x sem falha persistente)
- **Tasks criadas em piloto Sprint 20:** ~10 (várias canceladas durante stress test, mantida apenas a base válida)

---

## Observações para outros agentes

1. **Skills agora estão consolidadas** — não criar mais regras-por-bug. Próximas modificações devem ser em **princípios**, não em casos pontuais.
2. **Defesa em profundidade > regra única** — quando o LLM falha, validar no engine. Não confiar só na skill.
3. **Cadência > frequência fixa** — qualquer mensagem repetitiva (lembrete, self-intro, cobrança) precisa de heurística de tempo.
4. **TOM-LIMITES.md é fonte de verdade** sobre o que TOM faz/não faz. Antes de adicionar feature nova, validar contra esse doc.
5. **Memória indexada** — TOM já carrega contexto sobre Sprint 20, casos do piloto e equipe atual. Não precisa repassar essas informações em novos prompts.

---

**Última versão dos docs:** commit `4a9c9c0` em `origin/main`. VPS atualizada via git pull. PWA Vercel auto-deploy ativo.
