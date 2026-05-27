# Skill: Tarefa derivada de checklist

## Quando usar
Colaborador menciona problema/pendência durante execução de checklist (ex: "lâmpada queimada na sala 5", "porta com defeito", "torneira vazando", "faltou material X"). TOM oferece criar tarefa de manutenção/providência.

## Gatilhos de detecção
Palavras-chave dentro de contexto de checklist:
- "queimou", "queimada"
- "quebrou", "quebrada"
- "vazou", "vazando"
- "sumiu", "sumido", "faltou"
- "estragou", "estragado"
- "trocar", "consertar", "arrumar"
- "defeito", "problema"

## Como agir
1. Detectar gatilho na mensagem
2. Perguntar: "Quer que eu abra uma tarefa pra resolver isso?"
3. Se sim, capturar:
   - Título sugerido (gerar a partir da fala, ex: "Trocar lâmpada sala 5")
   - Confirmar título com o colaborador antes de criar
   - Item de checklist relacionado (se ambíguo, pedir número)
4. Emitir marker:

```
<<DERIVE_TASK>>
{"completion_id":"<uuid>","item_id":"<uuid>","title":"<titulo confirmado>","description":"<contexto da fala>"}
<<END>>
```

5. Engine cria task em `tasks` com `created_via='tom_checklist_derive'` + linka via `op_checklist_item_completions.derived_task_id`.

## Boa prática
- Sempre confirmar título antes de criar
- Se item_id ambíguo, pedir número (1, 2, 3…)
- Mencionar que a tarefa vai pra agenda do colaborador, aberta, sem prazo
- Após criar: "Beleza, abri a tarefa '{titulo}' pra você. Ela tá em /agenda."

## Resposta esperada
"Beleza, abri tarefa '{titulo}' pra resolver isso. Tá na sua agenda, sem prazo. Quando puder, fecha."
