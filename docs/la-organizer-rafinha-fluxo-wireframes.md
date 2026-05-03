# LA Organizer — Operações Técnicas (Rafinha)
## Fluxo operacional + wireframes conceituais

> Documento derivado do discovery do módulo do Rafinha.
> Objetivo: transformar a visão conceitual em fluxo prático de operação e wireframes de MVP.

---

# 1. Objetivo do módulo

Organizar a operação técnica da LA Music sem depender da cabeça do Rafinha.

O módulo precisa:
- estruturar entrada de demanda
- classificar o tipo de problema
- manter fila viva
- criar cadência preventiva
- sustentar aprovações e compras
- registrar fechamento
- dar visibilidade executiva sem microgestão

---

# 2. Atores do fluxo

## Atores principais
- **Professor / ponta operacional**
- **Assistente pedagógico / coordenação da unidade**
- **Rafinha**
- **Eduardo**
- **Gerente da unidade**
- **Alf**
- **Tom (agente)**

---

# 3. Tipos de demanda

O fluxo precisa começar distinguindo o tipo de demanda.

## Tipos principais
1. **Incidente técnico**
2. **Reposição / estoque**
3. **Apoio técnico / montagem**
4. **Obra / melhoria / infraestrutura**
5. **Preventivo / auditoria**

---

# 4. Fluxo operacional do módulo

## FLUXO 1 — Entrada de demanda

### Situação atual
Pedido chega por grupo, áudio, foto, vídeo, conversa solta.

### Fluxo futuro
1. Professor / unidade detecta problema
2. Demanda é registrada no canal correto
3. Tom força estrutura mínima
4. Demanda entra no LA Organizer
5. Sistema classifica e manda para fila certa

### Campos mínimos da demanda
- unidade
- sala
- categoria
- item
- urgência percebida
- impacto na aula
- foto/vídeo
- quem sinalizou
- observação livre

---

## FLUXO 2 — Triagem / filtro

### Regra
Nem tudo cai direto no Rafinha cru.

### Fluxo
1. Pedido chega
2. Coordenação / assistente pedagógico valida quando necessário
3. Tom classifica a natureza da demanda
4. Sistema define fila:
   - incidente
   - reposição
   - preventivo
   - apoio técnico
   - obra
   - compra / fornecedor

### Objetivo
Evitar que professor jogue qualquer coisa diretamente como urgência operacional.

---

## FLUXO 3 — Execução

### Fluxo
1. Rafinha abre a fila do dia
2. Vê o que é:
   - urgente
   - hoje
   - esta semana
   - aguardando compra
   - aguardando fornecedor
3. Decide se:
   - ele executa
   - delega para Eduardo
   - sobe para aprovação
   - agenda visita à unidade
4. Marca andamento

### Regra de distribuição
- **Rafinha** = decisão técnica, compra, fornecedor, problemas sensíveis
- **Eduardo** = apoio operacional, organização de sala, transporte, carga, execução simples

---

## FLUXO 4 — Compra / aprovação

### Fluxo
1. Demanda exige compra
2. Sistema mostra:
   - item
   - valor estimado
   - unidade
   - urgência
   - impacto
3. Se estiver abaixo da alçada configurada → compra direta
4. Se estiver acima → sobe para Alf
5. Compra aprovada entra em:
   - comprado
   - aguardando entrega
   - entregue
   - instalado / resolvido

### Regra inicial sugerida
- acima de R$ 300 sobe para aprovação explícita

---

## FLUXO 5 — Fornecedor / terceiro

### Fluxo
1. Problema depende de terceiro
2. Item vai para coluna/status `aguardando fornecedor`
3. Sistema registra:
   - fornecedor
   - data do último contato
   - previsão
4. Tom lembra quando está parado demais
5. Rafinha reativa

### Objetivo
Evitar que pendência externa suma da cabeça.

---

## FLUXO 6 — Checklist de sala com consequência

### Fluxo
1. No final do dia, unidade faz checklist da sala
2. Se tudo estiver ok → sala fecha verde
3. Se houver problema → sistema pergunta:
   - o que faltou?
   - item saiu da sala?
   - está quebrado?
   - impacta aula?
4. Isso gera ocorrência estruturada
5. Ocorrência entra na fila certa

### Objetivo
Transformar checklist em motor operacional, não ritual vazio.

---

## FLUXO 7 — Ritual semanal do Rafinha

### Frequência
Semanal, curto, 10–15 min

### Participantes
- Rafinha
- assistente pedagógico / coordenação da unidade
- eventualmente gerente
- Tom como suporte do fluxo

### Perguntas mínimas do ritual
- falta algo crítico?
- o que entrou em risco essa semana?
- o que precisa comprar?
- o que ficou parado?
- qual unidade está mais crítica?
- o que precisa ser resolvido antes de virar urgência?

### Saída do ritual
- lista da semana
- compras pendentes
- visitas necessárias
- itens preventivos
- alertas por unidade

---

## FLUXO 8 — Fechamento de ciclo

### Fluxo
1. Problema foi resolvido
2. Rafinha / Eduardo marcam como resolvido
3. Sistema notifica:
   - coordenação
   - assistente pedagógico
   - gerente
   - unidade envolvida
4. Item vira histórico
5. Se recorrente, sistema aprende que é um ponto crítico

---

