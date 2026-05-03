# LA Organizer — Camada Operacional Replicável por Departamento

> Documento de arquitetura de produto.
> Objetivo: consolidar a próxima evolução estrutural do LA Organizer a partir do estado real do PRD, banco, telas e roadmap.
> 
> Este documento não substitui o PRD geral do produto. Ele define uma camada arquitetural nova que nasce a partir do que já foi construído nas Sprints 11–14 e organiza a expansão futura sem gambiarra.

---

## 1. Tese central

O LA Organizer já deixou de ser apenas um sistema de tarefas pessoais + projetos + checklists.

Com a evolução das Sprints 11, 13 e 14, ele passou a incorporar elementos de:
- coordenação operacional
- comunicação interna
- responsabilidades por setor
- templates operacionais
- observabilidade
- dispatch automatizado

O próximo passo natural do produto não é criar módulos isolados por área.

O próximo passo natural é consolidar isso em uma:

# **Camada Operacional Replicável por Departamento**

Essa camada transforma o LA Organizer em uma plataforma de governança operacional configurável para qualquer área da escola.

---

## 2. Problema que essa camada resolve

Hoje, o produto já resolve partes da operação em blocos separados:
- checklists operacionais
- comunicados
- eventos institucionais
- tasks por setor
- mapa de equipe por unidade
- observabilidade de aprovação/envio

Mas ainda não existe uma abstração explícita que diga:
- qual é o departamento
- quais tipos de demanda ele recebe
- como essa demanda é classificada
- como vira fila
- como é acompanhada
- quem vê o quê
- qual é o ritual daquele departamento
- quais são os templates e alertas próprios daquela operação

### Risco se isso não for consolidado
Se o produto continuar crescendo por casos específicos, há risco de:
- duplicação de lógica
- módulos locais demais
- acoplamento excessivo a um setor específico
- telas fortes, mas sem espinha unificadora
- dificuldade de replicar o modelo para outras áreas

---

## 3. Formulação correta do problema

O caso do Rafinha mostrou algo importante:

O produto não precisa de um **“módulo do Rafinha”**.

Ele precisa de um:

# **framework de operação departamental**

em que o Rafinha é apenas o **primeiro caso-modelo**.

Isso significa que a arquitetura precisa suportar, no futuro:
- Operações Técnicas
- Marketing
- Financeiro
- RH
- Pedagógico
- Gerência
- Produção de Eventos
- outros domínios de trabalho

sem reinventar banco, telas e fluxo toda vez.

---

## 4. Princípio do design arquitetural

### O que NÃO fazer
- não criar módulo hardcoded para uma pessoa
- não criar tabela específica “RafinhaModule”
- não resolver tudo só com `tasks` e `checklists` sem abstração conceitual
- não duplicar lógica já existente em eventos, comunicados, templates e dispatch

### O que fazer
- nomear explicitamente a camada operacional por departamento
- reaproveitar o máximo da base já construída
- criar pouca modelagem nova, mas com alto poder de generalização
- usar o caso do Rafinha como piloto, não como exceção

---

## 5. O que já existe e deve ser reaproveitado

A nova camada não nasce do zero.
Ela já tem base forte no produto atual.

### Banco / entidades já existentes
- `tasks`
- `projects`
- `project_checkpoints`
- `events`
- `notifications`
- `announcements`
- `announcement_jobs`
- `op_checklists`
- `op_checklist_items`
- `op_checklist_completions`
- `op_checklist_item_completions`
- `event_team_map`
- `ritual_logs`
- `daily_plans`
- `weekly_plans`

### Interfaces já existentes
- Hoje
- Semana
- Projetos
- Checklists
- Templates de Checklists
- Comunicados
- Agenda Escolar
- Observabilidade
- Evento Detalhe
- Configurar Equipe

### Capacidades já existentes
- dispatch
- reminders
- WhatsApp via TOM
- aprovação em 2 estágios
- segregação por role
- visão por unidade/setor
- kit automático de tasks
- realtime + polling fallback

---

## 6. Nome da nova camada

### Nome recomendado
# **Camada Operacional Replicável por Departamento**

### Definição
Camada do LA Organizer que permite modelar e executar fluxos operacionais de qualquer departamento através de:
- templates
- tipos de demanda
- filas
- responsáveis
- aprovações
- checklists
- rituais
- observabilidade

