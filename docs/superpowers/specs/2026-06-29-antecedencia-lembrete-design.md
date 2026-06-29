# Antecedência de Lembrete — Default novo + Preferência granular

**Data:** 2026-06-29
**Origem:** Feedback da Fabi (collaborator `9df91fd3`): "agendo uma tarefa pro dia X, antes do dia chegar ele fica me lembrando direto; queria que me lembrasse só no dia."
**Tipo:** Feature (PWA + engine + dispatcher) com **impacto global** (muda o default de todos os usuários).

---

## Diagnóstico (causa-raiz, já verificada no banco)

A Fabi **não configurou lembrete nenhum** — `task_reminders` dela está vazia, `tasks.remind_at` é `null`, preferências no padrão. O "lembrando direto" é a **pilha de rituais proativos do dispatcher**, automática. Por tarefa com prazo, hoje:

- **Briefing matinal** (`daily_briefing`/`personal_briefing`) lista tarefas **futuras** ("vence amanhã"/"prazo em X") → a tarefa aparece **toda manhã** até o prazo. **← raiz do "todo dia".**
- **Véspera (D-1):** 2-3 crons sobrepostos disparam no dia anterior:
  - `remindOperationalTasks` (dispatcher ~1163, 09:00 BRT, tarefas com `department_id`) → "⏰ lembrete: X vence amanhã. Tudo certo da sua parte?"
  - `remindPersonalTasks` (dispatcher ~1226, 09:00 BRT, tarefas sem dept/project) → "📌 amanhã está marcado: X."
  - `checkDeadlineAlerts` (dispatcher ~4536, ~15:00 BRT, gated por `notify_deadline_alerts`, claim atômico via `notifications_alert_daily_uq`) → "⏳ lembrete: X vence amanhã. Tá encaminhado?"
  - **Redundância:** a mesma tarefa leva 2 lembretes "vence amanhã" na véspera (≈09h e ≈15h).
- **Fechamento do dia** (19:00, dias úteis) lista o que vence hoje ("fez?").

**Classificação:** NÃO é mau uso da Fabi. NÃO é um bug único — é a soma dos rituais, com **1 defeito claro** (redundância de véspera) + uma **proatividade-por-design** (antecipação diária) que precisa virar configurável.

---

## Goal

1. **Default novo (todos):** lembrete de tarefa com prazo = **véspera (~18h) + no dia (briefing)**. Fim da antecipação diária. Fim da redundância de véspera.
2. **Preferência granular:** seletor "Antecedência de lembrete" em Notificações (Só no dia / Véspera + dia [padrão] / Todos os dias), configurável pela tela **e** pela conversa com o TOM.

## Não-objetivos (YAGNI)

- Antecedência **por contexto** (trabalho vs pessoal separados) — fora.
- Lembrete dedicado "no dia" (cron próprio) — o briefing cobre.
- Mexer no **alerta de atraso** (cobrança pós-prazo, `notify_overdue_alerts`) — independente, não muda.
- **Tarefas de GRUPO** (`remindGroupTasks`, pool compartilhado): fora do escopo desta fatia (preferência é por-usuário; tarefa de grupo é compartilhada → ambiguidade de "qual lead aplicar"). Group reminder segue como está.

---

## Modelo

### Storage
Nova coluna `user_preferences.reminder_lead text` com CHECK `in ('same_day','eve_and_day','daily')`, **default `'eve_and_day'`**.
- **Backfill:** todos os usuários existentes → `'eve_and_day'` (= o novo default; muda a experiência de todos, decisão de produto consciente).
- O `notify_deadline_alerts` binário **sai da UI** (substituído pelo seletor). A coluna pode permanecer no banco (não dropar agora — evita quebrar leituras), mas **deixa de gatear** os crons; o seletor (`reminder_lead`) vira a fonte única.

### Semântica do seletor
| valor | lembrete de véspera ~18h | briefing antecipa tarefas futuras? | no dia |
|---|---|---|---|
| `same_day` (Só no dia) | ❌ | ❌ (só vence-hoje + atrasadas) | ✅ briefing |
| `eve_and_day` (Véspera + dia) **[padrão]** | ✅ | ❌ | ✅ briefing |
| `daily` (Todos os dias) | ✅ | ✅ (comportamento atual) | ✅ briefing |

---

## Componentes / fatias

### F1 — Migration + backfill
- `supabase/migrations/...reminder_lead.sql`: add coluna + CHECK + default `'eve_and_day'`; `UPDATE user_preferences SET reminder_lead='eve_and_day' WHERE reminder_lead IS NULL`.
- Idempotente (IF NOT EXISTS).

