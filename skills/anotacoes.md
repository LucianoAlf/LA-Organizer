---
name: anotacoes
description: Criar/anexar/compartilhar ANOTAÇÕES do usuário (caderninho pessoal, visível no app em Mais → Anotações). Anotação ≠ tarefa ≠ memória.
---

# Anotações (caderninho do usuário)

## Gatilhos
- "cria uma anotação" / "faz uma anotação" / "anota aí" / "anota isso pra mim"
- "adiciona na anotação ..." (anexar)
- "compartilha a anotação com X"

## O que NÃO é anotação
- "me lembra de X" / "às 9h" → tarefa/lembrete (TASK_UPDATE), não anotação.
- Feedback sobre VOCÊ ("me pergunta antes de mandar áudio") → memória (MEMORY_SAVE).
- "anota a venda/saída de item" → lojinha/inventário.

## Criar
Se a pessoa já mandou o conteúdo completo (ex.: ditou a ata inteira), emita direto.
Se só anunciou ("quero criar uma anotação"), pergunte o conteúdo primeiro.

```
<<NOTE_ACTION>>
{"action":"create","title":"<título curto>","body":"<texto VERBATIM da pessoa, preservando as linhas>","share_with":["<Nome>"]}
<<END>>
```

- **body = texto da pessoa SEM reescrever** (pode corrigir erro óbvio de transcrição de áudio). Preserve quebras de linha e bullets.
- `share_with` SÓ se a pessoa pediu; use **NOMES** (o sistema valida contra o cadastro — NUNCA invente nome nem id).
- Resposta após emitir: curta e concreta — *"✅ Anotado! Tá em **Anotações** no app — e dá pra virar tarefas por lá."* Sem jargão (nada de "marker", "sistema", "banco").

## Anexar
```
<<NOTE_ACTION>>{"action":"append","note":"latest","body":"<novas linhas>"}<<END>>
```
Use `"latest"` (anotação mais recente) salvo se a pessoa citar outra pelo título — aí use o `[id=xxxxxxxx]` do bloco "📒 Anotações recentes" do seu contexto.

## Compartilhar
```
<<NOTE_ACTION>>{"action":"share","note":"latest","share_with":["Ana"]}<<END>>
```

## Ler
A pessoa pediu pra ler/conferir uma anotação → use o bloco "📒 Anotações recentes" do contexto e cite o conteúdo de lá. Se a anotação não estiver no bloco, diga que ela encontra tudo no app em **Mais → Anotações** — NÃO invente conteúdo.

## Veto (NUNCA)
- NUNCA diga "anotado/salvei" sem emitir o marker na MESMA resposta (fala = persistência).
- NUNCA emita uuid/nome inventado em share_with.
- NUNCA transforme pedido de anotação em tarefa (nem o contrário) sem a pessoa pedir.
