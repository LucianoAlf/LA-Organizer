# Recorrência de pacote de grupo — UMA verdade por ciclo (design)

**Data:** 2026-08-17
**Autor:** Catraca (Claude) + Alf
**Status:** Spec para revisão — NENHUM código antes do OK do Alf.
**Origem:** incidente Rose 17/08 ("não precisa ser mensal, só o primeiro mês" → TOM não achou a própria série). Diagnóstico estrutural completo (subagente) apontou raiz única.

---

## 1. Problema (a raiz, não o sintoma)

Todo pacote de tarefas **recorrente** de grupo nasce com **duas verdades para o ciclo corrente**:

1. O **molde** (`is_group=true`, `recurrence_rule≠null`) é criado com **filhas-blueprint** datadas no mês corrente, `status='pending'`, **sem marcador intrínseco** (`recurrence_rule=null`, `is_group=null`, `recurrence_parent_id=null`).
2. Em seguida, `createTaskGroup` cria à mão a **mãe-instância** do ciclo corrente + **filhas-instância** nas **mesmas datas**.

Resultado no banco (medido — caso Rose "Conferir débito Light", `task-groups.js:96-134`): filha-blueprint "Dia 3" (08-03, pending) **e** filha-instância "Dia 3" (08-03, pending) coexistem, indistinguíveis por qualquer campo de UMA linha — só o **parentesco** (`parent_task_id → molde`) as separa.

### Por que sempre regride

Há **dois critérios de "o que é tarefa viva" no sistema**:

- **Relatório / contexto / PWA** filtram o blueprint por **parentesco** (`filterVisibleGroupTasks` + `idsDeMoldeDosPais`, `utils/group-task-visibility.js:38-43,108-120`). Correto.
- **Handlers de ação** (`complete`/`cancel`/`reschedule`/`TASK_SERIES`) resolvem por **`.ilike('title')`** e veem as **duas** linhas, cada um com sua **heurística por-linha** (`pickInstanceTarget`, `group-chat-tasks.js:87-96`).

Cada incidente Rose (12/06, 17/06, 31/07, 03/08, 05/08, 06/08, 08/08, 12/08, 17/08) consertou **um palpite de um handler**. Nenhuma spec travou por teste a invariante *"criar pacote recorrente ⇒ exatamente UMA verdade por ciclo no banco"* — o design de 09/06 assumiu que o filtro por parentesco esconderia o blueprint **em toda parte**, o que só é verdade no relatório/PWA, nunca nos handlers de chat.

**A dupla árvore (molde × instância) é INTENCIONAL e fica.** O defeito é: (a) a filha-blueprint nasce **datada + pending + sem marcador**, e (b) o predicado de visibilidade existe só no relatório.

---

## 2. Modelo canônico (o alvo)

**Invariante-mãe:** *o blueprint (molde + suas filhas-template) nunca conta como trabalho vivo, e é reconhecível por um predicado de UMA linha que TODO consumidor usa.*

### Mudança de dados — marcador intrínseco

Nova coluna em `tasks`:

```sql
ALTER TABLE tasks ADD COLUMN is_recurrence_template boolean NOT NULL DEFAULT false;
```

- **Molde** (mãe-template): `is_recurrence_template = true`.
- **Filha-blueprint** (filha direta do molde, `recurrence_parent_id IS NULL`): `is_recurrence_template = true`.
- **Mãe-instância, filha-instância, tarefa avulsa:** `false` (default).

**Predicado único de "vivo" (usado em TODO consumidor):** `is_recurrence_template = false`.

### Por que Opção A e não outras

- **NÃO** mexer no motor de recorrência (`materializeSeries` / `series_ended_at`) — está vivo em produção pós-flip; "flip sobre flip" é risco alto. O marcador é aditivo.
- **NÃO** tirar o `due_date` do blueprint (Opção B) — `materializeSeries` deriva `dtstart` de `template.due_date` (`recurrence-engine.js:75-76`) e o caminho "template-only cycle" lê `_tpl.due_date`. Invasivo demais.
- **NÃO** remover a criação eager do ciclo 1 (Opção C) — reintroduz o caso Rose 06/08 (molde É a ocorrência corrente antes de materializar).