---

## 7. Estrutura conceitual da camada

A camada deve suportar alguns elementos universais.

## 7.1 Departamento
Exemplos:
- Operações Técnicas
- Marketing
- Financeiro
- RH
- Pedagógico
- Gerência
- Produção de Eventos

O departamento é a unidade conceitual mais alta da operação.

---

## 7.2 Tipo de demanda
Cada departamento precisa poder definir seus tipos de demanda.

### Exemplos
#### Operações Técnicas
- incidente
- reposição
- preventivo
- compra
- fornecedor
- apoio técnico

#### Marketing
- captação de conteúdo
- edição
- aprovação
- publicação
- cobertura de evento

#### Financeiro
- cobrança
- conciliação
- pagamento
- aprovação
- pendência documental

#### RH
- onboarding
- documento pendente
- acompanhamento
- admissão
- desligamento

---

## 7.3 Fila operacional
Toda demanda precisa poder cair numa fila com:
- status
- prioridade
- criticidade
- responsável
- unidade/setor
- prazo
- próxima ação

### Status base sugeridos
- novo
- triado
- em execução
- aguardando aprovação
- aguardando terceiro
- resolvido
- validado

Esses status devem ser configuráveis por departamento, mas partir de um núcleo comum.

---

## 7.4 Template operacional
Cada área pode ter templates reutilizáveis de:
- checklist
- fluxo de execução
- tarefa derivada
- ritual periódico
- alerta

---

## 7.5 Mapa de responsabilidade
Inspirado em `event_team_map`, a camada deve suportar mapeamento do tipo:
- departamento × unidade × função/setor → responsável

Isso permite:
- roteamento
- fallback
- distribuição automática
- visão por unidade

---

## 7.6 Ritual do departamento
Cada área pode ter um ritual recorrente próprio.

### Exemplo Operações Técnicas
- ritual semanal do Rafinha
- revisão de riscos
- itens críticos
- compras
- pendências por unidade

### Exemplo Marketing
- ritual de pauta/produção
- pendências de conteúdo
- bloqueios de aprovação

---

## 7.7 Observabilidade operacional
Cada departamento precisa ter leitura mínima de:
- pendências abertas
- pendências críticas
- itens parados
- volume por unidade
- gargalos recorrentes
- backlog antigo

---

## 8. O papel do caso Rafinha

O caso do Rafinha é o piloto ideal dessa camada porque concentra quase todas as dores que o sistema quer resolver:
- entrada de demanda ruim
- fila mental
- urgência fabricada
- checklist sem consequência forte
- manutenção reativa
- comunicação fraca
- necessidade de aprovação
- necessidade de visão executiva sem microgestão

### Conclusão
O Rafinha deve ser tratado como:
# **primeira implementação real da camada replicável**

e não como um módulo isolado e fechado.

---

## 9. Como essa camada conversa com o que já existe

### Não substitui
- tasks
- events
- checklists
- announcements
- observabilidade

### Ela orquestra
Essa camada é uma arquitetura por cima da fundação já pronta.

### Relação com estruturas atuais
- `tasks` continuam sendo a unidade de execução
- `op_checklists*` continuam sendo a base de checklist
- `events` continuam servindo para rituais e agendamentos
- `notifications` continuam servindo como saída operacional
- `event_team_map` inspira o mapa de responsáveis
- `announcements` seguem na comunicação institucional

---

## 10. O que falta explicitamente no modelo atual

O produto atual já suporta boa parte dessa evolução, mas ainda faltam peças explícitas.

## 10.1 Entidade de departamento
Hoje isso está implícito em funções, categorias e setores.

### Recomendação
Criar uma abstração explícita como:
- `departments`

Campos possíveis:
- id
- slug
- name
- is_active
- default_visibility
- unit_scope_enabled
- created_at
- updated_at

---

## 10.2 Tipos de demanda por departamento
Hoje isso está espalhado em `category`, `action_type`, `event_sector`, `checklist_type`.

### Recomendação
Criar algo como:
- `department_request_types`

Campos possíveis:
- id
- department_id
- slug
- label
- description
- default_priority
- requires_approval
- generates_task
- generates_checklist
- is_active

