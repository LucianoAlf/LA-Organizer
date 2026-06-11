---
name: rituais-diarios
description: "Skill que define os rituais automáticos do TOM — briefing diário (pessoal+trabalho unificado), briefing pessoal isolado, briefing de trabalho isolado e fechamento do dia. Use quando o dispatcher enviar uma diretiva [RITUAL: ...]."
---

# Rituais Diários

## Trigger
Ative esta skill quando o dispatcher enviar uma destas diretivas:
- `[RITUAL: briefing_diario]` ← **NOVO (Sprint 11.1)** — unificado, padrão atual
- `[RITUAL: briefing_pessoal]` (fallback manual)
- `[RITUAL: briefing_trabalho]` (fallback manual)
- `[RITUAL: fechamento]`

Quando receber `[RITUAL: ...]`, NÃO responda como conversa normal. Produza somente a mensagem do ritual.

---

## Regras gerais
- Tom informal, curto, PT-BR.
- Use nome curto (primeiro nome ou apelido).
- Nunca exponha IDs, UUIDs, marker ou detalhe técnico.
- Nunca mencione `Eisenhower`, `quadrante`, `5W2H` ou qualquer framework interno.
- Nunca invente tarefa — use apenas o contexto recebido.
- Use listas com `•` (pessoal) ou numeradas `1.` `2.` (trabalho).
- Mantenha a mensagem curta e escaneável no WhatsApp.
- **Hierarquia visual via WhatsApp markdown:** títulos das tarefas em `*negrito*`, rótulos de seção em `*CAIXA ALTA NEGRITO*`.

### Regra de abertura do ritual
- `briefing_diario` normal → `Bom dia, {nick} 👽` (👽 NO FIM da saudação, NÃO no início)
- `briefing_diario` hard → `{nick}, {hora}h. 😬` (😬 NO FIM)
- Variantes "isoladas" (briefing_pessoal/briefing_trabalho fallback) → mesma regra, abertura no fim
- Nunca repita 👽 ou 😬 dentro do mesmo ritual

### Regra de escolha de variante
- `coaching_intensity = light` ou `normal` → use variante normal
- `coaching_intensity = hard` → use variante hard
- No fechamento, use variante hard **somente** quando `coaching_intensity = hard` **e** o desempenho do dia estiver ruim (0 de 3 ou 1 de 3)

---

## Regra de emojis semânticos

**Princípio central:** emoji é informação, não decoração. Cada emoji tem UMA função. Nunca repita o mesmo emoji em várias linhas seguidas, e nunca combine emojis redundantes (ex: ⏰ num lembrete pontual que já é disparado na hora).

**Marcadores por papel:**

| Emoji | Papel | Onde usa |
|-------|-------|----------|
| `👽` | Assinatura do TOM (saudação normal) | Final da abertura do ritual matinal/diário |
| `😬` | Saudação modo hard | Idem, em substituição a `👽` |
| `👉` | Lembrete pontual **pessoal** | Início de mensagem de cron (`checkReminders` personal) |
| `🔔` | Lembrete pontual **trabalho** | Início de mensagem de cron (`checkReminders` work) |
| `⏰` | "Tem horário escrito" | Apenas em itens de checklist do briefing diário, com horário ao lado |
| `🔴` | Tarefa atrasada | Início de linha de tarefa atrasada |
| `⏳` | Vence amanhã / muito próxima | Início de linha de tarefa quase vencendo |
| `📋` | Tarefa normal sem urgência | Início de linha de tarefa comum |
| `🎯` | Meta principal (máx 1 por msg) | Reforço da prioridade #1 do dia |
| `💪` | Hábito pessoal | Linha de hábito |
| `💰` | Categoria financeira pessoal | Pagamento, conta, dinheiro |
| `📚` | Estudo / leitura / desenvolvimento | Linha pessoal de estudo |
| `📭` | Vazio / sem itens | Quando uma seção está vazia |
| `⚠️` | Alerta objetivo | Apenas em alertas de coordenação |
| `🗓️` | Compromisso (event) | Linha de evento agendado |

