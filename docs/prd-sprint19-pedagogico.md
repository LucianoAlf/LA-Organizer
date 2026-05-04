# PRD — Sprint 19: Camada Pedagógica do LA Organizer

## Metadados
- **Produto:** LA Organizer
- **Sprint:** 19
- **Título:** Camada Pedagógica
- **Status:** Draft para validação
- **Dependência anterior:** Sprint 18 — Integridade de Agenda e Execução
- **Próxima prioridade mapeada:** Sprint 20 — Gerência

---

## 1. Problema

Depois da consolidação da camada operacional replicável por departamento e da coordenação conversacional via TOM, o próximo gargalo da LA Music está no domínio pedagógico.

Hoje, o Pedagógico funciona com forte dependência de WhatsApp, memória contextual, relação pessoal e hierarquia implícita. Isso gera risco de: cobranças fora de escopo, encaminhamentos errados, ruído entre School e Kids, perda de contexto em casos de aluno/professor/responsável, dependência excessiva da cabeça dos coordenadores, baixa rastreabilidade das pendências pedagógicas.

O problema central não é ausência de task manager. O problema central é:

> O Pedagógico precisa de uma camada de governança que respeite hierarquia, subdomínios e contexto humano.

---

## 2. Tese de produto

O Pedagógico não deve nascer como "mais um departamento operacional". Ele deve nascer como:

> **Camada de coordenação pedagógica em rede, com alçadas reais e roteamento contextual**

Essa camada precisa representar: coordenação pedagógica, assistentes pedagógicos, mentores pedagógicos, professores, School x Kids, especialidades transversais, demandas pedagógicas reais.

Não é só fila, não é só task, não é só chat. É coordenação pedagógica estruturada.

---

## 3. Objetivo da Sprint 19

Implementar o primeiro MVP do departamento Pedagógico dentro da camada operacional replicável do LA Organizer, reutilizando o motor já criado e adicionando: estrutura de pessoas e papéis, regras de alçada, tipos de demanda pedagógica, roteamento School x Kids, skill conversacional `pedagogico.md`, piloto controlado com coordenação + assistentes.

Sem criar tela nova obrigatória no MVP.

---

## 4. Escopo

### 4.1 Incluído
- novo departamento `pedagogico`
- request types do Pedagógico
- definição de papéis operacionais do MVP
- definição de hierarquia e alçadas
- skill `pedagogico.md`
- integração com `/mais/operacoes`
- piloto com coordenação e assistentes
- entrada de professores como origem/destinatário de demanda

### 4.2 Não incluído
- novo módulo visual exclusivo do Pedagógico
- sistema de avaliação pedagógica complexo
- dashboard pedagógico analítico avançado
- automação específica de eventos
- modelagem profunda de histórico pedagógico do aluno
- expansão total do papel dos professores como operadores plenos
- auditoria ou implementação de Eventos

---

## 5. Estrutura organizacional oficial do MVP

### 5.1 Camada superior
- **Alf**
- **Anne**

### 5.2 Coordenação pedagógica
Mesmo nível hierárquico:
- **Juliana** — Coordenadora da LA Music School
- **Quintela** — Coordenador da LA Music Kids

### 5.3 Assistentes pedagógicos
- **Leo** — Barra — 5521992053152
- **Ramon** — Recreio + Bandas — 5521999715997
- **Dai** — Campo Grande — 5521986409985
- **Matheus Felipe** — LA Music Kids — 5521978755351
- **Jordan** — eventos + bateria — 5521981450588
- **Rodrigo** — cordas — 5521997548859

### 5.4 Mentores pedagógicos
- **Peterson** — 5521989366076
- **Kinho** — 5521987375854
- **Renan** — 5521965736779

### 5.5 Professores
No MVP: podem abrir demandas, podem receber demandas, não delegam, não cobram como camada formal de governança.

---

## 6. Papéis operacionais do MVP

### 6.1 `pedagogical_lead`
Representa: Juliana, Quintela. Podem: criar demanda, delegar demanda, cobrar assistentes, cobrar mentores, cobrar professores, acompanhar execução, escalar casos, redirecionar entre School e Kids.

### 6.2 `pedagogical_assistant`
Representa: Leo, Ramon, Dai, Matheus Felipe, Jordan, Rodrigo. Podem: abrir demanda, registrar pendência, encaminhar para coordenação, cobrar professores, operar dentro do próprio escopo. Não têm poder irrestrito de coordenação horizontal ampla.

### 6.3 `pedagogical_mentor`
Representa: Peterson, Kinho, Renan. Podem: orientar, aconselhar, apoiar coordenação, apoiar professores, abrir demanda se necessário. Não podem delegar no MVP.

### 6.4 `teacher`
Pode: abrir demanda, receber demanda, acionar coordenação ou assistente. Não pode: delegar, cobrar como governança formal, atuar como operador pleno da malha de governança.

---

## 7. Subdomínios do Pedagógico

### 7.1 School
Responsável principal: Juliana. Escopo: adolescentes e adultos, operação pedagógica da LA Music School.

### 7.2 Kids
Responsável principal: Quintela. Escopo: bebês e crianças até 11 anos, operação pedagógica da LA Music Kids.

### 7.3 Especialidades transversais
Apoios/especialidades que atravessam os subdomínios: bandas, bateria, cordas, cultura, eventos pedagógicos, unidade. Não anulam School/Kids.

---

