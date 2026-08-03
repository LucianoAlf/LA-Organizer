# Resposta à auditoria cruzada — rodada 4 (Fatia 1.1 endurecida)

**Data:** 03/08/2026 · **De:** Claude · **Para:** Alfredo e Alf

## Onde estão os artefatos (o seu ponto 4)

**Commit: `9c0542aa`** em `origin/main`. Falha minha na rodada anterior: entreguei a resposta sem o hash. Os artefatos daquela rodada estavam em **`4b8e17ab`** — você auditou `ab86462`, o commit **anterior**, então de fato não existiam no seu checkout. Não foi entrega faltando; foi eu não ter dito onde. Daqui em diante toda resposta vem com o hash.

```
git fetch && git checkout 9c0542aa
bash scripts/test-router-ownership.sh      # no host com DATABASE_URL
```

| Artefato | Caminho |
|---|---|
| Migration | `migrations/2026-08-03-tom-router-ownership.sql` |
| Testes SQL | `scripts/sql/test-router-ownership.sql` |
| Runner | `scripts/test-router-ownership.sh` |
| Router puro | `src/router/route-decision.js` (+ teste) |

---

## Antes dos três: um defeito meu que o seu processo expôs

Ao rodar a bateria nova, o runner imprimiu **"TODAS AS CHECAGENS PASSARAM"** com **4 blocos `DO` abortados** por `column reference "operation_id" is ambiguous`. Um bloco que aborta não registra suas asserções em `_res` — e o resumo somava só o que sobrou. **Falso verde no meu próprio instrumento de prova**, exatamente o tipo de coisa que passei as rodadas anteriores corrigindo no TOM.

Duas correções: qualifiquei as colunas ambíguas, e **o runner agora falha se houver qualquer `ERROR` de SQL**, não só se uma asserção retornar falso. Isso revelou **30 asserções que nunca haviam rodado**: a bateria foi de 62 para **92**.

Se você tivesse rodado o artefato da rodada 3 antes desta correção, teria visto verde sobre 4 blocos mortos. Registro porque é o achado mais importante desta rodada e ele é meu, não do desenho.

---

## R4-1 — fencing token

**Procede.** `owner` identifica o runtime, não a **tentativa**. Um worker do v2 que travou (GC pause, rede) podia acordar depois do lease vencer, quando outro worker já retomou, e chamar `heartbeat`/`finish` como se ainda fosse dono. Meu `attempts` incrementava, mas não era usado como token — era contador, não posse.

**Corrigido:** `lease_token uuid` por posse. Cada `claimed`/`resumed` gera token novo e o devolve. `tom_route_heartbeat` e `tom_route_finish_inbound` exigem o token **atual** — token velho não renova, não fecha e não marca `completed`.

Provado: worker velho tenta renovar → rejeitado; tenta fechar → rejeitado e a mensagem **continua não-completada**; o worker atual faz as duas coisas normalmente.

## R4-2 — retomada não pode reexecutar às cegas

**Procede,** e era o mais sutil: retomar "pelo mesmo dono" é seguro para o *claim*, não para o *efeito*. Se o worker mutou a entidade e caiu antes do recibo, a retomada repetiria a mutação.

**Corrigido** com `tom_operation_steps` (unique por `operation_id, step_key`) e duas RPCs:
- `tom_operation_step_begin` → `new` (pode executar) · `in_progress` (alguém está/estava nele) · `done` (**não reexecutar**, e devolve o `result` guardado);
- `tom_operation_step_finish` grava resultado.

O `claim` retomado agora devolve **`steps_done`** — o worker sabe onde parou em vez de recomeçar.

Coloquei isso na infraestrutura, e não dentro de uma RPC de ação, de propósito: é idempotência **genérica**. Quando as RPCs de negócio existirem (E2.0), elas usam isto em vez de cada uma reinventar. `in_progress` é deliberadamente distinto de `done`: um passo que ficou aberto num crash exige que quem retoma **verifique o efeito no banco** antes de decidir — não é automático, e não deve ser.

## R4-3 — TTL do fluxo interativo

**Procede.** Sem prazo, um v2 que caísse antes de `retired` prenderia a conversa **para sempre** — a pessoa nunca mais seria atendida naquele chat. Isso é pior que qualquer duplicidade.

**Corrigido:** `interactive_until`. `tom_flow_open` **expropria** fluxo interativo expirado da conversa (marca `retired` com `note` contendo `expired_ttl`) antes de abrir o novo. `tom_flow_touch` renova enquanto o dono está vivo — senão o TTL viraria limite de duração de conversa, não proteção contra dono morto. Fluxo expirado **não** é ressuscitado pelo touch.

---

## Prova

```
 passou | falhou | total
     92 |      0 |     92
erros SQL durante os testes: 0 (esperado 0)

=== corrida REAL: 8 conexões simultâneas no mesmo inbound ===
claimed
in_progress_elsewhere  (×7)
linhas de ownership: 1 (esperado 1) · operações criadas: 1 (esperado 1)

schema restante: 0 (esperado 0)
=== TODAS AS CHECAGENS PASSARAM ===
```

Router puro: 17/17. Suíte JS: 2096 pass / 3 fail (baseline pré-existente por ambiente).

O ambiente continua sendo schema descartável no próprio projeto — os roles `anon`/`authenticated`/`service_role` são os **reais**, então o teste de privilégio (R3-A1) vale de verdade; num branch eu testaria roles de outro banco. `public` não é tocado e o schema é dropado no fim, com verificação.

---

## Estado

- Migration **não aplicada**. Router **não ligado** ao ingress. Canário **não aberto**.
- RPCs de ação de negócio continuam fora (E2.0).
- `soul/` e `skills/` intocados.
- Achado colateral da rodada 3 **segue aberto e não tocado**: as 5 funções `SECURITY DEFINER` que já existem em produção são executáveis por `anon`, incluindo `current_collab_id`. Mexer nisso pode quebrar o PWA e precisa da sua leitura.

Pode rodar `9c0542aa` e decidir a aplicação.
