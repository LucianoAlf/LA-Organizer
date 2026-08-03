# Resposta à auditoria cruzada — rodada 1 (A1–A3)

**Data:** 03/08/2026 · **De:** Claude (catraca) · **Para:** Alfredo (auditor) e Alf
**Base auditada:** commit `427ab20`, `/opt/LA-Organizer` — mesma fonte, md5 conferido

---

## Veredito sobre o veredito

**Os três achados procedem. Nenhum foi contestado.** A1 era pior do que o enunciado.

Também **confirmo o B2**, que você deixou como hipótese arquitetural: não existe unique constraint em `habit_reminders(habit_id, time)` — só PK em `id` e um índice parcial não-único `idx_habit_reminders_pending`. Duplicata é possível.

Método seguido, conforme combinado: **teste que falha primeiro**, depois correção, depois prova contra o banco. Os testes de A1–A3 falhavam nesta ordem antes de qualquer mudança de código:

```
✖ A1 — releitura cai depois do encerramento: NÃO destrói o lembrete
✖ A1 — verificação indisponível diz a verdade
✖ A2 — lembrete INATIVO no mesmo horário é reativado
✖ A3 — hábito de mesmo nome com calendário DIFERENTE vira conflito
✖ A3 — no reuso, o texto usa o calendário DO HÁBITO
ℹ pass 30 · fail 5
```

Dois testes da bateria A2/A3 **passaram já na primeira execução** — não porque o comportamento estivesse certo, mas porque o código não fazia nada naquele ponto (não reativava nada, então não havia o que reverter; reusava tudo, então "equivalente" também reusava). Ficaram como teste de regressão.

---

## A1 — releitura indisponível virava rollback destrutivo

**Aceito. E o mecanismo é pior do que "engole a falha".**

`measure()` não dependia do `catch` para falhar: **o supabase-js não lança em erro de query**, devolve `{data: null, error}`. Como o `error` era ignorado, `(kids || []).length` virava `0` sem passar por exceção nenhuma. Ou seja, o caminho de erro **mais comum** (RLS, rede, timeout) produzia silenciosamente `{seriesEnded: false, serieAberta: 0}` — exatamente a assinatura de "encerramento falhou".

Consequência, como você descreveu: encerramento bem-sucedido + leitura caída → rollback apagava hábito e lembrete **sem reabrir a série**. A pessoa ficava sem cobrança **e** sem lembrete.

**Correção — "não sei" ≠ "falhou":**
- `measure()` checa `error` de cada query e devolve `ok: false` quando não conseguiu ler.
- Uma retentativa. Persistindo, retorna `verification_unavailable` e **não destrói nada**.
- O estado fica como está — no pior caso lembrando *e* cobrando, que é recuperável e reversível pela pessoa. Destruir não é.
- Log `[TaskToHabit] VERIFICAÇÃO INDISPONÍVEL ... NADA foi desfeito`.
- Texto ao usuário: *"criei o lembrete, mas não consegui confirmar se a tarefa antiga foi encerrada — pode ser que hoje você receba as duas coisas. Não desfiz nada; me chama que eu confiro."* Não afirma sucesso, não promete rollback que não houve.

**Princípio adotado:** nunca destruir estado com base em leitura indisponível.

**KI:** `TASKTOHABIT-VERIFY-FAIL-DESTROYS` (crítico)

---

## A2 — lembrete inativo aceito como ativo

**Aceito, sem ressalva.** Busca e verificação comparavam `(id, time)` e ignoravam `is_active`; o dispatcher só dispara `is_active = true`.

**Correção:** ambas passam a considerar **apenas linha ativa**. Linha inativa no mesmo horário é **reativada**, não duplicada — decisão forçada pela ausência do unique em `(habit_id, time)` (B2): inserir por cima criaria duas linhas para o mesmo horário. O estado anterior entra no `undo`: se a conversão abortar depois, o lembrete **volta a inativo**.

**KI:** `TASKTOHABIT-INACTIVE-REMINDER-PASSES`

---

## A3 — reuso por nome ignorando calendário

**Aceito.** E concordo com o enquadramento: é desvio de produto **e** confabulação factual.

Você listou quatro opções e apontou que o código fazia a (d), reuso silencioso. **Escolhi a (b) — declarar conflito e pedir escolha**, com a (c) embutida.

Razão: (a) "atualizar com undo" altera um objeto que a pessoa criou, sem ela pedir — o hábito diário pode existir de propósito. Entre alterar dado alheio e devolver a decisão, devolvo a decisão. É a mesma regra que aplico a mim mesmo em produção.

- `schedulesEquivalent()` canoniza os dois lados em **conjunto de dias ISO**, então dialetos diferentes com o mesmo significado continuam sendo reuso (`weekdays` ≡ `weekly` + `[1..5]`; `daily` ≡ `[1..7]`). Isso evita conflito falso, que seria só outra forma de atrito.
- Calendários que **disparam em dias diferentes** → `habit_conflict`: não converte, **não encerra nada**, mostra os dois e pergunta.
- No sucesso com reuso, o texto passa a descrever o **calendário do hábito** (o que realmente dispara), não o derivado da RRULE da tarefa. Essa era a fonte direta da frase inventada.

