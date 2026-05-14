# Skill de Ajuda + Ativação do Briefing Pessoal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a skill `ajuda.md` que serve como guia conversacional de tudo que o TOM pode fazer (personalizado por cargo), e ativar o ritual de briefing pessoal automático que hoje só roda manualmente.

**Architecture:** Skill carregada pelo engine quando usuário pede ajuda/explicação. Dispatcher recebe flag para rodar `briefing_pessoal` automaticamente no horário `personal_briefing_time` configurado pelo usuário.

**Tech Stack:** Markdown (skill TOM), Node.js (dispatcher.js), sem mudanças no banco ou PWA.

---

## Contexto do sistema atual

### O que já existe e é relevante

| Componente | Estado |
|---|---|
| `skills/onboarding.md` | ✅ 5 perguntas de preferência |
| `src/rituals/dispatcher.js` | ✅ 6 rituais — briefing_trabalho, briefing_pessoal (desativado auto), fechamento, planejamento_semanal, retrospectiva_semanal, resumo_time |
| `user_preferences.personal_briefing_time` | ✅ Existe no banco (padrão: 07:00) |
| Skills existentes (16) | ✅ rituais-diarios, planejamento-semanal, habitos-pessoais, priorizacao-inteligente, checklists-operacionais, aprovar-projeto, etc. |
| `engine.js` — detecção de skill por trigger | ✅ Analisa mensagem do usuário e carrega skill correspondente |

### O que não existe

- `skills/ajuda.md` — não existe
- Briefing pessoal automático — desativado, roda só com `--force`

---

## Sub-projeto C1: Ativação do Briefing Pessoal

### O que muda em `src/rituals/dispatcher.js`

O briefing pessoal já está implementado como ritual — só está sendo suprimido na lógica de disparo automático. A mudança: remover a supressão e deixar ele rodar no horário `personal_briefing_time` de cada usuário, todos os dias (inclusive fins de semana — vida pessoal não tem dia útil).

**Comportamento após ativação:**
- Dispara todo dia em `user_preferences.personal_briefing_time` (padrão: 07:00)
- Roda independente do briefing de trabalho (que roda em horário separado)
- Se `personal_briefing_time` for igual ao `briefing_time`, os dois rodam juntos (OK — são contextos diferentes)
- Só roda se usuário tem `onboarding_completed = true` (mesmo critério do briefing de trabalho)

**Arquivo modificado:**
- `src/rituals/dispatcher.js` — remover supressão do `briefing_pessoal` no loop de disparo automático

---

## Sub-projeto C2: Skill de Ajuda

### Triggers de ativação

O engine detecta a skill `ajuda` quando o usuário envia mensagens contendo (case-insensitive):
- "como você funciona"
- "o que você pode fazer"
- "o que você faz"
- "me ajuda" (isolado ou seguido de "?" — NÃO dispara quando seguido de ação: "me ajuda a criar tarefa X" deve criar a tarefa, não abrir o menu de ajuda)
- "comandos"
- "funcionalidades"
- "o que tem aqui"
- "como te uso"
- "como usar"
- "me explica"
- "menu"

**Onde fica a detecção:** `src/engine.js` — bloco de seleção de skill por trigger, antes das skills de contexto.

### Conteúdo da skill `skills/ajuda.md`

A skill segue as regras do TOM: máx 3-4 linhas por mensagem, informal brasileiro, uma pergunta por vez. A conversa é multi-turn — TOM não despeja tudo de uma vez.

#### Abertura (sempre igual, qualquer cargo)

```
👽 Posso te ajudar de várias formas, [nome]! Tenho três áreas:

📅 *Rituais* — briefing, fechamento, planejamento semanal
✅ *Trabalho* — tarefas, projetos, checklists, follow-ups
💪 *Pessoal* — hábitos, agenda particular, organização

Quer saber mais sobre qual?
```

#### Se usuário responder "rituais" (ou similar)

```
📅 *Meus rituais diários:*

☀️ *Briefing matinal* — toda manhã te mando um resumo do dia (tarefa, compromissos, hábitos)
🌙 *Fechamento* — no fim do dia, vejo o que ficou pendente contigo
📊 *Planejamento semanal* — uma vez por semana a gente para e planeja juntos
🔍 *Retrospectiva* — reviso o que aconteceu na semana anterior

Tudo isso no horário que você configura nas Configurações do app. Quer ajustar os horários?
```

