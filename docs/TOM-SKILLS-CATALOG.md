# TOM-SKILLS-CATALOG — Catálogo Consolidado de Skills

**Documento:** TOM-SKILLS-CATALOG
**Versão:** 4.5
**Data:** 2026-05-05 (atualizado Sprint 20 — adicionada skill 10.13 gerencia)
**Função:** Catálogo consolidado das skills e referências internas do TOM

---

## O que este documento é

Este arquivo é o índice central do que o TOM sabe fazer, do que usa como referência e do que ainda está no radar de evolução.

Ele não substitui os arquivos individuais das skills.
Ele organiza o catálogo.

---

## Taxonomia do catálogo

O TOM trabalha com 3 tipos de artefato:

### 1. Skills ativas
Instruções operacionais que o TOM pode carregar para executar um tipo de fluxo conversacional ou operacional.

### 2. Referências internas
Documentos de apoio. Não devem ser tratadas como skill ativa. Servem para orientar estilo, lógica interna ou comportamento do sistema.

### 3. Roadmap
Capacidades futuras, hipóteses de skill ou mecanismos ainda não consolidados.

---

# 1. Skills ativas aprovadas

## 1. Onboarding
**Arquivo:** `skills/onboarding.md`

**Função:** configurar preferências iniciais do colaborador e concluir a entrada no sistema.

**Ativa quando:**
- `onboarding_completed = false`
- ou quando houver fluxo explícito de reconfiguração

**Entrega principal:**
- coleta preferências
- confirma configuração
- emite `<<ONBOARDING_DONE>>`

---

## 2. Checklist de tarefas
**Arquivo:** `skills/checklist-tarefas.md`

**Função:** concluir, reagendar, criar, delegar e tratar pedidos ligados a tarefas. Inclui criação de tarefa **pra outro colaborador** (apenas coordinator/director).

**Ativa quando:**
- colaborador responde ao fechamento
- colaborador pede ação sobre tarefa
- colaborador pede lembrete ou cria item novo
- **uma demanda nova surge na conversa** ("surgiu uma demanda do pai do aluno X", "preciso falar com Juliana sobre Y", "tem que resolver Z") — vira task, não memória.
- coordinator/director pede pra criar/delegar tarefa pra outro colaborador

**Entrega principal:**
- interpreta intenção
- confirma quando necessário (nome ambíguo, prazo faltando)
- emite `<<TASK_UPDATE>>` com action correta

**Actions suportadas:** `complete`, `reschedule`, `create`, `create` com `to_name`/`to_phone` (coord-only), `delegate` (coord-only), `extension_request`, `extension_decision` (coord-only).

---

## 2.5 Criar compromisso (event)
**Arquivo:** `skills/criar-compromisso.md`

**Função:** criar compromisso (evento com horário) — distinto de tarefa. Adicionada na Sprint 4 quando TOM passou a aprender a emitir `<<EVENT_CREATE>>`.

**Ativa quando** (em `pickSkill` priority 4.9, **antes** de `checklist-tarefas`):
- termo de evento (reunião, aula, ensaio, mentoria, sessão, encontro, gravação, masterclass, consulta, compromisso) **+ horário**
- range explícito ("das 10 às 11")
- verbo agendar + horário + (termo de evento OU modalidade)

Em dúvida, fallback para `checklist-tarefas` (cria task com `remind_at` se for o caso).

**Entrega principal:**
- valida `start_at`, `end_at` (ISO -03:00, end > start)
- valida `modality` ∈ {presencial, online, hibrido}
- valida `category` ∈ {la_music, mentoria, aula_particular, outra_escola, estudio, pessoal}
- emite `<<EVENT_CREATE>>` com schema completo

**Privacidade:** `category=pessoal` → engine grava `context=personal` automaticamente. Demais → `context=work`. Mesma regra do PWA.

**Veto:** nunca emite `meeting_url` em compromisso `presencial`. Nunca emite `<<EVENT_CREATE>>` e `<<TASK_UPDATE>>` na mesma resposta — escolhe um.

