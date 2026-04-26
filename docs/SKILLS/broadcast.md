---
name: broadcast
description: Skill para enviar comunicações em massa via WhatsApp com follow-up automático, rastreamento de confirmações e geração de relatório. Use quando coordenador+ pedir para avisar, comunicar ou notificar um grupo de pessoas com ou sem confirmação.
---

# Broadcast

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| sent_by | uuid | Coordenador+ identificado pelo phone | Sim |
| target_group | text | Coordenador define ("assistentes", "professores", "todos", "time do Recreio") | Sim |
| message_content | text | Coordenador define | Sim |
| requires_confirmation | boolean | Coordenador define (default: false) | Não |
| follow_up_interval_min | int | Coordenador define (default: 60) | Não |
| timeout_hours | int | Coordenador define (default: 24) | Não |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| broadcast_messages | record | Supabase |
| broadcast_responses | record[] | Supabase (1 por destinatário) |
| mensagens enviadas | WhatsApp | Cada destinatário via UAZAPI |
| relatório | WhatsApp | Remetente via UAZAPI (após timeout) |

## Fases de Execução

### Fase 1 — Verificar permissão
Se role NOT IN ('coordinator', 'manager', 'director') → rejeitar:
"Broadcast é função de coordenação. Quer que eu passe o pedido pro [supervisor]?"

### Fase 2 — Resolver grupo-alvo
Mapear target_group pra collaborator IDs:

| Grupo | Query |
|-------|-------|
| "assistentes" ou "assistentes pedagógicos" | WHERE function_title ILIKE '%assistente%' AND is_active |
| "professores" | WHERE role = 'collaborator' AND function_title ILIKE '%professor%' AND is_active |
| "coordenadores" | WHERE role = 'coordinator' AND is_active |
| "todos" | WHERE is_active AND id != sent_by |
| "time do [unidade]" | WHERE unit = '[unidade]' AND is_active |
| "equipe do projeto [X]" | JOIN project_members WHERE project_id = X |
| Lista explícita ("Joel, Eric, Jordão") | WHERE full_name IN (...) |

### Fase 3 — Confirmar com o remetente
```
Vou mandar pra [N] pessoas ([lista de nomes]):

"[message_content]"

Confirmação obrigatória: [sim/não]
Cobrança: a cada [interval] min por [timeout]h

Confirma o envio?
```

Só prosseguir após "sim", "confirma", "manda", "bora".

### Fase 4 — Criar registros e enviar
```sql
-- 1. Criar broadcast
INSERT INTO broadcast_messages (sent_by, target_group, target_ids, message_content, 
  requires_confirmation, follow_up_interval_min, timeout_hours, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
RETURNING id;

-- 2. Criar response pra cada destinatário
INSERT INTO broadcast_responses (broadcast_id, collaborator_id, status)
SELECT $broadcast_id, unnest($target_ids), 'pending';
```

Enviar mensagem pra cada destinatário via UAZAPI:
```
[Nome], aviso de [nome do remetente]: [message_content]
[Se requires_confirmation]: Por favor confirme sua presença.
```

### Fase 5 — Monitorar confirmações (cron a cada 15 min)
```sql
-- Verificar broadcasts ativos que precisam de follow-up
SELECT bm.id, br.collaborator_id, br.last_reminder_at, bm.follow_up_interval_min
FROM broadcast_messages bm
JOIN broadcast_responses br ON br.broadcast_id = bm.id
WHERE bm.status = 'active'
  AND bm.requires_confirmation = true
  AND br.status = 'pending'
  AND (br.last_reminder_at IS NULL 
       OR br.last_reminder_at < NOW() - (bm.follow_up_interval_min || ' minutes')::interval);
```

Pra cada pendente: enviar lembrete e atualizar last_reminder_at e reminders_sent.

```
[Nome], ainda preciso da sua confirmação sobre: [resumo do broadcast]. Confirma pra mim?
```

### Fase 6 — Processar confirmação do destinatário
Quando destinatário responde "confirmado", "sim", "vou", "ok":
```sql
UPDATE broadcast_responses
SET status = 'confirmed', responded_at = NOW(), response_text = $response
WHERE broadcast_id = $1 AND collaborator_id = $2;
```

Se responde "não posso", "não vou":
```sql
UPDATE broadcast_responses
SET status = 'declined', responded_at = NOW(), response_text = $response
WHERE broadcast_id = $1 AND collaborator_id = $2;
```

### Fase 7 — Gerar relatório (após timeout)
Quando NOW() > created_at + timeout_hours:

```sql
UPDATE broadcast_responses
SET status = 'no_response'
WHERE broadcast_id = $1 AND status = 'pending';

UPDATE broadcast_messages
SET status = 'completed', report_sent = true, report_sent_at = NOW()
WHERE id = $1;
```

Enviar relatório pro remetente:
```
Relatório do broadcast — [resumo]:

✅ Confirmados ([N]): [nomes]
❌ Recusaram ([N]): [nomes]
⏳ Sem resposta ([N]): [nomes]

Quer que eu continue cobrando os que não responderam?
```

Se remetente diz sim → resetar timeout, continuar follow-up.
Se não → manter status 'completed'.

## Veto Conditions — NUNCA
- NUNCA enviar broadcast sem confirmação do remetente
- NUNCA incluir dados pessoais de destinatários na mensagem
- NUNCA cobrar mais de 1x por intervalo configurado
- NUNCA enviar broadcast como se fosse do TOM — sempre identificar o remetente humano
- NUNCA permitir que collaborator (sem role) envie broadcast
- NUNCA bombardear: se o cara já respondeu, não mandar mais lembrete

## Checklist de Conclusão
- [ ] Permissão verificada (coordinator+)
- [ ] Grupo-alvo resolvido corretamente (IDs)
- [ ] Confirmação do remetente recebida
- [ ] broadcast_messages criado no Supabase
- [ ] broadcast_responses criados (1 por destinatário)
- [ ] Mensagens enviadas via UAZAPI pra todos os destinatários
- [ ] Follow-up funcionando no intervalo correto
- [ ] Confirmações registradas em tempo real
- [ ] Relatório gerado e enviado após timeout
- [ ] Status atualizado pra 'completed'

## Integrações
- **Supabase** — broadcast_messages, broadcast_responses, collaborators
- **UAZAPI** — envio de mensagens e lembretes
- **pg_cron** — fn_follow_up_broadcasts() a cada 15 min
