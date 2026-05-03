# PRD-Base — Sprint 18: Integridade de Agenda e Execução

> Documento-base para a próxima camada de inteligência operacional do TOM.
> Objetivo: impedir que o sistema apenas acumule compromissos, tarefas e pendências sem validar conflito, duplicidade, coerência e fechamento. Esta sprint propõe uma camada de integridade sobre agenda e execução.

---

## 1. Tese central

O TOM já consegue criar compromissos, tasks, coordenar pessoas, acompanhar respostas, disparar lembretes e operar departamentos.

Mas se ele continuar apenas **adicionando itens ao sistema**, sem proteger a coerência do que já existe, o resultado será degradação progressiva: compromissos sobrepostos, duplicidade de agenda, tasks redundantes, pendências zumbis, backlog poluído, compromissos passados nunca encerrados, sensação de sistema "cheio" mas pouco confiável.

A próxima camada necessária é:

**Integridade de Agenda e Execução**

---

## 2. Problema

Hoje o TOM pode aceitar comandos como "marca amanhã 10h no Recreio", "cria uma reunião com Henrique", "me lembra disso amanhã", "abre uma tarefa pra fazer isso" — sem necessariamente checar com força suficiente se já existe compromisso naquele horário, se já existe algo parecido marcado, se a tarefa já está aberta, se a pendência já foi concluída e não baixada, se a agenda já está inviável, ou se existe lixo operacional acumulado.

### Formulação correta

O TOM precisa deixar de ser apenas um **criador de itens** e passar a ser também um:

**guardião da integridade operacional**

---

## 3. O que essa camada deve proteger

### 3.1 Integridade temporal
- não marcar compromissos impossíveis
- detectar sobreposição de horário
- detectar conflito parcial ou total
- alertar antes da criação
- sugerir ajuste quando necessário

### 3.2 Integridade semântica
- detectar itens muito parecidos com algo já existente
- suspeitar de duplicidade de tarefa ou compromisso
- perguntar antes de duplicar

### 3.3 Integridade de execução
- evitar acúmulo de tarefas abertas sem sentido
- identificar tarefas concluídas na prática, mas não encerradas no sistema
- apontar pendências velhas, mortas ou redundantes

### 3.4 Integridade de fechamento
- ajudar a baixar o que já foi concluído
- reduzir entulho operacional
- evitar que o sistema se torne uma pilha infinita de lixo aberto

---

## 4. Casos reais que motivam a sprint

### Caso 1 — conflito de agenda
Alf pede: "marca amanhã 10h no Recreio"
Mas já existe: compromisso das 9h às 10h30 com Henrique

Resposta esperada do TOM:
> "Você já tem um compromisso de 9h às 10h30 nesse horário. Quer marcar assim mesmo ou prefere ajustar?"

### Caso 2 — duplicidade de compromisso
Alf pede: "marca apresentação com Levi amanhã"
Mas já existe algo muito semelhante: "Apresentação Sistema de Gestão — Levi + Hugo"

Resposta esperada:
> "Já existe um compromisso muito parecido amanhã. Você quer criar outro mesmo assim?"

### Caso 3 — tarefa redundante
Alf pede: "abre uma tarefa pra falar com Renan sobre a NF"
Mas já existe task aberta com essa mesma intenção.

Resposta esperada:
> "Já existe uma tarefa parecida aberta. Você quer reutilizar a atual, atualizar ela ou criar outra mesmo assim?"

### Caso 4 — lixo operacional
Há tarefas abertas há muitos dias, sem atualização, possivelmente já resolvidas ou esquecidas.

Comportamento esperado:
> "Essas 3 tarefas parecem estar paradas/obsoletas; quer revisar?"

### Caso 5 — compromisso passado sem fechamento
O compromisso aconteceu, mas o sistema continua sem qualquer fechamento/contexto.

---

## 5. Escopo conceitual

A sprint se divide em duas frentes irmãs:

### Frente A — Conflict Awareness
- detectar sobreposição de agenda
- detectar conflito temporal
- detectar duplicidade de compromisso
- alertar antes de criar
- sugerir ajustes

### Frente B — Execution Hygiene
- detectar tarefas redundantes
- detectar tarefas envelhecidas
- identificar pendências zumbis
- apoiar fechamento e limpeza do sistema

Essas duas frentes pertencem à mesma tese:

**O TOM deve proteger a coerência do sistema antes de continuar enchendo ele.**

---

## 6. O que a sprint NÃO deve ser

- não é agenda autocrática que impede tudo
- não é "policial" chato travando qualquer criação
- não é deduplicação agressiva sem confirmação humana
- não é limpeza automática destrutiva
- não é apagar task ou compromisso sem aval

---

## 7. Princípio de UX

O TOM deve atuar como alerta inteligente, filtro de coerência, sugeridor de ajuste e protetor do sistema.