Texto do conflito: *"você já tem um lembrete X que toca todo dia, e essa rotina é toda segunda. Não quis mexer sem te perguntar: mantenho o lembrete como está e encerro a tarefa, ou ajusto o lembrete pra toda segunda?"*

**KI:** `TASKTOHABIT-REUSE-IGNORES-SCHEDULE`

---

## Prova

**Unitários:** 35/35 no serviço. **Suíte:** 2068 pass / 3 fail — mesmo baseline pré-existente por ambiente (`SUPABASE_URL` ausente em `system-loadout`, `pending-intents-detect`, `group-chat-tasks`), local e VPS.

**E2E contra o banco real — 22/22**, agora **versionado** (`scripts/e2e-task-to-habit.js`), respondendo ao B3. Roda com `node scripts/e2e-task-to-habit.js` no host do TOM; opera só no colaborador de fachada `Admin` com prefixo `ZZ-E2E-` e limpa tudo ao final, inclusive em erro.

Cenário A1 (encerramento **grava** e a leitura cai logo depois):

```
[TaskToHabit] VERIFICAÇÃO INDISPONÍVEL tpl=b5081c67 habit=2b46709e
              — encerramento não confirmado, NADA foi desfeito
OK   não declarou sucesso — verification_unavailable
OK   série FOI encerrada de fato
OK   lembrete PRESERVADO (não destruiu com série já encerrada)
OK   não afirmou conversão nem prometeu desfeito
```

Cenário A3:

```
_você já tem um lembrete *...a3* que toca todo dia, e essa rotina é toda segunda.
 Não quis mexer sem te perguntar: ..._
OK   NÃO encerrou a série
OK   não mexeu no hábito existente
OK   texto mostra os DOIS calendários
```

---

## Sobre B1–B4 e o plano — o que concordo e o que não fiz

**Não executei nada fora de A1–A3.** O combinado é você auditar o diff antes de qualquer ampliação.

- **B1 (`endSeries1on1` mente para o resto do sistema) — concordo, e é o item mais valioso da sua lista.** Não o toquei: é compartilhado com `engine.js:4685` e com o outro chat, e corrigir por fora seria remendo. Vai para **E2.0** com resultado tipado por escrita e varredura dos chamadores. Registro a suspeita para o seu próximo olhar: `engine.js:4685` faz cancelamento de série confiando no mesmo `{ended:true}` — provavelmente tem o mesmo defeito, com alcance maior que o meu marker.
- **B2 (concorrência/duplicata) — hipótese confirmada.** Não há unique em `(habit_id, time)`, e verifiquei que **hoje não existe nenhuma duplicata no banco** — então um índice único seria aplicável sem limpeza prévia. **Deixo proposto, não aplicado**, para não escalar antes da sua auditoria: `create unique index concurrently ... on habit_reminders (habit_id, time)`.
- **B2 (atomicidade) — concordo com a nomenclatura.** Não chamo isto de atômico. É **compensação com verificação**, e a janela de crash entre gravar o lembrete e encerrar a série continua existindo. Atomicidade real exige RPC transacional no Postgres; isso é decisão de arquitetura para E2, não patch de marker.
- **B3 (prova reprodutível) — corrigido**, script versionado. Sobre `marker_logs` sem `TASK_TO_HABIT`: correto, o E2E chama o serviço direto; só uso real via WhatsApp gera marker.
- **B4 (a instabilidade está na Agenda, fora deste marker) — concordo integralmente.** Este marker resolveu um caso real do Arthur; não move a agulha de `TASK_UPDATE`.

**Sobre o plano:** aceito os cinco contrapontos. Em particular:
- **E0 com `operation_id`** correlacionando intenção → alvo resolvido → mutação tentada → efeito verificado → resposta enviada. Concordo: contar `executed/rejected` agrega causas incompatíveis, e `all_failed` hoje é um balde.
- **E2.0 — contrato de ciclo de vida antes de E2/E3.** Aceito e considero o achado mais importante da sua auditoria: meu marker provou na prática que *executor determinístico sem contrato de ciclo de vida herda a mentira da camada de baixo*.
- **E4 congelado** e `TASK_TO_HABIT` em observação: aceito. Não replico este padrão em outra conversão multi-entidade até você fechar A1–A3.
- **E5 com testes de caracterização antes de mover código:** aceito.

---

**Arquivos do diff:** `src/services/task-to-habit.js` · `src/services/task-to-habit.test.js` · `scripts/e2e-task-to-habit.js` (novo)
**KIs:** `TASKTOHABIT-VERIFY-FAIL-DESTROYS` · `TASKTOHABIT-INACTIVE-REMINDER-PASSES` · `TASKTOHABIT-REUSE-IGNORES-SCHEDULE`
**Nada em `soul/` ou `skills/` foi tocado.** Migração Hermes/OpenClaw segue fora de escopo.
