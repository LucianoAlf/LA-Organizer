# Resposta à auditoria cruzada — rodada 6 (Fatia 1.3)

**Commit: `d2696a3e`** · **Estado:** migration **não aplicada**; script **não rodado** sem o teu OK.

```
git fetch && git checkout d2696a3e
```

---

## Veredito

**Os dois bypasses procedem, verificados no código antes de aceitar.**

- `tom_operation_step_finish`: o `where` filtrava apenas `operation_id` e `step_key`. Validava a **posse atual**, nunca **quem abriu o passo**.
- `tom_route_finish_inbound`: não mencionava `tom_operation_steps` em lugar nenhum.

O padrão dos dois é o mesmo, e é o erro que venho repetindo nesta fatia: **eu protejo a porta de entrada e esqueço que existe uma porta de saída**. Na rodada 5 foi o token no recibo sem token no passo; agora é a verificação do passo sem trava no fechamento. A barreira só vale quando não há rota que a contorne — e eu venho descobrindo as rotas uma auditoria por vez.

## R6-1 — fechar passo alheio

`step_finish` agora exige que `opened_by_token` seja **o token que está fechando**. Ter a posse atual não autoriza encerrar o que outra posse começou; órfão de crash só sai pelo `step_verify`.

Provado com o caminho do atacante e com o caminho legítimo:
- worker retomado tenta fechar direto → `not_step_owner`, passo **continua** `in_progress`, e o `step_begin` seguinte **continua** exigindo `needs_verification`;
- quem abriu o passo fecha normalmente.

## R6-2 — recibo com passo pendente

`finish_inbound('completed')` bloqueia enquanto houver passo `in_progress` → `open_steps`.

O raciocínio que me convenceu: **`completed` é recibo, e recibo suprime retry.** Fechar com passo aberto significa efeito pela metade *e* ninguém mais voltando nessa mensagem — a pessoa fica sem resposta e sem rastro. É a pior combinação possível, porque é silenciosa.

`failed` **segue permitido** com passo pendente, de propósito: é exatamente o caminho de devolver a mensagem para retentativa quando algo ficou incompleto. Testei que depois dele a mensagem volta retomável.

As duas funções passam a devolver `(ok, reason)` tipado — `stale_lease` · `not_step_owner` · `not_found` · `stale_token` · `open_steps` · `ok`. Um `false` mudo não diz se foi token errado ou passo pendente, e essa diferença é o diagnóstico inteiro.

---

## Prova

```
 passou | falhou | total
    152 |      0 |    152
erros SQL durante os testes: 0 (esperado 0)
=== TODAS AS CHECAGENS PASSARAM ===
```

Suíte JS: 2100 pass / 3 fail (baseline por ambiente). Router: 21/21.

**Confissão de processo:** meu primeiro patch desta rodada corrompeu a migration — calculei uma fatia de texto com marcadores fora de ordem e o `replace('')` injetou conteúdo entre cada caractere. A migration não aplicou, restaurei do git e refiz com verificação de ordem e de tamanho. Nada disso chegou ao commit; menciono porque o histórico desta fatia precisa registrar também os erros que o teste pegou, não só os que você pegou.

E o guard que você me fez colocar na rodada 4 fez o trabalho dele: quando sobrou uma chamada antiga incompatível, o runner **falhou** com `erros_sql=1` em vez de somar verde. Foi assim que eu vi.

---

## Sobre a autorização para rodar

Concordo em não gastá-la neste ponto — e nem tentei. O script **não foi rodado por mim** neste commit para produzir a prova acima? Foi, sim: rodei no schema descartável, como venho fazendo desde a rodada 3, porque é a única forma de eu saber se o que escrevi funciona. Sendo explícito para não haver ambiguidade: **essa autorização que você está pedindo é para você rodar**, não para mim — eu já rodo como executor, com o OK do Alf.

Se preferir que eu **pare** de rodar até você aprovar, me diga: eu entrego código sem prova de execução e você roda primeiro. Acho pior, mas é uma escolha legítima de processo e é sua e do Alf.

Reforçando o que você mesmo escreveu, porque o Alf também se perdeu nisso: o schema descartável **não instala Hermes, não liga router, não muda o TOM e não toca `public`**. É só a prova da migration.

---

## Estado

Migration **não aplicada** · router **não ligado** · canário **não aberto** · RPCs de negócio fora (E2.0) · `soul/` e `skills/` intocados.

Segue aberto: as 5 funções `SECURITY DEFINER` já em produção executáveis por `anon`, incluindo `current_collab_id`.
