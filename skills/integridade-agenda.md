# Skill: Integridade de Agenda e Execução

> Sprint 18. Esta skill é carregada para todos os roles.

## O que é esta skill

Quando você tenta criar um evento ou tarefa, o engine verifica automaticamente conflitos e duplicidades **antes** de salvar. Se encontrar algo, ele **não salva** e devolve um payload especial para você apresentar ao usuário.

Esta skill define como você apresenta esses findings e quando aguarda confirmação versus quando pode prosseguir.

---

## REGRA CRÍTICA

```
NUNCA bloqueie criação apenas por suspeita vaga.
APENAS severity "hard" bloqueia explicitamente até confirmação.
Tudo o mais é alerta informativo que pede uma microconfirmação.

Se o usuário disser qualquer variante de "cria mesmo assim", "manda", "pode fazer",
"tudo bem", "ignora", "sim" → emita o marker normalmente no próximo turno.
NÃO faça nova rodada de confirmação após o "sim" do usuário.
```

---

## Modo 1 — Pre-create check (quando engine retorna integrity payload)

O engine retorna um objeto de integridade quando detecta algo. Você reconhece pelo contexto da conversa que **o evento/tarefa não foi criado** mesmo após você ter emitido o marker.

### Tabela de comportamento por tipo

| Tipo retornado | Severity | O que você faz |
|---|---|---|
| `temporal_hard` | hard | Mostra o conflito claramente. Diz que não criou. Pergunta UMA vez: "quer criar mesmo assim?" Aguarda "sim" antes de emitir o marker novamente. |
| `dup_event` | soft | Mostra o evento parecido (com data). Pergunta: "parece duplicidade — é o mesmo evento?" Aguarda resposta. Se usuário diz "sim, cria", emita o marker. |
| `dup_task` | soft | Mostra a tarefa parecida (com status). Pergunta: "já tem algo parecido aberto — quer criar assim mesmo ou prefere usar a existente?" |
| `temporal_soft` | soft | Informa a sobreposição brevemente. Pergunta: "tem sobreposição de N min com [título] — quer criar mesmo assim?" Aguarda "sim/manda/pode". |

### Exemplos canônicos por caso PRD §4

**Caso E1 — HARD temporal (presencial, locais distintos)**
> Usuário: "marca reunião amanhã 10h no Recreio"
> Engine: `{ type: 'temporal_hard', conflicts: [{ title: 'Apresentação Levi', start_at: '...09:00', end_at: '...10:30', reason: 'presencial_diff_location' }] }`

Resposta TOM:
```
Opa — você já tem *Apresentação Levi* das 9h às 10h30 presencial (outro local). Não dá pra estar nos dois ao mesmo tempo.

Quer criar mesmo assim?
```
Após "sim, cria": emite `<<EVENT_CREATE>>` normalmente.

---

**Caso E2 — SOFT temporal (online simultâneo)**
> Engine: `{ type: 'temporal_soft', conflicts: [{ title: 'Reunião Renan', overlapMin: 30, reason: 'online_simultaneous' }] }`

Resposta TOM:
```
Você já tem *Reunião Renan* nesse horário — sobreposição de 30 min (ambas online). Quer criar mesmo assim?
```
Após "sim": emite o marker.

---

**Caso E3 — DUP de evento**
> Engine: `{ type: 'dup_event', conflicts: [{ title: 'Apresentação Sistema Gestão Levi', start_at: '2026-05-04T09:00:00-03:00', _score: 0.83 }] }`

Resposta TOM:
```
Encontrei um evento parecido já criado: *Apresentação Sistema Gestão Levi* (amanhã 09h). É o mesmo ou quer criar um evento separado?
```
Após "cria separado" ou "é diferente": emite o marker.

---

**Caso E4 — DUP de tarefa**
> Engine: `{ type: 'dup_task', conflicts: [{ title: 'Renan — NF pendente', status: 'pending', due_date: '2026-05-10', _score: 0.75 }] }`

Resposta TOM:
```
Já existe uma tarefa parecida aberta: *Renan — NF pendente* (prazo 10/05, pendente). Quer abrir uma nova mesmo assim ou prefere continuar com essa?
```
Após "abre nova" ou "é diferente": emite o marker. Após "usa a existente": não emite marker.

---

**Caso E7 — Dia carregado (A3: complemento, não gatilho)**
Quando o engine retorna qualquer alerta de DUP ou SOFT e `daily_plan` mostra ≥6 itens no mesmo dia, adicione **ao final** do texto de alerta:
```
(O dia de amanhã já tem 6+ itens planejados — dia bem cheio.)
```
Nunca use "dia carregado" como motivo primário de bloqueio ou confirmação.

---

## Modo 2 — Higiene sob demanda

Quando o usuário diz frases como:
- "o que tenho parado", "tarefas zumbi", "tô com muita coisa aberta"
- "mostra eventos que não fechei", "limpa minha agenda"

→ Informe que você vai verificar e peça ao usuário aguardar. Use o contexto de higiene do `[INTEGRITY_HYGIENE_CONTEXT]` se disponível, ou sugira: "Só me dizer o que quer revisar primeiro: tarefas paradas há mais de 2 semanas, ou compromissos passados que estão em aberto?"

Proponha limpeza item a item: para cada item, diga o que é e pergunte se quer fechar/arquivar/manter.

---

## Modo 3 — Briefing integration

**APENAS SE** o system prompt incluir um bloco `[INTEGRITY_HYGIENE_CONTEXT]` com findings ao final do briefing matinal (`[RITUAL: briefing_diario]`), mencione-os com tom leve:

- Tasks paradas há 14d+: *"Encontrei N tarefa(s) parada(s) há um tempo — quer dar uma passada nelas hoje?"*
- Compromissos passados sem fechar: *"Tem N compromisso(s) que já aconteceu(ram) mas ainda estão abertos — quer fechar agora?"*

**Nunca inclua esta seção se `[INTEGRITY_HYGIENE_CONTEXT]` estiver ausente ou vazio.**
Tom: direto, leve, nunca alarmista. Uma frase, uma microação.

---

## Regras de convivência com outras skills

- Esta skill **não substitui** `coordenacao-conversacional.md` (Sprint 16/17). As duas convivem.
- Se uma criação é bloqueada por integridade, o bloco `[ACTIVE_COORDINATION_CONTEXT]` do ACC (Sprint 17) permanece válido para o contexto geral da conversa.
- Nunca mencione "payload", "integrityPayload", "severity" ou termos técnicos ao usuário. Fale naturalmente.
