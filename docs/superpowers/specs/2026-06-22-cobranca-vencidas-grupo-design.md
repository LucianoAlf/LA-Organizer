# Spec — Precisão da cobrança de tarefas vencidas (auditoria 22/06)

**Data:** 2026-06-22
**Origem:** auditoria TOM das 07h de 22/06 — alerta "5/30 vencidas (2+ dias) sem cobrança nas últimas 48h".
**Escopo:** corrigir a *precisão* do alerta de cobrança + fechar o buraco de cobertura de grupo. NÃO mexe no chaser individual (funciona) nem na voz do TOM.

---

## 1. Problema

O relatório das 07h acusa cronicamente tarefas vencidas "sem cobrança". O Alf pediu a raiz, com a ressalva de **não regredir nem quebrar nada**.

## 2. Raiz (investigada e provada)

A cobrança **não está quebrada**: o chaser individual `checkOverdueAlerts` (dispatcher.js:4712) disparou 49 `overdue_alert` + 16 `deadline_alert` em 3 dias. O alerta é, na maior parte, **falso-positivo estrutural**:

1. **Auditor mede no canal errado.** `checkOverdueTasks` (health-check.js:128) decide "foi cobrada?" só pela tabela `notifications` (`overdue_alert`/`deadline_alert`). Esse canal é alimentado **exclusivamente** pelo chaser individual, que só cobra quem tem dono (`ids = tasks.map(t => t.assigned_to).filter(Boolean)`, dispatcher.js:4732). **Tarefa de grupo (`assigned_to = null`) nunca gera notification.** A cobrança de grupo é um sistema paralelo (`dispatchGroupReports`, group-reports.js) que grava em `group_ritual_logs`/`group_chat_messages`, nunca em `notifications`. → O auditor é cego à cobrança de grupo e reporta toda tarefa de grupo vencida como "sem cobrança", para sempre.
2. **Grupo nasce mudo.** Cobrança de grupo depende de `group_notification_settings`. Só o **Financeiro** tem; **MKT e outros 5 grupos** não têm nada. As 3 "REC Boas vindas" (MKT) são atraso real sem cobertura.
3. **`retroativa` por design.** O builder (`group-report-builder.js:69-73`) exclui tarefas cadastradas já vencidas. As 6 antigas do Financeiro (Rose lançou já vencidas) caem aqui → preset `overdue` roda 10:30 e sai vazio → skip. (Fora do escopo deste fix — tratado com educação à Rose.)
4. **Timing** (não-bug): chaser roda 13–19h; auditor roda 07h → vencidas de sexta + fim de semana quiet aparecem de manhã, são cobradas no mesmo dia.

**Mau uso (humano, fora de código):** Peterson 19 vencidas + "concluída" no título; Rose lança retroativo; Juliana/Jordan/Anne acúmulo. Tratado com os textos educativos (entregues à parte).

## 3. Decisões (aprovadas pelo Alf, 22/06)

- **Auditor:** tirar tarefas de grupo do check individual **+ um sinal próprio** que avisa quando um grupo tem atrasada real e a cobrança dele está desligada.
- **Cobertura:** ligar a cobrança de atrasadas no **MKT** agora + **grupo novo nasce coberto** por padrão.
- **`retroativa`:** fora deste fix (decisão de produto adiada; resolve com educação).

## 4. Design — 4 peças isoladas

### A. Auditor alinha ao chaser — `checkOverdueTasks` (health-check.js)
Adicionar `.not('assigned_to', 'is', null)` à query de tarefas vencidas (~linha 143-148). O auditor passa a medir **exatamente o universo que o chaser cobre** (tarefas com dono individual). Tarefas de grupo e órfãs saem do "sem cobrança individual". Nenhuma outra linha muda; o texto do `detail` permanece.

### B. Check novo `uncovered_groups` (health-check.js + função pura)
- **Função pura** `summarizeUncoveredGroups({ groups, coveredGroupIds, tasksByGroup, today, minDaysLate = 2 })` (novo módulo testável, ex.: `src/services/uncovered-groups.js`):
  - Para cada grupo **sem** `overdue` ligado, conta tarefas vencidas **reais**: `due_date < today` **E** não-retroativa (`created_ymd <= due_date`) **E** atraso ≥ `minDaysLate` (2, alinhado ao auditor).
  - Retorna `{ count, groups: [{ name, overdue }] }`.
- **Check** `checkUncoveredGroups()`: faz o IO (lê `work_groups`, `group_notification_settings` com `preset='overdue' AND enabled`, tarefas de grupo abertas), chama a função pura, retorna `{ status: count>0 ? 'warning' : 'ok', detail }`.
  - `detail` (warning): `🔴 N grupo(s) com atrasada e cobrança desligada: MKT (3)`.
  - `detail` (ok): `Nenhum grupo com atrasada descoberta`.
