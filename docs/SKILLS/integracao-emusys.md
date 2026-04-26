---
name: integracao-emusys
description: Skill para sincronizar agenda de aulas do Emusys, monitorar lançamento de presença e conteúdo, e cobrar professores que não preencheram. Use no cron de sync (30 min), no lembrete pós-aula (15 min), e quando coordenador+ perguntar sobre aderência Emusys.
---

# Integração Emusys

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| collaborator_id | uuid | Professor identificado | Sim (pra lembrete) |
| emusys_endpoint | url | Configuração do sistema | Sim (pra sync) |
| class_date | date | CURRENT_DATE | Sim |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| emusys_classes | record[] | Supabase (atualizadas) |
| lembrete | WhatsApp | Professor via UAZAPI |
| relatório aderência | mensagem | Coordenador (no resumo do time) |

## Fases de Execução

### Fase 1 — Sync com Emusys (cron a cada 30 min)
```
1. Chamar endpoint Emusys pra cada professor ativo
2. Puxar agenda do dia: aluno, horário, status de presença, status de conteúdo
3. Pra cada aula:
   - Se já existe em emusys_classes (by emusys_class_id) → UPDATE
   - Se não existe → INSERT
4. Atualizar attendance_registered e content_registered com base no retorno da API
5. Atualizar last_synced_at
```

```sql
INSERT INTO emusys_classes (collaborator_id, emusys_class_id, student_name, class_date, 
  class_time, class_end_time, unit, attendance_registered, content_registered, last_synced_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
ON CONFLICT (emusys_class_id) DO UPDATE SET
  attendance_registered = EXCLUDED.attendance_registered,
  content_registered = EXCLUDED.content_registered,
  last_synced_at = NOW();
```

### Fase 2 — Lembrete pós-aula (cron a cada 15 min)
```sql
-- Aulas que terminaram há 10+ min sem presença lançada
SELECT ec.id, ec.collaborator_id, ec.student_name, ec.class_time, c.full_name
FROM emusys_classes ec
JOIN collaborators c ON c.id = ec.collaborator_id
WHERE ec.class_date = CURRENT_DATE
  AND ec.class_end_time <= NOW() - INTERVAL '10 minutes'
  AND ec.attendance_registered = false
  AND ec.reminder_sent = false;
```

Enviar lembrete:
```
Prof. [nome], sua aula com [aluno] ([horário]) terminou. Já lançou presença e conteúdo no Emusys?
```

Atualizar: reminder_sent = true, reminder_sent_at = NOW()

### Fase 3 — Segundo lembrete (30 min depois)
Se após 30 min do primeiro lembrete ainda não lançou:
```
Prof. [nome], presença da aula com [aluno] ([horário]) ainda pendente no Emusys. Lança lá pra não ficar pendente no relatório.
```

Máximo 2 lembretes por aula. Depois disso, entra no relatório como pendente.

### Fase 4 — Consolidar no fechamento do dia
No fechamento diário do professor, incluir aulas pendentes:
```
Antes das suas tarefas: você tem [N] aulas sem presença no Emusys hoje:
- [Aluno 1] ([horário])
- [Aluno 2] ([horário])

Lança lá que eu tiro da pendência.
```

### Fase 5 — Relatório pro coordenador
No resumo diário do time, incluir seção Emusys:
```
📋 EMUSYS:
✅ Prof. Joel — 4/4 aulas com presença
⚠️ Prof. Caio — 1/3 (2 pendentes)
❌ Prof. Eric — 0/2 (nenhuma lançada)
```

### Fase 6 — Aderência semanal
```sql
SELECT c.full_name,
  COUNT(*) as total_aulas,
  COUNT(CASE WHEN attendance_registered THEN 1 END) as presenca_ok,
  COUNT(CASE WHEN content_registered THEN 1 END) as conteudo_ok,
  ROUND(COUNT(CASE WHEN attendance_registered THEN 1 END)::numeric / COUNT(*) * 100, 1) as aderencia_presenca,
  ROUND(COUNT(CASE WHEN content_registered THEN 1 END)::numeric / COUNT(*) * 100, 1) as aderencia_conteudo
FROM emusys_classes ec
JOIN collaborators c ON c.id = ec.collaborator_id
WHERE ec.class_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY c.full_name
ORDER BY aderencia_presenca ASC;
```

## Veto Conditions — NUNCA
- NUNCA inventar dados de presença — só o que vem da API
- NUNCA cobrar presença de aula que ainda não aconteceu
- NUNCA expor nome de aluno em contexto fora do professor da aula
- NUNCA enviar mais de 2 lembretes por aula
- NUNCA culpar o professor no relatório — só dados objetivos

## Checklist de Conclusão
- [ ] Sync com Emusys rodando a cada 30 min
- [ ] emusys_classes atualizada com dados reais
- [ ] Lembrete pós-aula enviado 10 min após fim
- [ ] Segundo lembrete enviado após 30 min (se necessário)
- [ ] Aulas pendentes incluídas no fechamento do dia
- [ ] Seção Emusys incluída no resumo do coordenador
- [ ] Aderência semanal calculada e reportada

## Integrações
- **Emusys API** — endpoint de agenda de aulas
- **Supabase** — emusys_classes
- **UAZAPI** — lembretes e relatórios
- **pg_cron** — sync_emusys_classes (30 min), check_emusys_pending (15 min)