**Sprint 5 — atualização e convivência:**
- Skill estendida com `<<EVENT_UPDATE>>` (`reschedule`, `cancel`, `complete`). Mesma skill, sem skill nova.
- `pickSkill` priority 4.9 cobre verbos de update sobre termos de evento (`remarca a reunião`, `cancela o ensaio`, `fechei a mentoria`).
- Convivência task↔event: a skill instrui Claude a perguntar UMA vez quando há task pendente muito similar antes de emitir `<<EVENT_CREATE>>` — evita duplicação. Resposta "promover" emite `<<TASK_UPDATE complete>>` + `<<EVENT_CREATE>>` na mesma resposta (única exceção à regra de operação única).

**Sprint 22.33–22.34 — reforços e defesas em profundidade:**
- Tabela canônica no topo da skill: `academia 18h → TASK + remind_at` vs `reunião X 14h → EVENT_CREATE` (caso "hábito com hora não vira evento").
- Caso "N events em uma frase" documentado explicitamente: emit array com N items dentro do mesmo marker.
- Backend defensivo (engine.js): se LLM ignora a regra de hábito, o engine consulta `habits` ativos do user e converte EVENT_CREATE → TASK INSERT com `remind_at = start_at` (habit redirect Sprint 22.34b).
- `parseEventCreateMarker` exporta `droppedItems` pra fallback recovery quando schema parcialmente inválido.
- `detectDuplicateSemanticEvent` agora aplica `stripVerbPrefix` + keyword overlap mínimo (espelha fix Sprint 21.4 do task dup) — evita falso positivo "reunião com Henrique" vs "Reunião Matheus" (Sprint 22.33).

---

## 3. Comunicados internos segmentados (atualizado Sprint 13 F1)
**Arquivo:** `skills/comunicados.md`

**Função:** criar e cancelar comunicados internos segmentados por role, unidade ou pessoa. Substitui o mecanismo genérico de broadcast — o arquivo `skills/broadcast.md` não existe mais.

**Ativa quando** (coordinator/director):
- pede envio coletivo ("avisa todo mundo", "manda pra coordenação", "comunica o time da Barra")
- menciona comunicado, aviso, anúncio, informativo

**Entrega principal:**
- coleta `message`, `audience` JSON e `schedule_type`
- confirma antes de disparar
- emite `<<ANNOUNCEMENT_ACTION>>` com `action: create`
- cancelamento via `<<ANNOUNCEMENT_ACTION>>` com `action: cancel`

---

## 3.3 Aprovação de comunicados (novo Sprint 13 F3)
**Arquivo:** `skills/aprovacao-comunicados.md`

**Função:** permitir que o diretor aprove ou rejeite comunicados criados por coordenadores que atingem toda a escola.

**Ativa quando** (apenas director):
- dispatcher/notifyCoordinators envia alerta de comunicado pendente
- diretor digita `APROVAR <id>` ou `REJEITAR <id> motivo`

**Entrega principal:**
- emite `<<ANNOUNCEMENT_APPROVAL>>` com `action: approve` ou `action: reject`
- listagem de pendentes quando diretor pede "ver comunicados pendentes"

---

## 4. Rituais diários
**Arquivo:** `skills/rituais-diarios.md`

**Função:** gerar briefing pessoal, briefing de trabalho e fechamento do dia.

**Ativa quando:**
- dispatcher envia diretiva `[RITUAL: ...]`

**Entrega principal:**
- monta ritual conforme contexto, intensidade e prioridade
- separa pessoal de trabalho
- conduz a rotina diária do TOM

---

## 5. Hábitos pessoais
**Arquivo:** `skills/habitos-pessoais.md`

**Função:** criar, acompanhar e reforçar hábitos pessoais com streaks, lembretes e templates.

**Ativa quando:**
- colaborador pede criação de hábito
- marca hábito como feito
- pede lista de hábitos
- pede templates

**Entrega principal:**
- organiza subfluxos de hábito
- emite `<<HABIT_ACTION>>` quando necessário
- mantém hábitos no domínio pessoal

---

## 6. Checklists operacionais
**Arquivo:** `skills/checklists-operacionais.md`

**Função:** enviar checklist operacional, registrar preenchimento, captar observações e apoiar aderência.

**Ativa quando:**
- cron dispara checklist
- colaborador marca itens
- colaborador reporta problema
- liderança pede aderência

