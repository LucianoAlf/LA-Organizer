---
name: configurar-preferencias
description: Skill para atualizar preferências do usuário (horários de rituais, intensidade de cobrança, notificações, pausar TOM). Quando o user pede mudança de configuração, emita marker `<<PREFS_UPDATE>>`.
---

# Configurar Preferências

## Quando ativar
- "muda meu briefing pra X horas", "passa o briefing pessoal pra 7h"
- "fecha o dia mais cedo", "fechamento às 18h"
- "planejamento da semana no domingo às 19h"
- "tira os alertas de prazo", "desliga aviso de atraso"
- "pausa o TOM por 2 horas", "fica em silêncio até amanhã", "pausa até sexta"
- "quero foco em 3 tarefas só por dia"
- "intensidade leve / normal / dura"
- "só me manda mensagem a partir das 11h", "não me chama antes das 9h" → quiet_hours recorrente

## Regras de ouro
- **NÃO crie campos novos.** Só os 15 abaixo.
- Confirme com o user antes de salvar quando a mudança for grande (intensidade, max_daily_tasks, DND longo).
- Mudança simples e óbvia (briefing time, toggle) pode emitir direto após "muda pra 7h" — sem perguntar de novo.
- Sempre responda em PT-BR confirmando o que foi salvo.

## Schema do marker

```
<<PREFS_UPDATE>>
{ "campo1": valor, "campo2": valor, ... }
<<END>>
```

**Campos aceitos:**

| Campo | Tipo | Valores |
|---|---|---|
| `briefing_time` | string `"HH:MM"` | horário do briefing de trabalho (dias úteis) |
| `personal_briefing_time` | string `"HH:MM"` | briefing pessoal (todo dia) |
| `closing_time` | string `"HH:MM"` | fechamento do dia |
| `planning_day` | int `0-6` | dia da semana do planejamento (0=domingo) |
| `planning_time` | string `"HH:MM"` | horário do planejamento semanal |
| `monthly_planning_time` | string `"HH:MM"` | planejamento mensal (1ª segunda do mês) |
| `monthly_closing_time` | string `"HH:MM"` | fechamento mensal (última sexta do mês) |
| `max_daily_tasks` | int `1-20` | tarefas máximas no briefing — força foco |
| `coaching_intensity` | `"light"` / `"normal"` / `"hard"` | como TOM cobra |
| `notify_deadline_alerts` | bool | alertas D-1 |
| `notify_overdue_alerts` | bool | alertas de atraso |
| `notify_team_summary` | bool | resumo do time (só liderança) |
| `do_not_disturb_until` | ISO timestamp ou `null` | pausa TOM até essa hora; `null` despausa |
| `do_not_disturb_reason` | string ≤200 chars ou `null` | motivo da pausa |
| `quiet_start_time` | `"HH:MM"` ou `null` | início do período silencioso **recorrente** diário |
| `quiet_end_time` | `"HH:MM"` ou `null` | fim do período silencioso recorrente — TOM fica quieto em `[start, end)` todos os dias |

## Exemplos

### Mudança simples — briefing pessoal
**User:** "muda meu briefing pessoal pra 7h"
**TOM:** ✅ Briefing pessoal agora 07:00.
```
<<PREFS_UPDATE>>
{ "personal_briefing_time": "07:00" }
<<END>>
```

### Mudança composta — planejamento semanal
**User:** "quero o planejamento todo domingo às 19h"
**TOM:** ✅ Planejamento semanal: domingo, 19:00.
```
<<PREFS_UPDATE>>
{ "planning_day": 0, "planning_time": "19:00" }
<<END>>
```

### Toggle
**User:** "tira o aviso de atraso"
**TOM:** ✅ Alertas de atraso desligados.
```
<<PREFS_UPDATE>>
{ "notify_overdue_alerts": false }
<<END>>
```

### Intensidade
**User:** "tô precisando de cobrança mais dura"
**TOM:** ✅ Intensidade trocada pra **dura**. Vou direto ao ponto.
```
<<PREFS_UPDATE>>
{ "coaching_intensity": "hard" }
<<END>>
```

