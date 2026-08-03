# Resposta à auditoria cruzada — rodada 7 (Fatia 1.4)

**Commit: `51d7ec88`** · **Estado:** migration **não aplicada** em `public`.

```
git fetch && git checkout 51d7ec88
```

---

## Veredito

**As duas procedem.** Verifiquei no código antes de aceitar, e a primeira revelou uma assimetria que eu não tinha visto.

## R7-1 — o lease não valia para o próprio dono

`heartbeat` e `finish_inbound` conferiam **token**, nunca **prazo**. Um worker que travou, perdeu o lease e acordou antes de outro retomar renovava a própria posse ou declarava desfecho. Como você escreveu: isso mata o propósito do lease. Um prazo que o próprio dono pode ignorar nunca existiu.

**A assimetria:** as funções de **step** (`begin`, `finish`, `verify`) **já exigiam** `lease_until > now()` desde a rodada 5. `heartbeat` e `finish_inbound` não. Escrevi o mesmo contrato de dois jeitos no mesmo arquivo e não percebi — o rigor ficou onde a atenção estava naquele dia.

**Corrigido:** ambas exigem posse atual **e** lease vivo **e** status processável. Expirado devolve `stale_lease` **sem escrever nada** — testei que o `lease_until` continua no passado depois da tentativa.

Uma decisão que tomei e quero explícita: **`failed` também é bloqueado** com lease vencido. Poderia ter liberado, com o argumento de que "falhar é conservador". Não é: outro worker pode já ter retomado, e declarar desfecho ali sobrescreveria trabalho alheio. Quem perdeu a posse não decide o fim — reivindica de novo.

## R7-2 — recibo se sobrescrevia

`step_finish` conferia quem abriu, mas não se o passo ainda estava aberto. A segunda chamada reescrevia o recibo — e o teste mostrou o pior caso: **rebaixou um `done` para `failed`** e apagou o `result`. Justamente o `result` que a retomada usa para **não reexecutar**.

Idempotência que perde a memória não é idempotência.

**Corrigido:** só atualiza `in_progress`; já resolvido devolve `already_resolved` e preserva `status` e `result`. O `step_begin` seguinte continua vendo `done` com o resultado original.

`heartbeat` passou a devolver `(ok, reason)` tipado, como as outras.

---

## Prova

```
 passou | falhou | total
    167 |      0 |    167
erros SQL durante os testes: 0 (esperado 0)
corrida real 8 conexões: 1 claimed, 7 rejeitados
schema restante: 0
=== TODAS AS CHECAGENS PASSARAM ===
```

Suíte JS: 2100 pass / 3 fail (baseline por ambiente). Router: 21/21.

**Um teste antigo quebrou, e estava certo quebrar.** O `A3` chamava `finish_inbound` com o lease propositalmente vencido — caminho que a correção fechou. Ajustei a **sequência do teste** (reivindicar a posse antes de declarar desfecho), não o código. Registro porque a distinção importa: teste desatualizado por endurecimento de contrato é resultado esperado; se eu tivesse afrouxado a função para o teste passar, teria desfeito a correção da mesma rodada.

---

## Sobre o processo

Obrigado pelo esclarecimento — e concordo com onde você põe o bloqueio. Aplicar em `public` com porta aberta é irreversível na prática; rodar prova em schema descartável é reversível por construção. São riscos de ordens diferentes e faz sentido tratá-los diferente.

Sigo rodando a prova como executor e trazendo o número. Você bloqueia o `public`.

---

## Estado

Migration **não aplicada** · router **não ligado** · canário **não aberto** · RPCs de negócio fora (E2.0) · `soul/` e `skills/` intocados · TOM v1 rodando sem nenhuma alteração desde o início desta fatia.

Segue aberto: as 5 funções `SECURITY DEFINER` já em produção executáveis por `anon`, incluindo `current_collab_id`.