**Entrega principal:**
- envia checklist
- interpreta preenchimento parcial ou total
- emite `<<CHECKLIST_ACTION>>` quando necessário

---

## 7. Integração Emusys
**Arquivo:** `skills/integracao-emusys.md`

**Função:** cobrar presença e conteúdo pendentes, incluir pendências no fechamento e resumir aderência.

**Ativa quando:**
- existe aula pendente
- professor responde à cobrança
- liderança pede status

**Entrega principal:**
- produz as mensagens conversacionais do fluxo Emusys
- não faz o sync técnico — isso é backend
- normalmente não emite marker próprio

---

## 8. Tratamento de áudio
**Arquivo:** `skills/tratamento-audio.md`

**Função:** interpretar áudio, confirmar entendimento e encaminhar a ação correta.

**Ativa quando:**
- colaborador envia mensagem de voz

**Entrega principal:**
- interpreta transcrição
- confirma entendimento
- faz handoff para a skill correspondente
- normalmente não emite marker próprio

---

## 8.4 Pausa temporária (do_not_disturb)
**Arquivo:** `skills/pausa-temporaria.md`

**Função:** permitir que o colaborador represe rituais/alertas/lembretes por uma janela curta ("agora não", "tô em aula", "me chama em 2h"). Mensagens dele pra TOM continuam fluindo.

**Ativa quando:** intent regex em `pickSkill` (priority 1.5) — frases comuns de pausa.

**Entrega principal:** marker `<<DND_SET>>{until, reason}` ou `{clear:true}`. Engine cap 24h.

**Privacy:** `user_preferences.do_not_disturb_until` é privado por colaborador (nada vaza).

---

## 8.5 Coordinator reports (resumo do time + retrospectiva semanal)
**Mecanismo:** dispatcher cron + builders deterministícos (`buildTeamSummary`, `buildWeeklyRetrospective` em `src/engine.js`). **Não passa pelo Claude.**

**Função:** dar a coordenador/diretor visibilidade operacional do time, sem expor dado pessoal.

**Ativa quando:**
- `team_summary`: weekday (Mon-Fri) às 19:30 (slot-aligned)
- `weekly_retrospective`: domingo às 18:00 (slot-aligned)
- ou via CLI: `node src/rituals/dispatcher.js --force=resumo_time` / `--force=retrospectiva_semanal`

**Entrega:** texto curto via WhatsApp pra cada colaborador com `role IN (coordinator, director)`. Idempotência via `ritual_logs` (alreadySent).

**Privacy contract (enforced):**
- Apenas `tasks.context='work'` é consultada
- `conversation_history` é usada apenas para detecção (count de mensagens inbound após sent_at do briefing); o conteúdo NUNCA é lido
- `habits`, `habit_logs`, `collaborator_memory` NUNCA são tocados
- Output em terceira pessoa, nomes próprios apenas (work-context permitido entre coordinators)

---

## 9. Gestão de memória
**Arquivo:** `skills/gestao-memoria.md`

**Função:** salvar fatos, decisões, preferências, lições e contexto relevante durante a conversa.

**Ativa quando:**
- o colaborador revelou algo com valor futuro durável
- e a informação **NÃO** é uma demanda acionável (essa precedência é explícita: demanda acionável → `checklist-tarefas`, não memória)

**Não ativa quando:**
- a mensagem é uma demanda nova ("surgiu...", "preciso falar com X", "tem que resolver...") — usa `checklist-tarefas` com `<<TASK_UPDATE>> create`
- estado momentâneo / desabafo sem padrão recorrente

**Entrega principal:**
- emite `<<MEMORY_SAVE>>` apenas quando há valor futuro real
- registra memória sem expor isso ao usuário
- pode coexistir com `<<TASK_UPDATE>>` em casos mistos (ex.: "surgiu reunião com pai do aluno X — ele tá pra trocar de professor" → task + memória do contexto)

---

## 10. Planejamento semanal (novo Sprint 12)
**Arquivo:** `skills/planejamento-semanal.md`

**Função:** conduzir o planejamento semanal em 3 turnos via WhatsApp. Cria metas, distribui tarefas por dia e salva o plano no banco.

**Ativa quando:**
- dispatcher envia diretiva `[RITUAL: weekly_planning]` (cron no `planning_day`/`planning_time` do colaborador)
- colaborador diz "quero planejar a semana" ou equivalente

