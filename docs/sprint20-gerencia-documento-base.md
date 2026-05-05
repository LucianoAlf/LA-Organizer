# Sprint 20 — Gerência

## Documento-base

### 1. Contexto e tese

Depois da camada operacional replicável, coordenação conversacional, integridade de agenda e expansão para o Pedagógico, a próxima frente prioritária do LA Organizer é a **Gerência**.

A Gerência não é Comercial, não é Pedagógico e não é apenas Atendimento. Ela deve ser entendida como:

> **Camada de gestão relacional e operação humana da unidade**

Seu papel é coordenar o que acontece na interface entre pais/alunos, experiência da unidade, retenção, recuperação, atendimento, recepção, relacionamento, secretaria e articulação entre áreas.

A tese central é:

> O gerente é o **filtro inteligente da unidade** — recebe demandas, avalia, e roteia para o departamento certo. Ele não resolve tudo sozinho; ele articula.

---

### 2. Estrutura hierárquica oficial do MVP Gerência

#### Camada superior
- **Alf**
- **Anne**

Todos os gerentes respondem a Alf e Anne.

#### Gerentes por unidade
- **Jereh** — Gerente de Campo Grande — 5521985525984
- **Clayton** — Gerente interino do Recreio (cobrindo licença maternidade da Fabi) — 5521990450802
- **Krissya** — Gerente da Barra — 5521966875271

Os gerentes ocupam a camada de gestão da unidade.

#### Diferenciação de managers no sistema
- Gerentes de unidade: `role='manager'` + `unit` específica (Campo Grande, Recreio, Barra)
- Yuri (líder Marketing): `role='manager'` + `unit='all'`

A diferenciação é feita pela coluna `unit`: se o manager tem unit específica, é gerente de unidade. Se tem `unit='all'`, é líder de departamento (ex: Yuri/Marketing). Sem migration nova — a coluna `unit` já existe em `collaborators`.

---

### 3. Natureza da Gerência — Filtro e Roteador

A Gerência é uma camada de comando relacional-operacional da unidade. O gerente atua como **primeiro filtro inteligente**: recebe demandas de qualquer origem, avalia a natureza, e encaminha para o departamento/pessoa correta.

O gerente pode:
- tratar diretamente casos de retenção, experiência e atendimento
- encaminhar para o Pedagógico quando o caso é pedagógico
- acionar comercial, financeiro, marketing quando necessário
- articular múltiplas áreas simultaneamente
- falar diretamente com pais/alunos

O gerente **não resolve demandas pedagógicas sozinho**. Ele é o filtro que avalia e roteia:

Exemplo: "pai reclamando que o filho não está aprendendo"
1. Chega no gerente da unidade (ex: Krissya na Barra)
2. Krissya avalia: é questão pedagógica
3. Krissya encaminha: pro Leo (assistente pedagógico da Barra) OU direto pra Juliana (coordenação School) ou Quintela (coordenação Kids)

O TOM deve apoiar esse roteamento inteligente: sugerir opções de encaminhamento quando detectar que a demanda é pedagógica.

---

### 4. Alçadas formais do gerente

O gerente pode:
- cobrar atendimento, recepção, secretaria, pré-atendimento
- cobrar professores (questões operacionais, não pedagógicas)
- cobrar comercial
- cobrar coordenadores locais
- solicitar suporte à coordenação pedagógica (via relay/encaminhamento, não followup)
- falar diretamente com pais/alunos
- acionar financeiro e marketing

#### Regra de fronteira com o Pedagógico
- **Caso claramente pedagógico**: gerente encaminha para o Pedagógico (relay)
- **Caso claramente gerencial/relacional**: gerente trata diretamente
- **Caso híbrido**: gerente coordena e o Pedagógico apoia
- O gerente **não faz followup/cobrança formal** em pessoas com `pedagogical_role` — ele encaminha via relay

#### Implicação no gate pedagógico (Sprint 19)
O gate pedagógico (DENY = final) **não precisa de ajuste**. O gerente (`role='manager'`) não está na lista de `canDelegatePedagogical`, e isso está correto. Quando o gerente precisa acionar o pedagógico, ele usa `relay_assisted`, não `followup`.

---

### 5. Quem está no campo de articulação do gerente