### F2 — Cron de véspera consolidado (dispatcher) — helper puro + TDD
- **Helper puro** `src/rituals/reminder-lead.js`: `shouldRemindEve(reminderLead)` = `reminderLead !== 'same_day'`; `briefingAnticipates(reminderLead)` = `reminderLead === 'daily'`. (Funções puras, testáveis isoladas.)
- **Consolidar:** `remindOperationalTasks` + `remindPersonalTasks` + `checkDeadlineAlerts` → **UM** cron `remindDeadlineEve(now)` rodando ~18:00 BRT (= janela UTC 21:00-21:10), gate `reminder_lead != 'same_day'` (lê `user_preferences` do dono), preservando:
  - **tom por contexto:** operacional (corporativo) vs pessoal (leve) — branch pela presença de `department_id`/`context`.
  - **idempotência:** claim atômico (reusar o padrão `notifications_alert_daily_uq` de `checkDeadlineAlerts`) — NÃO reintroduzir check-then-act (regressão Jhonatan 12x).
  - **quiet hours / DND:** manter os gates `isQuietNow`/`getDndState`.
  - **cooldown 6h** (não cobrar tarefa recém-criada/reagendada).
- Remover/aposentar os 3 crons antigos do tick (sem deixar disparo duplicado).
- **Decisão de horário:** ~18:00 BRT (fim do dia), independente de `closing_enabled` e de dia útil (dispara em véspera de segunda).

### F3 — Briefing deixa de antecipar futuras (dispatcher) — helper puro + TDD
- Na seleção de tarefas do briefing (`daily_briefing` + `personal_briefing`), incluir tarefas **futuras** SOMENTE quando `reminder_lead === 'daily'`. Para `same_day`/`eve_and_day`: só **vence-hoje + atrasadas**.
- Isolar a regra num helper puro (`filterBriefingTasksByLead(tasks, reminderLead, todayYmd)`), testado.
- **Não** mexer no layout/voz do briefing — só no conjunto de tarefas listadas.

### F4 — PWA Notificações (UI)
- Em `web/src/.../Configuracoes`, seção **Notificações**: substituir o toggle "Alertas de prazo (D-1)" por um **seletor** "Antecedência de lembrete" (CustomSelect ou segmented, DS — tokens `text-tom`, etc.).
  - Opções: Só no dia · Véspera + dia · Todos os dias. Sub-texto explicando cada um.
- Persistir via o mesmo caminho de auto-save já existente (sem botão Salvar).
- Manter "Alertas de atraso" e "Resumo do time" como estão.

### F5 — TOM seta pela conversa (engine + skill)
- Estender `parsePrefsMarker`/`applyPrefsUpdate` (engine) com campo `reminder_lead` (validar enum; espelhar o padrão de `task_checkin_times`/DND).
- Skill (preferencias / a que cobre PREFS): mapear linguagem natural → enum: "me lembra só no dia"→`same_day`; "véspera e no dia"/"normal"→`eve_and_day`; "me lembra todo dia"/"pode antecipar"→`daily`.
- Anti-confab: só confirmar a mudança se o marker persistiu (Camada 1 já cobre).

### F6 — Validação + rollout
- `node --check` + `node --test` dos helpers; `tsc`+`vite build` do PWA; preview localhost:4173 do seletor.
- **E2E (ficha descartável):** criar tarefa futura pra um colaborador de teste com cada `reminder_lead`, rodar o tick do dispatcher (force) e provar: `same_day`→0 véspera; `eve_and_day`→1 véspera, 0 antecipação no briefing; `daily`→véspera + antecipação. Soft-cleanup.
- Deploy scp + pm2; migration aplicada.
- **Texto pro Alf passar pra Fabi:** "não era você — o TOM tava proativo demais por padrão; ajustamos, e agora dá pra escolher em Configurações › Notificações › Antecedência de lembrete (inclusive me pedindo 'me lembra só no dia')."
- Registrar known-issue (`REMINDER-DAILY-ANTICIPATION-OVERNAG` + redundância de véspera) + memória.

---

## Edge cases / riscos
- **Blast radius global:** todos migram pra `eve_and_day` no deploy → param de receber antecipação diária. Intencional. "Todos os dias" é a válvula de escape.
- **Véspera de segunda / fechamento desligado:** o cron de véspera é independente do fechamento e de dia útil → cobre.
- **Idempotência da véspera:** manter o claim atômico; consolidar 3→1 cron NÃO pode reintroduzir flood (regressão histórica Jhonatan).
- **Tarefa sem `due_date`:** não entra em nenhum lembrete de prazo (já é assim) — só aparece em listas/digest quando `daily`.
- **Tarefa de grupo:** fora de escopo; segue `remindGroupTasks` atual.
- **Atraso:** segue independente (`notify_overdue_alerts`).

## Testes (TDD onde houver lógica pura)
- `reminder-lead.js`: `shouldRemindEve`, `briefingAnticipates` — tabela-verdade dos 3 valores.
- `filterBriefingTasksByLead`: futuras escondidas em same_day/eve_and_day, mostradas em daily; hoje+atrasadas sempre.
- E2E dispatcher (VPS, ficha descartável) cobrindo os 3 modos.