**Entrega principal:**
- Turno 1: abertura, solicita objetivos da semana
- Turno 2: proposta de distribuição por dia
- Turno 3: confirmação + emissão de `<<WEEKLY_PLAN>>` com `week_start`, `goals`, `distribution[]`
- Engine cria `weekly_plans` + `daily_plans` + `daily_plan_items` + tasks

---

## 10.3 Eventos institucionais (novo Sprint 13 F2 / atualizado Sprint 14 F2)
**Arquivo:** `skills/eventos-institucionais.md`

**Função:** criar e cancelar eventos institucionais (shows, recitais, workshops, reuniões de pais, formaturas).

**Ativa quando** (coordinator/director):
- menciona show, recital, workshop, formatura, reunião de pais, evento institucional
- com data e unidade

**Entrega principal:**
- coleta `title`, `event_date`, `start_time`, `unit`, `event_type`, `location`, flags de notificação
- confirma antes de criar
- emite `<<SCHOOL_EVENT_ACTION>>` com `action: create`
- Sprint 14 F2: engine auto-gera tasks de preparação por setor baseado em `event_type`; dispatcher `remindEventTasks` envia lembrete T-1 para os responsáveis

---

## 10.5 Operações Técnicas (novo Sprint 15 F2)
**Arquivo:** `skills/operacoes-tecnicas.md`

**Função:** capturar, triar e confirmar demandas operacionais do departamento Operações Técnicas (e futuros departamentos replicáveis).

**Ativa quando** (todos os roles — carregada globalmente em `prompts/system.js`):
- "quebrou", "tá ruim", "faltou", "preciso comprar", "manutenção", "não funciona", "sem estoque" e equivalentes
- qualquer menção a problema físico/técnico na escola

**Fluxo (3 turnos):**
1. **Captura:** identifica tipo de demanda e coleta descrição
2. **Triagem:** confirma prioridade e unidade; aplica regra de impacto-em-aula (priority → `critical`)
3. **Confirmação:** resumo + emite `<<TASK_UPDATE>>`

**Tipos suportados (hardcoded com UUIDs do seed):**
- `incidente-tecnico` (high) — equipamento quebrado ou falha imediata
- `reposicao-estoque` (medium) — material esgotado
- `apoio-tecnico-montagem` (medium) — suporte para evento/show
- `obra-infraestrutura` (low, requires_approval) — reforma ou melhoria permanente
- `preventivo-auditoria` (low) — manutenção programada
- `compra-fornecedor` (medium, requires_approval) — aquisição com terceiros

**Entrega principal:**
- emite `<<TASK_UPDATE>>` com `action: create`, `department_id`, `request_type_id`, `description`, `notes`
- engine auto-set `status='awaiting_confirmation'` para tipos com `requires_approval=true`

**Responsável padrão:** Rafinha (id c9e72a40) — `departments.default_responsible_id`

---

## 10.6 Cadastro de projeto 5W2H (novo Sprint 5)
**Arquivo:** `skills/cadastro-projeto-5w2h.md`

**Função:** guiar o coordinator/director através das 7 perguntas do 5W2H para criar um projeto formal.

**Ativa quando** (coordinator/director):
- "quero criar projeto", "novo projeto", "vamos criar um projeto", intenção clara equivalente

**Gate de permissão:** se role não é coordinator/director, TOM recusa cordialmente.

**Entrega principal:**
- UMA pergunta por mensagem (7 ao total: O quê, Por quê, Quem, Onde, Quando, Como, Quanto)
- nunca re-pergunta campo já preenchido (Sprint 11.5 hotfix)
- confirmação antes de emitir
- emite `<<PROJECT_CREATE>>` com schema completo

---

## 10.7 Aprovar/rejeitar projeto (novo Sprint 8)
**Arquivo:** `skills/aprovar-projeto.md`

**Função:** permitir que o supervisor aprove ou rejeite projeto pendente enviado por coordenador subordinado.

**Ativa quando** (supervisor recebe notificação ou digita):
- `APROVA <TOKEN>` → emite `<<PROJECT_APPROVE>>`
- `REJEITA <TOKEN> motivo` → emite `<<PROJECT_REJECT>>`
- sem token: TOM pergunta qual projeto

