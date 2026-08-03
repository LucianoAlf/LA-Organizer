# Resposta à auditoria cruzada — rodada 5 (Fatia 1.2)

**Commit: `83e10e16`** · **De:** Claude · **Para:** Alfredo e Alf
**Estado:** migration **não aplicada** em produção.

```
git fetch && git checkout 83e10e16
bash scripts/test-router-ownership.sh
```

---

## Veredito

**Os três bloqueios e o ponto de governança procedem.** O R5-1 aponta um erro conceitual meu, não um esquecimento.

---

## R5-1 — o token estava no lugar errado

Eu cerquei `heartbeat` e `finish` e chamei de fencing. **Mas o passo é o que autoriza a mutação.** Um worker zumbi que não consegue renovar o lease, mas consegue abrir e fechar um passo, continua agindo — o token virava enfeite no caminho que não importa. Proteger o recibo e deixar o efeito aberto é proteger a porta e deixar a janela.

**Corrigido:**
- `tom_operation_step_begin`, `tom_operation_step_finish` e `tom_operation_step_verify` exigem o token da posse atual; com token velho devolvem `stale_lease` e **não criam nem alteram linha**.
- `tom_record_outbound` exige token **quando o outbound pertence a uma operação**. Saída registrada vira alvo de reply roteável — sem isso, o zumbi entrava de volta no fluxo pela porta do ledger. Sem `operation_id` (proativo do dispatcher) segue livre, porque ali não há posse a violar.
- `tom_route_assert_lease` novo: o worker checa a posse **imediatamente antes de enviar**. Sendo honesto sobre o alcance: isso não fecha a janela entre checar e enviar — nada em banco fecha. O que muda é que "worker zumbi mandou mensagem" passa de silencioso para detectável.

## R5-2 — aviso não é barreira

**Procede, e essa era a frase certa.** `in_progress` dizia "verifique" e seguia o baile: nada impedia agir de novo sobre uma mutação já gravada.

**Corrigido** com distinção real de quem abriu o passo (`opened_by_token`):

| situação | resposta |
|---|---|
| passo aberto sob a posse **atual** | `in_progress_active` — é o próprio worker rechamando |
| passo aberto sob **outra** posse | `needs_verification` — órfão de crash, **bloqueado** |
| resolvido | `done` (com o `result` guardado) ou liberado |

`needs_verification` **não passa na segunda chamada** — continua bloqueando até `tom_operation_step_verify`, onde o worker relê o banco e declara: efeito confirmado → fecha sem reexecutar; efeito negado → libera para nova execução. Ambos os caminhos testados, e `verify` com token velho é rejeitado.

## R5-3 — o TTL não estava em lugar nenhum que decidisse

**Procede.** Coluna sem consumidor é documentação, não proteção.

- `tom_flow_active_for_conversation(conversation)` — a consulta **única** do adapter, que aplica o TTL **no banco**: expirado devolve `owner` nulo e sinaliza `expired`. O adapter não tem como ler errado sem sair do contrato.
- `flow_token` no fluxo, exigido por `tom_flow_touch` (agora com `owner` também) e por `tom_flow_set_phase` — drenar ou aposentar fluxo alheio é tão grave quanto mantê-lo vivo indevidamente.
- **`flowExpired` no router**, como segunda barreira. O TTL é avaliado no banco (que tem o relógio) e chega como fato — o router continua puro. Só `true` expira: valor sujo mantém o fluxo prendendo, porque na dúvida o conservador é **não** soltar a conversa.

Detalhe que testei porque não era óbvio: TTL vencido **não** invalida a citação. O fluxo morreu, mas a mensagem citada tem dono e a entidade dele também — `quote` continua mandando.

## R5-4 — governança

**Concordo integralmente e apliquei.** `service_role` passa a ter **`SELECT` apenas**. Com `INSERT`/`UPDATE` diretos, o runtime contornaria token, lease e máquina de estados — as barreiras viram sugestão, e a primeira pressa de produção passa por cima. As RPCs são `SECURITY DEFINER`: escrevem sem depender do privilégio de quem chama. O teste prova as duas metades — `service_role` sem escrita direta **e** RPC escrevendo normalmente.

---

## Prova

```
 passou | falhou | total
    139 |      0 |    139
erros SQL durante os testes: 0 (esperado 0)
corrida real 8 conexões: 1 claimed, 7 rejeitados · 1 linha · 1 operação
schema restante: 0
=== TODAS AS CHECAGENS PASSARAM ===
```

Router: **21/21**, exaustão agora em **256 combinações** (inclui `flowExpired`). Suíte JS: 2100 pass / 3 fail (baseline por ambiente).

---

## Sobre rodar o script você mesmo

**Da minha parte, liberado** — e o Alf decide, já que o banco é dele. Registro o que sei do artefato, para a decisão não ser no escuro:

- Schema fixo `tom_router_test`, dropado **no início e no fim**; a última linha verifica `schema restante: 0`.
- Não toca `public` — o único contato com produção são os roles `anon`/`authenticated`/`service_role`, que são **lidos**, nunca alterados.
- Rodei **7 vezes** nesta sessão, sem resíduo em nenhuma.
- Custo: alguns segundos de CPU no Postgres de produção.

O que ele **não** faz: não escreve em `public`, não altera privilégio de nada existente, não toca TOM, Hermes ou UAZAPI.

Se o Alf preferir isolamento total em vez de fidelidade de roles, a alternativa é um branch Supabase (custo por hora, e o teste de privilégio passaria a valer sobre roles de outro banco). Minha recomendação continua sendo o schema descartável, pela razão do R3-A1: é lá que os roles reais estão.

---

## Estado

Migration **não aplicada** · router **não ligado** · canário **não aberto** · RPCs de negócio fora (E2.0) · `soul/` e `skills/` intocados.

Segue aberto o achado colateral da rodada 3: as 5 funções `SECURITY DEFINER` já em produção são executáveis por `anon`, incluindo `current_collab_id`.
