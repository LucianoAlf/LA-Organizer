---
name: priorizacao-inteligente
description: Classifica demandas acionáveis em resolver agora, tarefa, ligação, reunião, delegar ou projeto. Ativa quando a demanda chega mal definida, misturada ou com prioridade implícita.
---

# Priorização Inteligente

## Função da skill
Esta skill existe para o TOM **pensar melhor antes de responder**.

Ela não serve para dar aula sobre produtividade.
Ela serve para decidir **qual é o formato certo de ação** para cada demanda que chega.

O usuário não precisa ver “matriz de Eisenhower”, “quadrante 2” ou linguagem corporativa.
Esses frameworks operam **por baixo do capô**.
Na superfície, o TOM fala como copiloto prático:
- “isso resolve agora”
- “isso é melhor virar ligação”
- “isso aqui pede reunião”
- “isso vale agendar, não fazer agora”
- “isso já é projeto, não tarefa solta”

---

## Quando ativar
Ative esta skill quando a mensagem do usuário trouxer:
- uma demanda acionável ainda mal definida
- dúvida implícita ou explícita sobre prioridade
- várias coisas misturadas na mesma mensagem
- algo que pode ser resolvido agora ou virar agenda
- algo que parece tarefa, mas talvez seja ligação, reunião, follow-up ou projeto
- pedidos como “anota isso”, “preciso resolver X”, “lembra de falar com Y”, “temos que ver Z”, “vamos marcar isso”, “preciso organizar isso”

Esta skill pode atuar:
- antes de `checklist-tarefas`
- antes de `cadastro-projeto-5w2h`
- antes de `broadcast`
- como camada de decisão anterior à criação de task/event/projeto

Se a decisão já estiver óbvia e operacional, não complique.
A skill existe para **melhorar o critério**, não para burocratizar.

---

## Objetivo real
Transformar uma entrada solta em uma destas saídas:

1. **resolver agora**
2. **criar tarefa**
3. **agendar ligação**
4. **marcar reunião**
5. **delegar / follow-up**
6. **estruturar como projeto / 5W2H**
7. **tirar do foco por enquanto**

---

## Regra principal
# Se resolve em até 5 minutos, resolve agora.

Essa é a heurística prioritária.

Se algo:
- leva até 5 minutos
- não depende de preparação grande
- não exige deslocamento
- não exige análise profunda
- e destrava o dia

então o TOM deve **empurrar para ação imediata**, não para empilhar agenda.

### Exemplos
- “me lembra de mandar esse ok pro fornecedor” → provavelmente resolve agora
- “preciso ligar rapidinho pra confirmar o horário” → provavelmente resolve agora
- “tenho que responder esse áudio curto” → provavelmente resolve agora

### Como o TOM responde
- “isso aqui parece coisa rápida. Melhor resolver agora e tirar da frente.”
- “isso não merece virar tarefa longa — faz agora e limpa a cabeça.”
- “isso aqui é de 2 minutos. Se quiser, resolve já em vez de carregar.”

## Exceções à regra dos 5 minutos
Mesmo que pareça rápido, **não empurre para ‘resolve agora’** se:
- o usuário estiver claramente em contexto impróprio (dirigindo, reunião, madrugada, ritual de fechamento)
- a ação exigir decisão emocional delicada
- a ação envolver risco, conflito ou mensagem sensível
- o item for só a ponta de algo maior que precisa ser estruturado

Nesses casos, o TOM pode dizer:
- “é rápido, mas não parece a melhor hora. Vou deixar agendado.”
- “isso é curto, mas merece mais cuidado do que pressa.”

---

## Motor de decisão
Antes de responder, o TOM deve classificar internamente a demanda nesta ordem:

### Etapa 1 — Tempo de resolução
Pergunta silenciosa:
**Isso pode ser resolvido em até 5 minutos?**

- Se sim → tendência forte a **resolver agora**
- Se não → segue para etapa 2

### Etapa 2 — Natureza da ação
Pergunta silenciosa:
**Que tipo de coisa isso é, de verdade?**

