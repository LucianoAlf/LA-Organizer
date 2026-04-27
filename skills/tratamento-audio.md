---
name: tratamento-audio
description: Skill para interpretar mensagens de voz do colaborador, confirmar entendimento e só então encaminhar a ação correta. Use quando o colaborador enviar áudio via WhatsApp.
---

# Tratamento de Áudio

## Quando ativar
Ative esta skill quando o colaborador enviar uma mensagem de voz via WhatsApp.

Se a entrada não for áudio, NÃO use esta skill.

---

## Regra central
Áudio nunca vira ação automática direto.

O fluxo correto é:
1. transcrever
2. interpretar
3. resumir o entendimento
4. confirmar com o colaborador
5. só depois executar a ação correspondente

---

## Sobre markers
Esta skill **normalmente não emite marker próprio**.

Ela interpreta e confirma. A action final — `complete`, `reschedule`, `create`, etc. — deve ser emitida pelo fluxo correspondente (`checklist-tarefas`) após a confirmação do colaborador.

---

## Subfluxos

### 1. Áudio simples com uma ação clara

**Exemplos comuns:**
- "fiz a entrevista do professor"
- "marca reunião com Juliana amanhã"
- "me lembra de pagar a conta"

```text
Entendi: *Entrevista do professor* — feito ✅.

Certo?
```

**Regra:** se houver uma ação clara e única, confirme de forma curta. Não execute antes do "sim" do colaborador.

---

### 2. Áudio com múltiplas ações

**Exemplo:** colaborador conclui uma coisa, reagenda outra e dá contexto adicional no mesmo áudio.

```text
Entendi do áudio:

• ✅ Entrevista do professor — feita
• 🗓️ Material teatro — pra quinta
• 📝 Reunião com pai de aluno tomou a tarde

Tá certo isso?
```

**Regras:**
- listar na ordem em que o colaborador falou
- separar ação de contexto
- não exagerar no tamanho

---

### 3. Áudio ambíguo

**Exemplos comuns:**
- "tô vendo aquela parada lá do Renan"
- "acho que foi aquilo mesmo"
- "depois eu resolvo isso"

```text
Não ficou claro pra mim.

Você tá falando de *ligar pro Renan* ou *revisar o material do Renan*?
```

**Regras:**
- fazer uma pergunta curta
- nunca chutar a intenção
- não emitir action enquanto houver ambiguidade

---

### 4. Áudio com transcrição ruim ou incompleta

```text
Não consegui entender bem esse áudio.

Se puder, me manda de novo — pode ser em texto também.
```

**Regras:**
- não fingir entendimento
- oferecer saída simples
- não constranger o colaborador

---

### 5. Áudio que traz só contexto, sem ação

**Exemplos:** desabafo breve, explicação do dia, justificativa sem pedido objetivo.

```text
Entendi.

Valeu por me contextualizar.
```

**Regra:** se não houver ação, não invente uma. Contexto pode servir para a próxima resposta, mas não deve virar execução automática.

---

## Confirmação antes de agir

Só execute algo depois de sinais como:
- "sim", "isso", "certo", "isso mesmo", "é isso"

Se o colaborador corrigir, ajuste o entendimento e confirme de novo:

```text
Entendi então assim:

• ✅ Entrevista do professor — feita ontem
• 🗓️ Material teatro — ficou pra quinta

Agora sim tá certo?
```

---

## Handoff: emita o marker DIRETO ao confirmar

Depois do colaborador confirmar (`sim`, `isso mesmo`, `certo`), você emite o marker apropriado **na mesma resposta** que confirma a ação. Use os IDs `[id=XXXXXXXX]` que aparecem no contexto do system prompt em **Tarefas pendentes**.

### Marker para tarefa concluída

```text
✅ Fechado: *Entrevista do professor*.

<<TASK_UPDATE>>
[{"action":"complete","id":"<8-char>"}]
<<END>>
```

### Marker para reagendamento

```text
🗓️ Movido: *Material teatro* — pra quinta (30/04).

<<TASK_UPDATE>>
[{"action":"reschedule","id":"<8-char>","new_due_date":"2026-04-30"}]
<<END>>
```

### Marker para criação de tarefa nova

```text
✅ Anotado: *Ligar pro pai do aluno*.

<<TASK_UPDATE>>
[{"action":"create","title":"Ligar pro pai do aluno","context":"work","due_date":"2026-04-30","priority":"medium"}]
<<END>>
```

### Marker para múltiplas ações

```text
✅ Feito:
• Entrevista do professor — concluída
• Material teatro — pra quinta

<<TASK_UPDATE>>
[
  {"action":"complete","id":"ab12cd34"},
  {"action":"reschedule","id":"ef56gh78","new_due_date":"2026-04-30"}
]
<<END>>
```

### Veto crítico do handoff
- NUNCA invente que "tô sem acesso ao banco" — se a tarefa estiver no contexto, EMITA o marker.
- NUNCA mostre o ID `[id=...]` na parte visível — só dentro do bloco `<<TASK_UPDATE>>`.
- Se a tarefa exata não aparece em **Tarefas pendentes** e ela é uma criação nova, use `action: "create"`.

---

## Tolerância a erro de transcrição

Aceite como natural erros como:

| O que o sistema transcreveu | O que o colaborador quis dizer |
|---|---|
| "Open Claw" | OpenClaw |
| "clã de ferro" | Claude Code |
| "L.A." | LA Music |
| "é o muses" / "e-muses" | Emusys |
| "tom" | TOM |

Use o contexto da conversa para interpretar melhor.

---

## Regras de linguagem
- tom curto, leve e natural
- sem mostrar a transcrição bruta
- sem parecer robô de transcrição
- confirmar entendimento em linguagem humana
- se errar, corrigir sem drama

---

## Veto — nunca
- nunca presumir que entendeu 100%
- nunca agir com base em áudio sem confirmação
- nunca mostrar a transcrição bruta pro colaborador
- nunca guardar o arquivo de áudio como memória de longo prazo
- nunca inventar intenção quando o áudio estiver ambíguo
- nunca ignorar um áudio — se não entender, pedir repetição
- nunca emitir marker de ação antes da confirmação do colaborador
