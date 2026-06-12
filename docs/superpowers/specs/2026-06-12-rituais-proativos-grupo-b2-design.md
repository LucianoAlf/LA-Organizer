# B2 — Rituais proativos + Notificações do grupo — Design

**Data:** 2026-06-12
**Autor:** TOM dev (sessão com Alf)
**Status:** Aprovado (design) — pendente review da spec escrita
**Depende de:** B1 (relatórios sob demanda) — reaproveita `src/services/group-report-builder.js`
**Continuação de:** Chat de grupo Fase 4 v2 (espelho WhatsApp↔app) + Workspace de Grupos

---

## 1. Objetivo

Hoje o TOM só gera relatório do grupo **quando pedem** (B1). A B2 faz o TOM mandar
relatórios **sozinho**, em horários configuráveis, direto no chat do grupo — e o
espelho pro WhatsApp acontece automaticamente (bridge-out já existe). As líderes/membros
configuram **o quê**, **em que dia** e **a que horas** numa tela nova de Notificações
dentro do painel do grupo.

Resultado esperado: o grupo "Financeiro" recebe, por exemplo, todo dia útil às 08h um
"☀️ Bom dia! Hoje vocês têm: …", toda segunda um panorama da semana, e dia 1º um
panorama do mês — sem ninguém pedir.

---

## 2. Decisões (todas confirmadas no brainstorm)

1. **4 presets entram no v1** (cada um = um `buildGroupReport` agendado).
2. **Controle total por preset**: liga/desliga + dia(s) + horário. Os horários que o
   código traz são apenas **fallback**; a tela permite mudar dia e hora.
3. **Ligado sempre dispara**, mesmo sem conteúdo (bom dia vazio = "dia livre 😉";
   semanal/mensal vazios = "tudo tranquilo"). Exceção: **cobrança de atrasadas** só
   dispara se houver atrasadas (senão não faria sentido — não é "relatório", é "nudge").
4. **Permissão: qualquer membro do grupo** pode editar as notificações.
5. **Layout: acordeão (A)** — preset desligado fica recolhido (só título + toggle);
   ligado revela dia(s) + horário.

---

## 3. Presets

Cada preset mapeia para uma chamada de `buildGroupReport` com um `heading` e, no caso
do overdue, um modo especial:

| preset (enum)   | scope     | window | onlyOverdue | heading (com {grupo})                 | fallback dia/hora           |
|-----------------|-----------|--------|-------------|---------------------------------------|-----------------------------|
| `daily_morning` | `agenda`  | `hoje` | não         | ☀️ Bom dia, {grupo}! Hoje vocês têm:  | seg–sex, 08:00              |
| `weekly`        | `tudo`    | `semana`| não        | 📅 Semana do {grupo}                  | segunda, 08:00              |
| `monthly`       | `tudo`    | `mes`  | não         | 🗓️ Mês do {grupo}                     | dia 1, 08:00                |
| `overdue`       | `tarefas` | (n/a)  | sim         | ⏰ {grupo}: tarefas atrasadas         | seg–sex, 09:00              |

**Conteúdo vazio:** os 3 primeiros sempre montam o card (mesmo com 0 itens — o builder
já renderiza "(nada no período)" / seção "🎉 Tudo limpo"). O `overdue` é o único que faz
short-circuit: se não houver nenhuma tarefa atrasada, **não insere mensagem nenhuma**.

---

## 4. Arquitetura

```
cron (a cada 5 min)
  → src/rituals/dispatcher.js  (tick já existente)
      → dispatchGroupReports(now)        [NOVO — src/rituals/group-reports.js]
          1. carrega settings habilitados (group_notification_settings join work_groups)
          2. p/ cada setting: matchSchedule(now, setting)?  (dia + slot de horário)
          3. claim atômico em group_ritual_logs (group_id, preset, ymd)  → idempotência
          4. (overdue) consulta atrasadas; se 0 → libera claim e pula
          5. buildGroupReport({ scope, window, heading, onlyOverdue })   [B1 estendido]
          6. insere group_chat_messages { kind:'report', role:'tom', channel:'app', ... }
  → bridge-out (watcher já existente) espelha a row channel='app' pro WhatsApp
  → app renderiza o card via realtime (já existente)
```

Nenhuma mudança no bridge-out nem no render do app: a B1 já provou que um card
`kind='report'` channel='app' espelha e renderiza. A B2 só **produz** esses cards por
cron em vez de por marker.

---

## 5. Dados (Supabase — 2 tabelas novas, project `cesnbnrynvxvgdhfmaua`)

### 5.1 `group_notification_settings`
Uma linha por (grupo, preset). Default: não existe linha = preset desligado.

