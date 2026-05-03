# PRD — Coordenação Conversacional via TOM

> Feature estratégica do LA Organizer / TOM.
> Objetivo: permitir mediação conversacional entre colaboradores com hierarquia, rastreabilidade e follow-up, sem transformar o TOM em bagunça política nem em substituto indiscriminado da comunicação humana direta.

---

## 1. Tese central

À medida que o TOM assume mais funções reais dentro da operação — criação de tasks, follow-up, cobrança, memória, rituais e mediação operacional — surge naturalmente um novo comportamento dos usuários:

- "Tom, fala com o Rafinha."
- "Tom, cobra o Yuri."
- "Tom, avisa a Anne."
- "Tom, pergunta se ele viu."
- "Tom, transmite isso pra equipe."

Essa demanda **não é artificial**. Ela emerge do próprio uso.

O problema é que essa feature, se aberta sem regras, pode:

- romper hierarquia humana
- criar abuso político
- gerar ruído entre pares
- confundir recado com ordem
- transformar o TOM em atalho de comando sem governança

Portanto, a feature deve nascer como:

**Coordenação Conversacional via TOM**

e não como simples "envio de mensagem".

---

## 2. Pergunta estratégica

### Vale a pena falar com o TOM em vez de falar direto com a pessoa?

**Às vezes, sim. Às vezes, não.**

### Não vale quando:
- é recado simples e imediato
- exige nuance humana direta
- é conversa sensível
- feedback emocional ou relacional importa mais do que rastreabilidade

### Vale quando:
- a fala precisa virar fluxo rastreável
- há necessidade de follow-up
- existe prazo, confirmação ou cobrança
- o solicitante quer sair da execução manual da cobrança
- o TOM agrega memória, monitoramento e consequência

### Formulação correta

**O TOM não é melhor para conversar.**
**O TOM é melhor para coordenar quando a conversa precisa virar processo.**

---

## 3. Objetivo da feature

Permitir que o TOM intermedeie comunicação operacional entre colaboradores de forma:

- autorizada
- rastreável
- clara
- auditável
- proporcional à hierarquia real da organização

---

## 4. O que a feature NÃO deve ser

- não é WhatsApp paralelo
- não é substituto da comunicação humana direta
- não é ferramenta para qualquer colaborador "mandar" em qualquer outro
- não é espaço para ordens opacas ou politicamente ambíguas
- não é canal para o TOM inventar interpretações sem transparência

---

## 5. Princípio de governança

**O TOM não pode inverter a hierarquia humana.**

Ele pode:
- facilitar
- encaminhar
- lembrar
- acompanhar
- cobrar dentro da alçada correta
- registrar e devolver status

Ele não pode:
- criar autoridade onde ela não existe
- transformar recado lateral em ordem oficial
- cobrar alguém fora da alçada do solicitante sem regra clara
- usar tom de comando em nome de quem não tem autoridade

---

## 6. Casos de uso reais

### 6.1 Delegação monitorada
- "Tom, fala com o Rafinha sobre o teclado da sala 3 e me avisa se ele responder."

### 6.2 Cobrança com rastreamento
- "Tom, cobra o Yuri sobre os criativos do anúncio de amanhã."

### 6.3 Encaminhamento de aviso
- "Tom, avisa a Anne que amanhã vou estar no Recreio."

### 6.4 Pedido de confirmação
- "Tom, pergunta pra Juliana se o evento já foi alinhado."

### 6.5 Escalonamento por ausência de resposta
- "Tom, se o Rafinha não responder até 16h, me avisa."

### 6.6 Broadcast individualmente mediado
- "Tom, passa isso para os líderes e me fala quem respondeu."

---

## 7. Tipos de interação

O TOM precisa distinguir a intenção do pedido.

### 7.1 Recado / aviso
- Natureza: informativa, não coercitiva, baixa sensibilidade hierárquica

### 7.2 Pedido de ação
- Natureza: orienta execução, já exige alçada ou contexto de coordenação

### 7.3 Cobrança / follow-up
- Natureza: sensível politicamente, depende de autoridade, contexto e timing

### 7.4 Delegação / ordem monitorada
- Natureza: alta sensibilidade hierárquica, só deve existir dentro da autoridade correta

### 7.5 Solicitação de status
- Natureza: consulta de rastreamento, depende de suporte técnico e política de privacidade

---

## 8. Matriz inicial de permissão

### 8.1 Director
- Pode: avisar, pedir, cobrar, delegar, acompanhar, escalar
- Para: qualquer colaborador

### 8.2 Coordinator / Manager
- Pode: avisar, pedir, cobrar, delegar, acompanhar
- Para: subordinados diretos, pessoas do escopo da sua operação
- Fora do escopo: pode encaminhar aviso, solicitar contato, sugerir mediação

### 8.3 Collaborator
- Pode: encaminhar recado, pedir ajuda, informar bloqueio, solicitar contato
- Não pode: cobrar pares livremente, delegar ordens, usar TOM como mando fora da alçada

### 8.4 Regra geral
Se houver dúvida de alçada, o TOM deve preferir mediação leve, encaminhamento sem tom de comando, ou recusa clara com explicação institucional.

---

## 9. Modos de mediação do TOM

### 9.1 Relay literal
- "Tom, manda exatamente isso para o Rafinha."
- TOM repassa sem reinterpretar