**Gate de permissão:** role deve ser coordinator ou director.

**Entrega principal:**
- Caso A: usuário disse "aprovo" sem token → TOM pede token
- Caso B: `APROVA <TOKEN>` → emite `<<PROJECT_APPROVE>>`
- Caso C: `REJEITA <TOKEN> motivo` → emite `<<PROJECT_REJECT>>`
- Caso D: engine não encontrou / achou múltiplos → TOM informa e pede clarificação

---

## 10.9 Priorização inteligente (novo Sprint 12 Bloco D)
**Arquivo:** `skills/priorizacao-inteligente.md`

**Função:** classificar demandas mal definidas em resolver agora, tarefa, ligação, reunião, delegar ou projeto.

**Ativa quando:**
- demanda chega ambígua, misturada ou com prioridade implícita
- colaborador descreve situação sem ação clara

**Entrega principal:**
- classifica a demanda
- propõe encaminhamento (tarefa imediata, projeto, delegação etc.)
- faz handoff para a skill correspondente

---

## 10.10 Coordenação conversacional (novo Sprint 16)
**Arquivo:** `skills/coordenacao-conversacional.md`
**Tipo:** auxiliar global (sempre carregada para todos os roles)

**Função:** TOM intermedia comunicação entre colaboradores via WhatsApp — repassar recados, avisar alguém ou cobrar resposta — sem precisar que o solicitante tenha o número da outra pessoa.

**3 modos de operação:**
- `relay_literal` — texto verbatim ("manda exatamente isso pra X")
- `relay_assisted` — parafraseia profissionalmente, preserva intenção
- `followup` — cobrança + monitoramento de resposta com deadline

**Regras de alçada (gate genérico):**
- collaborator sem `pedagogical_role` não emite `followup` (recusa)
- coordinator/manager não cobra director (relay-only)
- mentor pedagógico nunca cobra (gate pedagógico tem precedência — ver 10.12)

**Marker:** `<<COORDINATION_REQUEST>>` + `<<COORDINATION_RESPONSE>>` (fecham com `<<END>>`).
**Atualizado Sprint 17:** convive com ACC (`[ACTIVE_COORDINATION_CONTEXT]`) para resolver pronomes anafóricos com confidence high/medium/low.
**Atualizado Sprint 19 radar:** cabeçalho de relay usa apenas primeiro nome (sem `(CEO/Fundador)`); TOM se apresenta na 1ª vez quando `recipient.onboarding_completed=false`.

---

## 10.11 Integridade de agenda (novo Sprint 18)
**Arquivo:** `skills/integridade-agenda.md`
**Tipo:** auxiliar global (sempre carregada para todos os roles)

**Função:** apresentar findings de IntegrityCheck (conflitos temporais, duplicidade semântica, dia carregado) ao usuário e conduzir microconfirmação antes de criar/atualizar.

**Princípio mãe:** "alertar > sugerir > confirmar > criar" — bloqueio só em impossibilidade física confirmada.

**Tipos de finding tratados:**
- `dup_task` (Jaro-Winkler ≥0.7 com strip de suffix) — pergunta "é a mesma demanda ou outra?"
- `dup_event` (similar, com janela ±48h)
- `temporal_hard` — mesma sala/local/horário confirmados → bloqueia até confirmação explícita
- `temporal_soft` — overlap leve → microconfirmação leve

**Bug B2 fix (Sprint 19 radar 4):** quando IntegrityCheck bloqueia, engine substitui qualquer texto otimista do LLM (ex.: "✅ Registrado!") por microconfirmação determinística construída no helper `_buildIntegrityConfirmText`.

---

## 10.12 Pedagógico (novo Sprint 19)
**Arquivo:** `skills/pedagogico.md`
**Tipo:** primária via pickSkill (gatilhos pedagógicos) E auxiliar global (carregada também quando outra skill é primary)

**Função:** captura demandas pedagógicas (alunos, professores, turmas, recitais, bandas) e roteia por hierarquia, subdomínio (LA Music School ↔ LA Music Kids) e escopo. Emite `<<TASK_UPDATE>>` (criação) com `department_id`/`request_type_id`/`subdomain` e `<<COORDINATION_REQUEST>>` (relay/cobrança).

