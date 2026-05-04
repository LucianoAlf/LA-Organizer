# Sprint 19 — Pedagógico

## Documento-base

### 1. Contexto e tese

O Pedagógico é a próxima camada prioritária do LA Organizer depois da Sprint 18.

Ele não deve nascer como apenas mais um departamento operacional. Ele deve nascer como uma **camada de coordenação pedagógica em rede**, porque seu funcionamento envolve:

- coordenação pedagógica
- assistentes pedagógicos
- mentores pedagógicos
- professores
- acompanhamento de alunos
- alinhamento com responsáveis
- planejamento pedagógico
- demandas ligadas a bandas, eventos pedagógicos e cursos específicos

A tese central é:

> O Pedagógico é o primeiro departamento em que hierarquia, alçada e roteamento humano importam quase tanto quanto a task em si.

Por isso, a Sprint 19 deve focar menos em UI nova e mais em: pessoas, papéis, poder de ação, fluxo entre camadas, taxonomia de demandas e skill conversacional correta.

---

### 2. Estrutura hierárquica oficial do MVP Pedagógico

#### Camada superior
- **Alf**
- **Anne**

#### Coordenação pedagógica — mesmo nível
- **Juliana** — Coordenadora da LA Music School (adolescentes e adultos)
- **Quintela** — Coordenador da LA Music Kids (bebês e crianças até 11 anos)

#### Camada abaixo da coordenação
- **Assistentes pedagógicos**
- **Mentores pedagógicos**

#### Professores
No MVP, professores podem abrir demandas, podem abrir demandas para assistentes pedagógicos e coordenação, continuam como destinatários/alvo de demandas, mas não têm poder de cobrança/delegação no MVP.

---

### 3. Comissão pedagógica — pessoas mapeadas

#### Coordenação Pedagógica
- **Juliana** — 5521981708609
- **Quintela** — 5521971751320

#### Assistentes Pedagógicos
- **Leo** — Assistente Pedagógico Barra — 5521992053152
- **Ramon** — Assistente Pedagógico Recreio + responsável pelo projeto de Bandas — 5521999715997
- **Dai** — Assistente Pedagógica Campo Grande — 5521986409985
- **Matheus Felipe** — Assistente Pedagógico LA Music Kids — 5521978755351
- **Jordan** — Assistente Pedagógico em eventos + suporte curso de bateria — 5521981450588
- **Rodrigo** — Assistente Pedagógico + suporte curso de cordas — 5521997548859

#### Mentores Pedagógicos / Guardiões da Cultura
- **Peterson** — 5521989366076
- **Kinho** — 5521987375854
- **Renan** — 5521965736779

---

### 4. Papéis e alçadas

#### 4.1 Coordenação pedagógica
Juliana e Quintela podem: criar demandas, delegar demandas, cobrar assistentes pedagógicos, cobrar mentores pedagógicos, cobrar professores, acompanhar execução, escalar casos pedagógicos sensíveis, receber demandas de professores, encaminhar demandas entre subdomínios School e Kids.

#### 4.2 Assistentes pedagógicos
Assistentes pedagógicos podem: abrir demandas, registrar pendências, encaminhar questões para coordenação, cobrar professores, acompanhar execução dentro do seu escopo, operar em seus domínios de unidade/especialidade. Assistentes não são camada superior da coordenação e não têm liberdade irrestrita para cobrança horizontal fora do escopo.

#### 4.3 Mentores pedagógicos
Mentores pedagógicos podem: orientar, aconselhar, atuar por demanda, apoiar coordenação, apoiar professores, abrir demandas quando necessário. Mentores não podem delegar no MVP. Mentores não são camada formal de cobrança operacional ampla.

#### 4.4 Professores
Professores podem: abrir demandas para assistentes pedagógicos, abrir demandas para coordenação, receber cobranças, receber acompanhamentos, ser alvo de pendências pedagógicas. Professores não podem: delegar, cobrar como camada formal de governança, atuar como operador pleno do fluxo no MVP.

---

### 5. Subdomínios internos do departamento Pedagógico

#### 5.1 School
Responsável principal: **Juliana**
Escopo: adolescentes e adultos, jornada pedagógica da LA Music School, professores ligados a School, casos pedagógicos desse segmento.

#### 5.2 Kids
Responsável principal: **Quintela**
Escopo: bebês e crianças até 11 anos, jornada pedagógica da LA Music Kids, professores ligados a Kids, casos pedagógicos desse segmento.

#### 5.3 Especialidades e apoios transversais
Camadas transversais já identificadas: unidade, bandas, eventos pedagógicos, bateria, cordas, cultura. Essas especialidades não substituem a divisão principal School x Kids. Elas orbitam em volta dela.

---

### 6. Tipos iniciais de demanda pedagógica

#### 6.1 `acompanhamento-professor`
Cobrar relatório de aula, cobrar retorno pendente, acompanhar performance de professor, ajustar condução pedagógica, verificar cumprimento de alinhamento.