| coluna        | tipo        | notas                                                            |
|---------------|-------------|------------------------------------------------------------------|
| id            | uuid PK     | `gen_random_uuid()`                                              |
| group_id      | uuid FK     | → `work_groups(id)` ON DELETE CASCADE                           |
| preset        | text        | CHECK in ('daily_morning','weekly','monthly','overdue')         |
| enabled       | boolean     | default true (a linha só é criada quando a pessoa liga/edita)    |
| weekdays      | int[]       | dias da semana 1=seg..7=dom. Usado por daily_morning, weekly, overdue. weekly usa array de 1 elemento. |
| day_of_month  | int         | 1..28 (evita 29/30/31 inexistentes). Usado só por monthly.       |
| time_local    | text        | 'HH:MM' (fuso SP). default conforme fallback do preset.          |
| created_at    | timestamptz | default now()                                                    |
| updated_at    | timestamptz | default now() (trigger ou set no upsert)                         |

**Único:** `(group_id, preset)`.
**RLS:** SELECT/INSERT/UPDATE/DELETE liberado para **membros do grupo**
(`EXISTS (SELECT 1 FROM work_group_members m WHERE m.group_id = group_notification_settings.group_id AND m.collaborator_id = current_collab_id())`).
Usa `current_collab_id()` (não `auth.uid()`) — ver [[reference_collab_id_vs_auth_uid]].
O **caminho service_role do cron ignora RLS** (lê via service_role) — ver
[[feedback_sensitive_data_service_role]]; aqui não há dado sensível, só config.

> Confirmar na implementação o nome real da tabela de membros (`work_group_members`?) e
> da função `current_collab_id()`/membership helper, lendo o RLS já existente de
> `group_chat_messages` (mesmo grupo). Degrada para o padrão que já estiver em uso.

### 5.2 `group_ritual_logs`
Idempotência do cron (espelha `ritual_logs` + `claimRitualSend`).

| coluna         | tipo        | notas                                              |
|----------------|-------------|----------------------------------------------------|
| id             | uuid PK     |                                                    |
| group_id       | uuid FK     | → `work_groups(id)` ON DELETE CASCADE             |
| preset         | text        |                                                    |
| reference_date | date        | ymd SP do disparo                                  |
| sent_at        | timestamptz | default now()                                      |

**Índice único:** `(group_id, preset, reference_date)` → o INSERT é o claim atômico
(23505 = já disparou hoje → skip). RLS não é necessária (acesso só via service_role no
cron); habilitar RLS sem policy (deny-all) para satisfazer o linter do Supabase.

---

## 6. Backend

### 6.1 `src/services/group-report-builder.js` (estender — B1)
- `buildGroupReport` ganha 2 params opcionais:
  - `heading` (string): substitui o título padrão "📊 Relatório do {grupo} — {label}".
    Se ausente, mantém o comportamento atual da B1.
  - `onlyOverdue` (bool): quando true, monta uma única seção só com tarefas **atrasadas**
    (`due_date < hoje`, `status != done`), ordenadas por data. Retorna
    `{ html, isEmpty }` — `isEmpty=true` quando não há atrasadas (o cron usa isso pra
    pular o overdue). Para os outros presets `isEmpty` reflete "0 itens em todas as seções"
    mas **não** bloqueia o envio (decisão: sempre manda).
- Sem quebra de contrato com a B1: chamadas sem os novos params se comportam idêntico.

### 6.2 `src/rituals/group-reports.js` (NOVO)
Funções puras (testáveis sem DB) + uma orquestradora:
- `matchSchedule(now, setting)` → bool. `now` = `nowSaoPaulo()` ({hour,minute,dow,ymd}).
  - daily_morning/weekly/overdue: `setting.weekdays.includes(dowToIso(now.dow))` &&
    `currentSlot(now) === timeToSlot(setting.time_local)`.
  - monthly: `Number(now.ymd.slice(8,10)) === setting.day_of_month` && slot bate.
  - reaproveita `timeToSlot`/`currentSlot` do dispatcher (extrair pra util compartilhada
    ou replicar — decidir na implementação; preferir importar do dispatcher se exportável).
- `presetConfig(preset)` → `{ scope, window, onlyOverdue, headingTemplate }` (tabela §3).
- `dispatchGroupReports({ now, supabase, deps })`:
  1. query settings `enabled=true` + nome do grupo (`work_groups.name`, `wa_group_jid`).
  2. filtra por `matchSchedule`.
  3. **overdue (caso especial):** roda o builder com `onlyOverdue` PRIMEIRO; se `isEmpty`
     → não claima e pula (sem mensagem). Só quando há atrasadas é que segue pro claim+envio.
  4. **demais presets:** claim `group_ritual_logs` (insert; 23505 → já disparou hoje → skip)
     ANTES de montar — sempre enviam, então claim primeiro evita corrida entre ticks.
  5. monta `buildGroupReport({ scope, window, heading })` (ou o html do overdue do passo 3)
     e insere `group_chat_messages { group_id, sender_id:null, role:'tom', kind:'report',
     content: html, channel:'app' }` (mesma forma do card da B1/closing).
  6. log estruturado por disparo (grupo, preset, enviado/skip/motivo).
