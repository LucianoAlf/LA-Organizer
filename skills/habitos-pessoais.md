---
name: habitos-pessoais
description: Skill para criar, acompanhar e motivar hábitos pessoais com streaks, templates prontos e lembretes. 100% privado — nunca aparece em relatórios do time. Use quando o colaborador pedir para criar hábito, quando o lembrete disparar, ou no briefing pessoal.
---

# Hábitos Pessoais

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| collaborator_id | uuid | Identificado pelo phone | Sim |
| action | enum (create, complete, list, templates) | Intenção do colaborador | Sim |
| habit_id | uuid | Banco (pra complete) | Pra complete |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| habit | record | Supabase (habits) |
| habit_log | record | Supabase (habit_logs) |
| mensagem | WhatsApp | Colaborador via UAZAPI |

## Fases de Execução

### Criar hábito

#### Fase 1 — Identificar se é template ou customizado
- Se o colaborador pede algo que corresponde a um template: "Achei um template pra isso. Quer usar?"
- Se não: criar do zero

#### Fase 2 — Coletar informações
```
Bora criar o hábito. Me diz:
1. Nome do hábito? (ex: "Academia", "Ler 30 min")
```
Aguardar. Depois:
```
2. Quantas vezes por semana? (todo dia, dias úteis, ou dias específicos?)
```
Aguardar. Depois:
```
3. Quer lembrete no WhatsApp? Se sim, que horas?
```

#### Fase 3 — Salvar
```sql
INSERT INTO habits (collaborator_id, name, icon, color, frequency, custom_days, 
  reminder_time, notify_whatsapp, is_active, current_streak, best_streak)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 0, 0);
```

Confirmar: "Hábito '[nome]' criado. [Emoji] Streak começa amanhã. Bora!"

### Completar hábito

#### Fase 1 — Registrar
```sql
INSERT INTO habit_logs (habit_id, collaborator_id, log_date, is_completed, completed_at)
VALUES ($1, $2, CURRENT_DATE, true, NOW())
ON CONFLICT (habit_id, log_date) DO UPDATE SET is_completed = true, completed_at = NOW();
```

#### Fase 2 — Calcular streak
```sql
-- Verificar se ontem também foi completado
WITH consecutive AS (
  SELECT log_date, is_completed,
    ROW_NUMBER() OVER (ORDER BY log_date DESC) as rn
  FROM habit_logs
  WHERE habit_id = $1 AND is_completed = true
  ORDER BY log_date DESC
)
SELECT COUNT(*) as streak
FROM consecutive
WHERE log_date = CURRENT_DATE - (rn - 1);
```

Atualizar: current_streak = calculado. Se current_streak > best_streak → best_streak = current_streak.

#### Fase 3 — Celebrar milestones
| Streak | Mensagem |
|--------|---------|
| 7 dias | "🔥 1 semana de [hábito]! Tá virando ritual." |
| 14 dias | "🔥🔥 2 semanas! Isso já é hábito, não disciplina." |
| 30 dias | "🔥🔥🔥 1 mês! [hábito] já faz parte de quem você é." |
| 60 dias | "💪 2 meses! Pouquíssima gente chega aqui." |
| 100 dias | "🏆 100 DIAS! Isso é lendário. Respeito total." |

### Lembrete (cron no horário configurado)
Se notify_whatsapp = true e horário bate:
```
[Emoji] [Nome do hábito] — streak: [N] dias. Bora?
```

### No briefing pessoal
Incluir hábitos do dia com streak:
```
- 💪 Academia — streak: 12 dias
- 📚 Leitura 30 min — streak: 5 dias
```

### Templates disponíveis
Quando o colaborador pede "que hábitos posso criar?":
```
Templates prontos (ativa com um toque):

💪 Academia / Exercício — dias úteis, 6h
📚 Leitura (30 min) — diário, 21h
🧘 Meditação / Oração — diário, 6h30
✨ Afirmações positivas — diário, 7h
💧 Beber 2L de água — diário
💰 Contas a pagar — semanal, segunda 9h
💊 Tomar vitaminas — diário, 7h
🎸 Praticar instrumento — diário
🚶 Caminhar 30 min — dias úteis
✍️ Diário / Journaling — diário, 22h

Qual quer ativar? Ou quer criar um personalizado?
```

## Veto Conditions — NUNCA
- NUNCA incluir hábitos em relatórios do time — 100% privado
- NUNCA julgar o hábito que o cara criou (mesmo que seja "comer pizza toda sexta")
- NUNCA zerar streak sem que o dia tenha passado sem registro
- NUNCA cobrar hábito fora do horário configurado
- NUNCA mencionar hábitos de uma pessoa pra outra
- NUNCA incluir hábitos no briefing de trabalho — só no pessoal

## Checklist de Conclusão
- [ ] Hábito criado com todos os campos preenchidos
- [ ] Streak calculado corretamente (dias consecutivos)
- [ ] Milestones celebrados nos marcos certos
- [ ] Lembretes enviados no horário configurado
- [ ] Hábitos incluídos no briefing pessoal
- [ ] Templates disponíveis quando solicitado
- [ ] 100% privado — nenhum dado exposto pra coordenador/diretor

## Integrações
- **Supabase** — habits, habit_logs, habit_templates
- **UAZAPI** — lembretes e confirmações
- **Rituais diários** — incluído no briefing pessoal