## 8. Tipos iniciais de demanda

### 8.1 `acompanhamento-professor`
Cobrança de relatório, retorno pendente, ajuste de condução, acompanhamento de performance.

### 8.2 `apoio-ao-aluno`
Falta recorrente, dificuldade pedagógica, ajuste de trilha, caso sensível.

### 8.3 `alinhamento-de-turma`
Troca de turma, mudança de professor, encaixe, redistribuição.

### 8.4 `alinhamento-com-responsavel`
Devolutiva pedagógica, orientação sobre trilha, alinhamento de situação do aluno.

### 8.5 `evento-pedagogico`
Banda/show pedagógico, preparação pedagógica para recital/show, demandas pedagógicas ligadas a eventos. Não substitui o motor geral de Eventos.

### 8.6 `pendencia-pedagogica`
Tipo coringa controlado para exceções.

### 8.7 `suporte-ao-professor` (opcional)
Material, reparo, necessidade de apoio aberta por professor. Pode ser ativado já no MVP ou absorvido depois em integração com o fluxo operacional já existente.

---

## 9. Regras de alçada

### 9.1 Coordenação
Juliana e Quintela podem: delegar para assistentes, delegar para professores, cobrar assistentes, cobrar mentores, cobrar professores, receber demandas de professores.

### 9.2 Assistentes
Podem: cobrar professores, abrir demandas, escalar casos para coordenação, operar no próprio domínio. Não têm poder irrestrito de coordenação horizontal ampla.

### 9.3 Mentores
Podem: orientar, apoiar, aconselhar, abrir demanda quando necessário. Não podem: delegar, funcionar como chefia operacional do fluxo.

### 9.4 Professores
Podem: abrir demanda para coordenação, abrir demanda para assistentes, receber demanda. Não podem: delegar, cobrar como governança formal.

---

## 10. Roteamento conversacional esperado

### 10.1 Origem das demandas
Demandas podem partir de: coordenação, assistentes, mentores, professores, Alf / Anne.

### 10.2 Roteamento padrão
- School → prioriza Juliana
- Kids → prioriza Quintela
- casos de unidade/especialidade → priorizam assistente adequado
- casos de orientação/cultura → podem envolver mentor
- professores → falam com assistente ou coordenação

### 10.3 Regra de prioridade
Quando houver ambiguidade: 1) respeitar School x Kids, 2) respeitar escopo da pessoa, 3) respeitar autoridade formal, 4) evitar mandar para mentor algo que é cobrança formal.

---

## 11. UX / PWA

O Pedagógico entra no MVP via a mesma camada `/mais/operacoes`. Não criar nova tela agora. Reaproveitar: abas por departamento, fila operacional existente, detalhe operacional, filtros existentes.

---

## 12. Skill `pedagogico.md`

Ensinar o TOM a: compreender School x Kids, respeitar alçada, distinguir coordenação/assistente/mentor/professor, encaminhar corretamente, evitar cobrança por quem não tem autoridade, diferenciar evento pedagógico de Eventos como motor geral.

Exemplos de comandos esperados:
- "cobra o professor X sobre o relatório de aula"
- "alinha com a Juliana o planejamento do recital"
- "fala com o assistente pedagógico da Barra"
- "abre pendência pedagógica do aluno Y"
- "isso é Kids, leva pro Quintela"
- "isso é School, manda pra Juliana"

---

## 13. Hipótese de modelagem técnica

Reaproveitar: `departments`, `department_request_types`, `tasks`, skill layer, `/mais/operacoes`. Seed esperado: department `pedagogico`, request types pedagógicos, responsáveis associados. Não criar nova entidade principal no banco para Pedagógico no MVP.

---

## 14. Piloto inicial

Participantes: Juliana, Quintela, assistentes pedagógicos. Mentores como apoio/orientação, professores como origem/destinatário.

Objetivos: validar hierarquia real, cobertura dos tipos de demanda, eficiência do roteamento, clareza entre School e Kids, adequação do papel de professores e mentores.

---

## 15. Critérios de sucesso

1. O Pedagógico puder operar dentro do motor atual sem módulo paralelo
2. School e Kids claramente diferenciados
3. Juliana e Quintela como leads formais
4. Assistentes operando dentro de seu escopo
5. Mentores sem gerar confusão de autoridade
6. Professores abrindo demandas sem virar camada de governança
7. TOM roteando corretamente a maioria dos casos do piloto

---

## 16. Riscos

- Confusão entre School e Kids → mitigação: explicitar no seed e na skill
- Mentores parecerem chefes operacionais → mitigação: regra explícita
- Professores ganharem poder demais → mitigação: manter papel limitado
- Escopo inflar cedo demais → mitigação: MVP enxuto
- Evento pedagógico colidir com motor de Eventos → mitigação: tratar apenas como demanda pedagógica

---

## 17. Dependências e roadmap

Dependência anterior: Sprint 18 concluída e estável.
Próximas prioridades: Sprint 19 Pedagógico → Sprint 20 Gerência → Auditoria de Eventos → Sprint específica de Eventos.

---

## 18. Resumo executivo

A Sprint 19 do Pedagógico é a primeira expansão da camada operacional para um domínio em que hierarquia pesa muito, contexto humano pesa muito e subdomínios internos são decisivos.

O foco não é interface nova. O foco é:

> **Papel certo, pessoa certa, autoridade certa e roteamento certo.**