- Erros nunca derrubam o tick (try/catch por setting, como os outros rituais).

### 6.3 `src/rituals/dispatcher.js` (1 linha no tick)
Adicionar `await dispatchGroupReports({ now: nowSaoPaulo(), supabase, deps })` junto aos
outros checks do tick (perto de `remindGroupTasks`). Falha isolada não derruba o resto.

---

## 7. PWA — tela de Notificações (layout acordeão)

Dentro do `GroupConfigPanel` (já existe, do Workspace de Grupos), nova seção
**🔔 Notificações**.

### 7.1 `web/src/lib/groupNotifications.ts` (puras + data)
- `PRESETS`: lista ordenada `[daily_morning, weekly, monthly, overdue]` com label, emoji,
  descrição curta e defaults (weekdays/day_of_month/time).
- `defaultSetting(preset)` → objeto com os fallbacks.
- `validateSetting(setting)` → normaliza (weekdays únicos/ordenados; day_of_month 1..28;
  time 'HH:MM').
- `loadGroupNotifications(groupId)` / `upsertGroupNotification(setting)` /
  `deleteGroupNotification(groupId, preset)` (supabase client do PWA).

### 7.2 `web/src/screens/grupos/config/GroupNotificationsSection.tsx`
- Acordeão: cada preset é uma linha. `Toggle` (on/off). Ligar cria/edita a linha
  (`enabled=true`); desligar mantém a linha com `enabled=false` (preserva dia/hora
  escolhidos) — ou deleta? **Decisão:** mantém a linha com `enabled=false` (não perde a
  config quando reativar).
- Ligado expande: chips de dias da semana (daily/weekly/overdue) **ou** `CustomSelect` de
  dia-do-mês (monthly) + `TimeInput` (DS) pro horário.
- weekly: chips de dia da semana em **modo single-select** (um dia só).
- **Auto-save com debounce** (mesmo padrão de Configurações — sem botão Salvar).
- Componentes do DS obrigatórios: `CustomSelect`, `TimeInput`, toggle existente, tokens
  `bg-bg-surface`/`text-tom`/`border-border`. Usa cor **`tom`** (verde), nunca `brand` —
  ver [[project_brand_tom_convention]].

### 7.3 Integração
- `GroupConfigPanel` importa e renderiza `<GroupNotificationsSection groupId={...} />`.
- Mobile (375px) e desktop (1440px) — guardrail desktop respeitado (a seção é responsiva,
  sem tela duplicada nova).

---

## 8. Testes

- **Puras backend** (`node --test`):
  - `group-report-builder`: `heading` custom aparece no card; `onlyOverdue` lista só
    atrasadas e `isEmpty` correto (0 atrasadas → true).
  - `group-reports`: `matchSchedule` p/ cada preset (weekday certo/errado, slot certo/errado,
    monthly dia-do-mês certo/errado); `presetConfig` mapeia direito.
- **Puras PWA** (vitest): `validateSetting` (normalização), `defaultSetting`.
- **e2e na VPS** (grupo Financeiro `d95f63af-5032-4120-89f2-ca4c49684cbc`):
  - `node src/rituals/dispatcher.js --force=group_reports` (ou script dedicado
    `scripts/force-group-report.js`) → confirma card no chat + espelho no WhatsApp.
  - Ligar/desligar na tela e confirmar persistência + RLS (membro consegue editar).

---

## 9. Fora de escopo (v1)

- Presets customizados (criar um relatório novo do zero). v1 = os 4 fixos.
- Notificações por pessoa dentro do grupo (é sempre no chat do grupo, pra todos).
- Escolher scope/janela arbitrários por preset na tela (o scope/window de cada preset é
  fixo pelo design; a pessoa só liga/desliga + dia/hora).
- Quiet hours / DND no grupo (elas controlam o horário; canal de grupo não é 1:1).

---

## 10. Riscos e mitigação

- **Spam acidental:** preset default é "linha inexistente = desligado". Nada dispara até
  alguém ligar. Mitiga grupo recebendo coisa sem querer.
- **Duplo envio nos ticks de 5 min:** claim atômico `group_ritual_logs` (índice único)
  garante 1 envio por (grupo, preset, dia). Mesmo padrão provado em `ritual_logs`.
- **Fuso/virada de dia:** tudo em SP fixo `-03:00` via `nowSaoPaulo()` — sem
  `toISOString().slice` (ver [[project_localymd_utc_shift]]).
- **Mudança de schema de membros:** o RLS depende do nome real da tabela de membros e do
  helper de membership — confirmar lendo o RLS de `group_chat_messages` antes de aplicar a
  migration; degradar pro padrão vigente.
