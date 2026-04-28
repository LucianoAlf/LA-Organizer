# 🗺️ Roadmap LA Organizer — TOM

**Baseado em:** PRD v2.0, Docs 01-06, TOM-SOUL, TOM-AGENTS, TOM-MEMORY, TOM-SKILLS
**Atualizado:** 26 de abril de 2026
**Estado:** Fase 1 em andamento

---

## FASE 0 — Infraestrutura ✅ CONCLUÍDA

| Item | Status |
|------|--------|
| VPS KVM4 + PM2 + Nginx | ✅ |
| Webhook UAZAPI end-to-end | ✅ |
| Claude CLI via spawn (stdin fechado) | ✅ |
| Supabase 27 tabelas + 9 domínios | ✅ |
| GitHub sincronizado | ✅ |
| SSH sem senha (`ssh tom`) | ✅ |
| ecosystem.config.js | ✅ |
| SOUL.md + AGENTS.md no prompt | ✅ |
| Arquitetura de prompt (3-8KB, 1 skill por vez) | ✅ |
| Linguagem visual 👽 + emojis semânticos | ✅ |
| Typing indicator ("TOM está digitando...") | ✅ |
| Memória ativa (extração automática) | ✅ |

---

## FASE 1 — TOM WhatsApp 🔄 EM ANDAMENTO

### 1A. Rituais automáticos (TOM inicia)

| Funcionalidade | Status | Observação |
|----------------|--------|------------|
| Onboarding (5 perguntas) | ✅ | Formatado com emojis |
| Briefing trabalho (8h) | ✅ | Cron funcionando |
| Fechamento do dia (19h) | ✅ | Cron funcionando |
| Briefing pessoal (7h) | ⚠️ | Cron existe mas hábitos/tarefas pessoais não implementadas |
| Planejamento semanal (domingo) | ⚠️ | Cron existe mas NUNCA testado de verdade |
| Alerta de prazo (vence em 1-2 dias) | ❌ | |
| Alerta de atraso (task overdue) | ❌ | |
| Resumo do time (coordenador, 19h30) | ❌ | |
| Retrospectiva semanal (coordenador, domingo) | ❌ | |

### 1B. Ações sob demanda (colaborador inicia)

| Funcionalidade | Status | Observação |
|----------------|--------|------------|
| Ticar tarefa ("fiz", "terminei") | ✅ | |
| Criar projeto 5W2H (7 perguntas) | ✅ | Com emojis semânticos |
| Ver status do dia | ✅ | |
| Ver status de projeto | ✅ | |
| Registrar demanda nova ("surgiu X") | ⚠️ | Parcial — salva como memória, não como task |
| Reagendar tarefa ("muda pra quinta") | ❌ | |
| Delegar tarefa ("passa pro Joel") | ❌ | |
| Pedir mais prazo ("não vou conseguir") | ❌ | Fluxo com notificação ao coordenador |
| Criar tarefa pessoal ("me lembra de pagar conta") | ❌ | context='personal', 100% privado |
| Criar lembrete avulso ("me lembra em 30 min") | ❌ | delayed notification |
| Criar tarefa de trabalho ("anota: reunião quarta") | ❌ | |

### 1C. Hábitos pessoais

| Funcionalidade | Status | Observação |
|----------------|--------|------------|
| Criar hábito ("quero ler 30 min/dia") | ❌ | Banco tem tabelas, templates seedados |
| Ver templates de hábitos | ❌ | 10 templates já no banco |
| Marcar hábito feito ("fiz academia") | ❌ | |
| Streak (dias consecutivos) | ❌ | |
| Hábitos no briefing pessoal | ❌ | Depende de tudo acima |

### 1D. Hierarquia e permissões

| Funcionalidade | Status | Observação |
|----------------|--------|------------|
| Trava server-side criar projeto (só coord+) | ✅ | |
| Eisenhower trigger no banco | ✅ | |
| Separação pessoal × trabalho (context) | ❌ | Tasks não separam contexto ainda |
| Notificação ao coordenador (pedido de prazo) | ❌ | |
| Coordenador cria tarefa e delega | ❌ | |
| Coordenador aprova/nega extensão | ❌ | |

### 1E. Separação de contextos (IMPORTANTE — PRD define isso)