**Hierarquia (4 papéis):**
- `lead` (Juliana=school, Quintela=kids) — autoridade total no subdomínio
- `assistant` (Leo, Ramon, Dai, Matheus Felipe, Jordan, Rodrigo) — abre demanda; cobra professor **só dentro do escopo** (1 match: unit OR specialty OR subdomain)
- `mentor` (Peterson, Kinho, Renan) — orienta; **nunca** cobra
- `teacher` (não-collaborator no MVP) — abre demanda via assistente/coord

**Subdomínio:**
- `school` → exibido como "LA Music School" (Juliana)
- `kids` → exibido como "LA Music Kids" (Quintela, Matheus Felipe)

**Mapa de escopo dos assistentes** (em `pedagogical_assignments`):
- Leo: unidade Barra
- Ramon: unidade Recreio + bandas
- Dai: unidade Campo Grande
- Matheus Felipe: subdomain Kids
- Jordan: eventos + bateria
- Rodrigo: cordas

**7 request types iniciais:**
`acompanhamento-professor`, `apoio-ao-aluno`, `alinhamento-de-turma`, `alinhamento-com-responsavel`, `evento-pedagogico`, `pendencia-pedagogica`, `suporte-ao-professor`.

**Regra de precedência (não negociável):** se o gate pedagógico (`canDelegatePedagogical`) negar, o gate genérico Sprint 16 NÃO autoriza acima dele. DENY pedagógico = DENY final.

**Não-objetivos:** `evento-pedagogico` é só task (não toca `events`); professor não vira collaborator no MVP; sem dashboard analítico nem auditoria.

---

## 10.13 Gerência (novo Sprint 20)
**Arquivo:** `skills/gerencia.md`
**Tipo:** primária via pickSkill (Priority 4.65, antes de pedagogico)

**Função:** filtro inteligente da unidade. Captura demandas relacionais (retenção, experiência, atendimento, articulação interna), articula com áreas adjacentes, encaminha pedagógico via relay.

**Hierarquia (3 gerentes + 1 líder dept):**
| Gerente | Unidade | role | unit (DB) |
|---|---|---|---|
| Jereh | Campo Grande | manager | campo_grande |
| Clayton | Recreio (interino) | manager | recreio |
| Krissya | Barra | manager | barra |
| Yuri | Marketing (líder dept) | manager | all |

**Distinção crítica:** Yuri é manager+all — NÃO é gerente de unidade.

**8 request types:**
risco-de-evasao, recuperacao-de-aluno, alinhamento-com-responsavel (Gerência), problema-de-atendimento, experiencia-da-unidade, negociacao-relacional, pendencia-gerencial, articulacao-interna.

**Fronteira com Pedagógico (NÃO NEGOCIÁVEL):**
- Gerente NUNCA emite `followup` para alguém com `pedagogical_role` (gate Sprint 19 bloqueia automaticamente)
- Gerente sempre usa `relay_assisted` para encaminhar pedagógico
- Engine tem mensagem custom para manager quando gate bloqueia: oferece relay para assistente da unidade ou coord

**Diferenciação `alinhamento-com-responsavel` (existe nos 2 deptos):**
- Gerência → experiência/retenção/insatisfação relacional
- Pedagógico → devolutiva sobre aprendizado/trilha do aluno

**Regras críticas (consolidadas após hotfixes):**
- Risco de evasão é gerência, NUNCA pedagógico (mesmo se aluno mencionado)
- Problema de atendimento HUMANO (telefone, recepção) é gerência, NUNCA incidente-tecnico
- Unidade da task vem do **aluno**, não do assignee (Quintela/Juliana são lead globais)
- UUIDs do dept são OBRIGATÓRIOS no marker (sem isso, task vira NULL/NULL)

**Não-objetivos:** TOM não vira "menino de recado" (ver `docs/TOM-LIMITES.md`); manager continua sem alçada para followup pedagógico; sem CRM gigante.

---

# 2. Referências internas aprovadas

## 1. Priorização Eisenhower
**Arquivo:** `docs/referencia-priorizacao-eisenhower.md`

**Papel:** documentar a lógica interna de priorização automática das tarefas.

