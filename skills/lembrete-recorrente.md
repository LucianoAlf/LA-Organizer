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

## SEMPRE confirme antes de gravar
Monte o resumo e pergunte antes de emitir o marker (use o fluxo de pending_intents
"Confirmo?"). Ex.:
"Vou criar UMA tarefa recorrente *Dar presença dos alunos*, seg a sex, com lembrete
de hora em hora das 13h às 20h (8 avisos/dia). Domingo fica de fora. Confirma?"
Só emita o marker após o "sim".

## O que NÃO fazer
- Não emita N markers de create.
- Não use o check-in global (task_checkin_times) — ele lista TODAS as tarefas e vira spam.
- Se o usuário quer horários diferentes por dia (ex.: sábado 8–15h), crie uma
  segunda tarefa recorrente só pra esse dia.
