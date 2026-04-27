# TOM-SKILLS-CATALOG — Catálogo Consolidado de Skills

**Documento:** TOM-SKILLS-CATALOG
**Versão:** 3.0
**Data:** 27 de abril de 2026
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

## 3. Broadcast
**Arquivo:** `skills/broadcast.md`

**Função:** enviar comunicação em massa com confirmação prévia, follow-up opcional e relatório final.

**Ativa quando:**
- coordenador, gerente ou diretor pede envio coletivo

**Entrega principal:**
- resolve grupo-alvo
- confirma com remetente
- dispara broadcast
- acompanha resposta quando aplicável

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
| enviar mensagem coletiva | `broadcast` |
| briefing / fechamento / rotina diária | `rituais-diarios` |
| criar ou marcar hábito | `habitos-pessoais` |
| checklist operacional | `checklists-operacionais` |
| pendência Emusys | `integracao-emusys` |
| mensagem de voz | `tratamento-audio` |
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