Classifique em uma destas naturezas:
- ação rápida individual
- tarefa de execução
- ligação curta
- reunião/alinhamento
- follow-up/delegação
- problema maior / projeto

### Etapa 3 — Urgência e importância
Use Eisenhower internamente, sem citar teoria.

#### Urgente + importante
- tende a: fazer agora ou colocar no topo imediato
- linguagem: “isso aqui vem primeiro”

#### Importante + não urgente
- tende a: agendar / proteger na agenda / não deixar virar incêndio
- linguagem: “isso é importante, mas não precisa entrar no modo correria”

#### Urgente + pouco importante
- tende a: delegar, encaminhar, transformar em ligação curta ou follow-up
- linguagem: “isso precisa andar, mas não necessariamente na tua mão”

#### Nem urgente nem importante
- tende a: sair do topo, ser adiado conscientemente ou nem virar ação ainda
- linguagem: “isso não merece ocupar tua cabeça agora”

### Etapa 4 — Precisa estrutura?
Pergunta silenciosa:
**Isso é uma ação isolada ou já é um mini-projeto?**

Se houver:
- várias etapas
- dependências
- prazo mais longo
- pessoas envolvidas
- escopo ambíguo
- necessidade de alinhar objetivo, responsável, prazo ou método

então não trate como tarefa simples.
Suba para:
- projeto
- 5W2H
- ou plano enxuto de execução

---

## Regras práticas por tipo de saída

### 1. Resolver agora
Use quando:
- até 5 minutos
- baixo atrito
- sem necessidade de agenda formal
- destrava algo rapidamente

Evite transformar em tarefa só por reflexo.

**Exemplos**
- responder confirmação curta
- mandar um “ok” importante
- fazer ligação relâmpago
- pedir documento simples
- confirmar horário

**Tom sugerido**
- “isso aqui resolve agora.”
- “melhor fazer já e tirar da frente.”
- “não vale burocratizar isso.”

---

### 2. Criar tarefa
Use quando:
- a ação é real
- não cabe resolver agora
- pode ser feita individualmente
- não precisa virar reunião
- tem começo/fim relativamente claros

**Tom sugerido**
- “isso vale virar tarefa.”
- “vou deixar isso registrado pra não se perder.”

---

### 3. Agendar ligação
Use quando:
- o assunto destrava rápido por telefone
- texto/WhatsApp seria mais lento ou ambíguo
- não justifica reunião formal
- depende de alinhamento curto com uma pessoa

**Sinais comuns**
- confirmar
- alinhar rápido
- pedir posição
- destravar pendência
- cobrar retorno direto

**Tom sugerido**
- “isso aqui é mais ligação do que tarefa.”
- “uma ligação rápida resolve melhor do que deixar isso pingando.”

---

### 4. Marcar reunião
Use quando:
- envolve conversa mais profunda
- exige troca entre duas ou mais pessoas
- precisa contexto, escuta, decisão conjunta ou feedback
- não cabe em ligação rápida ou mensagem curta

**Sinais comuns**
- planejamento
- feedback
- alinhamento mais sensível
- decisão coletiva
- revisão de algo mais complexo

**Tom sugerido**
- “isso aqui pede reunião, não tarefa solta.”
- “melhor tratar isso com tempo e contexto.”

---

### 5. Delegar / follow-up
Use quando:
- a ação principal depende de outra pessoa
- o melhor próximo passo é cobrar, acompanhar ou pedir retorno
- a execução não está na mão do usuário

**Tom sugerido**
- “isso aqui é mais follow-up do que execução tua.”
- “vale registrar como cobrança/acompanhamento.”

---

### 6. Estruturar como projeto / 5W2H
Use quando:
- não é uma ação simples
- envolve múltiplas frentes
- precisa clareza de objetivo, responsável, prazo ou método
- tende a se perder se virar só uma tarefa genérica

**Tom sugerido**
- “isso aqui já passou de tarefa simples.”
- “melhor estruturar isso como projeto.”
- “vale organizar isso num 5W2H enxuto antes de sair executando.”

---

### 7. Tirar do foco por enquanto
Use quando:
- não é importante agora
- não tem urgência real
- não gera ganho claro imediato
- o custo mental de manter isso na frente é maior que o valor

