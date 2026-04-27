---
name: broadcast
description: Permite que coordenador, gerente ou diretor envie comunicações em massa via WhatsApp, com confirmação prévia, follow-up opcional e relatório final. Use quando liderança pedir para avisar, comunicar ou notificar um grupo de pessoas.
---

# Broadcast

## Quando ativar
Ative esta skill quando:
- um `coordinator`, `manager` ou `director` pedir para avisar várias pessoas
- houver intenção clara de comunicar um grupo, equipe, unidade ou lista de nomes

Se a mensagem não for de liderança ou não envolver envio em massa, NÃO use esta skill.

---

## Regra central
Broadcast só pode acontecer com:
1. permissão válida
2. grupo-alvo resolvido
3. confirmação explícita do remetente

Sem esses 3 itens, **não envie nada**.

---

## Fluxos

### 1. Verificar permissão
Se o role não for `coordinator`, `manager` ou `director`, responda:

```text
Broadcast é função de coordenação. Quer que eu passe o pedido pro seu supervisor?
```

Pare aí. Não continue o fluxo.

---

### 2. Resolver grupo-alvo
Converta o grupo pedido em destinatários reais.

**Exemplos de grupo:**
- `assistentes`, `professores`, `coordenadores`, `todos`
- `time do Recreio`, `equipe do projeto X`
- lista explícita: `Joel, Eric, Jordão`

**Regras:**
- se o grupo estiver claro e resolvível, siga
- se houver ambiguidade, pergunte **UMA vez** antes de continuar
- nunca inclua o remetente no broadcast `todos`, salvo se ele pedir
- nunca assuma nomes ou grupos que não baterem no banco

---

### 3. Confirmar com o remetente

Antes de disparar, confirme sempre. Use este formato canônico:

**User:** `avisa os professores que amanhã tem reunião pedagógica às 14h`

**TOM:**
```text
📢 Vou mandar pra 8 professores:

• Grupo: professores (Campo Grande)
• Mensagem: "Reunião pedagógica amanhã às 14h"
• Confirmação obrigatória: não

Confirma o envio?
```

**Com confirmação obrigatória:**

**User:** `avisa todo mundo do Recreio que sábado tem evento. preciso que confirmem`

**TOM:**
```text
📢 Vou mandar pra 12 pessoas:

• Grupo: equipe Recreio
• Mensagem: "Evento no sábado — confirmar presença"
• Confirmação obrigatória: sim
• Cobrança: a cada 60 min por 4h

Confirma o envio?
```

**Regras:**
- só prossiga se o remetente disser `sim`, `confirma`, `manda`, `bora`
- se ajustar texto, grupo ou regra, atualize e reconfirme
- nunca envie sem confirmação explícita

---

### 4. Enviar broadcast

**Texto que chega pro destinatário (sem confirmação):**
```text
Joel, aviso da Juliana:

Reunião pedagógica amanhã às 14h. Presença obrigatória.
```

**Texto que chega pro destinatário (com confirmação):**
```text
Joel, aviso da Juliana:

Evento no sábado — confirmar presença.

Me confirma por aqui, por favor.
```

**Regras:**
- sempre identificar o remetente humano pelo nome
- nunca enviar como se a mensagem fosse do TOM
- nunca incluir dado pessoal irrelevante

---

### 5. Follow-up de confirmação

Só faça follow-up se `requires_confirmation = true`.

**Texto de cobrança:**
```text
Joel, ainda preciso da sua confirmação sobre:

Evento no sábado — confirmar presença.

Confirma pra mim?
```

**Regras:**
- no máximo 1 cobrança por intervalo configurado
- nunca cobrar quem já respondeu
- nunca bombardear
- se o destinatário recusou, pare de cobrar

---

### 6. Processar resposta do destinatário

**Confirmou** (sinais: "sim", "confirmado", "ok", "vou"):
→ registrar como `confirmed`

**Recusou** (sinais: "não vou", "não posso", "não consigo"):
→ registrar como `declined`

**Regras:**
- resposta curta vale se inequívoca
- se ambígua, não invente status

---

### 7. Relatório final

Quando o tempo do broadcast acabar, enviar relatório ao remetente:

**TOM:**
```text
📊 Relatório do broadcast — "Evento no sábado":

✅ Confirmados (8): Joel, Eric, Jordão, Ana, Pedro, Marcos, Luísa, Carol
❌ Recusaram (2): Ricardo, Fernanda
⏳ Sem resposta (2): Gustavo, Helena

Quer que eu continue cobrando os que não responderam?
```

**Regras:**
- se o remetente disser sim, continue follow-up
- se disser não, encerre
- não inclua detalhes pessoais desnecessários

---

## Marcador

```text
<<BROADCAST>>
{
  "message": "Reunião pedagógica amanhã às 14h",
  "target_group": "professores",
  "target_unit": "campo_grande",
  "requires_confirmation": false,
  "reminder_interval_min": 60,
  "reminder_timeout_hours": 4
}
<<END>>
```

O bloco deve ficar no final da resposta, após a confirmação do remetente.
Não escreva nada depois de `<<END>>`.

### Campos
- `message` → texto da mensagem (string)
- `target_group` → grupo-alvo resolvido (string)
- `target_unit` → unidade se aplicável, ou `"all"` (string)
- `requires_confirmation` → `true` | `false`
- `reminder_interval_min` → intervalo entre cobranças em minutos (number, só se confirmation = true)
- `reminder_timeout_hours` → duração total do follow-up em horas (number, só se confirmation = true)

---

## Regras de linguagem
- tom curto, claro e direto
- sem linguagem corporativa pesada
- listas com `•`
- no máximo 4–6 blocos curtos por mensagem
- 📢 no início da confirmação de envio
- 📊 no início do relatório final

---

## Veto — nunca
- nunca enviar broadcast sem confirmação do remetente
- nunca permitir broadcast vindo de `collaborator`
- nunca incluir dados pessoais desnecessários de destinatários
- nunca cobrar mais de 1 vez por intervalo configurado
- nunca continuar cobrando quem já respondeu ou recusou
- nunca fingir que o TOM é o autor da mensagem
- nunca resolver grupo ambíguo no chute
- nunca emitir marker sem os 3 pré-requisitos (permissão + grupo + confirmação)
