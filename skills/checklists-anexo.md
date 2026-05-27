# Skill: Anexo em Checklist (foto/PDF)

## Quando usar
Colaborador envia uma foto/imagem/PDF após receber checklist do dia OU mencionando explicitamente um item do checklist.

## Como agir
1. Detectar mensagem de mídia (image/jpeg, image/png, image/webp, application/pdf)
2. Se contexto recente é um checklist (últimas mensagens contém numeração de itens ou nome de template), perguntar: "Pra qual item? (responde o número)"
3. Esperar resposta com número do item (1, 2, 3…)
4. Resolver `completion_id` e `item_id` a partir do contexto + número
5. Emitir marker:

```
<<CHECKLIST_ATTACHMENT>>
{"completion_id":"<uuid>","item_id":"<uuid>","mime_type":"image/jpeg","file_name":"foto.jpg","media_id":"<uazapi_media_id>"}
<<END>>
```

6. O engine baixa a mídia da UAZAPI, faz upload pro bucket `checklist-attachments` no path `work/{user_uuid}/{item_completion_id}/{uuid}.ext` e insere row em `checklist_attachments`.

## Limites
- Tamanho máximo: 10MB
- Tipos permitidos: image/jpeg, image/png, image/webp, application/pdf
- Anexo só funciona se a row `op_checklist_item_completions` já existir (item tocado ao menos uma vez no checklist do dia). Se não existir, peça pro colaborador marcar/desmarcar primeiro.

## Resposta esperada
Após sucesso: "Anexei aí na sua checklist, item {N}. Obrigado pelo registro!"
