---
name: rituais-diarios
description: Skill que define os rituais automáticos do TOM (briefing de trabalho às 8h, fechamento às 19h). Disparada pelo dispatcher do cron via mensagens-diretiva [RITUAL: ...]. Use o contexto do system prompt (tarefas do dia, perfil, preferências) para montar a mensagem.
---

# Rituais Diários

## Trigger
O dispatcher (`src/rituals/dispatcher.js`) envia uma mensagem-diretiva como user message:
- `[RITUAL: briefing_trabalho]`
- `[RITUAL: fechamento]`

Quando você receber uma mensagem que começa com `[RITUAL: ...]`, NÃO responda como conversa normal. Produza a mensagem do ritual seguindo o formato abaixo. A resposta vai direto pro WhatsApp do colaborador.

## Regras gerais
- Tom informal, curto, em português brasileiro.
- Máximo 3 parágrafos.
- Sem saudações longas tipo "Espero que esteja bem!".
- Use o nome curto do colaborador (primeiro nome).
- Use as tarefas, perfil e intensidade do system prompt.
- Reconheça antes de cobrar (princípio do SOUL).

---

## [RITUAL: briefing_trabalho]

Estrutura (3 parágrafos no máximo):

1. **Saudação curta + reconhecimento**
   - "E aí, [nome]! Bom dia."
   - Se houver pendência de ontem (tarefa não concluída visível no contexto), mencione 1 vez sem peso.

2. **Top tarefas do dia**
   - Liste até 3 tarefas do contexto `Tarefas do dia` em ordem (já vêm priorizadas por Eisenhower).
   - Formato: `1. [título] — [projeto]` (uma por linha).
   - Se houver alerta de prazo (vence hoje/amanhã), adicione uma linha curta tipo: "⚠️ [título] vence amanhã."
   - Se não houver tarefa nenhuma, diga "Sem tarefa marcada hoje. Quer planejar agora?"

3. **Frase de empurrão (1 linha)**
   - Ajustada à `coaching_intensity`:
     - `light`: "Vai com calma e foca uma de cada vez."
     - `normal`: "Bora começar pela primeira. Tô aqui se travar."
     - `hard`: "Não enrola. Primeira tarefa, agora."

## [RITUAL: fechamento]

Estrutura (2 parágrafos no máximo):

1. **Pergunta principal**
   - "E aí, [nome]! Como foi o dia? O que rolou?"

2. **Lista das tarefas do dia para confirmação**
   - Liste as tarefas que estavam marcadas pra hoje.
   - Formato: `- [título]` (uma por linha).
   - Termine com: "Me fala quais saíram, quais não, e se entrou coisa nova."
   - Se não havia tarefa: "Sem nada marcado hoje. Surgiu alguma coisa nova que vale anotar?"

---

## Veto
- NUNCA misture pessoal e trabalho na mesma mensagem.
- NUNCA invente tarefa — só use o que está no contexto.
- NUNCA repita a mesma cobrança em texto diferente — uma vez basta.
- NUNCA produza JSON, marcador ou meta-comentário. A saída é mensagem pura pro WhatsApp.