A Opção A é a cirurgia mínima que **colapsa as duas verdades numa fonte só** sem tocar no motor.

### Migração dos dados legados

```sql
-- moldes
UPDATE tasks SET is_recurrence_template=true WHERE recurrence_rule IS NOT NULL;
-- filhas-blueprint: filha direta de um molde, sem lineage de instância
UPDATE tasks c SET is_recurrence_template=true
  FROM tasks m
  WHERE c.parent_task_id=m.id AND m.recurrence_rule IS NOT NULL
    AND c.recurrence_parent_id IS NULL;
```

(Validar no banco de produção que o 2º UPDATE só pega blueprint — filha-instância tem `recurrence_parent_id≠null`. Conferido no caso Rose: blueprint `3fde5a17` rpid=null; instância `503a8b8e` rpid=`3fde5a17`.)

---

## 3. Consumidores a refatorar (trocar heurística por predicado)

Todos passam a excluir `is_recurrence_template=true` na query/no filtro. A heurística por-linha (`pickInstanceTarget` etc.) **permanece** para escolher entre instâncias legítimas de ciclos diferentes, mas **nunca mais** recebe blueprint no conjunto.

| Consumidor | file:line | Mudança |
|---|---|---|
| `complete` | `group-chat-tasks.js:342` | query `.eq('is_recurrence_template', false)` antes do `pickVisibleCompletionTarget` |
| `cancel` | `group-chat-tasks.js:447` | idem |
| `reschedule` | `group-chat-tasks.js:479` | idem |
| `TASK_SERIES end` resolver | `group-chat-engine.js:401-406` | resolve o molde por `recurrence_rule≠null` **ou** rótulo composto "Pacote: Filha" → pacote; blueprint fica fora do "vivo" mas o molde É o alvo aqui (exceção consciente) |
| `_resolveByPhraseFallback` | `group-chat-tasks.js` | excluir template do pool |
| `loadContext` (pool do TOM) | `group-chat-engine.js:29-86` | predicado único (hoje usa parentesco — passa a usar o flag; equivalente e mais barato) |
| `group-report-builder` | `group-report-builder.js:204-227` | predicado único (substitui/reforça `filterVisibleGroupTasks`) |

**Regra transversal (asserção do replay):** nenhum resolvedor de ação por título retorna uma linha `is_recurrence_template=true`.

---

## 4. Operação nova: "só o primeiro mês" (de-recur mantendo o ciclo atual)

Hoje **não existe**. `endSeries` (`group-chat-tasks.js:538`) cancela molde + instâncias — **inclusive a corrente** — e ainda deixa filha-blueprint órfã (`parent_task_id=molde` não é tocado). Rose queria: manter agosto, parar setembro+.

**Definição:** `derecur(templateId)`:
1. `series_ended_at = now()` no molde (para o cron; `is_recurrence_template` já o esconde).
2. Cancela instâncias **futuras** (`recurrence_parent_id=molde AND due_date > cicloCorrente`).
3. **Mantém** a mãe-instância + filhas-instância do ciclo corrente.
4. (via §5) blueprint órfão não sobra vivo — já é `is_recurrence_template=true`, invisível.

**Superfície TOM:** estende `<<TASK_SERIES>>` com `action:'derecur'` (além de `end`/`revive`). `end` continua sendo "cancela tudo, inclusive o corrente" (intenção "não faço mais isso"); `derecur` é "para de repetir, mantém o que tá aberto". O LLM escolhe pela intenção — **comportamento do TOM = decisão do Alf** (esta fatia é a única que toca jeito/tom; validar a redação da confirmação com ele).

## 5. `endSeries` limpa órfãs

`endSeries` passa a cancelar também as filhas-blueprint (`parent_task_id=molde`). Sem isso, encerrar série deixa `Dia 3`/`Dia 15` do blueprint pending órfãs (hoje escondidas só por sorte do filtro do relatório; com o flag, invisíveis, mas ainda `pending` no banco — limpar por higiene).

---

## 6. Replay INTEGRAL (o trilho que faltou)

