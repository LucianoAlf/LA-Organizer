# Relatório Executivo — Sprint 19 + Estado do LA Organizer

**Data:** 2026-05-05
**Sprint encerrado:** 19 — Camada Pedagógica
**Validação E2E:** aprovada pelo Alf via WhatsApp em produção
**Commits principais:** `8d6be1a` (feat) + 7 hotfixes (`637e697` → `49fa159`) + 4 radar (`9787109`)

---

## O que foi entregue na Sprint 19

### Objetivo
Implementar o departamento **Pedagógico** dentro da camada operacional replicável (Sprint 15) — sem criar módulo paralelo, respeitando hierarquia (lead/assistant/mentor/teacher), subdomínios (LA Music School ↔ LA Music Kids) e roteamento por unidade/especialidade.

### F1 — Schema + Seed
- 3 mudanças mínimas no DB:
  - `tasks.subdomain` (text CHECK ∈ {'school','kids'})
  - `collaborators.pedagogical_role` (text CHECK ∈ {'lead','assistant','mentor'})
  - Tabela `pedagogical_assignments(collaborator_id, scope_type, scope_value)` com PK composta + RLS
- Seed: department `pedagogico` + 7 request types
- 11 colaboradores criados/atualizados com `pedagogical_role`:
  - **lead:** Juliana, Quintela
  - **assistant:** Leo, Ramon, Dai, Matheus Felipe, Jordan, Rodrigo
  - **mentor:** Peterson, Kinho, Renan
- 10 atribuições de escopo em `pedagogical_assignments` (subdomain/unit/specialty)

### F2 — Engine helpers + handler extensions
- 4 helpers novos em `engine.js`:
  - `getPedagogicalRole(collab)`
  - `findPedagogicalAssignee({subdomain, unit, specialty})` — apoio/lookup, não automação opaca
  - `scopeOverlap(idA, idB)` — 1 match em qualquer eixo já autoriza
  - `canDelegatePedagogical(requester, target)` — gate de alçada com **precedência sobre o gate genérico** (DENY pedagógico = DENY final, sem fallback)
- `applyTaskActions` create: aceita `subdomain` no whitelist
- `applyCoordinationRequestAction`: gate pedagógico avaliado **antes** do gate genérico Sprint 16

### F3 — Skill `pedagogico.md`
- 5–8 KB, auxiliar global (carrega para todos os roles)
- Ensina hierarquia, mapa de escopo, 7 request types, regra de precedência, regra de match de escopo
- 6 exemplos canônicos verbatim do PRD pedagógico §7
- Todos os UUIDs reais embutidos (departamento + 7 request types) — não há placeholders

### F4 — Loader em `system.js`
- `loadSkill('pedagogico')` injetado como auxiliar global em `buildSystemPrompt` (async)
- Convive com `coordenacao-conversacional.md` e `integridade-agenda.md`
- `composeSystemPrompt` (sync) é dead code — task pendente cobre

### F5 — Deploy + 8 hotfixes + 4 ajustes UX (radar)
Ver seção "Bugs encontrados e corrigidos" abaixo.

### Validação E2E em produção
- ✅ Task pedagógica criada com sucesso: *"Alinhamento com responsável — frequência baixa aluna Marina (canto)"* → `dept=pedagogico`, `req_type=alinhamento-com-responsavel`, `subdomain=school`, `assignee=Juliana`
- ✅ Task operacional criada: *"Ar-condicionado parou — Recreio Sala 5"* → `dept=operacoes-tecnicas`, `req_type=incidente-tecnico`, `priority=critical`, `assignee=Rafinha`
- ✅ TOM identificou subdomain inferido pelo contexto ("violão iniciante 7 anos" → kids → Quintela)
- ✅ ACC continua resolvendo pronomes ("agradece a ele") e propagando respostas em threads
- ✅ Filtro Responsável da PWA aba Pedagógico mostra os 11 colaboradores

---

## Bugs encontrados e corrigidos durante a Sprint

