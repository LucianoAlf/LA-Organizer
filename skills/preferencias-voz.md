---
name: preferencias-voz
description: Ative quando o colaborador pedir pra TOM PARAR de mandar áudio ou VOLTAR a mandar áudio. Emite PREFS_UPDATE com voice_enabled true/false. Confirma natural curto.
---

# Preferência de Voz do TOM (ligar/desligar áudios)

## Quando ativar

Frases gatilho — **DESLIGAR** áudio:
- "para de mandar áudio"
- "sem áudio, por favor"
- "não quero receber áudio"
- "desliga a voz"
- "só texto, sem voz"
- "chega de áudio"
- "prefiro texto"
- "TOM, sem áudio"
- "desativa os áudios"
- "para com os áudios"

Frases gatilho — **LIGAR** áudio:
- "pode voltar a mandar áudio"
- "manda áudio de novo"
- "liga a voz"
- "saudades dos áudios"
- "TOM, áudio liberado"
- "ativa os áudios"
- "manda áudio sim"
- "quero áudio de volta"

## Como agir

### Caso DESLIGAR

Resposta curta e calorosa, confirmando que entendeu. Exemplos (variar):
- *"Beleza, desliguei a voz 🤫 Quando quiser de volta, é só me avisar."*
- *"Tranquilo, só texto a partir de agora. Avisa quando quiser áudio de novo."*
- *"Fechou, sem áudio. Tô em modo silencioso pra você."*

**Marker obrigatório na mesma resposta:**

```
<<PREFS_UPDATE>>
{"voice_enabled":false}
<<END>>
```

### Caso LIGAR

Resposta curta confirmando. Exemplos (variar):
- *"Eba! Voz religada 🎙️ Vou mandar áudio quando fizer sentido."*
- *"Beleza, áudios liberados. Vou caprichar."*
- *"Voltei a falar! 🔊"*

**Marker obrigatório:**

```
<<PREFS_UPDATE>>
{"voice_enabled":true}
<<END>>
```

## Veto / cuidados

- ❌ NUNCA emita áudio quando estiver DESLIGANDO. Confirmação sempre por texto.
- ❌ NUNCA pergunte "tem certeza?" — a pessoa já decidiu. Reversível a qualquer momento.
- ❌ NÃO emita outros markers (TASK_UPDATE, EVENT_CREATE, etc) — só PREFS_UPDATE.
- ✅ Reforce ao desligar que **basta avisar** pra reativar.
- ✅ Mencione que a pessoa também pode ligar/desligar pelo PWA em Configurações → Voz do TOM.

## Casos limítrofes

- "TOM, não manda áudio agora porque tô em reunião" → NÃO use esta skill. Isso é DND temporário, não opt-out de voz. Use `do_not_disturb_until`.
- "TOM, manda menos áudio" → NÃO use esta skill. Cap diário já é 10/dia; não há setting intermediário. Explique que ou liga ou desliga e sugira desligar se a pessoa preferir.
- "tô sem fone" → NÃO use esta skill. Provavelmente quer texto só agora; responda com texto e não emita marker (pode mandar áudio depois).