---

## 10.3 Camada de “request / case” operacional
Para o MVP, ainda é possível começar só com `tasks`.

Mas a tendência de médio prazo é nascer algo como:
- `operational_requests`

### Quando isso vira necessário
Quando a operação exigir distinguir claramente:
- demanda recebida
- triagem
- execução
- compra
- aguardando terceiro
- validação final

sem transformar tudo em task desde o primeiro segundo.

### Recomendação
**Não criar isso já no MVP**, a menos que o desenho do Sprint 15 mostre dor real imediata.

---

## 11. Onde essa camada aparece no PWA

A camada não precisa começar com 20 telas novas.
Ela pode nascer como um **hub operacional** que orquestra telas já existentes.

### Conceito de interface sugerido
Dentro de “Mais”, ou em um novo eixo da navegação conforme maturidade, existir algo como:

# **Operações**

Dentro disso, o usuário escolhe o departamento:
- Operações Técnicas
- Marketing
- Financeiro
- RH
- Pedagógico
- etc.

E cada departamento enxerga:
- sua fila
- seus checklists
- seus rituais
- suas pendências
- seus responsáveis
- sua visão por unidade

---

## 12. O que essa camada precisa ser capaz de fazer

### Universalmente
1. receber demanda
2. classificar demanda
3. colocar em fila
4. atribuir responsável
5. disparar lembrete
6. acionar aprovação quando necessário
7. registrar fechamento
8. notificar partes envolvidas
9. dar visibilidade executiva

---

## 13. Escalonamento por fases

## Fase A — explicitar a arquitetura
- nomear a camada
- modelar departamentos
- modelar tipos de demanda
- decidir o que continua em `tasks`
- decidir o que fica para fase 2

## Fase B — piloto Operações Técnicas
- usar o Rafinha como caso-modelo
- construir fila operacional mínima
- ligar checklist com consequência
- ritual semanal
- visão por unidade

## Fase C — replicação
- adaptar o template para Marketing
- depois Financeiro / Pedagógico / RH / Eventos

---

## 14. O que essa camada NÃO deve fazer

- não virar ERP gigante
- não virar módulo isolado por pessoa
- não virar duplicata de projetos/eventos/checklists
- não exigir remodelagem completa do banco atual
- não quebrar o princípio do PWA como espelho

---

## 15. Relação com CEO Quest e governança

O CEO Quest mostrou algo valioso:
- progresso visual
- rituais
- cobrança
- status objetivos
- fechamento de ciclo
- visibilidade sem microgestão

Parte desses princípios pode inspirar essa camada operacional, mas sem copiar mecanicamente o jogo pessoal do CEO para o time.

### Princípios transferíveis
- fila viva
- fechamento claro
- status legíveis
- rituais recorrentes
- visibilidade sem excesso de detalhe
- acompanhamento proativo

---

## 16. Decisão estratégica

O LA Organizer está pronto para deixar de ser apenas um “sistema operacional de vida e trabalho” e assumir conscientemente uma nova camada:

# **Governança Operacional Replicável por Departamento**

Essa camada:
- é coerente com o produto
- reaproveita o que já foi construído
- evita módulo local/gambiarra
- prepara o futuro SaaS para outras escolas

### Decisão prática
O caso do Rafinha não deve ser tratado como destino final.
Ele deve ser tratado como:

# **piloto da camada operacional replicável**

---

## 17. Próximo passo recomendado

O próximo passo não é sair construindo um “módulo do Rafinha” direto.

O próximo passo é:

1. validar esta camada como decisão arquitetural
2. definir o escopo do MVP dessa camada
3. derivar uma sprint específica a partir dela
4. usar Operações Técnicas como caso-modelo inicial

---

## 18. Resumo executivo

### O que já está claro
- o produto já suporta essa direção
- o banco e as telas não precisam ser descartados
- a operação por setor já começou a emergir nas Sprints 11–14

### O que falta
- explicitar a camada
- modelar departamentos e tipos de demanda
- estruturar o piloto sem acoplamento local

### Recomendação final
Seguir com:
# **Sprint piloto da Camada Operacional Replicável**
com
# **Operações Técnicas / Rafinha**
como primeiro caso real de implementação.
