# PRD — LA Organizer / Módulo Operações Técnicas

> Produto: LA Organizer  
> Módulo: Operações Técnicas  
> Caso-modelo inicial: Rafinha  
> Status: PRD inicial completo  
> Origem: discovery operacional + fluxo conceitual + wireframes

---

## 1. Visão geral

O módulo **Operações Técnicas** do LA Organizer existe para transformar a operação técnica da LA Music de um modelo reativo, disperso e dependente de memória individual para um modelo estruturado, rastreável, previsível e assistido por agentes.

O caso inicial é o do **Rafinha**, responsável por um conjunto amplo de funções operacionais críticas da escola.

Esse módulo não nasce para substituir o trabalho dele.  
Ele nasce para:
- organizar a entrada de demandas
- classificar prioridades
- sustentar manutenção preventiva
- estruturar compras e aprovações
- manter histórico
- reduzir falha de comunicação interna
- dar visibilidade executiva sem puxar o CEO para microgestão

---

## 2. Problema que o módulo resolve

### 2.1 Problema central
A operação técnica da LA Music hoje depende demais de:
- memória individual
- urgência percebida no calor do momento
- comunicação informal via WhatsApp
- pedido mal estruturado
- falta de cadência preventiva
- ausência de fila visível

### 2.2 Sintomas observados
- equipamentos e insumos críticos faltam “do nada”
- demandas chegam mal descritas
- tudo parece urgente
- filas somem na cabeça do responsável
- manutenção vira apagamento de incêndio
- não existe visibilidade clara do que está pendente
- compras e aprovações acontecem sem trilha confiável
- checklist existe, mas sem consequência forte
- o CEO precisa aprovar coisas sem ter contexto organizado

### 2.3 Dor-raiz da operação
As duas dores estruturais identificadas são:
1. **Desorganização**
2. **Falha de comunicação interna**

---

## 3. Objetivo do módulo

### Objetivo principal
Criar uma camada operacional capaz de:
- captar sinais da operação
- transformar sinais em demanda estruturada
- classificar e priorizar corretamente
- manter fila viva
- acionar compras e execução
- sustentar rotinas preventivas
- fechar o ciclo de comunicação

### Resultado desejado
O Rafinha deixa de operar por memória e urgência improvisada e passa a operar por:
- fila visível
- rito semanal
- checklist com consequência
- classificação clara
- orçamento visível
- histórico rastreável

---

## 4. Usuários e atores

## 4.1 Usuários principais
- **Rafinha** — responsável técnico operacional
- **Eduardo** — apoio operacional e logístico
- **Assistente pedagógico da unidade**
- **Coordenação**
- **Gerente da unidade**
- **Alf** — aprovador e leitor executivo
- **Tom** — agente de suporte operacional

## 4.2 Usuários indiretos
- professores
- marketing
- equipe de eventos
- equipe administrativa
- fornecedores

---

## 5. Escopo funcional do módulo

O módulo cobre:
- manutenção técnica
- manutenção predial básica e acompanhamento
- reposição de itens críticos
- apoio técnico e logístico de operação
- suporte a gravações/eventos internos
- acompanhamento de compras e fornecedores
- manutenção preventiva
- inventário leve e checklist de sala
- visão por unidade

### Fora do escopo inicial
- ERP completo de estoque
- sistema financeiro completo
- OS complexa estilo field service enterprise
- multiempresa
- compras avançadas com fiscal completo

---

## 6. Papel do Rafinha no sistema

O Rafinha é o caso-modelo porque hoje atua como um **hub operacional técnico da LA**.

Ele concentra:
- manutenção de equipamentos
- manutenção predial
- logística entre unidades
- áudio e sonorização
- apoio a eventos
- compra de materiais
- orçamento e execução
- contato com fornecedores
- resolução de incidentes

### Diagnóstico do papel atual
Ele não falha por falta de competência.  
Ele falha porque o sistema de trabalho em torno dele é fraco:
- fila mental
- prioridade intuitiva
- comunicação ruim na entrada
- pouca disciplina preventiva

---

## 7. Tipos de demanda do módulo

O sistema precisa classificar demanda por natureza.

### Tipos oficiais
1. **Incidente técnico**
   - exemplo: cabo ruim, amp quebrado, ar-condicionado falhando

2. **Reposição / estoque**
   - exemplo: falta corda, falta baqueta, falta microfone reserva

3. **Apoio técnico / montagem**
   - exemplo: gravação, vídeo, evento, apoio de sala

4. **Obra / melhoria / infraestrutura**
   - exemplo: luz de emergência, reforma, ajuste estrutural, fornecedor

