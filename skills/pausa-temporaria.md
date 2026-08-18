---
name: pausa-temporaria
description: O colaborador está pedindo uma pausa temporária ("agora não", "tô em aula", "me chama em 2h"). Confirme curtinho e emita marker `<<DND_SET>>` com a janela. Mensagens automáticas (rituais, alertas, lembretes) ficam represadas durante esse período. O colaborador continua podendo falar normalmente — DND só pausa o que sai do TOM por iniciativa própria.
---

# Pausa Temporária ("não me incomoda agora")

## Quando ativar
Ative quando a mensagem expressa pedido claro de pausa:
- "agora não", "não posso falar", "tô ocupado"
- "tô em aula", "tô em reunião", "tô dirigindo"
- "me chama em 2h", "me lembra mais tarde"
- "depois", "só mais tarde", "agora não dá"
- **folga de HOJE declarada pelo próprio colaborador**: "hoje tô de folga", "hoje é minha folga", "dia de folga hoje". É estado de descanso do dia — silencie o resto do dia (ver tabela). **NÃO** vale folga FUTURA ("amanhã é folga" → não silencie hoje), NEGADA ("não tô de folga") nem de OUTRA pessoa ("a folga do Rafinha").

Se a mensagem é só "tô ocupado hoje" ou "tô cansado" sem pedido explícito de pausa **e sem dizer que é folga**, **NÃO ative** — isso é estado emocional, não DND.

## Como inferir a duração

| Pista do colaborador | Janela default |
|---|---|
| "agora não" / "depois" sem hora | 1 hora |
| "tô em aula" | 2 horas |
| "tô em reunião" | 1 hora |
| "tô dirigindo" | 30 minutos |
| "me chama em 2h" / "depois das 18h" | exato (calcule) |
| "amanhã" | até 8h da manhã do dia seguinte |
| **folga de hoje** ("tô de folga hoje", "dia de folga") | **até 23:59 de HOJE** (fim do dia local, `-03:00`), `reason:"folga"` |
| ambíguo de mais | pergunte uma vez: "Te chamo em quanto tempo?" |

**Regra de ouro:** nunca silencie sem teto. **MÁXIMO 24h** por DND. O engine corta se você passar disso.

## Marker

Quando a janela está clara, sua resposta termina com:

```text
<<DND_SET>>
{"until":"2026-04-27T22:00:00-03:00","reason":"em aula"}
<<END>>
```

- `until`: ISO 8601 com timezone `-03:00` (São Paulo).
- `reason`: opcional, frase curta (até 80 chars) para audit. Ex: `"em aula"`, `"reunião externa"`, `"dirigindo"`.

Para liberar antes da hora ("pode falar", "voltei"):

```text
<<DND_SET>>
{"clear":true}
<<END>>
```

## Resposta visível

Confirme curto e claro. Exemplo:

> Beleza, te chamo em 2h. Se precisar antes, é só me chamar.

Ou no clear:

> 👋 Voltei. Tô aqui.

**Não invente** que vai "anotar" ou "lembrar de algo" durante a pausa — apenas confirme o silêncio.

## O que DND faz e o que NÃO faz

**DND ativo represa:**
- briefings (pessoal, trabalho, fechamento, planejamento)
- alertas de prazo / atraso
- lembretes pré-evento
- resumo do time / retrospectiva semanal (para coordenadores)

**DND ativo NÃO represa:**
- mensagens iniciadas pelo próprio colaborador (ele continua podendo falar/perguntar)
- respostas do TOM a essas mensagens dele
- pendências em si — elas continuam no banco, retomam após a janela

## Veto
- NUNCA emita DND_SET com `until` no passado
- NUNCA emita DND_SET com janela > 24h
- NUNCA prometa "vou anotar X durante o silêncio" — o engine não faz isso
- NUNCA emita marker sem confirmar curtinho ao colaborador antes
