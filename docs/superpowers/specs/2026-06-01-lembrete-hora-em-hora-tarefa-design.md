# Lembretes por horário na tarefa (incl. "de hora em hora") — Design

**Data:** 2026-06-01
**Origem:** Auditoria do Jhonatan (29/05). Ele pediu "me lembra de hora em hora pra dar presença"; o TOM, sem ferramenta certa, criou 204 tarefas avulsas (bug `BULK-RECUR`). A infra de lembrete por-tarefa já existe — falta expor na UI, ensinar o TOM a usá-la e blindar contra recriação em massa.

**Objetivo:** Permitir que uma tarefa (especialmente recorrente) dispare múltiplos lembretes em horários do dia — inclusive "de hora em hora" numa janela — tanto pela UI quanto por chat com o TOM, sem poluir a lista de tarefas nem spammar o WhatsApp.

---

## Contexto: o que JÁ existe (não construir de novo)

| Peça | Estado | Arquivo |
|---|---|---|
| `task_reminders` (task_id, remind_at, sent_at, label) — N lembretes por tarefa | ✅ existe | tabela Supabase |
| Disparo `checkTaskReminders` — manda "⏰ <label>: *título*", idempotente por linha (sent_at) | ✅ existe | `src/rituals/dispatcher.js` (~4098) |
| Respeita **DND** + **quiet_days/quiet_weekends** (adia, não consome) | ✅ confirmado | `dispatcher.js` (~4132-4144) |
| Engine cria `task_reminders` a partir de `reminders_at[]` do marker | ✅ existe | `src/engine.js` (~4035) |
| Recorrência **clona** os reminders do template pra cada instância (preserva delta) | ✅ existe | `src/services/recurrence-engine.js` `_cloneRemindersForInstances` (~141) |
| UI: Repetição (Diária / Dias úteis seg-sex / Personalizado) + chips de lembrete relativo | ✅ existe | modal de tarefa + `RecurrencePicker.tsx` |
| Componente lista-de-horários ("+ Adicionar horário") | ✅ existe (só em Configurações) | tela Configurações → "Lembretes de tarefas" |

**Implicação:** uma tarefa recorrente (Dias úteis) com 8 `task_reminders` (13h–20h) já produziria, hoje, 8 pings/dia útil clonados pela recorrência, respeitando domingo. O que falta é **input** (UI), **acionamento por chat** (TOM) e **guardrail**.

---

## Decisões (do brainstorm)

1. **Onde aparece:** chips relativos atuais **E** lista de horários absolutos, **sempre visíveis** no modal de tarefa.
2. **Como preenche:** lista manual (reaproveitada das Config) **+ gerador de intervalo** ("de [X] às [Y], a cada [1h | 30min]") que expande em linhas editáveis.
3. **TOM no chat:** monta o resumo e **confirma via `pending_intents` ANTES de gravar** ("vou criar 1 tarefa recorrente seg-sex, lembrete de hora em hora 13–20h — confirma?").
4. **Check-in global** (`task_checkin_times`): **fora de escopo** — mantém como está, reavalia depois.
5. **Guardrail:** teto de **10** tarefas quase idênticas por lote de criação → engine **bloqueia** e TOM oferece o caminho recorrente.
6. **Domingo/fim de semana:** sem código novo — recorrência "Dias úteis" não materializa sáb/dom + silêncio global de domingo como rede.

---

## Arquitetura — 3 camadas

### Camada 1 — Dados (mínima)
- Núcleo usa `task_reminders` como está. **Sem mudança de schema** para o caminho principal.
- Os horários da lista viram **linhas concretas** em `task_reminders` (uma por horário), com `label` legível (ex: `"13h"`). O gerador de intervalo é conveniência de UI/engine que **expande** em linhas — não há coluna "intervalo" persistida (YAGNI).
- Numa tarefa **recorrente**, os reminders ficam no **template**; a recorrência clona pra cada instância (já existe). Ver "Risco timezone" abaixo.

### Camada 2 — UI (PWA) — maior parte do trabalho novo
- **Extrair** o componente de lista-de-horários hoje embutido em Configurações para um componente compartilhado (ex: `ReminderTimesField.tsx`), consumido por Configurações **e** pelo modal de tarefa (DRY; segue Guardrail Desktop — não quebrar mobile).
- No modal de tarefa, abaixo dos chips de lembrete relativo, nova sub-seção **"Horários"** (sempre visível):
  - Lista de `TimeInput` (DS) + "+ Adicionar horário" (idêntico a Config).
  - **Gerador de intervalo:** três controles — início (`TimeInput`), fim (`TimeInput`), "a cada" (`CustomSelect`: 1h | 30min) — e um botão "Gerar" que preenche a lista (horários editáveis/removíveis depois).