#### Se usuário responder "trabalho" (ou similar)

Resposta varia por cargo — engine injeta `function_title` e `role` no contexto:

**Para Hunter / Farmer:**
```
✅ *No trabalho, posso te ajudar com:*

• "cria tarefa X pra sexta" → registro e te cobro
• "o que tenho hoje?" → resumo do dia
• "o que ficou pendente?" → tarefas atrasadas
• "cria projeto Y" → projeto com checkpoints
• "como tá meu pipeline?" → resumo de follow-ups

Pede do jeito que você falar — entendo linguagem natural 😉
```

**Para Professor / Assistente Pedagógico:**
```
✅ *No trabalho, posso te ajudar com:*

• "o que tenho hoje?" → agenda de aulas + tarefas
• "cria tarefa X" → registro com prazo
• "o que tá atrasado?" → pendências do dia
• "abre checklist de abertura" → checklists operacionais
• "como foi minha semana?" → retrospectiva pedagógica

Pede do jeito que você falar — entendo linguagem natural 😉
```

**Para Gerente / Coordenador / Diretor:**
```
✅ *No trabalho, posso te ajudar com:*

• "o que tenho hoje?" → agenda + tarefas + time
• "como tá o time?" → resumo da equipe
• "cria projeto X" → projeto com 5W2H
• "aprova projeto Y" → fluxo de aprovação
• "o que tá atrasado?" → pendências da equipe

Pede do jeito que você falar — entendo linguagem natural 😉
```

**Fallback (Financeiro / RH / cargo não mapeado):**
```
✅ *No trabalho, posso te ajudar com:*

• "cria tarefa X pra sexta" → registro e te cobro
• "o que tenho hoje?" → resumo do dia
• "o que ficou pendente?" → pendências em aberto
• "cria projeto Y" → projeto com checkpoints
• "como foi minha semana?" → retrospectiva semanal

Pede do jeito que você falar — entendo linguagem natural 😉
```

#### Se usuário responder "pessoal" (ou similar)

```
💪 *Na vida pessoal, posso te ajudar com:*

• "quero criar o hábito de X" → registro e acompanhamento diário
• "me lembra de Y amanhã às 10h" → lembrete pessoal
• "como foram meus hábitos essa semana?" → retrospectiva pessoal
• "anota que prefiro reuniões às 15h" → memória pessoal
• "o que tenho no pessoal hoje?" → agenda pessoal

O que é pessoal fica só entre a gente 🤐
```

#### Mensagem de coaching (após qualquer resposta de área)

Toda resposta de área termina com uma frase de incentivo rotativa — a skill define um pool de frases e o TOM escolhe uma contextualmente:

```
Pool de frases de coaching (TOM escolhe uma):
- "Quanto mais você me usa, mais fácil fica organizar a cabeça. Bora tentar? 💪"
- "O segredo é consistência — manda uma mensagem por dia e você já vai sentir diferença 🎯"
- "Não precisa ser perfeito. Começa pequeno e a gente vai ajustando juntos 🚀"
- "Tô aqui todo dia. Pode contar comigo, [nome] 👽"
```

### Arquivos

| Arquivo | Ação |
|---|---|
| `skills/ajuda.md` | **Criar** — conteúdo completo da skill |
| `src/engine.js` | **Modificar** — adicionar bloco de detecção de triggers da skill ajuda |

---

## Fora de escopo

- Skill de ajuda no PWA (painel de ajuda visual) — spec separada se necessário
- Ajuda contextual por feature específica (ex: "como aprovar um projeto?") — skill existente `aprovar-projeto.md` já cobre
- Personalização de frases de coaching por intensidade (light/normal/hard) — refinamento futuro

---

## Arquivos impactados (resumo)

| Arquivo | Ação |
|---|---|
| `skills/ajuda.md` | Criar |
| `src/engine.js` | Modificar — detectar triggers de ajuda |
| `src/rituals/dispatcher.js` | Modificar — ativar briefing pessoal automático |
