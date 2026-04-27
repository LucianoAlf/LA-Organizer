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
Esta skill normalmente não emite marker próprio.

Ela interpreta e confirma. Depois da confirmação, a resposta final deve seguir o fluxo da skill correspondente — normalmente `checklist-tarefas` — e emitir o marker adequado (`<<TASK_UPDATE>>`) quando houver ação de tarefa.

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

## Execução após confirmação

Depois que o colaborador confirmar o entendimento, a resposta final deve seguir o fluxo correspondente e emitir o marker de tarefa quando aplicável.

### Exemplo 1 — concluir tarefa
Se o áudio foi:
> "fiz a entrevista do professor"

Depois do "sim", responder:

```text
✅ Fechado: *Entrevista do professor*.

<<TASK_UPDATE>>
[{"action":"complete","id":"abc12345"}]
<<END>>
```

### Exemplo 2 — reagendar tarefa
Se o áudio foi:
> "o material do teatro fica pra quinta"

Depois do "sim", responder:

```text
🗓️ Movido: *Material teatro* — pra quinta.

<<TASK_UPDATE>>
[{"action":"reschedule","id":"def67890","new_due_date":"2026-05-01"}]
<<END>>
```

### Exemplo 3 — criar tarefa
Se o áudio foi:
> "me lembra de pagar a conta amanhã"

Depois do "sim", responder:

```text
✅ Anotado!

🗓️ Amanhã te lembro de pagar a conta.

<<TASK_UPDATE>>
[{"action":"create","title":"Pagar conta","context":"personal","due_date":"2026-04-28","priority":"medium"}]
<<END>>
```

### Regra
- confirmação primeiro
- marker depois
- nunca emitir marker estrutural antes da validação do colaborador
- quando a ação for tarefa, seguir o contrato da `checklist-tarefas`

---

## Handoff para outras skills

Depois da confirmação, a execução segue o fluxo apropriado:

- tarefa concluída → `checklist-tarefas` (`complete`)
- reagendamento → `checklist-tarefas` (`reschedule`)
- criação de tarefa → `checklist-tarefas` (`create`)
- contexto relevante → memória, se fizer sentido

---

## Tolerância a erro de transcrição

| O que o sistema transcreveu | O que o colaborador quis dizer |
|---|---|
| "Open Claw" | OpenClaw |
| "clã de ferro" | Claude Code |
| "L.A." | LA Music |
| "é o muses" / "e-muses" | Emusys |
| "tom" | TOM |

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