- Ao salvar a tarefa, cada horário da lista → 1 `task_reminders` (no template, se recorrente; na tarefa, se avulsa).

### Camada 3 — Engine + TOM
- **Skill** (nova `lembrete-recorrente.md` ou estender `criar-recorrencia.md`): mapear "rotina repetida de hora em hora / em vários horários" → **1 tarefa** com `recurrence_rule` (ex: Dias úteis) **+ `reminders_at[]`** (horários do dia). NUNCA N tarefas.
- TOM monta o **resumo** e cria um `pending_intent` ("Confirmo?"); só grava após o "sim" do usuário (reusa o fluxo existente de pending_intents).
- O marker `TASK_UPDATE` action=create já aceita `recurrence_rule` + `reminders_at[]` — sem mudança no parser. Validar que os dois juntos funcionam num único create.

### Guardrail anti-bomba (`applyTaskActions`)
- Antes de aplicar um lote de `create`: se o lote contém **> 10** ações de create com **título normalizado idêntico/quase idêntico** (mesma `lower(trim(title))`), **bloqueia o lote** e retorna mensagem orientando o caminho recorrente (TOM repassa: "isso é uma rotina — melhor 1 tarefa recorrente com lembretes; quer que eu monte assim?").
- Independente da skill (backstop mesmo se o LLM ignorar a orientação). Auto-retry já está proibido de criar (fix 01/06).
- `log`/telemetria: registrar `BULK_CREATE_BLOCKED` em `marker_logs` para o radar.

---

## Fluxo de dados (caso Jhonatan, via chat)
1. Jhonatan: "me lembra de dar presença de hora em hora, seg a sex, das 13h às 20h."
2. TOM monta resumo (1 tarefa recorrente Dias úteis + lembretes 13–20h, 8 horários) → cria `pending_intent`, pergunta "confirma?".
3. Jhonatan: "sim" → engine resolve o intent, emite UM `TASK_UPDATE` create com `recurrence_rule=Dias úteis` + `reminders_at=[13:00..20:00]`.
4. Engine cria o template + 8 `task_reminders`. Ritual de recorrência (00:30) materializa instâncias dos dias úteis, clonando os 8 reminders por dia.
5. `checkTaskReminders` dispara cada horário, respeitando DND/silêncio. Domingo não tem instância. Lista de tarefas mostra 1 tarefa/dia, não 8.

## Fluxo de dados (via UI)
1. Usuário cria tarefa "Dar presença", Repetição = Dias úteis.
2. Na sub-seção "Horários", usa o gerador: 13h → 20h, a cada 1h → 8 linhas.
3. Salva → template + 8 `task_reminders`. Mesma materialização/disparo acima.

---

## Tratamento de erros / riscos
- **Risco timezone (clock-time na clonagem):** `_cloneRemindersForInstances` preserva o **delta** entre `remind_at` e o anchor (`due_date`). Para horários de relógio (13h em BRT) em tarefa recorrente, validar que o delta reproduz o **mesmo HH:MM local** em cada dia, sem drift por UTC/DST. Teste explícito no plano; se houver drift, ancorar por HH:MM local em vez de delta absoluto.
- **Edição de horários depois:** alterar a lista no template deve refletir nas instâncias **ainda não materializadas** (clonagem no próximo ritual, idempotente). Instâncias futuras **já materializadas** podem precisar de re-sync — definir no plano (re-clonar diferença ou re-gerar instâncias futuras do template).
- **Guardrail vs. recorrência legítima:** o teto conta apenas ações `create` **avulsas** idênticas; um único create com `recurrence_rule` (que materializa N dias) **não** é bloqueado (é o caminho certo).
- **Tarefa avulsa com horários no passado:** ignora horários já vencidos no dia (não cria reminder retroativo).

## Testes
- **Backend:**
  - Recorrência clona reminders preservando HH:MM local por instância (incl. virada de DST se aplicável).
  - Guardrail bloqueia lote > 10 títulos idênticos; permite 1 create recorrente.
  - `checkTaskReminders` respeita DND + quiet_days (regressão — já existe).
- **TOM:** "me lembra de hora em hora pra dar presença seg-sex 13-20h" → 1 create recorrente + 8 reminders_at, com confirmação `pending_intent` antes.
- **UI:** gerador de intervalo (13→20 a cada 1h = 8; a cada 30min = 15) gera linhas corretas; componente compartilhado funciona em Config e no modal; mobile 375px e desktop 1440px intactos.

## Fora de escopo
- Remover/alterar o check-in global (`task_checkin_times`).
- Horários diferentes por dia-da-semana na mesma tarefa (ex: sáb 8–15h + seg-sex 13–20h) — usuário cria 2 recorrências se precisar.
- Lembrete relativo (chips) — permanece como está.