Sprint 19 expôs problemas pré-existentes no engine que vinham silenciosamente desde Sprint 17/18:

| # | Bug | Causa | Commit |
|---|---|---|---|
| 1 | Skills auxiliares globais nunca carregavam em produção | `loadSkill('integridade-agenda.md')` chamava com `.md` enquanto a função appendava `.md` automaticamente — buscava `xxx.md.md` | `637e697` |
| 2 | IntegrityCheck dup_task com falsos positivos sistemáticos | Boost +0.2 dept + +0.2 type batia título completamente diferente em 0.82+ | `14b2e35` |
| 3 | jaroWinkler dominado por suffix `— UNIDADE` | "Palhetas — Recreio Sala 3" vs "Teclado — Recreio Sala 3" batia 0.72 puramente pelo suffix compartilhado | `837f461` |
| 4 | TOM falava "critical" em pt-BR | Skill operacoes-tecnicas não tinha tradução; PWA também não | `2a02039` + `9787109` |
| 5 | TOM repergunta urgência mesmo após user dizer "é urgente" | Skill não relia mensagem antes de perguntar | `2a02039` |
| 6 | COORD_HINT virava relay duplicado | Hint inicialmente sem instrução clara; TOM mencionava recados já entregues proativamente | `2a02039` |
| 7 | Tasks criadas sem `department_id` (NULL) | pickSkill caía em `checklist-tarefas` (genérica) — sem template de marker com FK | `b8b8b70` |
| 8 | Tasks pedagógicas com `department_id`/`request_type_id` NULL | Skill emitia `<UUID-pedagogico>` literal; engine validava UUID e silenciosamente fazia fallback para NULL | `7be949c` |

### Radar pós-Sprint (4 ajustes UX entregues no mesmo dia)
- **R1:** PWA traduz priority labels — `Crítico` → **Urgente** (alinha com a fala do TOM); concordância de gênero (Alta/Média/Baixa)
- **R2:** Cabeçalho relay enxuto — apenas primeiro nome (`O Luciano me pediu` em vez de `O Luciano (CEO/Fundador) me pediu`)
- **R3:** TOM se apresenta na 1ª vez com cada collaborator novo — prepend `"Oi, X! Aqui é o TOM, organizador da LA Music. Vou te passar um recado:"` quando `onboarding_completed=false`
- **R4:** Bug B2 — alucinação `"✅ Registrado!"` quando IntegrityCheck bloqueia foi substituída por **microconfirmação determinística no engine** (`_buildIntegrityConfirmText`) que cobre `dup_task`, `dup_event`, `temporal_hard`, `temporal_soft`. Pergunta clara ao user: *"É a mesma demanda ou outra?"*

### Bonus: hotfixes diversos
- `unitLabel('all') → 'Todas'` (PWA mostrava `all` literal nas cards)
- Filtro Responsável da PWA aba Pedagógico passa a buscar candidatos formais (`pedagogical_role IS NOT NULL`) além de extrair de tasks visíveis

---

## Decisões fechadas (PO ratificadas)

| ID | Decisão | Motivo |
|---|---|---|
| **D1** | `tasks.subdomain` como coluna explícita com CHECK | Estrutural; melhora roteamento e filtro; reusa para Marketing/Eventos no futuro |
| **D2** | `collaborators.pedagogical_role` como coluna com CHECK | Type-safe; query direta para gating |
| **D3** | Skill `pedagogico.md` carrega sempre (auxiliar global) | Pedagógico é central no piloto — perda por keyword > peso de prompt |
| **R1** | DENY pedagógico tem precedência sobre ALLOW genérico | Alçada estrutural não pode ser contornada |
| **R2** | Assistant: 1 match de escopo (unit OR specialty OR subdomain) autoriza | Cobertura pragmática sem inflar regra |

### Não-objetivos afirmados
- ❌ Não cria módulo Eventos. `evento-pedagogico` = task com nota.
- ❌ Professor não vira collaborator no MVP — assistente/coord registra demanda em nome dele.
- ❌ Sem dashboard pedagógico analítico, sem timeline custom de caso, sem auditoria.
- ❌ Sem expansão de RLS — `coordinator/director` continuam sendo os únicos com escrita ampla.