### 9.2 Relay assistido
- "Tom, avisa o Yuri que preciso dos criativos até 16h."
- TOM reorganiza a frase para ficar mais clara, sem mudar o sentido

### 9.3 Follow-up monitorado
- "Tom, cobra o Rafinha e me avisa se ele não responder."
- TOM envia, registra, acompanha resposta e devolve status

### 9.4 Escalonamento
- "Tom, se ele não responder até 17h, me lembra."
- TOM cria condição temporal de acompanhamento

---

## 10. Como o TOM deve responder quando a regra não permite

### Exemplo 1 — cobrança fora da alçada
- "Não vou cobrar o Yuri por você. Esse tipo de cobrança precisa vir do coordenador ou diretor."

### Exemplo 2 — delegação indevida
- "Não posso usar esse canal para dar uma ordem em teu nome fora da tua alçada."

### Exemplo 3 — alternativa segura
- "Posso te ajudar a formular a mensagem para teu coordenador encaminhar."

### Exemplo 4 — mediação parcial
- "Posso encaminhar isso como recado, mas não como cobrança oficial."

### Regra de UX
A recusa do TOM deve ser firme, clara, institucional, sem humilhar e sem ser permissiva demais.

---

## 11. Arquitetura conceitual

Essa feature adiciona uma nova camada ao TOM: **mediação conversacional entre pessoas**.

Elementos arquiteturais:
- autorização por hierarquia
- estado da interação mediada
- tracking de envio
- tracking de resposta
- possíveis read receipts
- timeout / SLA de resposta
- escalonamento
- auditoria da mediação
- diferenciação entre mensagem literal e interpretada

---

## 12. Questões de design ainda abertas

### 12.1 Permissões
- coordinator pode cobrar qualquer colaborador?
- manager e coordinator são equivalentes?
- existe mapa explícito de subordinados ou a regra será por role + unit + área?

### 12.2 Read receipts
- consultar UAZAPI?
- confiar em webhooks?
- usar só conversation_history do TOM?
- tratar como best-effort, não garantia?

### 12.3 Tracking de resposta
- o que conta como resposta?
- qualquer mensagem? confirmação explícita? resposta semântica?

### 12.4 Privacidade
- o receptor sabe que veio via TOM?
- o remetente pode exigir envio literal?
- TOM pode resumir/parafrasear?
- diferenciação explícita entre "mensagem do Alf via TOM" e "pedido interpretado pelo TOM"?

### 12.5 Auditoria
- histórico em conversation_history ou entidade própria?
- como rastrear: enviado / entregue / visto / respondeu / escalou?

---

## 13. MVP recomendado

### MVP 1 — Delegação Conversacional Assistida

Permitir que director/coordinator/manager usem o TOM para avisar, pedir, cobrar e solicitar confirmação com destinatários dentro do escopo permitido.

### O TOM deve:
1. interpretar a intenção
2. validar a permissão hierárquica
3. enquadrar a mensagem no modo correto
4. enviar ao destinatário
5. registrar o envio
6. monitorar resposta
7. devolver status ao solicitante

### Fora do MVP inicial:
- colaborador cobrando qualquer par
- grupos
- múltiplos destinatários complexos
- broadcast avançado por TOM conversacional livre
- interpretação opaca sem transparência
- workflow multi-escalonamento sofisticado

---

## 14. Fluxo recomendado do MVP

1. Solicitante aciona: "Tom, cobra o Yuri sobre os criativos de amanhã e me avisa se ele não responder até 16h."
2. TOM classifica intenção: cobrança, destinatário Yuri, remetente Alf, deadline 16h
3. TOM valida permissão: Alf é director → permitido
4. TOM envia: "Yuri, o Alf pediu que eu confirme contigo os criativos de amanhã. Consegue me responder aqui até 16h?"
5. TOM registra: enviado, modo follow-up monitorado
6. TOM acompanha: respondeu? não respondeu?
7. TOM devolve ao solicitante: status da resposta

---

## 15. Critérios de sucesso

- aumentar coordenação sem aumentar caos político
- reduzir carga manual de cobrança do Alf e líderes
- manter a hierarquia humana intacta
- gerar rastreabilidade útil
- deixar claro quando o TOM está repassando vs. mediando
- evitar que o TOM vire atalho para abuso entre colaboradores

---

## 16. Critérios de fracasso

- qualquer colaborador puder mandar em qualquer outro via TOM
- o TOM cobrar pessoas fora de alçada sem critério
- ambiguidade entre texto literal e texto reinterpretado
- o solicitante acreditar em rastreamento que não houve
- o receptor não entender quem está pedindo o quê
- o canal gerar ruído político ou sensação de vigilância opaca

---

## 17. Relação com o roadmap atual

Conversa diretamente com:
- Sprint 14 (create-for-other, notificações, follow-up)
- Sprint 15 (operação departamental, responsáveis, fila e coordenação)
- futuras camadas de mensageria, grupos e broadcast inteligente

---

## 18. Decisão recomendada

Sim, vale abrir essa frente agora. Mas como PRD de Coordenação Conversacional com foco em hierarquia, permissão, rastreabilidade, tom institucional e MVP seguro.

---

## 19. Frase-síntese

**O TOM não deve substituir a conversa humana direta.**
**Ele deve assumir os casos em que a conversa precisa virar coordenação com memória, rastreabilidade e consequência.**