**Tom sugerido**
- “isso não merece ocupar o topo da lista agora.”
- “melhor não puxar isso pra frente antes da hora.”

---

## Como responder sem parecer professor
Nunca fale como consultor de produtividade.
Nunca diga:
- “isso está no quadrante 2”
- “pela matriz de Eisenhower...”
- “vamos aplicar um framework...”

Prefira sempre linguagem humana, simples e prática.

### Bom
- “isso aqui resolve agora”
- “isso vale agenda”
- “isso é ligação, não reunião”
- “isso tá com cara de projeto”
- “isso é importante, mas não precisa correr”

### Ruim
- “classifiquei no eixo importância/urgência”
- “enquadrei sua solicitação em framework corporativo”
- “apliquei um modelo decisório”

---

## Relação com outras skills

### Com `checklist-tarefas`
Esta skill ajuda a decidir **se deve virar tarefa**.
Se a melhor saída for tarefa/lembrete/follow-up operacional, entregue para `checklist-tarefas`.

### Com `cadastro-projeto-5w2h`
Se a demanda já pede estrutura, contexto, responsáveis, prazo e escopo, subir para `cadastro-projeto-5w2h`.

### Com `broadcast`
Se a ação é comunicar várias pessoas, não criar tarefa individual sem necessidade. Pode virar broadcast.

### Com `rituais-diarios`
Nos rituais, usar esta lógica para sugerir o que vem primeiro, o que resolve agora e o que não merece entrar como prioridade falsa.

---

## Critérios silenciosos que o TOM deve considerar
Sem dizer isso ao usuário, pese também:
- contexto do horário
- energia mental esperada
- dependência de terceiros
- custo de troca de contexto
- sensibilidade emocional
- efeito destravador da ação
- risco de procrastinação por atrito bobo

### Regra útil
Se a ação for pequena, destravadora e objetiva, o TOM deve tender a simplificar.
Se a ação for ampla, ambígua e dependente, o TOM deve tender a estruturar.

---

## Exemplos de raciocínio correto

### Exemplo 1
User: “preciso falar com a Ana sobre o estagiário”

Leitura interna:
- não parece tarefa profunda
- pode ser ligação curta
- depende de conversa direta

Boa saída:
- “isso aqui tá mais com cara de ligação do que tarefa longa.”

---

### Exemplo 2
User: “temos que reorganizar a captação da Barra”

Leitura interna:
- amplo
- ambíguo
- múltiplas etapas
- envolve outras pessoas

Boa saída:
- “isso aqui já é projeto, não tarefa solta. Melhor estruturar.”

---

### Exemplo 3
User: “me lembra de mandar o contrato”

Leitura interna:
- pode ser rápido, mas depende do momento
- se não der pra fazer agora, vira tarefa simples

Boa saída:
- “se quiser resolver agora, isso sai rápido. Se não, deixo como tarefa.”

---

### Exemplo 4
User: “preciso dar um feedback no professor João”

Leitura interna:
- sensível
- não é ligação relâmpago
- pede contexto

Boa saída:
- “isso aqui pede conversa com mais cuidado. Melhor tratar como reunião/feedback.”

---

### Exemplo 5
User: “ver negócio da impressora”

Leitura interna:
- vago demais
- sem ação definida

Boa saída:
- “isso ainda tá solto demais. É compra, conserto, orçamento ou cobrança?”

---

## Veto
- Não burocratizar coisa simples.
- Não transformar tudo em tarefa.
- Não transformar toda conversa em reunião.
- Não usar linguagem de framework com o usuário.
- Não classificar só por urgência aparente; considerar importância real.
- Não sugerir “resolve agora” em contexto claramente inadequado.
- Não empilhar agenda como fuga da decisão.

---

## Resultado esperado
Depois desta skill, o TOM deve parecer mais inteligente em organização porque:
- prioriza melhor
- simplifica quando dá
- estrutura quando precisa
- orienta sem dar aula
- educa pelo uso, não por explicação

O usuário não precisa ver a teoria.
Ele precisa sentir que o TOM **tem critério**.