---

## Estado atual do produto (pós-Sprint 19)

### Capacidades operacionais (em produção)
- **TOM via WhatsApp:** criação de tasks/eventos/projetos/comunicados; aprovação de comunicados por director; **coordenação conversacional** (relay/relay_assisted/followup) com **ACC** (resolução de pronomes); **integridade de agenda** (dup detection + microconfirmação); **camada pedagógica** com hierarquia/subdomínio/escopo
- **PWA mobile-first:** Hoje, Semana, Projetos, Histórico, Hábitos, Checklists, Comunicados, Agenda Escolar, Observabilidade, Eventos, Equipe, **Operações multi-departamento** (Marketing, Operações Técnicas, Pedagógico)
- **Dispatcher:** rituais diários, checklists operacionais, comunicados em fila, lembretes de event tasks, **higiene de execução** (stale tasks segunda 09h, eventos passados sem fechamento diário 09:30)
- **Aprovação 2-stage:** coordinator cria comunicado → director aprova/rejeita → broadcaster envia
- **Eventos institucionais:** criação via TOM com até 4 etapas de comunicação + auto-geração de kit de tasks
- **3 departamentos operacionais** ativos no piloto: `marketing`, `operacoes-tecnicas`, `pedagogico`

### Operadores no sistema (15 colaboradores ativos)
| Camada | Quem |
|---|---|
| Direção | Alf (CEO/Fundador), Anne |
| Coordenação geral | (a definir) |
| **Coordenação pedagógica** | **Juliana (LA Music School)**, **Quintela (LA Music Kids)** |
| **Assistentes pedagógicos** | Leo (Barra), Ramon (Recreio + bandas), Dai (Campo Grande), Matheus Felipe (Kids), Jordan (eventos + bateria), Rodrigo (cordas) |
| **Mentores pedagógicos** | Peterson, Kinho, Renan (Guardiões da Cultura) |
| Operações técnicas | Rafinha (atende todas as unidades) |

### Schema do banco (mudanças cumulativas Sprint 15→19)
- Sprint 15: `departments`, `department_request_types`, `tasks.department_id`, `tasks.request_type_id`
- Sprint 16: `coordination_requests` (relay/followup state)
- Sprint 17: nada novo (ACC computa em runtime)
- Sprint 18: nada novo (integridade computa em runtime via detectores)
- **Sprint 19: `tasks.subdomain`, `collaborators.pedagogical_role`, `pedagogical_assignments`**

### Skills no catálogo (cumulativo)
**Primárias (selecionadas via pickSkill):**
`onboarding`, `cadastro-projeto-5w2h`, `tratamento-audio`, `pausa-temporaria`, `aprovar-projeto`, `planejamento-semanal`, `rituais-diarios`, `habitos-pessoais`, `criar-compromisso`, `checklist-tarefas`, `operacoes-tecnicas`, **`pedagogico`** (Sprint 19)

**Auxiliares globais (sempre carregadas):**
`coordenacao-conversacional` (Sprint 16), `integridade-agenda` (Sprint 18), **`pedagogico`** (Sprint 19, também acessível como auxiliar quando outra skill é primary)

**Auxiliar contextual:**
`priorizacao-inteligente` (carregada quando primary é `checklist-tarefas`/`criar-compromisso`/`cadastro-projeto-5w2h`)

---

## Aprendizados da Sprint