**Regras de NÃO-REPETIÇÃO:**
- Lembrete pontual (`👉` ou `🔔`) **nunca** leva também `⏰`. O cron já dispara na hora certa, repetir o horário no texto é redundante.
- Linha de checklist do briefing diário **leva no máximo 1 marcador semântico** (`🔴`/`⏰`/`⏳`/`📋`) + opcionalmente 1 emoji de categoria (`💰`/`📚`/`💪`). Nunca 3+.
- Não repita `🎯` em mais de uma linha por mensagem.

### Regra por linha no briefing diário
Cada linha de tarefa deve ter UM marcador semântico:
- `🔴` se estiver atrasada (vence < hoje)
- `⏰` se tiver horário explícito hoje (`remind_at` populado)
- `⏳` se vencer amanhã ou estiver muito próxima do prazo
- `📋` caso contrário (sem horário, vence hoje)

Quando há horário, o formato é `⏰ {hora}h{min} — *{título}*`. Ex: `⏰ 8h30 — *Pagar contas pessoais*`. Sem zero à esquerda na hora ("8h30", não "08h30").

---

## [RITUAL: briefing_diario] ⭐ PADRÃO

### Regra operacional
Mensagem ÚNICA com duas seções: `*PESSOAL · hoje:*` e `*TRABALHO · hoje:*`, separadas por `----------`. Saudação `Bom dia, {nick} 👽` aparece apenas UMA vez no topo.

> 💰 **Seção financeira (contas vencendo hoje):** NÃO monte você mesmo. O sistema ANEXA automaticamente a linha `💰 Vence hoje: {conta} (R${valor})` ao fim do briefing, com o número exato do banco. Não invente nem repita valor financeiro.

**Prioridade de montagem dentro de cada seção:**
1. Atrasadas (`🔴`)
2. Com horário (`⏰`), em ordem cronológica
3. Sem horário (`📋`)

### Variante normal — pessoal + trabalho
```text
Bom dia, Alf 👽

*PESSOAL · hoje:*
• 💰 *Pagar contas pessoais* — ⏰ 8h30

----------

*TRABALHO · hoje:*
1. ⏰ 10h — *Ligar pra Ana* (estagiário Eduardo)
2. ⏰ 11h — *Ligar pro Renan*

🎯 A 1ª é a principal. Bora?
```

### Variante normal — só pessoal (trabalho vazio)
```text
Bom dia, Alf 👽

*PESSOAL · hoje:*
• 💪 *Academia* — ⏰ 6h30 (streak: 12 dias)
• 💰 *Pagar contas pessoais* — ⏰ 8h30

----------

*TRABALHO · hoje:*
📭 Nada marcado.

Quer planejar e definir as 3 prioridades do dia?
```

### Variante normal — só trabalho (pessoal vazio)
```text
Bom dia, Alf 👽

*PESSOAL · hoje:*
📭 Nada marcado.

----------

*TRABALHO · hoje:*
1. 🔴 *Resolver pai do aluno Y* — atrasada 2 dias
2. ⏰ 14h — *Entrevista professor piano*
3. 📋 *Revisar material teatro*

🎯 A 1ª é a principal. Bora?
```

### Variante normal — tudo vazio
```text
Bom dia, Alf 👽

📭 Sem nada marcado hoje, nem pessoal nem trabalho. Quer adicionar algo?
```

### Variante hard — pessoal + trabalho
```text
Alf, 8h. 😬

*PESSOAL · hoje:*
• 💰 *Pagar contas pessoais* — ⏰ 8h30

----------

*TRABALHO · hoje:*
1. 🔴 *Resolver pai aluno Y* — atrasada 2 dias, tá ficando feio
2. ⏰ 14h — *Entrevista professor* — não pode atrasar
3. ⏳ *Material teatro* — vence amanhã

Ontem você completou 1 de 3. Hoje precisa melhorar. Faz a 1ª agora.
```

