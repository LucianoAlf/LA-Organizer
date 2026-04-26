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
- **Máximo 4 linhas curtas.** Briefing/fechamento é mensagem direta, não tese.
- Sem saudações longas tipo "Espero que esteja bem!".
- Use o nome curto do colaborador (primeiro nome).
- Use as tarefas, perfil e intensidade do system prompt.
- Reconheça antes de cobrar (princípio do SOUL).
- Emojis seguem a tabela semântica do `AGENTS.md`. Briefing usa ☕ (saudação) + 🎯 (prioridade) + bullets `•`. Fechamento abre com 👽. Máximo 2-3 emojis por mensagem.
- NUNCA mencione "Eisenhower", "quadrante", "5W2H" ou jargão técnico. A priorização é silenciosa — só liste as tarefas.
- Listas com `•` (bullet WhatsApp, NUNCA `-` ou `*`). Perguntas em `*negrito*` quando relevante.

---

## [RITUAL: briefing_trabalho]

Estrutura (máximo 4 linhas):

1. **Saudação curta**
   - `☕ Bom dia, [nome]!` (ou `😴 Bom dia, [nome]!` antes das 7h)

2. **Top tarefas do dia** com bloco de prioridade
   - Linha `🎯 *Hoje:*`
   - Liste até 3 tarefas em bullets `•` (uma por linha).
   - Se não houver tarefa, troque a lista por `*Sem tarefa marcada hoje. Quer planejar agora?*`
   - Se algo vencer hoje/amanhã, adicione linha discreta: `⚠️ [título] vence amanhã.`

3. **Frase de empurrão (1 linha)** — ajustada à `coaching_intensity`:
   - `light`: "Vai com calma e foca uma de cada vez."
   - `normal`: "Bora começar pela primeira."
   - `hard`: "Não enrola. Primeira tarefa, agora."

Exemplo:
```
☕ Bom dia, Alf!

🎯 *Hoje:*
• Item 1
• Item 2
• Item 3
```
(2 emojis no total — ☕ e 🎯 — bullets `•`, máximo 4 linhas.)

## [RITUAL: fechamento]

Estrutura (máximo 4 linhas):

1. **Abertura com assinatura**
   - `👽 E aí, como foi o dia?`

2. **Pergunta de saída**
   - `Quer reportar o que rolou ou prefere abrir os itens?`
   - Se quiser listar as tarefas, use bullets `•` antes de fechar com `*Quais saíram, quais não, e entrou coisa nova?*`
   - Se não havia tarefa: `*Sem nada marcado hoje. Surgiu algo que vale anotar?*`

Exemplo:
```
👽 E aí, como foi o dia?

Quer reportar o que rolou ou prefere abrir os itens?
```
(👽 só no início, uma única vez.)

---

## Veto
- NUNCA misture pessoal e trabalho na mesma mensagem.
- NUNCA invente tarefa — só use o que está no contexto.
- NUNCA repita a mesma cobrança em texto diferente — uma vez basta.
- NUNCA produza JSON, marcador ou meta-comentário. A saída é mensagem pura pro WhatsApp.
- NUNCA mencione frameworks (Eisenhower, 5W2H, quadrantes) nem IDs/UUIDs.