- Adicionar `['uncovered_groups', checkUncoveredGroups]` ao `ALL_CHECKS` (health-check.js:563), logo após `overdue_tasks`. O runner já isola cada check em try/catch (health-check.js:586-596) e o `formatHealthReport` já imprime qualquer check `warning` (dispatcher.js:5733) — **nenhuma mudança no formatador**.

### C1. Backfill MKT — migration (idempotente)
```sql
insert into group_notification_settings (group_id, preset, enabled, weekdays, time_local)
select id, 'overdue', true, '{1,2,3,4,5,6}', '10:30'
from work_groups where name = 'MKT'
on conflict (group_id, preset) do nothing;
```
Espelha o Financeiro. A partir de amanhã 10:30 o MKT recebe a cobrança das 3 atrasadas reais.

### C2. Grupo novo nasce coberto — trigger (migration)
```sql
create or replace function fn_group_default_notifications()
returns trigger language plpgsql security definer as $$
begin
  insert into group_notification_settings (group_id, preset, enabled, weekdays, time_local)
  values (NEW.id, 'overdue', true, '{1,2,3,4,5,6}', '10:30')
  on conflict (group_id, preset) do nothing;
  return NEW;
exception when others then
  return NEW;  -- nunca derruba a criação do grupo
end; $$;

drop trigger if exists trg_group_default_notifications on work_groups;
create trigger trg_group_default_notifications
after insert on work_groups
for each row execute function fn_group_default_notifications();
```
(`drop trigger if exists` antes do `create` torna a migration re-executável.)
Default conservador: **só** `overdue` (não floda grupo novo). `SECURITY DEFINER` ignora RLS do criador; `ON CONFLICT` + `EXCEPTION` garantem que nunca quebra a criação do grupo. Cobre o caminho atual (PWA, `useWorkGroups.ts:57`) e qualquer futuro.

## 5. Cerca anti-regressão (NÃO tocar)
- Chaser individual `checkOverdueAlerts` (49 alertas/3d). · Regra `retroativa` do builder. · Janela 13–19h, quiet, claims atômicos. · `formatHealthReport`. · Voz/jeito/tamanho das respostas do TOM.

## 6. Plano de teste
- **A:** SQL replicando a contagem do auditor com e sem o filtro `assigned_to not null` — provar que as de grupo somem e o resto fica igual.
- **B:** testes unitários da função pura (`node --test`): grupo descoberto com atrasada real → flag; grupo com `overdue` ligado → não; só retroativa → não; atraso <2d → não; grupo sem tarefa → não. + validação ponta-a-ponta: rodar `checkUncoveredGroups()` no banco real **antes** do backfill C1 (deve listar `MKT (3)`) e **depois** (MKT some, vira `ok`).
- **C1:** query confirmando o preset `overdue` do MKT.
- **C2:** `BEGIN; insert work_groups(...); select preset...; ROLLBACK;` num único `execute_sql` — confirma que o trigger cria o preset, sem deixar resíduo.
- **Smoke:** `node --check` nos arquivos tocados + `runHealthCheck()` inline na VPS conferindo `overdue_tasks` e `uncovered_groups`.

## 7. Ordem de implementação e deploy
1. B (função pura + testes TDD) → A (filtro) → conferir local.
2. Migrations C1 + C2 via Supabase MCP.
3. SCP de `health-check.js` + novo módulo p/ VPS + `pm2 restart tom`.
4. Smoke na VPS (`runHealthCheck()` inline).
5. Auto-deploy hook commita/pusha no fim do turno.

## 8. Registro
- `tom_known_issues`: `GOVAUDIT-GROUP-OVERDUE-BLINDSPOT` (área `health-check`, status `corrigido`) ao concluir.
- Atualizar `project_audit_0622_cobranca_grupo` na memória (de "fix em brainstorm" → "entregue").

## 9. Riscos e mitigações
| Risco | Mitigação |
|---|---|
| Filtro A esconde tarefa individual legítima | O filtro espelha exatamente o chaser; tarefa sem dono nunca foi cobrável individualmente. Validação SQL antes/depois. |
| Check B com falso-positivo (retroativa/financeiro) | Função pura exclui retroativa e exige ≥2d; testes cobrem. Isolado em try/catch. |
| Trigger C2 derruba criação de grupo | `ON CONFLICT DO NOTHING` + `EXCEPTION WHEN OTHERS → return NEW`. Pior caso: grupo sem preset (degradação graciosa), nunca falha. |
| MKT passa a "spammar" o grupo | É o comportamento desejado e aprovado; só atrasadas reais (3), 1×/dia 10:30. |
