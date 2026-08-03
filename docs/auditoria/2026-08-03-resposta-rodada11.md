# Resposta à auditoria cruzada — rodada 11 (Fatia 1.7, só prova)

**Commit: `3c16ac73`** · **Estado:** migration **não aplicada** em `public`.

```
git fetch && git checkout 3c16ac73
bash scripts/test-router-ownership.sh            # EXIT=0 esperado
MUTATE=1 bash scripts/test-router-ownership.sh   # EXIT=0 = os testes DETECTARAM o bug
```

---

## Veredito

**Procede inteiro.** E é a terceira vez que o mesmo defeito aparece em lugar diferente: **a coisa que mede diz "verde" sem ter medido**.

| onde | como se manifestava |
|---|---|
| rodada 4 | blocos `DO` abortavam, não registravam asserção, e o resumo somava só o que sobrou |
| rodada 8 | `UPDATE` afetava zero linhas e a função devolvia `ok=true` |
| rodada 11 | `psql` dava `ERROR`, o texto do erro caía na variável, não casava com `true/*` e o cenário **passava** |

Nos três, o instrumento era mais frágil que o objeto medido.

## O que mudei no runner

- **`ON_ERROR_STOP=1` + exit code conferido** em todo `psql`, com stderr em arquivo próprio — nunca mais misturado ao valor comparado.
- **Asserções exatas.** `assert_eq` exige o recibo literal: `false/stale_lease`, `false/expired`, `false/stale_token`, `ABRIU`, `in_progress`. "Não retornou true" aceitava qualquer coisa, inclusive mensagem de erro.
- **`wait` conferido** em todo background, com o stderr dele no relatório.
- **`trap` de limpeza** — o schema descartável some mesmo se o script morrer no meio.
- **Modo mutante com expectativa invertida**: `MUTATE=1` só sai `0` se os testes **falharem**. Se nada falhar, ele grita que a prova não detecta nada.

## O achado ao endurecer

Ao ligar a checagem de background, os cinco cenários acusaram `conexão de apoio saiu com 127` — mesmo com todas as asserções verdes.

Causa: eu lançava o processo com `PID=$(segurar_linha ...)`. Dentro de `$(...)` o background nasce num **subshell**; o processo deixa de ser filho deste shell e `wait` devolve **127 sem conferir nada**.

Ou seja: **a verificação que eu tinha acabado de escrever não verificava.** Ela só apareceu porque o exit code passou a ser exigido — a correção da rodada encontrou o furo dela mesma. Corrigido com `BG_PID` global.

---

## Prova

```
=== TODAS AS CHECAGENS PASSARAM ===   EXIT=0
(duas execuções consecutivas, EXIT=0 nas duas)

181/181 asserções SQL · 0 erros SQL
corrida de 8 conexões: exatamente 1 'claimed'
R8 worker antigo = false/stale_token · status final = claimed
C1 = false/stale_lease · passo em voo sobreviveu = 1
C2 = false/expired    · TTL revivido = false
C3 = ABRIU            · interativos ativos = 1
C4 = false/stale_lease · status do passo = in_progress
schema restante = 0
```

**Modo mutante** (`clock_timestamp()` → `now()`):
```
FALHOU: C2 ... obtido 'true/ok'     |  C2 TTL revivido: obtido 'true'
FALHOU: C3 ... obtido 'NULO'
FALHOU: C4 ... obtido 'true/ok'     |  C4 status do passo: obtido 'done'
=== MUTANTE: os testes DETECTARAM o bug ===   EXIT=0
```

C1 continua passando nos dois modos — discrimina posse, não relógio, como declarei na rodada anterior. Suíte JS: 2100 pass / 3 fail (baseline). Router: 21/21.

---

## Estado

Migration **não aplicada** · router **não ligado** · canário **não aberto** · RPCs de negócio fora (E2.0) · `soul/` e `skills/` intocados · TOM v1 sem alteração nenhuma desde o início da fatia.

Segue aberto: as 5 funções `SECURITY DEFINER` já em produção executáveis por `anon`, incluindo `current_collab_id`.
