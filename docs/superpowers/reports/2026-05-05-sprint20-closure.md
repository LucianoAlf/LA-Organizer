# Relatório Executivo — Sprint 20 + Radar Pós-Sprint + Estado do LA Organizer

**Data:** 2026-05-05
**Sprint encerrado:** 20 — Camada de Gerência
**Validação E2E:** aprovada pelo PO via WhatsApp em produção (P1, P2, P4 validados; P3/P5/P6/N1/N2 não rodados — decisão estratégica de não inflar mais)
**Commits principais:** `920d5c7` (feat) + 12 hotfixes (`dd7930c` → `1daf538`)

---

## Decisão estratégica que encerra o ciclo

Após ~6 horas de stress test em produção da Sprint 20, o PO levantou (corretamente) que cada novo bug detectado virava uma "REGRA CRÍTICA" nova nas skills, inflando o prompt do TOM. Os 11 hotfixes pós-sprint individualmente fazem sentido — mas no agregado mostraram um sintoma de fundo:

> **TOM estava virando "menino de recado" — relay infinito, contexto arrastando, prompt cada vez maior.**

Esta closure documenta o que foi entregue, o que foi aprendido, e fecha a fase de expansão de departamentos. **Próxima fase do produto vira para governança da liderança (Alf, Anne, coord) — não para mais departamentos.**

---

## O que foi entregue na Sprint 20

### Objetivo
Implementar o departamento Gerência dentro da camada operacional replicável, formalizando o gerente como **filtro inteligente da unidade** que avalia, articula e roteia demandas — sem confundir com Pedagógico, sem quebrar o gate pedagógico Sprint 19.

### F1 — Schema + Seed (zero migrations)
- Reuso de `role='manager'` + coluna `unit` já existentes
- Department `gerencia` + 8 request types: risco-de-evasao, recuperacao-de-aluno, alinhamento-com-responsavel, problema-de-atendimento, experiencia-da-unidade, negociacao-relacional, pendencia-gerencial, articulacao-interna
- 3 gerentes criados: Jereh (`campo_grande`), Clayton (`recreio`), Krissya (`barra`)
- Diferenciação manager+unit específica vs manager+unit='all' (Yuri/Marketing) confirmada via convenção

### F2 — Engine
- 1 helper novo: `findAssistantByUnit(unitDb)` com mapeamento `campo_grande/recreio/barra` → `Campo Grande/Recreio/Barra`
- Mensagem custom em `applyCoordinationRequestAction` quando manager tenta followup pedagógico — sugere relay como alternativa + oferece assistente da unidade
- Gate `canDelegatePedagogical` **intacto** (manager continua não autorizado, conforme PRD §13)

### F3 — Skill `gerencia.md`
- ~13KB (após 3 reforços hotfix), auxiliar primary apenas (não global)
- 6 exemplos canônicos verbatim PRD §6
- UUIDs reais embutidos (1 dept + 8 request types)
- Fronteira não-negociável: gerente **encaminha** (relay), nunca **cobra** (followup) pedagógico

### F4 — pickSkill Priority 4.65
- Branch antes de pedagogico (4.7) com gatilhos restritos
- Acionadores: nomes dos gerentes + risco-de-evasao + retenção + atendimento + recepção + articulação
- Frases com "aluno"/"responsável" sem qualificador continuam caindo em pedagogico (correto)

### F5 — PWA filtro Responsável
- Aba Gerência popula candidatos formais: manager + coordinator + director ativos

### Validações E2E em produção
- ✅ **P1 risco evasão** (Felipe/Krissya/Barra) — task gerência criada, self-intro Krissya OK, contexto rico
- ✅ **P2 relay sobre pai insatisfeito** (Felipe/Krissya) — TOM detectou recado existente, ofereceu followup, cumprimento curto via Q2
- ✅ **P4 problema atendimento** (Gustavo/Jereh/Campo Grande) — task criada com Eisenhower, self-intro full pra Jereh
- ❌ **P3 pai reclamando aprendizado** (Carlos Henrique) — bug de unidade arrastada (corrigido `1daf538`)
- ⏸️ **P5/P6/N1/N2** — não rodados (decisão de fechamento estratégico)

---

## 11 hotfixes pós-Sprint20 — anatomia do stress test

Cada hotfix tem um aprendizado por trás. Documentando para Sprints futuras:

