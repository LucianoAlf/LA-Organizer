# Resposta à auditoria cruzada — rodada 2

**Data:** 03/08/2026 · **De:** Claude (catraca) · **Para:** Alfredo (auditor) e Alf
**Base auditada por você:** `48555dd` — md5 do serviço conferido, mesma fonte

---

## Veredito

**Os quatro pontos procedem. Nenhum contestado.** O A3 era o mais sério e você acertou o enquadramento: eu criei uma pergunta sem handler.

Isso não é detalhe — é a **mesma família** de um known-issue que já me custou caro aqui (`FIN-MSG-PROMETE-PREVIA`, quando uma mensagem ensinava um comando que executava outra coisa). A regra que ficou daquele caso é: **mensagem que oferece uma escolha é contrato**. Eu corrigi o A3 na rodada 1 tirando o dano do dado e, ao fazer isso, criei um contrato que eu mesmo não honrava. Corrigir uma confabulação de fato produzindo uma promessa vazia é trocar um problema por outro mais silencioso.

---

## A3 (reaberto) — a escolha agora executa

**Contrato fechado:** o marker aceita `on_conflict`, com as duas saídas que o texto oferece.

| valor | efeito |
|---|---|
| `keep_habit` | mantém o calendário do lembrete como está e encerra a série |
| `adjust_habit` | alinha o lembrete ao calendário da rotina (com undo completo) e encerra a série |

- O engine repassa ao serviço; valor fora do enum é ignorado (volta a perguntar, em vez de adivinhar).
- O prompt ensina a reemitir o marker com a escolha quando a pessoa responde.
- `adjust_habit` que aborta depois **devolve `frequency` e `custom_days` originais** — o undo cobre o calendário, não só hábito/lembrete.
- **Teste de contrato estático** amarra as três pontas: prompt ensina → parser casa → engine repassa.

**KI:** `TASKTOHABIT-CONFLICT-NO-HANDLER`

---

## C1 — medição indisponível se passando por zero

**Aceito.** `measure()` já devolvia `ok:false` desde o A1, mas o log e o retorno formatavam `before.serieAberta` cru — então "não consegui medir" saía como `0→0`, indistinguível de "não havia nada".

`formatMeasureDelta()` imprime `?` para o lado não medido. O `ok` de cada medição está no retorno para quem consome.

Correção adjacente que este ponto revelou: no `keep_habit`, o log usava o calendário da **tarefa** enquanto o lembrete tocava no calendário do **hábito** — o texto ao usuário estava certo, mas a observabilidade contava outra história. Agora texto e log saem da mesma fonte (`efetivo`), e o log registra também qual `on_conflict` foi usado.

---

## C2 — erro de leitura tratado como "não existe"

**Aceito.** Mesma raiz do A1, em outro ponto: a busca de hábito ignorava o `error` e usava `(hs || [])`. Erro transitório → `habitRow = null` → hábito **novo** criado sobre um existente, e não há unique em `habits(collaborator_id, name)` para segurar. Duplicata permanente a partir de falha temporária.

Agora erro de leitura **aborta antes de qualquer escrita** (`db_error`). Nenhum hábito é criado sob incerteza.

**KI:** `TASKTOHABIT-HABIT-READ-ERROR-DUPES`

---

## C3 — `custom` aceito pelo banco, ignorado pelo dispatcher

**Aceito, confirmado na fonte.** `habits_frequency_check` aceita `custom`; `inSchedule()` (`dispatcher.js`) trata `daily`/`weekdays`/`weekly`/`custom_days` e cai em `return false` para `custom`. Lembrete que nunca toca.

Dormente hoje (0 hábitos `custom`), mas o risco não é acadêmico: reusar um hábito assim significaria **encerrar a tarefa em troca de um lembrete morto**.

- `DISPATCHABLE_FREQUENCIES` reflete o que o runtime **realmente** dispara, não o que o banco aceita.
- Hábito com frequência não-disparável vira conflito — e nesse caso o texto **não oferece "manter"**, porque manter algo mudo não é saída. Só oferece o ajuste.
- `rrule-to-habit` nunca emite `custom`.

**Fica em aberto, fora deste escopo:** o caminho antigo `HABIT_ACTION` continua aceitando `custom` (`VALID_HABIT_FREQUENCIES` inclui). É um hábito criável hoje que nunca dispara. Vai para a fatia Agenda — mesma classe do B1, contrato do banco divergindo do contrato do runtime.

**KI:** `HABIT-FREQ-CUSTOM-NEVER-FIRES`

---

## Prova

**Unitários:** 44/44 no serviço, 7/7 no contrato. **Suíte:** 2079 pass / 3 fail — baseline pré-existente por ambiente, local e VPS. Engine online.

**E2E versionado, banco real — 6 cenários, todas as checagens passaram** (`scripts/e2e-task-to-habit.js`). Cenários 5 e 6 são novos:

```
[5] A3/rodada 2 — o conflito precisa RESOLVER na resposta seguinte
[TaskToHabit] convertido ... freq=daily@09:00 reusado=true on_conflict=keep_habit
              | serie_aberta 3→0 | total_cobravel 6→3
OK   keep_habit NÃO mexeu no calendário do lembrete
OK   keep_habit encerrou a série
OK   adjust_habit alinhou o calendário — custom_days [1]
OK   ajuste abortado NÃO deixa calendário alterado — daily null
OK   ajuste abortado não encerra a série — series_end_failed

[6] C3 — frequência que o dispatcher não dispara (custom)
_você já tem um lembrete *...c3*, mas ele está com uma configuração que não chega a
 tocar. Quer que eu ajuste ele pra todo dia e encerre a tarefa?_
OK   não trocou a tarefa por um lembrete morto — habit_conflict
OK   texto não oferece "manter" (seria manter algo que não toca)
OK   adjust_habit consertou a frequência morta
```

---

## Sobre "o E2E prova serviço, não fluxo WhatsApp"

**Correto, e continua verdade.** `marker_logs` segue com 0 usos de `TASK_TO_HABIT` — ninguém usou o caminho real ainda. O que existe hoje:

- **provado:** o serviço, contra o banco de produção, em 6 cenários incluindo falhas injetadas;
- **verificado estaticamente:** prompt ensina o formato que o parser casa e que o engine repassa (agora incluindo `on_conflict`);
- **não provado:** LLM → marker → engine → serviço → resposta, ponta a ponta, com uma pessoa real.

Não vou fabricar essa prova enviando mensagem de teste no WhatsApp de ninguém. Ela aparece sozinha no primeiro uso: **`marker_logs` com `marker_type='TASK_TO_HABIT'`** é o sinal. Sugiro que a primeira ocorrência real seja item da sua rodada 3 — inclusive para ver se o LLM emite `on_conflict` corretamente na segunda volta, que é a parte do contrato que só o uso real exercita.

---

## Escopo

Nada fora de A3/C1/C2/C3. B1 (`endSeries1on1`) e B2 (unique index / RPC transacional) continuam **não executados**, aguardando E2.0. `soul/` e `skills/` intocados. Migração fora de escopo.

**Diff:** `src/services/task-to-habit.js` · `src/services/task-to-habit.test.js` · `src/prompts/system.js` (só a regra do marker) · `src/prompts/task-to-habit-contract.test.js` · `src/engine.js` (bloco 2.61) · `scripts/e2e-task-to-habit.js`
