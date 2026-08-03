# Resposta à auditoria cruzada — rodada 8 (Fatia 1.5)

**Commit: `c39fb3df`** · **Estado:** migration **não aplicada** em `public`.

```
git fetch && git checkout c39fb3df
bash scripts/test-router-ownership.sh
```

---

## Veredito

**Procede, e é o achado mais sério desta fatia inteira.**

Todas as barreiras que construímos da rodada 4 à 7 — token, lease, verificação de passo, recibo — validavam num instante e escreviam em outro, sem nada garantindo que o mundo não mudasse no meio. Cada uma delas estava correta **na leitura sequencial** e furada sob concorrência. Isso não é um bug a mais na lista: é a constatação de que sete rodadas de barreiras foram testadas só num regime onde o problema não aparece.

## O bug, reproduzido antes de corrigir

Montei o teste determinístico que faltava — duas conexões, com lock explícito para eliminar sorte de timing. Conexão A trava a linha e entrega a posse a outro worker; conexão B, com o token que **era** dela, tenta fechar no meio disso.

**Antes da correção:**
```
worker antigo recebeu: true/ok      (esperado false/...)
status final da mensagem: claimed   (esperado != completed)
```

O `UPDATE` afetou zero linhas e a função devolveu `ok=true`. É o pior recibo possível: **falso e silencioso**. O worker acredita que entregou, ninguém reprocessa, e a pessoa fica sem resposta sem que nada apareça em log.

## A correção — três travas, não uma

1. **`SELECT ... FOR UPDATE`** serializa a linha de ownership antes de qualquer validação.
2. **`clock_timestamp()` na revalidação.** Este é o detalhe que eu não teria pego sozinho: `now()` é o instante de **início da transação** e **não avança enquanto se espera no lock**. Uma função que ficou 3 segundos parada esperando compararia o lease contra um relógio congelado — e um lease vencido pareceria vivo justamente no caso em que houve disputa. A trava sem o relógio certo seria uma trava que mente.
3. **`row_count` conferido.** Zero linha afetada vira `lost_race`, nunca `ok`. Com a trava isso não deveria acontecer, mas um sucesso declarado sem escrita comprovada é exatamente o que passamos oito rodadas eliminando — a defesa fica.

Aplicado em `heartbeat`, `finish_inbound`, `step_begin`, `step_finish`, `step_verify` e `record_outbound`. O TTL de fluxo e o `assert_lease` também passaram a comparar com `clock_timestamp()`.

---

## Prova

```
 passou | falhou | total
    167 |      0 |    167
erros SQL durante os testes: 0 (esperado 0)

corrida REAL: 8 conexões simultâneas → 1 claimed, 7 rejeitados · 1 linha · 1 operação

R8: check-then-write sob concorrência REAL (duas conexões)
worker antigo recebeu: false/stale_token   (esperado false/...)
status final da mensagem: claimed          (esperado != completed)

schema restante: 0
=== TODAS AS CHECAGENS PASSARAM ===
```

**Rodei 3 vezes consecutivas** — mesmo resultado nas três. Teste de concorrência que passa uma vez não prova nada; queria ver se era determinismo ou sorte.

O teste novo fica versionado no runner, então a próxima rodada já nasce com ele.

Suíte JS: 2100 pass / 3 fail (baseline por ambiente). Router: 21/21.

---

## O que eu tiro disso

A lição não é "faltou um `FOR UPDATE`". É que **eu vinha provando contratos de concorrência com testes sequenciais** — e testes sequenciais são estruturalmente cegos para essa classe. Os 167 passavam com o bug presente. O único teste que o pegou foi o que você exigiu: duas conexões de verdade, com interleaving forçado.

Vale para o resto da migração: qualquer contrato que envolva dois runtimes precisa de prova concorrente, não de prova sequencial bem escrita.

---

## Estado

Migration **não aplicada** · router **não ligado** · canário **não aberto** · RPCs de negócio fora (E2.0) · `soul/` e `skills/` intocados · TOM v1 sem nenhuma alteração desde o início da fatia.

Segue aberto: as 5 funções `SECURITY DEFINER` já em produção executáveis por `anon`, incluindo `current_collab_id`.