#### 6.2 `apoio-ao-aluno`
Resolver falta recorrente, lidar com dificuldade pedagógica, ajustar trilha de aprendizado, tratar caso sensível.

#### 6.3 `alinhamento-de-turma`
Troca de aluno de turma, mudança de professor, encaixe pedagógico, redistribuição interna.

#### 6.4 `alinhamento-com-responsavel`
Orientar responsável sobre trilha, dar devolutiva pedagógica, alinhar situação pedagógica do aluno.

#### 6.5 `evento-pedagogico`
Organizar banda/show pedagógico, alinhar preparação pedagógica para recital/show, tratar demandas pedagógicas ligadas a evento. Este tipo não substitui o motor oficial de Eventos.

#### 6.6 `pendencia-pedagogica`
Tipo coringa controlado para pendências que não encaixam nos tipos iniciais, exceções operacionais do domínio pedagógico.

#### 6.7 `suporte-ao-professor` (opcional)
Material, reparo, necessidade de apoio operacional aberta por professor. Pode ser absorvido em integração futura com a lógica operacional já usada no caso do Rafinha.

---

### 7. Exemplos reais de demandas mapeadas

- cobrar professor sobre relatório de aula
- alinhar troca de aluno de turma
- resolver falta recorrente de aluno
- orientar responsável sobre trilha
- organizar banda/show pedagógico
- pedir suporte da coordenação para caso delicado
- acompanhar performance de professor

---

### 8. Regras de roteamento do MVP

#### 8.1 Origem das demandas
Demandas podem nascer de: coordenação pedagógica, assistentes pedagógicos, mentores pedagógicos, professores, Alf / Anne.

#### 8.2 Fluxo principal
- Professor → Assistente Pedagógico ou Coordenação
- Assistente Pedagógico → Coordenação ou Professor
- Mentor Pedagógico → Coordenação / orientação / apoio
- Coordenação → Assistentes / Mentores / Professores
- Alf / Anne → Coordenação

#### 8.3 Regra de encaminhamento
- demandas School tendem a orbitar em Juliana
- demandas Kids tendem a orbitar em Quintela
- especialidades podem cruzar School/Kids, mas sem quebrar a hierarquia principal

#### 8.4 Regra de autoridade
- coordenação tem autoridade formal plena no MVP
- assistentes têm autoridade operacional dentro do escopo
- mentores têm autoridade de orientação, não de delegação
- professores têm capacidade de abertura, não de governança formal

---

### 9. Hipótese de modelagem no motor do LA Organizer

A Sprint 19 deve reaproveitar a base replicável criada na Sprint 15.

Estrutura prevista: novo departamento `pedagogico`, subdomínios internos interpretados pela skill e/ou metadados operacionais, request types iniciais do Pedagógico, responsável padrão por tipo quando fizer sentido, manutenção do ponto de entrada em `/mais/operacoes`.

O MVP do Pedagógico não precisa de tela nova. Ele entra como extensão da camada já existente. O foco é: taxonomia, alçada, skill, roteamento, piloto real.

---

### 10. Hipótese de seed inicial

Departamento: `pedagogico`

Request types: acompanhamento-professor, apoio-ao-aluno, alinhamento-de-turma, alinhamento-com-responsavel, evento-pedagogico, pendencia-pedagogica, suporte-ao-professor (se ativado).

Responsáveis estruturais: Juliana = lead School, Quintela = lead Kids.

Camadas de operação: assistentes por unidade/especialidade, mentores como apoio/orientação.

---

### 11. Hipótese de skill `pedagogico.md`

A skill do Pedagógico deve ensinar o TOM a: entender o domínio School x Kids, respeitar alçadas, encaminhar demanda para coordenação/assistente/mentor conforme contexto, distinguir cobrança válida de orientação, tratar professor como origem/destinatário mas não como camada de governança, não confundir evento pedagógico com o motor central de Eventos.

---

### 12. Piloto inicial recomendado

Primeiro piloto controlado com: Juliana, Quintela, assistentes pedagógicos. Mentores entram como apoio estruturado, sem delegação plena. Professores entram como origem/destinatário de demandas.

Meta do piloto: validar se a hierarquia faz sentido no uso real, se os tipos de demanda cobrem o cotidiano, se School x Kids resolve mais do que complica, se há necessidade de novos tipos ou papéis, se o fluxo com professores está equilibrado.

---

### 13. Relação com as próximas sprints

1. Sprint 18 — Integridade de Agenda e Execução
2. Sprint 19 — Pedagógico
3. Sprint 20 — Gerência
4. Auditoria obrigatória de Eventos
5. Só depois sprint específica de Eventos

Eventos não entram direto como próxima camada funcional. Antes, será obrigatória uma auditoria do motor atual de eventos.

---

### 14. Resumo executivo

A Sprint 19 do Pedagógico deve ser tratada como o primeiro departamento com complexidade relacional interna de verdade.

O núcleo do MVP não é task.

> O núcleo do MVP Pedagógico é **alçada + roteamento + contexto pedagógico correto**.