# 5. Estrutura de status sugerida

## Status da demanda
- **Novo**
- **Triado**
- **Em execução**
- **Aguardando compra**
- **Aguardando fornecedor**
- **Resolvido**
- **Validado**

## Etiquetas de criticidade
- 🔴 Crítico
- 🟠 Alto
- 🟡 Médio
- 🟢 Baixo

## Natureza
- manutenção
- reposição
- apoio técnico
- obra
- preventivo
- inventário

---

# 6. Wireframes conceituais

## Wireframe 1 — Inbox / fila do Rafinha

```text
┌──────────────────────────────────────────────────────────────┐
│ OPERACOES TECNICAS — FILA DO DIA                            │
├──────────────────────────────────────────────────────────────┤
│ Filtros: [Unidade] [Tipo] [Urgência] [Status] [Responsável] │
├──────────────────────────────────────────────────────────────┤
│ 🔴 Recreio | Cabo guitarra ruim | Em execução               │
│ 🟠 Campo Grande | Luz de emergência | Aguardando compra     │
│ 🟡 Barra | Falta cadeira sala 3 | Triado                    │
│ 🟡 Recreio | Estoque de baqueta baixo | Novo                │
│ 🟢 Campo Grande | Revisão semanal de salas | Preventivo     │
└──────────────────────────────────────────────────────────────┘
```

---

## Wireframe 2 — Card da demanda

```text
┌──────────────────────────────────────────────────────┐
│ CABO DE GUITARRA RUIM — RECREIO                     │
├──────────────────────────────────────────────────────┤
│ Unidade: Recreio                                    │
│ Sala: 2                                             │
│ Tipo: Incidente técnico                             │
│ Criticidade: Alta                                   │
│ Impacta aula: Sim                                   │
│ Responsável: Rafinha                                │
│ Apoio: Eduardo                                      │
│ Status: Em execução                                 │
├──────────────────────────────────────────────────────┤
│ Origem                                              │
│ Professor sinalizou no checklist/foto               │
├──────────────────────────────────────────────────────┤
│ Próxima ação                                        │
│ Substituir cabo ainda hoje                          │
├──────────────────────────────────────────────────────┤
│ Timeline                                            │
│ [11:02] Demanda criada                              │
│ [11:08] Tom classificou                             │
│ [11:15] Rafinha assumiu                             │
└──────────────────────────────────────────────────────┘
```

---

## Wireframe 3 — Painel por unidade

```text
┌──────────────────────────────────────────────────────────────┐
│ OPERACOES TECNICAS — VISAO POR UNIDADE                      │
├──────────────────────────────────────────────────────────────┤
│ Campo Grande                                                │
│ Pendências: 4 | Críticas: 1 | Estoque em risco: 2          │
│                                                              │
│ Recreio                                                      │
│ Pendências: 9 | Críticas: 3 | Estoque em risco: 4          │
│                                                              │
│ Barra                                                        │
│ Pendências: 3 | Críticas: 0 | Estoque em risco: 1          │
└──────────────────────────────────────────────────────────────┘
```

---

## Wireframe 4 — Checklist de sala

```text
┌──────────────────────────────────────────────────────┐
│ CHECKLIST DE SALA — RECREIO / SALA 2                │
├──────────────────────────────────────────────────────┤
│ [ ] Cadeiras completas                              │
│ [ ] Cabos ok                                        │
│ [ ] Instrumentos ok                                 │
│ [ ] Fonte ok                                        │
│ [ ] Microfone ok                                    │
│ [ ] Ar-condicionado desligado                       │
│ [ ] Sala organizada                                 │
├──────────────────────────────────────────────────────┤
│ Se algo falhar:                                     │
│ [Reportar ocorrência]                               │
└──────────────────────────────────────────────────────┘
```

---

## Wireframe 5 — Painel executivo do Alf

```text
┌──────────────────────────────────────────────────────────────┐
│ RESUMO EXECUTIVO — OPERACOES TECNICAS                      │
├──────────────────────────────────────────────────────────────┤
│ Unidade mais crítica: Recreio                              │
│ Pendências críticas abertas: 3                             │
│ Itens recorrentes: cabo, baqueta, cadeira                  │
│ Consumo da cota do mês: 62%                                │
│ Aguardando tua aprovação: 2 compras                        │
│ Aguardando fornecedor: 4 itens                             │
└──────────────────────────────────────────────────────────────┘
```

---

# 7. MVP recomendado

## MVP 1
- abertura estruturada de demanda
- fila do Rafinha
- classificação por tipo
- responsável
- status
- checklist de sala com geração de ocorrência
- visão por unidade

## MVP 2
- orçamento / cota
- aguardando compra / fornecedor
- alertas de item parado
- ritual semanal do Rafinha

## MVP 3
- inteligência de recorrência
- padrões por unidade
- itens mais problemáticos
- leitura executiva consolidada

---

# 8. Conclusão

O módulo do Rafinha dentro do LA Organizer deve nascer como:

## um sistema de coordenação operacional técnica

não só um quadro de tarefas.

Ele precisa conectar:
- comunicação
- fila
- manutenção
- inventário leve
- compra
- prevenção
- unidade
- governança

Esse é o caso-modelo ideal para provar que o LA Organizer consegue transformar caos operacional em fluxo assistido por agentes.