### Pausar TOM (DND)
**User:** "pausa o TOM por 2 horas"
**TOM:** Beleza, te deixo em paz por 2 horas. Volto às 17:30.
```
<<PREFS_UPDATE>>
{ "do_not_disturb_until": "2026-05-09T20:30:00Z", "do_not_disturb_reason": "pausa solicitada" }
<<END>>
```
(Calcule o ISO em UTC com base no agora + 2h.)

### Despausar
**User:** "pode voltar a falar comigo"
**TOM:** ✅ De volta à ativa. Te trago o que tá pra hoje?
```
<<PREFS_UPDATE>>
{ "do_not_disturb_until": null, "do_not_disturb_reason": null }
<<END>>
```

### Foco do dia
**User:** "quero focar em 3 coisas só por dia"
**TOM:** ✅ Briefing vai ter no máximo 3 tarefas por dia.
```
<<PREFS_UPDATE>>
{ "max_daily_tasks": 3 }
<<END>>
```

### Horário silencioso recorrente — "só a partir de X"
**⚠️ IMPORTANTE:** "só a partir das Xh" / "não me chama antes das Xh" é uma preferência **permanente e recorrente** — NÃO é DND. Use `quiet_start_time`/`quiet_end_time`, não `do_not_disturb_until`.

**User:** "só me manda mensagem a partir das 11h"
**TOM:** Feito — fico quieto antes das 11h todos os dias.
```
<<PREFS_UPDATE>>
{ "quiet_start_time": "00:00", "quiet_end_time": "11:00" }
<<END>>
```

**User:** "pode me chamar a qualquer hora, sem restrição"
**TOM:** ✅ Removida a restrição de horário.
```
<<PREFS_UPDATE>>
{ "quiet_start_time": null, "quiet_end_time": null }
<<END>>
```

**Tabela de mapeamento:**
| Pedido | quiet_start_time | quiet_end_time |
|--------|-----------------|----------------|
| "só a partir das 11h" | "00:00" | "11:00" |
| "não me chama antes das 9h" | "00:00" | "09:00" |
| "silêncio noturno 22h–8h" | "22:00" | "08:00" |
| "sem restrição de horário" | null | null |

**Regra:** sempre setar `quiet_start_time` e `quiet_end_time` juntos. Nunca só um deles.

## Quando o user reclama "hoje é folga / dia de descanso"

Se o user falar algo como "hoje é domingo, dia de descanso", "para de me encher hoje", "tô de folga, deixa pra amanhã" — **NÃO emita PREFS_UPDATE marcando o dia como silêncio automaticamente.** O user precisa marcar isso no app pra a regra valer toda semana.

Resposta padrão:
```
Tem razão, vou parar de cobrar hoje. Pra eu nunca te encher [no domingo / nesse dia da semana] de novo, abre o app:

⚙️ *Mais* → *Configurações* → role até o fim → seção *"Dias de silêncio"*.

Marca o(s) dia(s) que você não quer ser cobrado e aperta *Salvar*. A partir daí eu fico quieto recorrentemente nesses dias — sem alertas, sem briefing, sem lembrete.
```

**Por que não marcar automático:** o user pode estar só desabafando hoje. Marcar quiet_day recorrente é decisão dele — TOM só ensina onde fica.

Exceção: se o user pedir EXPLICITAMENTE ("marca aí pra mim", "configura domingo no silêncio"), aí sim emita o PREFS_UPDATE apropriado.

---

## Veto
- ❌ NUNCA emita PREFS_UPDATE sem confirmar a mudança no texto da resposta.
- ❌ NUNCA invente valores ("acho que era 8h" → não, pergunta).
- ❌ NUNCA persista DND sem o user pedir explicitamente.
- ❌ Se user pediu mudança que não é nenhum dos 13 campos, responda que não dá pra mudar isso por aqui (ex: "trocar foto" não é PREFS_UPDATE).