| Contexto | Emoji | Exemplos | Status |
|----------|-------|----------|--------|
| Pessoal | 💪 💰 🏋️ | Academia, contas, médico, leitura | ❌ |
| Trabalho | 📋 📚 🗂️ | Tarefas profissionais, projetos, reuniões | ✅ |
| Financeiro | 💰 | Contas a pagar (pessoal) | ❌ |
| Projeto | 🗂️ | Vinculado a projeto específico | ✅ |

### 1F. Outros

| Funcionalidade | Status | Observação |
|----------------|--------|------------|
| Cadastrar mais colaboradores | ❌ | Só Alf no banco |
| Broadcast com follow-up | ❌ | Skill existe, engine não |
| Tratamento de áudio | ❌ | Skill existe, engine não |
| "Não me incomoda agora" (do_not_disturb) | ❌ | |
| Consolidação de memória (cron domingo 22h) | ❌ | Skill existe, cron não |
| Evolução autônoma de skills (Hermes) | ❌ | Documentado, não implementado |

---

## FASE 2 — PWA Espelho ❌ NÃO INICIADA

| Tela | Descrição |
|------|-----------|
| Hoje | 3 tarefas do dia + checkbox + pendências de ontem |
| Semana | 7 dias com entregas distribuídas |
| Projetos | Roadmap visual + checkpoints |
| Configurações | Horários, intensidade, Google Calendar |
| Hábitos | Streak, templates, tracking visual |
| Checklist operacional | Ticar itens da função |
| Histórico | Dias anteriores, taxa de conclusão |

---

## FASE 3 — Dashboard Gerencial ❌ NÃO INICIADA

| Funcionalidade | Descrição |
|----------------|-----------|
| Dashboard do time | Ranking de conclusão, alertas |
| Pessoa detalhe | Tarefas, rituais, checklists por pessoa |
| Aderência geral | Rituais + checklists + Emusys |
| Gestão de checklists | Criar/editar templates operacionais |
| Check-in de presença em unidade | Pedido Ana Paula RH |
| Dashboard executivo (Alf) | Métricas consolidadas |

---

## FASE 4 — Integração Alfredo ❌ NÃO INICIADA

| Funcionalidade | Descrição |
|----------------|-----------|
| "Como tá a Juliana?" | Diagnóstico com dados reais |
| "Quem não tá usando?" | Lista de inativos |
| "Como tá o Projeto X?" | Roadmap + atrasos + equipe |

---

## FASE 5 — Checklists Operacionais + Emusys + Google Calendar ❌ NÃO INICIADA

| Funcionalidade | Descrição |
|----------------|-----------|
| Checklist abertura escola | Secretária, início do turno |
| Fiscalização de salas | Assistente pedagógico |
| Lembrete Emusys pós-aula | Professor |
| Google Calendar sync | Bidirecional |

---

## 📊 Resumo numérico da Fase 1

| Categoria | Total PRD | Implementado | Falta |
|-----------|-----------|-------------|-------|
| Rituais automáticos | 9 | 3 | 6 |
| Ações sob demanda | 11 | 4 | 7 |
| Hábitos pessoais | 5 | 0 | 5 |
| Hierarquia/permissões | 6 | 2 | 4 |
| Contextos (pessoal/trabalho) | 4 | 1 | 3 |
| Outros (broadcast, áudio, etc) | 6 | 0 | 6 |
| **TOTAL FASE 1** | **41** | **10** | **31** |

---

## 🎯 Prioridade sugerida para próximas sprints

### Sprint 1 (próxima): Fechar o ciclo básico
1. Criar tarefa pessoal ("me lembra de pagar conta sexta")
2. Criar tarefa de trabalho ("anota: reunião quarta")
3. Criar lembrete avulso ("me lembra em 30 min")
4. Reagendar tarefa ("muda pra quinta")
5. Separação pessoal × trabalho (context field)
6. Cadastrar Juliana + Quintela no banco

### Sprint 2: Planejamento completo
1. Planejamento semanal testado de verdade (domingo 19h)
2. Delegar tarefa ("passa pro Joel")
3. Pedir mais prazo + notificação ao coordenador
4. Alertas de prazo e atraso
5. Hábitos pessoais (criar, marcar, streak)