5. **Preventivo / auditoria**
   - exemplo: revisão de sala, checagem de itens críticos, ronda semanal

---

## 8. Fluxo operacional do módulo

## 8.1 Entrada da demanda
### Estado atual
A demanda chega por:
- grupos de WhatsApp
- mensagens diretas
- áudios
- fotos
- vídeos

### Estado desejado
Toda demanda deve virar registro estruturado com:
- unidade
- sala
- categoria
- item
- urgência percebida
- impacto na aula
- evidência (foto/vídeo)
- origem

## 8.2 Triagem
Nem tudo deve cair cru no Rafinha.

### Filtro ideal
- assistente pedagógico
- coordenação
- gerente da unidade, quando necessário

### Regra
Se é algo ligado à operação pedagógica da unidade, deve passar primeiro pelo filtro local antes de virar fila técnica.

## 8.3 Classificação
O Tom ajuda a classificar a demanda em uma das naturezas oficiais.

## 8.4 Execução
Depois da triagem:
- Rafinha assume o que é técnico/sensível
- Eduardo assume o que é apoio operacional/executável
- itens que dependem de compra entram em fluxo de aprovação
- itens que dependem de terceiro entram em acompanhamento externo

## 8.5 Fechamento
Quando resolvido:
- unidade deve ser avisada
- coordenação / assistente pedagógico devem saber
- gerente da unidade deve ter visibilidade
- item vira histórico

---

## 9. Fila operacional

A fila operacional é o coração do módulo.

### Objetivo
Externalizar a fila mental do Rafinha.

### Status sugeridos
- Novo
- Triado
- Em execução
- Aguardando compra
- Aguardando fornecedor
- Resolvido
- Validado

### Criticidade sugerida
- Crítico
- Alto
- Médio
- Baixo

### Responsável
- Rafinha
- Eduardo
- Aguardando Alf
- Aguardando fornecedor

---

## 10. Checklist de sala com consequência

Já existe checklist em parte da operação, mas ele ainda não gera consequência forte.

### Problema atual
- acontece de forma inconsistente
- depende da cultura da unidade
- Campo Grande faz mais ou menos
- Recreio tem aderência maior
- Barra sustenta mal
- checklist não se converte automaticamente em ação

### Regra do módulo
Se o checklist detectar problema, ele deve:
1. registrar a ocorrência
2. classificar a natureza do problema
3. alimentar a fila
4. notificar responsáveis

### Exemplo de itens do checklist
- cadeiras completas
- cabos ok
- instrumentos ok
- fonte ok
- microfone ok
- ar-condicionado desligado
- sala organizada

---

## 11. Itens críticos de operação

Há itens que não podem faltar porque afetam diretamente a experiência da aula.

### Itens críticos mapeados até agora
- corda
- baqueta
- cabo
- microfone
- pele de bateria
- fonte
- cadeira / setup mínimo de sala

### Regras desejadas
Cada item crítico deve permitir:
- estoque mínimo
- alerta de nível baixo
- unidade vinculada
- responsável por conferência

---

## 12. Ritual semanal do Rafinha

### Objetivo
Criar cadência preventiva sem depender da memória ou de visita física a toda unidade toda semana.

### Frequência
Semanal

### Duração sugerida
10 a 15 minutos

### Participantes
- Rafinha
- assistente pedagógico / coordenação das unidades
- eventualmente gerentes
- Tom como suporte do fluxo

### Perguntas mínimas
- falta algo crítico?
- o que ficou em risco?
- o que precisa comprar?
- o que ficou parado?
- qual unidade está mais problemática?
- o que precisa resolver antes de virar urgência?

### Saídas esperadas
- compras da semana
- fila prioritária
- visitas necessárias
- ações preventivas
- alertas por unidade

---

## 13. Aprovação e orçamento

### Situação atual
- compra pequena costuma acontecer direto
- compra maior sobe para o Alf
- não existe cota mensal formal

### Regra desejada
O módulo deve sustentar uma visão simples de orçamento de manutenção, com:
- valor mensal disponível
- valor já consumido
- percentual usado
- itens aguardando aprovação

### Regra inicial sugerida
- compras acima de **R$ 300** sobem para aprovação explícita do Alf

Essa regra é um ponto de partida, não necessariamente a regra final permanente.

---

## 14. Fornecedores e terceiros

Hoje, quando algo depende de fornecedor, a lembrança e a cobrança ficam frágeis.

### O módulo deve registrar
- fornecedor responsável
- último contato
- previsão prometida
- status atual
- tempo parado

### Regra de operação
Itens aguardando fornecedor não podem sumir.  
Precisam continuar visíveis na fila e gerar lembrete.

