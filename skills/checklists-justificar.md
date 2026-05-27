# Skill: Justificar não-execução de checklist

## Quando usar
Colaborador responde uma cobrança de checklist dizendo que não vai conseguir fazer hoje OU informa motivo de descumprimento.

## Gatilhos
Frases tipo:
- "hoje não vou fazer porque…"
- "não vou conseguir hoje"
- "não vou fazer hoje, porque…"
- "deixei de fazer porque…"
- "não consegui, a escola fechou"
- "tô doente, não consigo"

## Como agir
1. Detectar gatilho em resposta a cobrança de checklist (cobrança = TOM tinha lembrado o colaborador antes nessa conversa)
2. Capturar o motivo completo
3. Perguntar (se motivo curto/ambíguo): "Anota essa justificativa pra você: '{motivo}'?"
4. Emitir marker:

```
<<CHECKLIST_JUSTIFY>>
{"completion_id":"<uuid>","justification":"<texto completo>"}
<<END>>
```

5. Engine salva em `op_checklist_completions.justification` + `justified_at = now()` + `justified_by_id = colab.id`.

## Após justificar
- Não cobrar mais o checklist do dia (pular nas próximas escalações)
- Avisar líder via WhatsApp opcional (sprint futura): "Gabi justificou Abertura Escola — 'escola fechou hoje'"
- Confirmar pro colaborador: "Beleza, anotei aqui. Sem cobrança pra hoje, depois conversamos."

## Resposta esperada
"Beleza, anotei aqui: '{justificativa}'. Sem cobrança pra hoje. Cuidado contigo!"
