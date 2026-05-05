# PRD — Sprint 20: Camada de Gerência do LA Organizer

## Metadados
- **Produto:** LA Organizer
- **Sprint:** 20
- **Título:** Camada de Gerência
- **Status:** Draft ajustado — decisões arquiteturais travadas
- **Dependência anterior:** Sprint 19 — Pedagógico
- **Próxima etapa obrigatória:** Auditoria de Eventos

---

## 1. Problema

A LA Music possui frentes pedagógicas, comerciais e operacionais, mas existe um domínio transversal da unidade que não cabe em nenhuma dessas camadas: a Gerência.

Muitos casos de retenção, experiência, articulação entre setores e relacionamento com pais/alunos dependem de comunicação dispersa, improviso ou memória contextual dos líderes.

O problema central é:

> Falta uma camada explícita de governança relacional da unidade, com o gerente atuando como filtro inteligente que avalia e roteia demandas para o departamento certo.

---

## 2. Tese de produto

A Gerência deve ser modelada como:

> **Camada de articulação relacional e filtro inteligente da unidade**

O gerente não resolve tudo sozinho. Ele recebe demandas, avalia a natureza, e encaminha para o departamento/pessoa correta. Quando o caso é de retenção, experiência ou atendimento, ele trata diretamente. Quando é pedagógico, ele encaminha.

---

## 3. Objetivo da Sprint 20

Implementar o departamento Gerência dentro da camada operacional replicável, reutilizando o motor atual e adicionando: gerentes por unidade, autoridade transversal com roteamento inteligente, taxonomia de demandas gerenciais, skill `gerencia.md`, piloto controlado.

Sem módulo visual separado no MVP.

---

## 4. Escopo

### 4.1 Incluído
- novo departamento `gerencia`
- 8 request types da Gerência
- 3 gerentes com `role='manager'` e `unit` específica
- skill `gerencia.md` com roteamento inteligente
- integração via `/mais/operacoes`
- piloto com Jereh, Clayton, Krissya

### 4.2 Não incluído
- dashboard exclusivo da Gerência
- analytics de retenção
- CRM completo
- automação de Eventos
- modelagem de jornada do aluno
- mudanças no gate pedagógico (Sprint 19)

---

## 5. Estrutura organizacional do MVP

### 5.1 Camada superior
- **Alf** (director)
- **Anne** (coordinator)

### 5.2 Gerentes por unidade
- **Jereh** — Campo Grande — 5521985525984
- **Clayton** — Recreio (interino) — 5521990450802
- **Krissya** — Barra — 5521966875271

### 5.3 Diferenciação no banco
- Gerentes: `role='manager'`, `unit='Campo Grande'`/`'Recreio'`/`'Barra'`
- Yuri (Marketing): `role='manager'`, `unit='all'`
- Sem migration nova — `unit` já existe em `collaborators`

---

## 6. Gerente como filtro inteligente

### 6.1 Princípio
O gerente é o primeiro filtro da unidade. Quando uma demanda chega, ele avalia e decide:
- Tratar diretamente (retenção, experiência, atendimento)
- Encaminhar para o Pedagógico (relay, não followup)
- Acionar comercial, financeiro, marketing
- Articular múltiplas áreas

### 6.2 Exemplo concreto
"Pai reclamando que o filho não está aprendendo"
1. Chega no gerente (ex: Krissya, Barra)
2. Krissya avalia: questão pedagógica
3. TOM sugere: "Encaminho pro Leo (assistente da Barra) ou direto pra Juliana (School)?"
4. Krissya decide e TOM encaminha via relay

### 6.3 Regra de fronteira com Pedagógico
- Caso pedagógico → gerente encaminha (relay_assisted)
- Caso relacional/retenção → gerente trata
- Caso híbrido → gerente coordena, pedagógico apoia
- **Gate pedagógico (Sprint 19) não muda** — gerente não está em `canDelegatePedagogical`, e isso está correto

---

## 7. Alçadas do gerente

O gerente pode:
- cobrar atendimento, recepção, secretaria, pré-atendimento
- cobrar professores (questões operacionais)
- cobrar comercial e coordenadores locais
- falar diretamente com pais/alunos
- acionar financeiro e marketing
- **encaminhar** (não cobrar) para coordenação pedagógica