---

## 15. Papel do Tom (agente)

O Tom não substitui o Rafinha.  
Ele atua como agente de estruturação.

### Funções do Tom
- capturar demanda do canal de entrada
- forçar perguntas mínimas
- transformar mídia solta em item organizado
- classificar
- distribuir para fila correta
- lembrar itens parados
- sinalizar urgência real vs urgência fabricada
- apoiar o ritual semanal
- sustentar follow-up e fechamento

### Tese
O valor do Tom é tornar explícito o que hoje está implícito e disperso.

---

## 16. Regras de governança e comunicação

### Quem mais interage com o Rafinha
- coordenação
- assistente pedagógico
- gerentes
- Alf

### Quem mais pede mal hoje
- professores, principalmente

### Quem precisa ser avisado quando resolve
- unidade envolvida
- coordenação
- assistente pedagógico
- gerente

### O que sobe para o Alf
- compras acima da alçada
- investimento relevante
- urgência crítica
- risco operacional real
- visão consolidada da fila

### O que não deve subir para o Alf
- microgestão do operacional
- detalhe bruto de item simples
- resolução de rotina já dentro da alçada do módulo

---

## 17. Visão executiva do Alf

O módulo precisa dar visibilidade executiva sem sugar o CEO para a operação diária.

### O que o Alf deve enxergar
- status por unidade
- unidade mais crítica
- fila crítica
- pendências antigas
- itens recorrentes
- consumo do orçamento
- itens aguardando aprovação
- itens aguardando fornecedor
- risco operacional

---

## 18. Wireframes conceituais do módulo

Os wireframes base já foram descritos em documento complementar:
- fila do dia
- card da demanda
- visão por unidade
- checklist de sala
- painel executivo do Alf

Esse PRD os considera como referência conceitual de interface.

---

## 19. MVP por fases

## MVP 1 — Base de operação
- entrada estruturada
- triagem
- classificação por tipo
- fila do Rafinha
- responsável
- status
- visão por unidade
- checklist com geração de ocorrência

## MVP 2 — Governança operacional
- orçamento/cota de manutenção
- aguardando compra
- aguardando fornecedor
- alertas de item parado
- ritual semanal do Rafinha

## MVP 3 — Inteligência operacional
- análise de recorrência
- leitura de unidade crítica
- histórico de problemas repetidos
- visão executiva consolidada
- padrões de urgência fabricada

---

## 20. Critérios de sucesso

O módulo será considerado bem-sucedido se produzir efeitos como:

### Operacional
- menos incidentes “do nada” em itens previsíveis
- menos pedido mal estruturado
- menos dependência de memória individual
- mais fechamento de ciclo

### Gerencial
- mais visibilidade por unidade
- compras mais organizadas
- fila viva e rastreável
- menos microgestão do Alf

### Cultural
- professores e unidades entendendo melhor como pedir
- checklist deixando de ser ritual vazio
- manutenção saindo do modo incêndio para o modo gestão

---

## 21. Riscos de implementação

### Riscos principais
- tentar automatizar demais antes de estruturar a disciplina
- professor continuar pedindo fora do fluxo
- checklist continuar sem consequência real
- Rafinha não aderir ao ritual semanal
- virar microgestão disfarçada
- criar burocracia excessiva para demanda simples

### Mitigação
- começar enxuto
- usar casos reais
- focar em fila e consequência
- proteger o fluxo de entrada
- dar valor visível rapidamente

---

## 22. Dependências

### Dependências operacionais
- definição clara dos canais de entrada
- papel do filtro local (assistente/coordenação)
- estrutura mínima das unidades
- adesão do Rafinha e do Eduardo

### Dependências técnicas
- integração com a camada de comunicação interna do LA Organizer
- uso do agente Tom como camada de classificação e suporte
- persistência das ocorrências e da fila
- eventual ligação futura com estoque / LA Report, se fizer sentido

---

## 23. Decisão final

O caso do Rafinha valida a seguinte decisão estratégica:

# O módulo Operações Técnicas deve nascer dentro do LA Organizer.

Não como sistema separado.

Ele é um caso-modelo ideal porque concentra exatamente as dores que o LA Organizer quer resolver em escala organizacional:
- comunicação ruim
- fila invisível
- operação improvisada
- falta de previsibilidade
- falta de governança de execução

---

## 24. Próximos passos recomendados

1. revisar este PRD com o Alf
2. validar o nome final do módulo
3. validar o fluxo de entrada real por canal
4. escolher o escopo exato do MVP 1
5. transformar os wireframes conceituais em especificação de interface
6. alinhar implementação com o time do LA Organizer
