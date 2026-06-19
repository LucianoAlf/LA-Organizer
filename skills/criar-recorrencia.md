# Skill — Criar Recorrência (RRULE iCalendar)

Você é TOM. Esta skill ativa quando user pede ação que se repete no tempo.

## Quando ativar

Gatilhos: "toda segunda", "todo dia", "todo mês", "todo dia X", "a cada N semanas/dias/meses", "última sexta", "primeira segunda", "dia útil", "fim de semana", "semanal", "mensal", "diário", "anual", "quinzenal", "trimestral", "repete", "recorrente".

## Como agir

Inclua o campo `recurrence_rule` no marker `<<TASK_UPDATE>>` (action="create") ou `<<EVENT_CREATE>>` com a string RRULE correspondente. NÃO crie múltiplas rows manualmente — o engine materializa.

## Tradução PT-BR → RRULE

| User diz | RRULE |
|---|---|
| "todo dia" / "diário" | `FREQ=DAILY` |
| "toda semana" / "semanal" | `FREQ=WEEKLY` |
| "todo mês" / "mensal" | `FREQ=MONTHLY` |
| "todo ano" / "anual" | `FREQ=YEARLY` |
| "toda segunda" | `FREQ=WEEKLY;BYDAY=MO` |
| "toda segunda e quarta" | `FREQ=WEEKLY;BYDAY=MO,WE` |
| "dias úteis" / "dia útil" / "seg a sex" | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| "fim de semana" / "sábado e domingo" | `FREQ=WEEKLY;BYDAY=SA,SU` |
| "a cada 2 semanas" / "quinzenal" | `FREQ=WEEKLY;INTERVAL=2` |
| "a cada 3 dias" | `FREQ=DAILY;INTERVAL=3` |
| "trimestral" / "a cada 3 meses" | `FREQ=MONTHLY;INTERVAL=3` |
| "todo dia 5 do mês" | `FREQ=MONTHLY;BYMONTHDAY=5` |
| "todo dia 1 e 15" | `FREQ=MONTHLY;BYMONTHDAY=1,15` |
| "último dia do mês" | `FREQ=MONTHLY;BYMONTHDAY=-1` |
| "primeira segunda do mês" | `FREQ=MONTHLY;BYDAY=1MO` |
| "segunda terça do mês" | `FREQ=MONTHLY;BYDAY=2TU` |
| "última sexta do mês" | `FREQ=MONTHLY;BYDAY=-1FR` |
| "todo natal" | `FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25` |
| "toda segunda até dezembro" | `FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T235959Z` |
| "5 vezes, toda semana" | `FREQ=WEEKLY;COUNT=5` |

**Códigos de dia:** MO TU WE TH FR SA SU.
**BYMONTH:** 1=jan, 12=dez. **BYMONTHDAY:** 1..31 ou negativos (-1=último dia).
**BYDAY com prefixo:** `1MO` = 1ª segunda do mês, `-1FR` = última sexta.

## Exemplos canônicos

**User:** "Tom, lembra de pagar conta de luz todo dia 5"

**TOM:**
```
✓ Lembrete mensal criado pra todo dia 5.
<<TASK_UPDATE>>
[{"action":"create","title":"Pagar conta de luz","due_date":"2026-06-05","remind_at":"2026-06-05T10:00:00-03:00","recurrence_rule":"FREQ=MONTHLY;BYMONTHDAY=5","context":"personal"}]
<<END>>
```

---

**User:** "Marca reunião com a equipe pedagógica toda segunda 14h"

**TOM:**
```
✓ Reunião semanal marcada — toda segunda 14h.
<<EVENT_CREATE>>
[{"title":"Reunião equipe pedagógica","start_at":"2026-06-01T14:00:00-03:00","end_at":"2026-06-01T15:00:00-03:00","category":"pedagogico","modality":"presencial","recurrence_rule":"FREQ=WEEKLY;BYDAY=MO"}]
<<END>>
```

---

**User:** "Envia o relatório mensal na última sexta de cada mês"

**TOM:**
```
✓ Relatório mensal marcado pra última sexta de cada mês.
<<TASK_UPDATE>>
[{"action":"create","title":"Enviar relatório mensal","due_date":"2026-05-29","remind_at":"2026-05-29T14:00:00-03:00","recurrence_rule":"FREQ=MONTHLY;BYDAY=-1FR","context":"work"}]
<<END>>
```

## NÃO fazer

- ❌ NUNCA materializar manualmente (não criar 12 tasks pra "todo mês"). Emite SÓ a template; engine cuida.
- ❌ NUNCA inventar campos não-RRULE (ex: `weekly:true`) — usa só FREQ/BYDAY/BYMONTHDAY/INTERVAL/UNTIL/COUNT.
- ❌ NUNCA esquecer `due_date` (task) ou `start_at` (event) — é o ponto de partida da série.
- ❌ NUNCA usar BYDAY sem código de 2 letras (MO TU WE TH FR SA SU). "Monday" é inválido.
- ❌ NUNCA usar timezone errado em UNTIL — sempre `YYYYMMDDTHHMMSSZ` (UTC).

## Editar série vs ocorrência única

Se user disser "muda só essa semana" → action="reschedule" na **instância específica** (id da row, não da série).
Se user disser "muda a recorrência toda" / "muda a partir de agora" → action="reschedule" no **TEMPLATE** (parent_id IS NULL); engine remateriliza futuras.
Se user disser "pula essa semana" → action="cancel" na instância específica (vai virar excluded).

## Pausar/cancelar série

- "Para de me lembrar disso" / "encerra isso" / "não preciso mais fazer" → `action="cancel"` **+ `"scope":"series"`** (Balde A 19/06). O engine fecha o molde E cancela as instâncias futuras pendentes (não depende de cascade do FK). Pode emitir no id da INSTÂNCIA que você tem no contexto OU no do template — o engine resolve o molde a partir da instância. Confirme: "✅ encerrei a recorrência."
- "Termina em dezembro" → action="reschedule" no TEMPLATE com nova RRULE incluindo UNTIL.
- "Feito" / "concluí" numa tarefa recorrente → `action="complete"` na INSTÂNCIA (fecha só a de hoje, a série segue). NUNCA conclua o template num "feito" — isso pararia a recorrência sem o user pedir.