---

## 8. Tipos iniciais de demanda

### 8.1 `risco-de-evasao`
Aluno em risco de saída, sinais de afastamento, risco de cancelamento.

### 8.2 `recuperacao-de-aluno`
Reativação, reconquista, recuperação de vínculo.

### 8.3 `alinhamento-com-responsavel`
Contato com pai/mãe no contexto de retenção/experiência (diferente do pedagógico que é devolutiva sobre aprendizado). Skill diferencia pelo contexto.

### 8.4 `problema-de-atendimento`
Falha no atendimento, ruído de recepção, reclamação operacional.

### 8.5 `experiencia-da-unidade`
Conflito de experiência, percepção ruim do ambiente/serviço.

### 8.6 `negociacao-relacional`
Negociação sensível de permanência, alternativa de retenção.

### 8.7 `pendencia-gerencial`
Tipo coringa controlado para exceções.

### 8.8 `articulacao-interna`
Mobilizar múltiplas áreas, problema transversal da unidade.

---

## 9. Roteamento conversacional

### 9.1 Fluxo com roteamento inteligente
- Demanda chega no gerente → avalia natureza
- Pedagógico → gerente encaminha (relay) para assistente da unidade ou coordenação
- Retenção/experiência → gerente trata diretamente
- Comercial puro → gerente encaminha para comercial
- Híbrido → gerente articula e pedagógico apoia

### 9.2 TOM apoia o roteamento
Quando o gerente recebe algo pedagógico, TOM sugere:
- "Isso parece pedagógico. Encaminho pro [assistente da unidade] ou direto pra [coordenação]?"

---

## 10. Skill `gerencia.md`

Ensinar o TOM a:
- entender gerente como filtro inteligente da unidade
- distinguir demanda gerencial de demanda pedagógica
- sugerir roteamento quando demanda é pedagógica
- distinguir retenção de comercial puro
- rotear para o gerente certo pela unidade
- usar `pedagogical_assignments` para resolver assistente da unidade

Exemplos:
- "esse aluno está em risco de evasão"
- "fala com a Krissya sobre esse pai insatisfeito"
- "isso parece pedagógico, encaminha pro Leo"
- "aciona a gerência da unidade"
- "preciso articular recepção, secretaria e coordenação nesse caso"

---

## 11. Hipótese técnica

### Reaproveitar
- `departments` + `department_request_types` + `tasks`
- Skill layer + `/mais/operacoes`
- `pedagogical_assignments` (para resolver assistente da unidade no roteamento)

### Seed
- department: `gerencia`
- 8 request types
- 3 gerentes: INSERT em `collaborators` com `role='manager'` + `unit` específica

### Sem schema novo
Zero migrations. Sem nova entidade. Diferenciação de managers via `unit`.

---

## 12. Critérios de sucesso

1. Gerência operar no motor atual sem módulo paralelo
2. Sistema distinguir Gerência de Pedagógico com clareza
3. Gerentes atuarem como filtros/roteadores inteligentes
4. Roteamento pedagógico funcionar via relay (não followup)
5. Casos de retenção/experiência roteados corretamente
6. Skill reduzir ambiguidade de comando

---

## 13. Critérios de fracasso

- Gerente tentar followup em pedagógicos e ser bloqueado sem orientação
- Confusão entre `alinhamento-com-responsavel` pedagógico vs gerencial
- Gerência virar "categoria genérica de tudo"
- Gate pedagógico quebrar por causa da Gerência

---

## 14. Riscos

- Confusão com Comercial → skill explicita fronteira
- Confusão com Pedagógico → gerente encaminha, não resolve
- Escopo virar CRM → MVP enxuto, baseado em demanda
- `pendencia-gerencial` virar buraco negro → tipo coringa controlado

---

## 15. Resumo executivo

O gerente é o filtro inteligente da unidade. Ele não resolve tudo — ele articula, avalia e roteia.

> O foco é: **filtro inteligente + articulação relacional + roteamento para o departamento certo**.