Não como bloqueador burocrático, validador excessivamente conservador ou robô que pede confirmação pra tudo.

---

## 8. Tipos de conflito temporal

### 8.1 Conflito duro
Novo compromisso coincide diretamente com outro que ocupa o mesmo intervalo de forma incompatível.

### 8.2 Conflito parcial
Há interseção, mas não necessariamente inviabilidade total.

### 8.3 Bloqueio contextual
Há deslocamento, unidade diferente ou natureza incompatível. Exemplo: reunião online 10h + compromisso presencial no Recreio 10h15. Mesmo com sobreposição parcial pequena, o contexto torna inviável.

---

## 9. Tipos de duplicidade semântica

### 9.1 Duplicidade quase literal
Mesmo nome / mesmo ator / mesmo dia / mesma intenção.

### 9.2 Duplicidade provável
Não é igual, mas parece o mesmo item com wording diferente.

### 9.3 Duplicidade de follow-up
A mesma cobrança ou o mesmo lembrete sendo recriado sem necessidade.

---

## 10. Tipos de sujeira operacional

### 10.1 Task zumbi
Task aberta, velha, sem atualização e sem sinal claro de que ainda faz sentido.

### 10.2 Task redundante
Task nova que repete uma já aberta.

### 10.3 Compromisso morto
Compromisso passado sem status e sem consequência de fechamento.

### 10.4 Pendência invisível
Algo já foi resolvido na prática, mas o sistema continua aberto.

---

## 11. Comportamentos esperados do TOM

### 11.1 Antes de criar compromisso
Verificar: conflito de horário, sobreposição dura ou parcial, duplicidade semântica recente.

### 11.2 Antes de criar task
Verificar: task similar já aberta, item equivalente recém-criado, conflito com compromisso já marcado se a task vier com data/hora forte.

### 11.3 Em revisões de rotina
Sinalizar: tasks envelhecidas, pendências potencialmente zumbis, compromissos passados que merecem fechamento.

---

## 12. Forma correta de intervenção do TOM

### Em caso de conflito
> "Você já tem um compromisso nesse horário. Quer manter assim mesmo?"

### Em caso de duplicidade
> "Já existe algo muito parecido. Quer atualizar o atual ou criar outro mesmo assim?"

### Em caso de sujeira operacional
> "Essas tarefas parecem paradas há dias. Quer revisar agora ou depois?"

---

## 13. O que o TOM não deve fazer sozinho

- cancelar compromisso automaticamente
- excluir tarefa automaticamente
- fundir itens automaticamente sem confirmação
- assumir que conflito inviabiliza criação em 100% dos casos

---

## 14. Possíveis componentes da solução

Sem definir implementação, a sprint provavelmente precisará de alguma combinação de:

- heurística temporal sobre `events`
- heurística semântica sobre `tasks` e `events`
- regras de sobreposição por intervalo
- suspeita de duplicidade por proximidade textual + ator + data
- score de "item possivelmente obsoleto"
- prompts de confirmação leves e objetivos

---

## 15. Relação com o que já existe

Conversa diretamente com: `events`, `tasks`, `daily_plans`, `weekly_plans`, `notifications`, TOM de criação de compromisso, TOM de criação de tasks, camada operacional departamental, coordenação conversacional.

Não substitui esses elementos. Atua como camada de validação e integridade por cima deles.

---

## 16. Decisões de design importantes

### 16.1 Bloquear ou só alertar?
Recomendação: alertar por padrão. Bloquear só em casos muito claros e destrutivos.

### 16.2 Duplicidade deve ser exata ou probabilística?
Tem que ser probabilística com confirmação humana.

### 16.3 Higiene deve ser automática?
Não no começo. Primeiro deve ser assistida e revisável.

---

## 17. Critérios de sucesso

- reduzir criação de compromissos conflitantes
- reduzir duplicidade de tasks e eventos
- melhorar a higiene do backlog
- aumentar confiabilidade percebida do sistema
- fazer o TOM parecer mais inteligente e menos acumulador de ruído

---

## 18. Critérios de fracasso

- o TOM começar a pedir confirmação para tudo
- os alertas forem excessivos e cansativos
- ele bloquear cenários que na prática eram desejáveis
- a limpeza virar comportamento destrutivo ou autoritário
- a heurística gerar muito falso positivo sem utilidade real

---

## 19. Recomendação estratégica

Esta sprint faz mais sentido depois da consolidação da Sprint 17 (ACC), depois de mais uso real da camada conversacional, e antes de grande expansão de novos departamentos. Porque ela melhora a qualidade sistêmica do produto como um todo.

---

## 20. Frase-síntese

**O TOM não pode só criar coisas.**
**Ele precisa proteger a integridade do que já existe.**
