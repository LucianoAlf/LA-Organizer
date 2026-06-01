# Skill: Lembrete recorrente de hora em hora

## Quando usar
Quando o usuário pede pra ser lembrado REPETIDAMENTE de uma rotina — "me lembra
de X de hora em hora", "me cobra a cada hora", "vários lembretes por dia", "todo
dia nesses horários". Ex.: "me lembra de dar presença de hora em hora, seg a sex,
das 13h às 20h".

## Regra de ouro
NUNCA crie uma tarefa por horário/dia. Rotina repetida = UMA tarefa recorrente
com MÚLTIPLOS lembretes. Criar dezenas de tarefas iguais é proibido (o engine
bloqueia via guardrail) e polui a lista do usuário.

## Como montar
1 marker `<<TASK_UPDATE>>` action="create" com:
- `recurrence_rule`: a recorrência (ex.: dias úteis seg-sex). Use o mesmo formato
  aceito hoje pela skill criar-recorrencia.
- `reminders_at`: ARRAY com os horários do dia em ISO BRT (-03:00). Para "de hora
  em hora das 13h às 20h": 13:00,14:00,...,20:00 na data da primeira ocorrência.
- `reminders_labels` (opcional): rótulos curtos ("13h","14h",...).
A recorrência clona os lembretes pra cada dia automaticamente. Domingo/sábado
ficam de fora se a regra for "dias úteis".

## Fluxo de 2 turnos: confirma, depois grava
**Turno 1 (o pedido):** NÃO emita marker ainda. Monte o resumo e pergunte. Ex.:
"Vou criar UMA tarefa recorrente *Dar presença dos alunos*, seg a sex, com lembrete
de hora em hora das 13h às 20h (8 avisos/dia). Domingo fica de fora. Confirma?"

**Turno 2 (o usuário confirmou — "sim"/"confirmo"/"pode"/"isso"/"fechado"):** AGORA
emita IMEDIATAMENTE o marker estruturado completo, com `recurrence_rule` + o ARRAY
`reminders_at` (todos os horários). NÃO pergunte de novo, NÃO crie tarefa simples.
Os parâmetros (dias da semana, janela de horas) estão na SUA própria mensagem
anterior do resumo — releia o histórico e converta em marker. Exemplo do marker do
turno 2 para "seg a sex, 13h às 20h, de hora em hora":
```
<<TASK_UPDATE>>
[{"action":"create","title":"Dar presença dos alunos","context":"work",
  "recurrence_rule":"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "due_date":"<data da próxima ocorrência YYYY-MM-DD>",
  "reminders_at":["<data>T13:00:00-03:00","<data>T14:00:00-03:00","<data>T15:00:00-03:00","<data>T16:00:00-03:00","<data>T17:00:00-03:00","<data>T18:00:00-03:00","<data>T19:00:00-03:00","<data>T20:00:00-03:00"],
  "reminders_labels":["13h","14h","15h","16h","17h","18h","19h","20h"]}]
<<END>>
```
REGRA CRÍTICA: confirmação SEM o marker estruturado = falha grave. Se você só
escrever "Criado!" sem emitir o `<<TASK_UPDATE>>` com `recurrence_rule` e
`reminders_at`, a tarefa NÃO é criada de verdade — nunca faça isso.

## O que NÃO fazer
- Não emita N markers de create.
- Não use o check-in global (task_checkin_times) — ele lista TODAS as tarefas e vira spam.
- Se o usuário quer horários diferentes por dia (ex.: sábado 8–15h), crie uma
  segunda tarefa recorrente só pra esse dia.