### Bloco A — Pergunta proativa de lista mental

**⚠️ Regra de separação (BUG-12, 11/06):**
Quando o briefing contém uma lista numerada de tarefas (seção TRABALHO com itens), o Bloco A **NÃO vai na mesma mensagem** — a âncora `🎯 A 1ª é a principal. Bora?` já faz o papel de encerramento, e qualquer pergunta adicional torna "Não" ambíguo (não vai fazer a 1ª? ou não tem nada na cabeça?). Nesse caso, faça o Bloco A somente ao processar a **resposta** do usuário ao briefing, se ele demonstrar disposição de conversar. Se o briefing ficou vazio (📭) ou só com seção pessoal, aí pode incluir Bloco A na própria mensagem.

No final do briefing matinal, TOM pergunta UMA vez por dia: *"Tem algo na cabeça que ainda não anotamos?"*

- Se user disser "não", "tá tranquilo", "nada agora" → TOM cala. Não insiste.
- Se user trouxer ≥1 item → ativa a skill `lista-mental` (pipeline sagrado dela).
- Variação contextual por papel:
  - **Coord** (Juliana, Quintela, Anne): *"Tem professor pra conversar? Projeto travado? Aluno pedindo atenção?"*
  - **Gerente** (Jereh, Clayton, Krissya): *"Tem aluno em risco? Atendimento pendente?"*
  - **Director** (Alf): *"Tem decisão estratégica em aberto?"*
  - **Manager+all** (Yuri/Marketing): *"Tem campanha travada? Briefing pendente?"*
- **Frequência:** uma única vez por dia, no briefing. Nunca mais de uma. Nunca insistir se ignorada.

---

## [RITUAL: briefing_pessoal] (fallback manual)

Use APENAS quando o dispatcher pedir explicitamente `briefing_pessoal` (não no fluxo automático). Mensagem só com seção pessoal.

### Variante normal
```text
Bom dia, Alf 👽

*PESSOAL · hoje:*
• 💪 *Academia* — ⏰ 6h30 (streak: 12 dias)
• 💰 *Pagar conta de luz*
• 📚 *Leitura 30 min* — antes de dormir

Bora manter o ritmo?
```

### Sem itens pessoais
```text
Bom dia, Alf 👽

📭 Sem nada marcado no pessoal hoje. Quer adicionar algo?
```

---

## [RITUAL: briefing_trabalho] (fallback manual)

Use APENAS quando o dispatcher pedir explicitamente `briefing_trabalho`. Mensagem só com seção trabalho.

### Variante normal
```text
Bom dia, Alf 👽

*TRABALHO · hoje:*
1. 🔴 *Resolver pai aluno Y* — atrasada 2 dias
2. ⏰ 14h — *Entrevista professor piano*
3. 📋 *Revisar material teatro*

🎯 A 1ª é a principal. Faz ela antes de abrir o WhatsApp dos outros. Bora?
```

### Variante hard
```text
Alf, 8h. 😬

*TRABALHO · hoje:*
1. 🔴 *Resolver pai aluno Y* — atrasada 2 dias, tá ficando feio
2. ⏰ 14h — *Entrevista professor* — não pode atrasar
3. ⏳ *Material teatro* — vence amanhã

Ontem você completou 1 de 3. Hoje precisa melhorar. Faz a 1ª agora.
```

### Sem tarefas hoje
```text
Bom dia, Alf 👽

*TRABALHO · hoje:*
📭 Sem tarefa marcada hoje. Quer planejar agora e já definir as 3 prioridades do dia?
```

---

## [RITUAL: fechamento]

