---
name: tratamento-audio
description: Skill para receber, transcrever, interpretar e agir sobre mensagens de voz do colaborador. Use sempre que o colaborador enviar áudio via WhatsApp — o TOM transcreve, extrai a intenção, confirma o entendimento e executa a ação correspondente.
---

# Tratamento de Áudio

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| collaborator_id | uuid | Identificado pelo phone | Sim |
| audio_file | binary | UAZAPI (mensagem de voz recebida) | Sim |
| audio_duration | int | UAZAPI (duração em segundos) | Não |
| context | text | Contexto atual (briefing, closing, free_chat) | Sim |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| transcription | text | conversation_history (content) |
| extracted_intent | text | NLU → skill correspondente |
| extracted_data | jsonb | Dados extraídos (tarefas, nomes, datas) |
| confirmation_message | WhatsApp | Colaborador via UAZAPI |
| action_result | variável | Depende da intenção identificada |

## Fases de Execução

### Fase 1 — Receber áudio da UAZAPI
A UAZAPI recebe a mensagem de voz e envia pro motor do TOM:
- URL do arquivo de áudio
- Duração
- Número do remetente

### Fase 2 — Transcrever
Enviar pra serviço de STT (Speech-to-Text):
- **Opção 1:** OpenAI Whisper API
- **Opção 2:** Google Speech-to-Text
- **Opção 3:** Whisper local na VPS (se performance permitir)

Configuração:
- Idioma: pt-BR
- Modelo: whisper-large-v3 (ou equivalente)
- Formato de saída: texto limpo sem timestamps

### Fase 3 — Registrar transcrição
```sql
INSERT INTO conversation_history (collaborator_id, direction, message_type, content, context)
VALUES ($1, 'inbound', 'audio', $transcription, $context);
```

### Fase 4 — Extrair intenção e dados
Usar o modelo (Sonnet 4.6) pra interpretar a transcrição:

```
Prompt interno (não mostrar pro colaborador):

"O colaborador enviou um áudio. Transcrição:
[transcrição]

Contexto atual: [briefing/closing/free_chat]
Tarefas do dia: [lista]

Extraia:
1. Intenção principal (task_complete, task_reschedule, status_check, etc.)
2. Dados específicos (quais tarefas foram mencionadas, datas, nomes)
3. Se há mais de uma ação, liste todas na ordem

Retorne em JSON:
{
  'intents': [
    {'intent': '...', 'data': {...}},
    {'intent': '...', 'data': {...}}
  ],
  'summary': 'Resumo em 1-2 frases do que o colaborador disse'
}"
```

### Fase 5 — Confirmar entendimento
SEMPRE confirmar antes de agir. O colaborador precisa validar.

```
Entendi do áudio:
- ✅ [ação 1 interpretada]
- ❌ [ação 2 interpretada]
- 📝 [informação registrada]

Tá certo isso?
```

Exemplos de confirmação:

**Áudio simples:**
> "Fiz a entrevista do professor"
```
Entendi: Entrevista professor — feito ✅. Certo?
```

**Áudio com múltiplas ações:**
> "Fala cara, hoje eu fiz a entrevista do professor, o cara é bom, acho que vai dar certo. O material do teatro eu não consegui porque pintou uma reunião com pai de aluno que tomou minha tarde. Vou ter que deixar pra quinta."
```
Entendi do áudio:
- ✅ Entrevista professor — feito
- ❌ Material teatro — reagendado pra quinta
- 📝 Reunião com pai de aluno tomou a tarde (resolvida)

Tá certo?
```

**Áudio ambíguo:**
> "Tô vendo aquela parada lá do Renan"
```
Não ficou claro pra mim — qual tarefa? Ligar pro Renan ou revisar material do Renan?
```

### Fase 6 — Executar após confirmação
Se o colaborador confirma ("isso", "certo", "sim", "isso mesmo"):
- Processar cada intenção na ordem
- Chamar a skill correspondente (rituais-diarios pra ticar tarefa, etc.)
- Registrar tudo no banco

Se o colaborador corrige ("não, a entrevista foi ontem, não hoje"):
- Ajustar os dados
- Confirmar novamente
- Executar

### Fase 7 — Registrar resposta
```sql
INSERT INTO conversation_history (collaborator_id, direction, message_type, content, context)
VALUES ($1, 'outbound', 'text', $response, $context);
```

## Erros Comuns de Transcrição (aceitar como natural)

| Transcrição errada | O que provavelmente é |
|---|---|
| "Open Claw" | OpenClaw |
| "clã de ferro" | Claude Code |
| "L.A." | LA Music |
| "é o muses" / "e-muses" | Emusys |
| "tom" (minúsculo) | TOM (o agente) |
| "cinco de b" | 5W2H |
| "ai sem hall" | Eisenhower |
| "WIP" / "Wipp" | VIP |

O TOM deve ser tolerante com erros de transcrição e usar contexto pra interpretar.

## Veto Conditions — NUNCA
- NUNCA presumir que entendeu 100% — sempre confirmar
- NUNCA agir com base em áudio sem confirmação do colaborador
- NUNCA guardar o arquivo de áudio original — só a transcrição em texto
- NUNCA transcrever e mostrar a transcrição bruta pro colaborador (pode ter erros constrangedores) — mostrar a interpretação resumida
- NUNCA ignorar áudio — sempre processar, mesmo que curto

## Checklist de Conclusão
- [ ] Áudio recebido da UAZAPI
- [ ] Transcrição gerada com sucesso (pt-BR)
- [ ] Transcrição registrada em conversation_history
- [ ] Intenções e dados extraídos pelo modelo
- [ ] Confirmação enviada pro colaborador
- [ ] Confirmação recebida antes de executar
- [ ] Ações executadas corretamente
- [ ] Resultado registrado no banco

## Integrações
- **UAZAPI** — recebimento de áudio
- **Whisper/STT** — transcrição
- **Claude Sonnet 4.6** — interpretação e extração de intenções
- **Supabase** — conversation_history
- **Skills correspondentes** — rituais-diarios, broadcast, etc. (chamadas após confirmação)
