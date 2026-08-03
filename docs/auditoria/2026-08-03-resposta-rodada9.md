# Resposta à auditoria cruzada — rodada 9 (Fatia 1.6)

**Commit: `5ce6419a`** · **Estado:** migration **não aplicada** em `public`.

```
git fetch && git checkout 5ce6419a
bash scripts/test-router-ownership.sh
```

---

## Veredito

**Os dois procedem.** O R9-1 é o mais grave dos dois, porque a função fazia o **oposto** do que promete.

## R9-1 — `verify` apagando passo em voo

`step_verify` existe para destravar passo **abandonado por crash**. Do jeito que estava, aplicado a um passo da posse **atual** com `effect_confirmed=false`, ele apagava um passo **ainda em voo** — e o `step_begin` seguinte devolvia `new`, autorizando repetir uma mutação que podia estar acontecendo naquele instante.

Ou seja: a função criada para impedir dupla execução tinha um caminho que a **provocava**. E o caminho não era exótico — bastava o worker chamar `verify` no próprio passo, que é um engano plausível de quem implementar o v2 lendo só a assinatura.

**Corrigido:** `verify` só age quando `opened_by_token` é de **outra** posse. Passo da própria posse devolve `not_orphan` — quem fecha passo próprio é o `step_finish`. Também passou a recusar passo já resolvido (`already_resolved`, preservando o recibo) e ganhou trava, `clock_timestamp()` e `row_count`, como as demais.

Provado nos dois sentidos: passo em voo é recusado e **continua existindo**, com o `begin` seguinte devolvendo `in_progress_active` (nunca `new`); órfão de verdade continua resolvível normalmente.

## R9-2 — TTL do fluxo, mesma classe temporal da R8

Você tinha razão inclusive no diagnóstico: eu corrigi a **leitura** (`tom_flow_active_for_conversation`) na rodada 5 e deixei `now()` na **escrita** (`flow_touch` e `flow_open`). O padrão se repete: eu corrijo onde estou olhando e deixo a mesma falha no vizinho.

O cenário é idêntico ao da R8: `touch` começa antes do prazo, espera no lock, o prazo passa nesse meio tempo, e o `now()` congelado da transação ainda vê o TTL vivo — **ressuscitando um fluxo expirado** e prendendo a conversa no v2. Exatamente o que o TTL existia para evitar.

**Corrigido:** `flow_touch` com `FOR UPDATE` + `clock_timestamp()` + `row_count`, e tipado `(ok, reason)`: `not_found` · `not_owner` · `expired` · `lost_race` · `ok`. `flow_open` usa `clock_timestamp()` tanto na expropriação do expirado quanto no TTL que grava.

Varri o arquivo: **zero** comparações de lease ou TTL restantes com `now()`.

---

## Prova

```
 passou | falhou | total
    181 |      0 |    181
erros SQL durante os testes: 0 (esperado 0)

corrida REAL 8 conexões: 1 claimed, 7 rejeitados
check-then-write (2 conexões): false/stale_token
schema restante: 0
=== TODAS AS CHECAGENS PASSARAM ===
```

Duas execuções consecutivas com o mesmo resultado. Suíte JS: 2100 pass / 3 fail (baseline). Router: 21/21.

---

## Um padrão meu que já dá para nomear

Três rodadas seguidas com a mesma forma de erro:

| rodada | corrigi | deixei passar |
|---|---|---|
| 7 | lease vivo nos **steps** | `heartbeat` e `finish_inbound` |
| 8 | trava e relógio no **ownership** | — |
| 9 | relógio na **leitura** do fluxo | `touch` e `open` do fluxo |

Não é desatenção pontual: é aplicar a regra no ponto que estou olhando e não varrer os irmãos. Passei a fazer a varredura explícita ao fechar cada correção — foi assim que confirmei que não sobrou nenhum `now()` em comparação temporal. Devia ter sido o método desde a rodada 5.

---

## Estado

Migration **não aplicada** · router **não ligado** · canário **não aberto** · RPCs de negócio fora (E2.0) · `soul/` e `skills/` intocados · TOM v1 sem alteração nenhuma desde o início da fatia.

Segue aberto: as 5 funções `SECURITY DEFINER` já em produção executáveis por `anon`, incluindo `current_collab_id`.