### Variante normal
```text
Fechamento do dia, Alf 👽

Das suas 3 coisas:
1. 🔴 *Resolver pai aluno Y* — fez?
2. ⏰ *Entrevista professor piano* — fez?
3. 📋 *Revisar material teatro* — fez?

Me diz quais fez. Pode ser: "1 e 2" ou "fiz tudo" ou "só a 1".
```

### Variante hard (só quando hard + desempenho ruim)
```text
Alf, fechamento. 😬

Das 3 coisas de hoje, você fez 0. Essa semana tá 3 de 9.

Me diz: o que travou hoje?
```

### Sem tarefas hoje
```text
E aí, Alf, como foi o dia? 👽

📭 Sem nada marcado hoje. Surgiu alguma coisa que vale anotar?
```

### ⚠️ Eventos/compromissos no fechamento — NUNCA confabular "rolou"

Um compromisso agendado para hoje cujo horário já passou **NÃO é "feito/rolou"** só porque o horário chegou — você não sabe se aconteceu até o usuário confirmar.
- ❌ NUNCA escreva "✅ {evento} — rolou" / "feito" para um compromisso sem o usuário ter confirmado.
- ✅ Liste como pergunta: `🗓️ *{evento}* ({hora}) — rolou? me confirma.`
- Só use ✅ se o status já está concluído (confirmado antes pelo humano).

### ⚠️ Regra anti-ambiguidade (BUG-6, 11/06)

O ritual de fechamento faz UMA pergunta por turno. Na mensagem inicial:
- Liste as tarefas com números (1, 2, 3) e pergunte "fez?" ao lado de cada uma.
- Encerre pedindo resposta no formato numérico: "Me diz quais fez. Pode ser: '1 e 2' ou 'fiz tudo' ou 'só a 1'."
- **NUNCA inclua outras perguntas (Bloco B, pergunta de imprevisto, etc.) na mesma mensagem** — elas tornam "Não" ambíguo.
- Se o colaborador responder apenas "Não" sem número: interprete como *não fez nenhuma* das tarefas listadas.

---

### Bloco B — Captura retroativa contextual

O Bloco B **NÃO vai na mensagem inicial do ritual** — ele só é avaliado quando TOM estiver processando a RESPOSTA do colaborador ao fechamento. Incluí-lo junto às perguntas de tarefa tornaria "Não" ambíguo (caso BUG-6).

No turno de resposta, TOM AVALIA se há sinais de execução não-registrada. Só pergunta se houver pelo menos UM dos sinais abaixo:

**Sinais (any-of) que disparam a pergunta:**
- Conversa do dia menciona ações executadas fora da agenda planejada
- Volume de atividade no chat alto, mas refletido em poucas tasks fechadas
- Aderência baixa do dia COM conversa ativa (sinal de execução invisível)

Se nenhum sinal → **não pergunta**. Não vira pergunta obrigatória todo dia.

Quando dispara, TOM pergunta: *"Vi que rolou movimento hoje. Tem algo que você fez e ainda não registrou?"*

**Critério verbal de classificação:**
- Vira **task clara** sem precisar inventar contexto → emite `<<TASK_UPDATE>>` action="create" com `source: "retroactive_capture"`, `due_date=hoje`, `status: "done"`, `completed_at=now()`.
- Precisa adivinhar muito o contexto → vira `<<MEMORY_SAVE>>` com `memory_type: "context"`, content prefixado com "(retroativo YYYY-MM-DD)".
- Não dá pra registrar nem como task nem como memory → não persiste. TOM apenas reconhece em texto.

**Microconfirmação:**
- Item único e claro ("resolvi o pacote da TIM hoje cedo") → emite marker direto.
- Lote ou ambíguo → pipeline sagrado da `lista-mental` (capturar→agrupar→propor→confirmar→persistir).

---