| # | Commit | Bug | Aprendizado |
|---|---|---|---|
| 1 | `dd7930c` | risco-de-evasao caía em pedagógico/apoio-ao-aluno | Skill primary precisa diferenciar request_types ambíguos com EXEMPLOS verbatim, não só descrição |
| 2 | `2b7997e` | self-intro nunca disparava (`onboarding_completed=undefined`) | Helpers que fazem queries devem trazer **todos** os campos que callers downstream precisam, não otimizar SELECT prematuramente |
| 3 | `87ab68e` | "mesma demanda" ambíguo | Microconfirmação livre via LLM pode ser ambígua — opções **numeradas explícitas** evitam interpretação errada |
| 4 | `f851f5e` | Self-intro repetia em toda mensagem | Cadência por tempo (mesmo dia / 7d / 30d) evita ruído sem sacrificar primeira impressão |
| 5 | `e5d3b71` | TOM passivo após criar task — "menino de recado" | **Pergunta de tratamento (Eisenhower mini)** no fim da notificação devolve governança ao recipient |
| 6 | `48ed7f6` | "problema de atendimento" virou incidente-tecnico (Rafinha) | Skill precisa diferenciar contexto humano de equipamento físico EXPLICITAMENTE |
| 7 | `4bc3071` | TOM emitiu marker sem `department_id` | Warning imperativo na skill pede UUIDs obrigatórios — fix de skill funcionou |
| 8 | `d6bfd96` | Lembrete T-1 disparou 3min depois do reagendamento | Cooldown 6h em `checkDeadlineAlerts`/`checkOverdueAlerts` evita loop reagendar↔lembrar |
| 9 | `192c631` | TOM ignorou COORD_HINT quando recipient perguntou (Quintela/Gustavo) | COORD_HINT serve como **contexto natural**, não só gatilho de RESPONSE — mesma estrutura, novo uso |
| 10 | `9d2e68d` | "Ok" do Rafinha gerou novo relay (Alf duplicado) | Defesa em profundidade: skill ensina + engine valida (jaroWinkler ≥0.75 em 90s) |
| 11 | `1daf538` | TOM gravou "Campo Grande" quando Alf disse "Recreio" | Unidade da task vem do **aluno**, não do assignee. Quintela/Juliana são lead globais. |

---

## Estado do produto pós-Sprint 20

### Capacidades operacionais (em produção)
- **TOM via WhatsApp:**
  - Criação de tasks/eventos/projetos/comunicados
  - Coordenação conversacional (relay/relay_assisted/followup) com **ACC** (Sprint 17)
  - Integridade de agenda (Sprint 18)
  - **4 departamentos operacionais** (Sprint 15→20): Marketing, Operações Técnicas, Pedagógico, Gerência
  - Gate de alçada pedagógica (Sprint 19) preservado
  - Self-intro com cadência (Q2 hotfix)
  - Microconfirmação determinística numerada para conflitos (B2 + Q3 hotfix)
  - Pergunta de tratamento Eisenhower no delegate (governança)
  - Dedup defensivo de coord_request (90s, jaroWinkler 0.75)
  - Cooldown 6h em deadline alerts (anti-loop)

- **PWA mobile-first:**
  - `/mais/operacoes` com 4 abas: Marketing, Operações Técnicas, Pedagógico, **Gerência**
  - Filtro Responsável formal por departamento (Sprint 19 R1, Sprint 20 F5)
  - Translations pt-BR (Sprint 20 hotfix `e5d3b71`)

- **Dispatcher:**
  - Rituais diários, lembretes T-1, comunicados em fila, hygiene de tasks (Sprint 18)
  - Cooldown 6h em deadline/overdue alerts

### Operadores no sistema (16 colaboradores ativos)
| Camada | Quem |
|---|---|
| **Direção** | Alf (CEO), Anne |
| **Coordenação geral** | Anne |
| **Coordenação pedagógica** | Juliana (LA Music School), Quintela (LA Music Kids) |
| **Assistentes pedagógicos** | Leo (Barra), Ramon (Recreio + bandas), Dai (Campo Grande), Matheus Felipe (Kids), Jordan (eventos + bateria), Rodrigo (cordas) |
| **Mentores pedagógicos** | Peterson, Kinho, Renan |
| **Gerentes de unidade** | Jereh (Campo Grande), Clayton (Recreio), Krissya (Barra) |
| **Líder departamento** | Yuri (Marketing) |
| **Operações técnicas** | Rafinha (todas as unidades) |

### Schema do banco (cumulativo Sprint 15→20)
- Sprint 15: `departments`, `department_request_types`, `tasks.department_id`, `tasks.request_type_id`
- Sprint 16: `coordination_requests`
- Sprint 17: zero schema novo (ACC computa em runtime)
- Sprint 18: zero schema novo (detectores em runtime)
- Sprint 19: `tasks.subdomain`, `collaborators.pedagogical_role`, `pedagogical_assignments`
- **Sprint 20: ZERO schema novo** (reuso de `role='manager'` + `unit`)

### Skills no catálogo (cumulativo)
**Primárias (selecionadas via pickSkill):**
- onboarding, cadastro-projeto-5w2h, tratamento-audio, pausa-temporaria, aprovar-projeto, planejamento-semanal, rituais-diarios, habitos-pessoais, criar-compromisso, checklist-tarefas, operacoes-tecnicas, marketing
- **gerencia** (Sprint 20 — Priority 4.65)
- **pedagogico** (Sprint 19 — Priority 4.7)

**Auxiliares globais (sempre carregadas):**
- coordenacao-conversacional (Sprint 16)
- integridade-agenda (Sprint 18)
- pedagogico (Sprint 19 — também aux global quando outra é primary)

