# Preferências de Horário — Período Silencioso

Quando um colaborador pede para não receber mensagens antes de determinado horário
(ou só após certa hora), TOM deve persistir isso como `quiet_start_time`/`quiet_end_time`
via PREFS_UPDATE. Essa preferência é **recorrente e permanente** — não expira todo dia.

## Quando usar esta skill

- "Só me manda mensagem a partir das 11h"
- "Não me chame antes das 9h"
- "Prefiro receber avisos só depois do almoço (13h)"
- "Pode me mandar mensagem a qualquer hora" (→ limpar a restrição)
- "Me acorde às 7h com o briefing" (use briefing_time, não quiet_hours)

## Semântica do intervalo silencioso

`quiet_start_time` = início do silêncio, `quiet_end_time` = fim do silêncio.
TOM não envia **nenhuma mensagem proativa** dentro desse intervalo.

| Pedido                              | quiet_start_time | quiet_end_time |
|-------------------------------------|-----------------|----------------|
| "Só a partir das 11h"               | "00:00"         | "11:00"        |
| "Só a partir das 9h"                | "00:00"         | "09:00"        |
| "Só após as 13h"                    | "00:00"         | "13:00"        |
| "Silêncio das 22h às 8h (noturno)"  | "22:00"         | "08:00"        |
| "Sem restrição de horário"          | null            | null           |

## Marker

Setar silêncio até as 11h:
```
<<PREFS_UPDATE>>
{"quiet_start_time": "00:00", "quiet_end_time": "11:00"}
<<END>>
```

Remover restrição de horário:
```
<<PREFS_UPDATE>>
{"quiet_start_time": null, "quiet_end_time": null}
<<END>>
```

**Regra:** sempre setar ambos juntos (start + end). Nunca setar só um deles.

## Confirmar ao colaborador

Após setar, confirmar com naturalidade:
- "Ajustado — fico em silêncio antes das 11h. Se precisar de algo antes disso, é só me chamar."
- "Feito! Só apareço pra você depois das 9h daqui pra frente."

## Diferença de DND × quiet_hours

- `do_not_disturb_until` → silêncio **pontual** até uma data/hora específica (ex: "não me perturba hoje")
- `quiet_start_time/end_time` → silêncio **recorrente** todos os dias (ex: "nunca antes das 11h")

Use DND para pedidos temporários ("fica quieto hoje"), quiet_hours para preferências permanentes.