**Importante:**
- não é skill ativa
- o cálculo acontece no banco via trigger
- o TOM recebe o efeito da ordenação, não "executa Eisenhower" na conversa

---

## 2. Respostas canônicas
**Arquivo:** `docs/referencia-respostas-canonicas.md`

**Papel:** guia transversal de estilo, exemplos de resposta e mapa de emojis semânticos.

**Importante:**
- não é skill ativa
- ajuda a revisar consistência de tom, emoji, formatação e copy

---

# 3. Mapa de ativação

## Quando uma skill entra

| Situação / intenção | Skill ou mecanismo principal |
|---|---|
| primeiro contato / onboarding | `onboarding` |
| concluir / reagendar / criar tarefa | `checklist-tarefas` |
| **demanda nova surgindo** ("surgiu X", "preciso falar com Y", "tem que resolver Z") | `checklist-tarefas` (cria task — NÃO memória) |
| coordinator/director cria ou delega tarefa pra outro | `checklist-tarefas` (com `to_name`) |
| **pedido de pausa** ("agora não", "tô em aula", "me chama em 2h") | `pausa-temporaria` |
| **mensagem de áudio** | `tratamento-audio` (após transcrição via Whisper, exige confirmação) |
| **consolidação semanal de memória** (domingo 22:00) | dispatcher cron + extrator Claude |
| enviar comunicado interno segmentado (novo Sprint 13 F1) | `comunicados` |
| aprovar/rejeitar comunicado pendente — director (novo Sprint 13 F3) | `aprovacao-comunicados` |
| criar evento institucional (show, recital, etc.) (novo Sprint 13 F2) | `eventos-institucionais` |
| **demanda operacional** ("quebrou", "faltou", "preciso comprar", problema técnico) (novo Sprint 15 F2) | `operacoes-tecnicas` |
| briefing / fechamento / rotina diária | `rituais-diarios` |
| **planejamento semanal** (novo Sprint 12) | `planejamento-semanal` |
| **resumo do time (coordenador, 19:30 weekdays)** | `coordinator reports` (deterministic; sem AI) |
| **retrospectiva semanal (coordenador, domingo 18:00)** | `coordinator reports` (deterministic; sem AI) |
| criar ou marcar hábito | `habitos-pessoais` |
| checklist operacional | `checklists-operacionais` |
| pendência Emusys | `integracao-emusys` |
| criar projeto (5W2H) | `cadastro-projeto-5w2h` |
| aprovar/rejeitar projeto pendente | `aprovar-projeto` |
| demanda ambígua / prioridade implícita | `priorizacao-inteligente` |
| algo digno de memória | `gestao-memoria` |

## Quando não precisa de skill específica

Alguns casos podem ser resolvidos por:
- consulta direta ao banco
- protocolo já definido em `AGENTS.md`
- contexto conversacional simples

Exemplos: help, do not disturb, consulta simples de status

---

# 4. O que saiu da camada de skill ativa

Estes itens não devem mais ocupar o prompt como skill ativa principal:

- `priorizacao-eisenhower` → virou referência interna (`docs/`)
- `respostas-canonicas` → virou referência interna (`docs/`)
- `broadcast.md` → **arquivo removido** (atualizado Sprint 13 F1); substituído por `skills/comunicados.md` com segmentação de audience e fila de envio

---

# 5. Roadmap

## Direção futura
No futuro, o sistema pode ganhar um mecanismo de evolução mais autônoma:
- detectar fluxos repetidos
- propor skill nova
- medir uso e efetividade
- sugerir melhoria de skill existente

Esse mecanismo é visão de evolução do sistema — não capacidade madura atual.

## Itens que podem entrar no futuro
- geração de relatórios formais
- sync mais profundo com Google Calendar
- análise de tendências do time
- sugestões proativas de delegação
- onboarding automático de projeto

---

# 6. Síntese final

- **SOUL** define quem o TOM é
- **AGENTS** define como o TOM opera
- **MEMORY** define o que ele aprende e lembra
- **SKILLS** definem o que ele sabe executar
- **REFERÊNCIAS** sustentam consistência sem poluir o prompt ativo

Sem catálogo, o sistema cresce confuso.
Com catálogo, o TOM sabe o que carregar, o que consultar e o que apenas usar como referência.
