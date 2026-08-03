# Resposta à auditoria cruzada — rodada 10 (prova concorrente)

**Commit: `23a01f2b`** · **Estado:** migration **não aplicada** em `public`.

```
git fetch && git checkout 23a01f2b
bash scripts/test-router-ownership.sh              # prova
MUTATE=1 bash scripts/test-router-ownership.sh     # prova que a prova detecta
```

---

## Veredito

**Procede — e a cobrança é da minha própria lição.** Na rodada 8 eu escrevi que "testes sequenciais são estruturalmente cegos para essa classe" e, na rodada seguinte, entreguei os testes R9 sequenciais. Expirar a linha na mão e chamar a função não reproduz *começou antes, esperou o lock, expirou durante a espera* — reproduz outra coisa.

## Os quatro cenários, com duas conexões de verdade

| # | cenário | resultado |
|---|---|---|
| C1 | `verify` com troca de posse durante a espera | `false/stale_lease`, passo em voo **sobrevive** |
| C2 | `flow_touch` com TTL cruzando a espera | `false/expired`, TTL **não** revivido |
| C3 | `flow_open` com TTL vencido durante a espera | abre e expropria; **1** interativo ativo |
| C4 | `step_finish` com lease vencendo na espera | `false/stale_lease`, passo continua `in_progress` |

Ficam versionados no runner, então a próxima rodada já nasce com eles.

## O que o teste C3 encontrou — e não era o relógio

Escrevi o C3 esperando confirmar a correção da rodada 9. Ele **falhou**. E a causa não era a que eu tinha corrigido:

> O `UPDATE` de expropriação faz o **scan antes de esperar qualquer lock**. Se no instante do scan o TTL ainda estava vivo, a linha **nem entra** no conjunto a atualizar — o UPDATE afeta zero linhas e **não espera**. Quem espera é o `INSERT` seguinte, que já encontra o índice único ocupado e devolve `null`. **Conversa presa, com o TTL vencido.**

Relógio certo não resolvia isso. O que resolve é **travar antes de avaliar o prazo** — a mesma correção estrutural da R8, que eu não tinha aplicado ao `flow_open` porque ali "não havia check-then-write aparente". Havia: o check é o `WHERE` do UPDATE e o write é o INSERT, separados por uma espera.

Foi o teste que você exigiu que encontrou. Sozinho, o SQL "parecia certo" — inclusive para mim, que o escrevi, e para você, que auditou.

## A prova de que a prova detecta

Um teste de concorrência que passa não vale nada se passaria de qualquer jeito. Adicionei `MUTATE=1`: aplica a migration com `clock_timestamp()` trocado por `now()` — a versão vulnerável — e os testes **têm de falhar**.

| cenário | normal | mutante | detecta? |
|---|---|---|---|
| C1 | `false/stale_lease` | `false/stale_lease` | **não** |
| C2 | `false/expired` | `true/ok` + TTL revivido | **sim** |
| C3 | id devolvido | `NULO` | **sim** |
| C4 | `false/stale_lease` | `true/ok` + passo `done` | **sim** |

**O C1 passa nos dois modos.** Ele discrimina **posse** (o token já basta para recusar), não **relógio**. Deixo declarado em vez de contar como quatro provas do mesmo eixo — foi por isso que escrevi o C4, que isola o tempo mantendo a posse constante.

---

## Prova

```
 passou | falhou | total
    181 |      0 |    181
erros SQL: 0

corrida REAL 8 conexões: 1 claimed, 7 rejeitados
check-then-write (2 conexões): false/stale_token
C1..C4: os quatro cenários concorrentes passaram
schema restante: 0
=== TODAS AS CHECAGENS PASSARAM ===
```

Duas execuções consecutivas, mesmo resultado. Suíte JS: 2100 pass / 3 fail (baseline). Router: 21/21.

---

## Estado

Migration **não aplicada** · router **não ligado** · canário **não aberto** · RPCs de negócio fora (E2.0) · `soul/` e `skills/` intocados · TOM v1 sem alteração nenhuma desde o início da fatia.

Segue aberto: as 5 funções `SECURITY DEFINER` já em produção executáveis por `anon`, incluindo `current_collab_id`.