As frentes abaixo/ao redor da Gerência no fluxo:
- recepção
- professores (questões operacionais)
- atendimento
- relacionamento
- pré-atendimento
- secretaria
- coordenadores locais

E por encaminhamento (relay):
- coordenação pedagógica
- comercial
- financeiro
- marketing

---

### 6. Tipos iniciais de demanda da Gerência

#### 6.1 `risco-de-evasao`
Aluno sinalizando saída, comportamento de afastamento, risco de cancelamento, alerta de perda de vínculo.

#### 6.2 `recuperacao-de-aluno`
Reativação, reconquista, tentativa de recuperação de vínculo, reaproximação estruturada.

#### 6.3 `alinhamento-com-responsavel`
Contato com pai/mãe/responsável no contexto de retenção/experiência (não pedagógico). Mediação de expectativa, devolutiva relacional, ajuste de percepção sobre a experiência.

**Nota:** este slug também existe no Pedagógico. A diferença é de natureza: no Pedagógico é devolutiva sobre aprendizado/trilha; na Gerência é sobre experiência/retenção/insatisfação. A skill diferencia pelo contexto.

#### 6.4 `problema-de-atendimento`
Falha no atendimento, ruído de recepção, problema de retorno, reclamação operacional.

#### 6.5 `experiencia-da-unidade`
Conflito de experiência, percepção ruim do ambiente/serviço, fricções na vivência presencial.

#### 6.6 `negociacao-relacional`
Negociação sensível de permanência, construção de alternativa de retenção, tratativa relacional que não é só comercial.

#### 6.7 `pendencia-gerencial`
Tipo coringa controlado para exceções.

#### 6.8 `articulacao-interna`
Quando a gerência precisa mobilizar mais de uma área. Alinhamento entre recepção, secretaria, coordenação, atendimento, comercial etc.

---

### 7. Regras de roteamento do MVP

#### 7.1 Origem das demandas
Demandas podem nascer de: gerentes, Alf/Anne, atendimento, recepção, relacionamento, secretaria, coordenadores locais, professores, pais/responsáveis/alunos (indiretamente).

#### 7.2 Fluxo principal com roteamento inteligente
- Demanda chega no gerente → gerente avalia natureza
- Se pedagógico → gerente encaminha (relay) para assistente da unidade ou coordenação
- Se retenção/experiência → gerente trata diretamente
- Se comercial puro → gerente encaminha para comercial
- Se híbrido → gerente articula e pedagógico apoia

#### 7.3 O TOM deve apoiar o roteamento
Quando o gerente recebe algo pedagógico, o TOM deve sugerir:
- "Isso parece pedagógico. Encaminho pro [assistente da unidade] ou direto pra [Juliana/Quintela]?"
- Usar `pedagogical_assignments` para resolver o assistente correto da unidade

---

### 8. Diferença entre Gerência e Pedagógico

#### Pedagógico
- qualidade pedagógica
- professores no eixo pedagógico
- jornada de aprendizado
- School x Kids
- coordenação + assistentes + mentores

#### Gerência
- saúde relacional da unidade
- retenção e recuperação
- experiência do aluno/família
- atendimento e recepção
- conflitos humanos da jornada
- articulação entre áreas
- filtro e roteador inteligente

---

### 9. Hipótese de modelagem

Reaproveitar a base replicável da Sprint 15. Sem módulo novo, sem tela nova.

#### Seed esperado
- department: `gerencia`
- 8 request types
- 3 gerentes como `role='manager'` com `unit` específica

#### Decisão importante
Não criar nova entidade principal no banco. Usar `unit` para diferenciar gerentes de unidade vs líderes de departamento.

---

### 10. Piloto inicial

Participantes: Jereh, Clayton, Krissya.

Meta: validar se a taxonomia cobre os principais casos, se a fronteira com Pedagógico ficou clara, se o roteamento inteligente funciona, se os fluxos de retenção/experiência são acionáveis.

---

### 11. Resumo executivo

O gerente é o filtro inteligente da unidade. Ele não resolve tudo — ele articula, avalia e roteia.

> O núcleo do MVP da Gerência é **articulação relacional + filtro inteligente + roteamento para o departamento certo**.