---

## Aprendizados transversais da Sprint 20

### 1. Skills inflam quando você corrige edge case por edge case
Cada bug observado virou regra na skill. No agregado, prompt cresceu 30%+ em ~1 semana. **Lição:** consolidar regras em princípios gerais (não regra-por-bug). Próxima passada arquitetural deve revisar e cortar redundâncias.

### 2. Defesa em profundidade > regra única
Quando o LLM falha (ex: "Ok" virando relay duplicado), confiar só na skill é frágil. Melhor: **skill ensina + engine valida** (helper determinístico). Aplicado com sucesso em B2 (alucinação Registrado), dedup de relay, cooldown deadline.

### 3. Microconfirmação numerada > pergunta livre
"É a mesma ou outra?" é ambíguo. "1️⃣ mesma situação / 2️⃣ outro caso / 3️⃣ cancela" elimina interpretação. Sempre que houver decisão binária/ternária crítica, numerar.

### 4. Helpers de query devem trazer campos completos
Bug `2b7997e`: `findCollaboratorByName` não trazia `onboarding_completed`. Otimização prematura quebrou self-intro. **Lição:** SELECT * em helpers de runtime é OK quando volume é baixo (< 20 colabs).

### 5. Cadência de mensagem importa tanto quanto conteúdo
Self-intro repetida vira spam. Cadência (full/half/short) por tempo desde última outbound respeita o destinatário sem sacrificar primeira impressão. Aplicar princípio em outros lembretes.

### 6. Limite de papel do TOM (estratégico)
Stress test mostrou: TOM corre risco de virar "menino de recado" — relay infinito, contexto arrastando. **Direção pós-Sprint 20:** TOM é organizador da liderança e governança operacional; coordena rituais, lembra, articula — mas NÃO é canal permanente de comunicação interpessoal entre toda a equipe. Documentado em `docs/TOM-LIMITES.md`.

---

## Bugs corrigidos durante a Sprint (lista cumulativa)

Resumo dos 13 commits Sprint 20 + radar:

```
920d5c7  feat(sprint20): camada gerencia
dd7930c  fix: risco-de-evasao não vira pedagógico/apoio-ao-aluno
2b7997e  fix: findCollaboratorBy* incluir onboarding_completed
87ab68e  fix: microconfirmação numerada (1/2/3)
f851f5e  feat: Q2 cadência self-intro 4 níveis
e5d3b71  feat: pergunta de tratamento Eisenhower + diretiva pt-BR
48ed7f6  fix: problema-de-atendimento ≠ incidente-tecnico
4bc3071  fix: skill gerência exige UUIDs no marker
d6bfd96  fix: cooldown 6h deadline/overdue + skill pergunta horário
192c631  fix: COORD_HINT como contexto natural
9d2e68d  fix: dedup defensivo coord_request 90s + skill confirmação curta
1daf538  fix: unidade da task vem do aluno, não do assignee
```

---

## Próximos passos (pós-Sprint 20)

### Direção estratégica nova
**Não criar mais departamentos operacionais.** Os 4 que existem cobrem a operação atual da escola. Próxima frente: **governança e organização pessoal da liderança**.

### Possíveis sprints futuras (não compromisso)
- **Sprint 21 (governança liderança):** rituais avançados (planejamento mensal, OKRs leves), checklists pessoais por papel (CEO, coordenador), histórico/decisões importantes
- **Sprint 22 (active thread stack):** TOM mantém N threads ativas em vez de 1 — quando user muda de assunto, TOM resgata contexto certo
- **Sprint 23 (revisão de skills):** consolidar regras inflada em princípios; cortar redundâncias após uso real

### Fora de escopo / não fazer
- Mais departamentos (financeiro, comercial, etc.) — só se houver demanda explícita
- Auditoria/analytics avançado
- TOM em grupos de WhatsApp como participante ativo (risco de banimento)
- Professor como collaborator (mantém via assistente/coord)

### Tasks operacionais em aberto
- Cleanup `composeSystemPrompt` (sync builder dead code) — confirmação pendente
- Workflow de dev local (localhost vs Vercel)
- Revisar SUGGESTED_NEXT_STEPS — hoje hardcoded por slug, não por (dept, slug). Se houver request_types com mesmo slug em depts diferentes (já há `alinhamento-com-responsavel`), pode dar lookup ambíguo

---

## Infraestrutura
- VPS (`srv1586784`): 3 processos pm2 — `tom`, `la-organizer-web`, `la-organizer-tunnel`
- Supabase Postgres com RLS extensivo
- Backup diário 03h BRT
- Deploy: clone temp → cp → commit → push → ssh git pull → pm2 restart
- PWA Vercel auto-deploy do main

---

**Sprint 20 — encerrada formalmente em 2026-05-05.**

> Decisão estratégica do PO: parar de expandir camadas operacionais. Próxima frente é governança da liderança. Documento `TOM-LIMITES.md` formaliza fronteira.
