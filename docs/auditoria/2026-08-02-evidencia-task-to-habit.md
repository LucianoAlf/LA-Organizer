# Evidência — atomicidade do `<<TASK_TO_HABIT>>`

**Data:** 02/08/2026 · **Origem:** contraponto do Alfredo · **Status:** procede, corrigido e verificado

---

## 1. O contraponto

> *"Antes de considerar fechado eu quero evidência de atomicidade: se criar hábito/lembrete e falhar ao encerrar a série, não pode deixar estado meio convertido. Também mede antes/depois, registra logs/queries."*

**Veredito: procede — e o problema era maior do que o enunciado.**

## 2. O que estava errado

`endSeries1on1` (`src/services/recurrence-engine.js`) executa 3 updates e **não checa `error` em nenhum**:

```js
await supabase.from('tasks').update({ series_ended_at: nowIso })...   // erro ignorado
const rTpl  = await supabase.from('tasks').update({ status: 'cancelled' })...
const rKids = await supabase.from('tasks').update({ status: 'cancelled' })...
return { ended: true, templateId, cancelled };   // ← 'true' incondicional
```

A primeira versão do `convertTaskToHabit` confiava nesse retorno para anunciar *"Encerrei as N tarefas em aberto dessa rotina"*. Ou seja: **o caminho de falha silenciosa produzia uma confabulação** — o TOM afirmando um encerramento que não aconteceu, com a pessoa recebendo lembrete **e** cobrança. É a mesma classe de bug que o chokepoint de honestidade existe para combater, escrita por mim.

Não era hipótese: no Supabase REST, um update sem efeito é o **comportamento padrão** desse código diante de RLS, rede ou constraint.

## 3. A garantia (não há transação — então a garantia é outra)

O Supabase REST não oferece transação multi-statement. Sem ela, o desenho é **escreve → relê o banco → se não bateu, desfaz o que criou**:

| Passo | Garantia |
|---|---|
| 1. Cria hábito + lembrete | `undo` registra **só o que este serviço criou** |
| 2. **Relê** (`verifyHabitSide`) | O lembrete existe no horário certo? Senão → rollback |
| 3. Encerra a série | Só depois do lembrete existir de fato |
| 4. **Relê** (`measure`) | `series_ended_at` preenchido **e** 0 instâncias cobráveis? Senão → rollback |
| 5. Sucesso | Só aqui o retorno diz `ok: true` |

**Regras do rollback:**
- Hábito **reusado** (preexistente) nunca é apagado — não é deste serviço.
- Lembrete que já existia nunca é apagado; só o criado agora.
- Hábito que foi **religado** volta ao estado anterior.
- Rollback que falha **reporta resíduo** e muda o texto ao usuário — nunca engole.

**Por que desfazer em vez de seguir:** o estado meio convertido cobra *e* lembra, com o TOM dizendo que resolveu. Voltar ao estado inicial é pior UX momentânea e melhor honestidade — a pessoa continua como estava e pode tentar de novo.

## 4. Evidência

### 4.1 Testes (28 no serviço; 2061 pass / 3 fail na suíte = baseline)

Os 3 `fail` são pré-existentes e por ambiente (`SUPABASE_URL` ausente em `system-loadout`, `pending-intents-detect`, `group-chat-tasks`).

Testes específicos de atomicidade, com falha injetada no mock — incluindo o modo **silencioso** (update devolve sucesso e não escreve):

- encerramento falha em silêncio → desfaz e volta ao estado inicial
- depois do rollback não há hábito nem lembrete órfão
- hábito reusado **não** é apagado no rollback
- lembrete falha → hábito recém-criado é removido e a rotina não é tocada
- rollback que também falha **reporta resíduo**
- sucesso carrega medição antes/depois
- texto de falha **nunca** afirma conversão (varre os 3 motivos)

### 4.2 E2E contra o banco de produção — 12/12

Mock prova que o mock funciona. Este roda no Postgres real (colaborador de fachada `Admin`, telefone `00000000000`), sabotando o encerramento do mesmo jeito que a falha real se manifesta:

```
ANTES  : {"abertas":3,"serieEncerrada":false,"habitos":0,"lembretes":0}

retorno: {"ok":false,"reason":"series_end_failed",
          "detail":"series_ended_at=null instancias_abertas=3",
          "rolledBack":{"undone":["lembrete","hábito"],"residue":[]}}

texto ao usuário:
_criei o lembrete mas não consegui encerrar a tarefa antiga, então desfiz pra não te
deixar com os dois. Está tudo como antes — tenta de novo em instantes?_

DEPOIS : {"abertas":3,"serieEncerrada":false,"habitos":0,"lembretes":0}

OK   não declarou sucesso — series_end_failed
OK   rollback sem resíduo
OK   NENHUM hábito órfão no banco — habitos=0
OK   NENHUM lembrete órfão no banco — lembretes=0
OK   tarefas continuam cobráveis (como antes) — 3 → 3
OK   série NÃO ficou marcada como encerrada
OK   texto não afirma conversão

--- mesma rotina, sem sabotagem ---
[TaskToHabit] convertido tpl=4c996e52 habit=60aaa8fe freq=daily@09:00 reusado=false
             | serie_aberta 3→0 | total_cobravel 3→0
FINAL  : {"abertas":0,"serieEncerrada":true,"habitos":1,"lembretes":1}
OK   conversão funciona depois do rollback (nada travado)
OK   medição antes/depois bate com o banco — 3 → 0

=== TODAS AS CHECAGENS PASSARAM ===
```

`ANTES` e `DEPOIS` são idênticos: o banco voltou ao estado exato.

### 4.3 Log de produção

Toda conversão bem-sucedida emite uma linha com a medição:

```
[TaskToHabit] convertido tpl=<id8> habit=<id8> freq=<freq>[dias]@<hora>
              reusado=<bool> | serie_aberta N→M | total_cobravel N→M
```

Rollback incompleto emite `[TaskToHabit] ROLLBACK INCOMPLETO — resíduo: <lista>` em `console.error`. No engine, cada uso registra em `marker_logs` (`marker_type='TASK_TO_HABIT'`, `result` `executed`/`rejected`).

### 4.4 Medição antes/depois — caso real (Arthur)

```sql
-- rodar com o collaborator_id alvo
select
 (select count(*) from tasks
    where assigned_to = $1 and status not in ('done','cancelled'))          as cobraveis,
 (select count(*) from tasks
    where assigned_to = $1 and recurrence_rule is not null
      and series_ended_at is null)                                          as series_vivas,
 (select count(*) from habits h join habit_reminders r on r.habit_id = h.id
    where h.collaborator_id = $1 and h.is_active and h.notify_whatsapp
      and r.is_active)                                                      as lembretes,
 (select count(*) from habits
    where collaborator_id = $1 and is_active
      and id not in (select habit_id from habit_reminders where is_active)) as habitos_mudos;
```

| métrica | antes | depois |
|---|---|---|
| tarefas cobráveis em aberto | **51** | **0** |
| séries de tarefa vivas | 3 | 0 |
| lembretes ativos | 1 | 2 |
| hábitos sem lembrete ("mudos") | 0 | 0 |
| tarefas concluídas (histórico) | 53 | 53 |

Reconferido após o hardening: `cobraveis=0, series_vivas=0, lembretes=2, habitos_mudos=0`.

## 5. Limitações — o que ainda NÃO é atômico

Honestidade sobre o alcance da correção:

1. **Janela de crash.** Entre gravar o lembrete e encerrar a série há milissegundos. Se o processo morrer exatamente aí, sobra hábito + tarefa (lembra **e** cobra). É o estado menos danoso dos possíveis, e a operação é idempotente: rodar de novo converge (reusa o hábito, encerra a série). Não há compensação para processo morto — só transação de verdade resolveria.
2. **Resíduo de rollback.** Se o rollback falhar, o estado sujo permanece. Ele é logado e o texto ao usuário muda para avisar — mas ninguém limpa sozinho.
3. **`endSeries1on1` continua sem checar erro.** Não o alterei de propósito: é compartilhado com o engine e com o outro chat, e mudá-lo agora seria mexer em código de terceiro fora do escopo. A proteção aqui é **externa** (releitura). **Recomendação para a etapa E2 da Agenda:** fazer `endSeries1on1` propagar erro, e varrer os outros chamadores dele com o mesmo critério — provavelmente confiam no `{ended:true}` do mesmo jeito.

## 6. Escopo

Fora deste trabalho, por decisão do Alf: migração Hermes/OpenClaw (primeiro estabilizar Agenda) e qualquer mudança em tom/persona do TOM — **nada em `soul/` ou na voz foi tocado**; a única alteração em `prompts/system.js` foi acrescentar o marker à lista canônica e as regras de uso dele.

**Arquivos:** `src/services/task-to-habit.js` · `src/utils/rrule-to-habit.js` · bloco 2.61 de `src/engine.js`
**Known-issues:** `TASK-ROUTINE-NO-REMINDER-ONLY` · `HABIT-REMINDER-TIME-NO-PAD` · `TASKTOHABIT-PARTIAL-STATE`