### Sprint 3: Coordenação
1. Resumo do time diário (19h30)
2. Retrospectiva semanal (domingo)
3. Coordenador cria e distribui tarefas
4. Broadcast com follow-up
5. "Não me incomoda agora"

### Sprint 4: Inteligência
1. Consolidação de memória (cron domingo 22h)
2. Evolução autônoma de skills (Hermes)
3. Tratamento de áudio
4. Otimização de latência do Claude CLI

---

*Fase 1: 10 de 41 funcionalidades implementadas (24%)*
*Próxima sprint foca em fechar o ciclo básico de tarefas — pessoal + trabalho + lembretes.*

---

## Sprint 9+ parking lot — débitos pós-Sprint 8

Itens descobertos durante Sprint 8 que ficaram fora de escopo:

- **Member picker no wizard** — selecionar collaborators cadastrados em vez de texto livre. Ao confirmar, popula `project_members` automaticamente e o engine notifica cada membro no WhatsApp na hora da criação. Hoje "Quem participa" é texto solto que TOM precisa interpretar; com picker, é vínculo de banco direto. Aumenta o valor do projeto criado pelo PWA.
- **Hierarquia tipográfica do wizard** — labels (🎯 Por que existe, 👥 Quem participa) estão com peso/tamanho próximos demais dos valores, gera ruído visual. Não bloqueou Sprint 8 mas precisa de uma passada de design tokens. Aplicar nas telas: passo 4 (resumo) e tela final do wizard.

---

## Sprint 9 — visão proativa do TOM (insight pós-Etapa 5)

Insight crítico capturado durante a Sprint 8 (28/04/2026) durante teste do APROVA/REJEITA. O Alf identificou um gap conceitual da Sprint 8: o TOM precisa ser proativo, não reativo a comandos.

**Premissa**: a maioria dos colaboradores LA Music **não conhece** roadmap, 5W2H, Matriz de Eisenhower, ciclos de checkpoint. Se o TOM só esperar comando explícito, eles vão ficar perdidos. Precisa **conduzir**.

**Disparadores onde o TOM deve sugerir, não esperar**:

1. **Pós PROJECT_CREATE / PROJECT_APPROVE** — em vez de criar 1 checkpoint genérico "Definir primeiros passos", o TOM deve analisar nome+justificativa+janela+metodologia e propor 4-6 etapas sugeridas. Ex:
   - Workshop de Bateria → ["Definir convidado", "Divulgação", "Confirmação de inscritos", "Material/local", "Realização", "Follow-up"]
   - Festa de 15 anos da filha (pessoal!) → ["Lista de convidados", "Salão", "Buffet (3 cotações)", "Banda/DJ", "Decoração", "Fotógrafo"]
   - Mensagem WA: "Pensei nessas etapas pra `<projeto>`: 1, 2, 3, 4. Quer ajustar?"
   - Usuário responde com edição em texto → TOM atualiza checkpoints

2. **Projetos pessoais tem peso igual ao trabalho** — não é só pra coordenação. Aniversários, viagens, reformas, eventos da família. Mesmo formato de roadmap sugerido.

3. **Acompanhamento ativo** — uma vez criado, TOM deve ir checando: "Faltam 2 semanas pro recital, como tá o ensaio coletivo?" "O salão da festa já fechou?". Sem precisar pedir.

4. **Generoso com sugestões, leve com julgamento** — o TOM sugere, oferece exemplos, mas respeita a decisão do usuário. Não impõe template, libera para reescrever.

**Skills a evoluir / criar**:
- `cadastro-projeto-5w2h.md` — passar a sugerir etapas no fim do fluxo (em vez de só persistir)
- `aprovar-projeto.md` — após APROVA, sugerir checkpoints na próxima resposta
- Nova skill `acompanhar-projeto` — cron periódico que olha projetos ativos e dispara nudges contextuais
- Nova skill `sugerir-checkpoints` — chamada interna pelo engine para gerar lista a partir de meta + janela

**Outras pendências da Sprint 8**:
- Member picker no wizard (popular project_members + notificar membros)
- Hierarquia tipográfica do PWA (debt visual)
- Resposta da skill de aprovação ainda saindo com artefato "text" — investigar se é template engessado vs liberdade do agente (Hermes/OpenCloud)