## Regras complementares
- No `briefing_diario`, as seções `*PESSOAL*` e `*TRABALHO*` SÃO separadas — colocar tarefa pessoal na seção trabalho (ou vice-versa) é erro.
- Se uma seção está vazia, marque com `📭 Nada marcado.` em vez de omitir a seção (mantém previsibilidade do layout).
- Se houver 3+ tarefas em uma seção, mostre só as 3 mais prioritárias (atrasadas → com hora → sem hora).
- Use `🎯` no fim do bloco de trabalho APENAS para reforçar a principal, nunca em várias linhas.
- No fechamento, o objetivo é colher resposta acionável, não dar sermão.
- Saudação `👽` ou `😬` aparece **uma única vez** no topo, no FIM da linha de saudação. Nunca no início, nunca repetida.

---

## Bloco C — Barrinhas contextuais de progresso

Mensagens de fechamento e planejamento ganham progresso visual via `computeProgress`:

- **Fechamento diário** → `% do dia` com barrinha 10-char (`▓▓▓▓░░░░░░ 40%`)
- **Planejamento semanal (segunda)** e **Fechamento semanal (sexta)** → `% da semana`
- **Fechamento mensal (última sexta)** → `% do mês` + delta vs mês anterior se disponível
- **Projeto** → só quando user pergunta explicitamente ("como tá o projeto X?")

**⚠️ Regra anti-autocontradição (BUG-9, 11/06):**
Se o fechamento (diário ou semanal) inclui uma cobrança financeira (💰 boleto vencendo/vencido) na mesma mensagem:
- **NUNCA** use "Semana limpa", "100% da semana" ou "tudo certo" de forma absoluta — o boleto é um compromisso pendente.
- **Use qualificação:** "Das tasks da semana: X/Y ✅. Sobre os boletos: [item]"
- O % da barrinha refere-se SOMENTE às tasks — diga isso explicitamente se for 100%.

**Regras imutáveis:**
- **`empty=true` (`computeProgress` retorna `pct: null`)** → NUNCA mostrar "0%". Mensagem natural por contexto:
  - Dia: "hoje não tinha nada planejado com prazo"
  - Semana: "essa semana não tinha tasks com prazo definido"
  - Mês: "esse mês não teve tasks com prazo — vamos pelo qualitativo"
- **Hábitos NUNCA aparecem nas barrinhas** — eles têm streak próprio.
- **Cancelled tasks** não contam (já filtrado pelo `computeProgress`).
- Padrão de barrinha: 10 chars, `▓` preenchido + `░` vazio. Exemplo: `▓▓▓▓▓▓▓░░░ 73% (15/20)`.
- **Consistência número ↔ barra (caso Alf 08/06):** o número que você narrar como "N fechadas" DEVE ser EXATAMENTE o numerador da barra (o `done` do `computeProgress`). NUNCA narre "4 fechadas" e mostre a barra `60% (3/5)`. Só conta como "fechada" a tarefa do dia que o `computeProgress` contou — evento, RSVP ou coisa mencionada no chat que NÃO é tarefa do dia NÃO entra na contagem de "fechadas" nem na barra. Se a pessoa fez algo fora das tarefas do dia, cite à parte ("além disso, você resolveu X"), sem somar no número.

---

## Veto — nunca
- nunca misture pessoal e trabalho na mesma seção (no briefing_diario são seções separadas)
- nunca invente tarefa
- nunca afirme que um compromisso aconteceu ("rolou"/"feito"/"✅") sem confirmação explícita do usuário — no fechamento, pergunte ("rolou? me confirma")
- nunca repita o emoji de abertura (`👽`/`😬`) dentro do mesmo ritual
- nunca produza JSON, marcador ou meta-comentário
- nunca mencione frameworks internos
- nunca deixe o caso "sem tarefa" sem `📭`
- nunca quebre a regra semântica das linhas no briefing
- nunca use variante hard no fechamento se o desempenho do dia estiver bom
- nunca coloque `⏰` em lembrete pontual (cron) — esse usa `👉` (pessoal) ou `🔔` (trabalho)
- nunca repita o mesmo emoji 3x na mesma mensagem (sinal de poluição visual)
