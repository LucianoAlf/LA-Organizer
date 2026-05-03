# PRD / Spec-Base — Sprint 17: Active Coordination Context (ACC)

> Documento-base da próxima evolução cognitiva do TOM na camada de Coordenação Conversacional.
> Objetivo: corrigir a fragilidade de contexto observada na Sprint 16 sem transformar a solução em remendo de prompt. O foco da Sprint 17 é criar um subsistema explícito de contexto ativo de coordenação.

---

## 1. Tese da Sprint 17

A Sprint 16 provou que a Coordenação Conversacional via TOM funciona como feature. Mas a validação real mostrou uma limitação cognitiva central:

**O TOM ainda não sustenta bem o foco conversacional quando há múltiplos requests ativos.**

A Sprint 17 existe para resolver isso.

---

## 2. Problema

O TOM coordena com inteligência conversacional frágil:
- perde referente anafórico
- mistura threads paralelas
- não sabe qual request é o foco dominante
- pergunta demais quando poderia inferir
- fecha parcialmente loops de mediação

O TOM não precisa de mais "memória geral". Precisa de:

**Contexto Ativo de Coordenação** — representação pequena, priorizada e útil dos requests que importam naquele momento.

---

## 3. Active Coordination Context (ACC)

Subsistema que identifica, prioriza e injeta no prompt o conjunto mínimo de contexto para resolver:
- pronomes
- referência implícita
- foco dominante
- último ator relevante
- múltiplos requests abertos
- última resposta recebida

### O que o ACC NÃO é
- não é memória longa
- não é histórico completo
- não é dump de todos os coordination_requests
- não é prompt maior "pra ver se melhora"

---

## 4. Princípio central

**O ACC não deve maximizar contexto. Deve maximizar foco.**

Selecionar pouco, ordenar bem, apontar candidato dominante, só pedir confirmação quando confiança for baixa.

---

## 5. Estrutura do ACC

```text
[ACTIVE_COORDINATION_CONTEXT]
- Último request criado por você: {id_short} | recipient={name} | "{preview}" | há {min}min
- Último request onde você é recipient: {id_short} | from={name} | "{preview}" | há {min}min
- Última resposta recebida: {id_short} | de={name} | "{summary}" | há {min}min
- Requests abertos (sent/awaiting_response):
  • {id_short} ↔ {name} | mode={mode} | "{preview}"

FOCUS_CANDIDATE: req {id_short} | actor={name} | reason={razão}
FOCUS_CONFIDENCE: high | medium | low
```

---

## 6. FOCUS_CANDIDATE

Indica ao modelo qual request é o centro mais provável da próxima fala do usuário.

Exemplo: `FOCUS_CANDIDATE: req ab12 | actor=Rafinha | reason=última resposta recebida`

---

## 7. FOCUS_CONFIDENCE

Define estratégia de resposta:
- **high** → resolver sem perguntar
- **medium** → resolver com linguagem cautelosa
- **low** → perguntar citando candidatos

---

## 8. Heurísticas de resolução

### Pronomes
- `ele/ela/esse/aquele` → último ator do FOCUS_CANDIDATE

### Comandos elípticos
- `manda/confirma/autorizado/responde` sem objeto → request mais recente e relevante

### Agradecimento
- `agradece` → último ator de quem recebeu resposta

### Dúvida legítima
- Múltiplos candidatos com relevância próxima → perguntar citando nomes

---

## 9. Ranking de relevância

1. Última resposta recebida (peso mais alto)
2. Último request explicitamente mencionado ou recém-criado
3. Último request aberto criado pelo usuário
4. Último request onde o interlocutor atual é recipient
5. Demais requests abertos recentes

---

## 10. Defense in depth (engine)

Engine deve stripar prefixos de origem duplicados no message_body antes de montar cabeçalho final. Não confiar apenas na skill.

---

## 11. Confirmação contextual

### Sempre perguntar
- relay_literal sem texto literal claro
- destinatário ambíguo
- request sem actor identificável

### Perguntar se ambíguo
- relay vs followup não está claro
- 2+ candidatos com confiança parecida

### Não perguntar
- comando claro + objetivo claro + recipient claro

---

## 12. Temporal grounding

Âncora explícita obrigatória no system prompt:

```text
Hoje é {dia_semana}, {YYYY-MM-DD}.
Amanhã é {dia_semana_amanhã}, {YYYY-MM-DD}.
Esta semana: segunda {data}, terça {data}, ..., domingo {data}.
```

---

## 13. Problemas atacados

| Prioridade | Problema |
|---|---|
| P1 | Perda de referente anafórico |
| P1 | Ausência de thread dominante |
| P2 | Mistura de threads paralelas |
| P3 | Fechamento incompleto de loop |
| P3 | Over-clarification residual |
| P4 | Grounding temporal |

---

## 14. Arquitetura

1. **Seleção** — buscar coordination_requests mais relevantes
2. **Ranking** — aplicar heurística de foco dominante
3. **Compactação** — gerar ACC curto e estruturado
4. **Injeção** — adicionar ao system prompt (não ao histórico)
5. **Política de ação** — orientar quando resolver vs perguntar

---

## 15. Fora do escopo

- Sem nova tabela
- Sem PWA
- Sem read receipts
- Sem novos modos de mediação
- Sem expansão de departamentos
- Sem reescrita da Sprint 16

Sprint de inteligência conversacional aplicada, não de expansão funcional.

---

## 16. Critérios de sucesso

1. TOM resolver pronomes corretamente na maioria dos casos
2. Múltiplos requests abertos sem confusão recorrente
3. Comandos elípticos funcionarem sem confirmação extra
4. Sem regressão de cabeçalho duplicado
5. Grounding temporal confiável

---

## 17. Critérios de fracasso

- ACC virar só prompt mais longo
- Continuar sem foco dominante
- Resolver pronomes chutando errado
- Pedir confirmação em excesso com contexto forte
- System prompt confuso e pesado sem ganho

---

## 18. Exemplos de comportamento desejado

### Cenário A
TOM: "Rafinha respondeu que vai verificar amanhã cedo."
Alf: "Agradece a ele por mim."
→ TOM entende "ele" = Rafinha e envia sem perguntar.

### Cenário B
Requests abertos com Anne e Rafinha.
Alf: "Diz que está autorizado."
→ Se foco claro: resolve. Se não: "Pra Anne ou pro Rafinha?"

### Cenário C
Alf: "fala com Anne sobre o briefing de amanhã"
→ TOM executa direto em relay_assisted, sem confirmação extra.

---

## 19. Frase-síntese

**A Sprint 16 provou que o TOM consegue coordenar.**
**A Sprint 17 deve provar que ele consegue sustentar foco conversacional com maturidade.**