`scripts/replay-lab-cenario-grupo-recorrencia-*.js` — mensagem → engine real → **asserção = contagem no banco** (memória: teste verde ≠ fix → checar o BANCO). Perfil QA de grupo dedicado. Cada cenário é uma fatia de teste; **Fatia 0 roda tudo VERMELHO** (reproduz o bug atual) antes de qualquer fix.

| # | Cenário | Invariante no banco |
|---|---|---|
| 1 | Criar mensal (dias 3 e 15) | `count(filha "Dia 3" viva, mês corrente)` = **1** (hoje=2); 1 molde, 1 mãe-instância, 1 filha-viva por (título,ciclo) |
| 2 | "Só o primeiro mês" (derecur) | 0 molde ativo (`series_ended_at` set); instância corrente pending; 0 filha-blueprint pending órfã |
| 3 | Concluir "Dia 3 feito" | exatamente 1 linha → `done` (a filha-instância corrente); blueprint intocado; relatório sem gêmea aberta |
| 4 | Remarcar data/lembrete | `molde.due_date` + blueprint **inalterados**; instância+filhas movidas em cascata; **0** linhas novas (regressão Rose 31/07) |
| 5 | Encerrar série (`end`) | molde `cancelled`+`series_ended_at`; instâncias futuras canceladas; **0 filha-blueprint pending órfã**; cron não regenera |
| 6 | Vira-mês materializa | `count(instância, próximo mês)` = 1; **re-run idempotente** (2× não muda contagem) |
| 7 | Concluir ciclo template-only (molde sem instância) | materializa a ocorrência já-`done`; molde intacto; sem duplicata |
| 8 | Re-emitir `create` do mesmo pacote | `count(molde ~=título)` = 1; só itens novos entram; nenhuma geração nova |

**Transversal:** todo resolvedor de ação por título, em todos os cenários, retorna **0** linhas `is_recurrence_template=true`.

---

## 7. Fatias (ordem de execução)

0. **Replay que reproduz o bug (VERMELHO).** Cenários 1–8 no motor real; documenta o estado atual (2 verdades). Trava antes de consertar.
1. **Migração + marcador.** Coluna `is_recurrence_template` + backfill legado + `createTaskGroup`/`materializeSeries` setam o flag na criação. Cenário 1 fica verde.
2. **Handlers → predicado único.** Trocar `complete`/`cancel`/`reschedule`/resolvers/`loadContext`/report pra excluir template. Cenários 3,4,7,8 + transversal verdes. Zero-regressão por construção (flag ausente = comportamento de hoje via default false — mas backfill garante).
3. **`derecur` (só o primeiro mês).** Nova ação `TASK_SERIES:derecur` + confirmação. Cenário 2 verde. **Redação da confirmação = OK do Alf.**
4. **`endSeries` limpa órfãs.** Cenário 5 verde.
5. **Validação integral VERDE + limpeza de dados legados.** Todos os cenários verdes na VPS; varredura e cancelamento dos pacotes duplicados legados do grupo Financeiro (e outros grupos, se houver). Registrar KI.

Cada fatia: `.deploy-hold` nas 2 pontas → TDD → suíte VPS baseline (fail 3) → deploy cirúrgico md5 → restart provado → registrar. Rollback: flag de env por fatia onde fizer sentido (ex.: `TOM_GROUP_TEMPLATE_FLAG`).

---

## 8. Riscos e mitigação

- **Migração marca linha errada** → validar os 2 UPDATEs contra o banco real (dry-run count) antes de aplicar; reversível (`is_recurrence_template=false`).
- **Consumidor esquecido** → grep de TODOS os leitores de `tasks` do grupo (memória: varrer READERS por grep quando o contrato muda); o replay transversal pega o que o grep não pegar.
- **`derecur` mexe em comportamento** → fatia isolada, redação validada com o Alf, flag de rollback.
- **Motor de recorrência intacto** → não tocar `materializeSeries`/`series_ended_at` além de setar o flag; regressão de geração é o pior cenário.

---

## 9. Critério de "pronto"

**NÃO** é "helper puro verde". É: **os 8 cenários do replay integral passam na VPS, com as contagens no banco batendo**, e a varredura confirma 0 pacotes duplicados no grupo Financeiro. Enquanto o replay não estiver verde ponta-a-ponta, a refatoração não está pronta.