1. **Test-in-production exposes silent bugs** — Sprint 18 estava em produção desde 03/05 mas a skill `integridade-agenda.md` nunca carregou (bug `loadSkill('xxx.md')`). Isso só apareceu quando Sprint 19 puxou a mesma string para `pedagogico.md` e o efeito ficou impossível de ignorar.
2. **`<UUID-placeholder>` em skill = department_id NULL no banco** — engine valida regex de UUID e silenciosamente faz fallback para NULL em vez de rejeitar. Sempre embutir UUIDs reais nas skills.
3. **jaroWinkler é sensível a sufixos compartilhados** — quando títulos terminam em mesma unidade/sala, dominância do suffix sobe a similaridade falsamente. Strip do sufixo antes de comparar é mandatório.
4. **pickSkill é o gargalo de roteamento** — sem branch específico para o departamento, TOM cai em skill genérica que não preenche FKs. Cada departamento operacional precisa de gatilhos próprios no pickSkill.
5. **Microconfirmação determinística > confiança no LLM** — quando o engine detecta um conflito após o LLM já ter gerado resposta, sobrescrever o reply com texto fixo é mais robusto que confiar na skill processar payload.

---

## Tasks abertas para Sprint 20+

### Operacional/UX
- Investigar `composeSystemPrompt` (sync builder) — confirmar dead code ou alinhar com `buildSystemPrompt`
- TOM se apresenta na 1ª vez está implementado mas não há ainda teste E2E com collaborator novo
- Workflow de dev local: localhost:4173 não atualiza após push — investigar fluxo de pull/build/preview
- PWA aba Operações Técnicas — popular dropdown Responsável com candidatos formais (mesma lógica que aba Pedagógico)

### Possíveis Sprints 20–22
- **Sprint 20 (sugerida):** módulo de Eventos como motor próprio (separar `evento-pedagogico` task de event entity de fato), governança fina de subdomínio (Anne só Kids, etc.)
- **Sprint 21 (sugerida):** professor como collaborator (resolve gap §6 do PRD pedagógico — professor abrir demanda direto), expansão da camada replicável para Financeiro e Comercial
- **Sprint 22 (sugerida):** dashboard analítico cross-departamento, observabilidade pedagógica (frequência aluno × performance professor), retros automatizadas

### Técnicas a observar
- IntegrityCheck B1 (tom de suspeita não-bloqueio): após Bug B2 fix, monitorar se microconfirmações soam acolhedoras ou paranoicas
- B2 (regressão em criação simples): confirmar que tasks sem conflito ainda passam direto sem microconfirmação espúria
- B3 (peso da skill no prompt): `pedagogico.md` adiciona ~6 KB ao system prompt sempre; revisitar se ultrapassar 30% do total

---

## Infraestrutura
- VPS (`srv1586784`) hospeda 3 processos pm2: `tom`, `la-organizer-web`, `la-organizer-tunnel`
- Supabase Postgres com RLS extensivo, helper `current_collab_role()` em uso
- Backup diário às 03h BRT
- Deploy: clone temporário → cp → commit → push origin main → ssh tom git pull → pm2 restart
- PWA Vercel auto-deploy do main

## Commits da Sprint 19 (cronologia)

```
684770c  docs(sprint19): spec + plano camada pedagogica
8d6be1a  feat(sprint19): camada pedagogica - schema + helpers + skill + gate
637e697  fix(sprint18+19): loadSkill .md.md
14b2e35  fix(sprint18): IntegrityCheck dup_task false positives
837f461  fix(sprint18): strip suffix '— UNIDADE' before jaroWinkler
2a02039  fix: 3 hotfixes finos UX/comprehension (urgente, é-urgente, COORD_HINT)
b8b8b70  fix(sprint19): pickSkill rotea para pedagogico/operacoes-tecnicas
7be949c  fix(sprint19): substitui placeholders <UUID-xxx> por UUIDs reais
5519157  fix(sprint19): tradução visível school→Escola na fala do TOM (revertido depois)
7eb5306  fix(sprint19): apresentação Escola = LA Music School / LA Music Kids
937c1e9  fix(sprint19): PWA filtro Responsavel popula candidatos do dept
9787109  fix(radar): 4 ajustes UX pós-Sprint19 (priority/relay/intro/B2)
49fa159  fix(pwa): unitLabel traduz 'all' para 'Todas'
```

**Sprint 19 — encerrada formalmente em 2026-05-05.**
