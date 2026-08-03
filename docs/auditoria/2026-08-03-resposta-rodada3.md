# Resposta à auditoria cruzada — rodada 3 (Fatia 1.1)

**Data:** 03/08/2026 · **De:** Claude · **Para:** Alfredo e Alf
**Base auditada por você:** `ab86462` · **Estado:** endurecido e provado. **Migration continua NÃO aplicada.**

---

## Veredito

**Os quatro P0 procedem. Nenhum contestado.** O R3-A1 eu não só confirmei — **é pior do que a hipótese**.

---

## R3-A1 — privilégios (crítico, confirmado no banco)

Você previu que as RPCs nasceriam abertas. Fui verificar com `has_function_privilege` e o resultado é este:

```
proname                | anon_pode | auth_pode | security_definer
briefing_response_count|   true    |   true    |   true
get_supervised_ids     |   true    |   true    |   true
current_collab_id      |   true    |   true    |   true
op_checklists_audit_fn |   true    |   true    |   true
op_checklist_items_...  |   true    |   true    |   true
```

**As cinco funções `SECURITY DEFINER` que já existem em produção hoje estão executáveis por `anon`.** Não é previsão sobre as minhas: é o estado atual do banco. Minhas RPCs nasceriam iguais.

**Corrigido:** `REVOKE ALL ... FROM public, anon, authenticated` + `GRANT EXECUTE ... TO service_role` nas 6 funções, com **assinatura completa** (revoke por nome não pega sobrecarga). As três tabelas também tiveram privilégio revogado — RLS sem policy já bloqueia, mas negar o privilégio é a barreira que não depende de ninguém lembrar de não criar uma policy permissiva depois.

> **Achado colateral, fora do meu escopo, para a sua próxima rodada:** `current_collab_id` — a função que sustenta as policies de RLS — é executável por `anon` hoje. Não toquei: mexer em ACL de função viva pode quebrar o PWA, e isso precisa da sua leitura antes. Registro aqui para não ficar só na minha cabeça.

## R3-A2 — corrida do claim (crítico)

Procede. Meu `SELECT` → `INSERT ON CONFLICT DO NOTHING` → relê → `return false` marcava o **perdedor** como novo. O comentário "devolve o dono vencedor" era, como você escreveu, metade do contrato.

**Corrigido:** `RETURNING true into v_ins` distingue quem inseriu. Quem não inseriu cai na leitura com `FOR UPDATE` e recebe `in_progress_elsewhere` / `already_completed` / `owned_by_other` — nunca "novo".

## R3-A3 — claim ≠ recibo (crítico)

Procede, e era o mais perigoso: crash depois do claim **perdia a mensagem para sempre**.

**Corrigido** com ciclo de vida explícito na própria linha:

| estado | significado |
|---|---|
| `claimed` / `processing` | em andamento, com `lease_until` |
| `completed` | recibo — **só isto** suprime reprocessamento |
| `failed` | devolve para retentativa do **mesmo** dono |

- `lease_until` vencido sem conclusão = crash → **retomável** (`resumed`, com `attempts++`).
- Retomada só pelo **mesmo dono**: outro runtime receberia `owned_by_other`, porque o efeito parcial do primeiro é desconhecido.
- `tom_route_heartbeat` renova o lease de trabalho longo.
- **A operação nasce na mesma transação do claim** — você apontou que não havia nada ligando as duas coisas. Agora não existe claim sem trilha em `tom_operations`.

## R3-A4 — fluxo por conversa (crítico)

Procede. `decideRoute` recebia **um** `flowOwner` que o schema não sabia produzir — em grupo, rotearia pelo dono errado.

**Corrigido:** `conversation_key` (remoteJid canônico, 1:1 ou grupo) + índice único parcial **um fluxo interativo ativo por conversa**. É a constraint que torna o `flowOwner` determinístico, não uma consulta "último fluxo do colaborador". Entidades não-interativas coexistem sem prender a conversa.

---

## Riscos B — todos endereçados

- **B1** — `tom_record_outbound` agora é tipado: `inserted` / `already_recorded_same` / `ownership_conflict` / `missing_message_id`. Colisão com dono diferente vira incidente explícito, nunca no-op.
- **B2** — `tom_flow_set_phase` virou máquina de estados de verdade: só `canary → draining → retired`. `draining → canary` responde `illegal_transition`. Retorna a fase anterior como recibo.
- **B3** — **`canaryOpen` removido.** Você provou que ele alterava 0 das 64 decisões. Um parâmetro que parece controle de canário e não controla nada é pior que a ausência dele — alguém confiaria naquele botão durante um rollback. Adicionei teste que quebra se ele voltar.
- **B4** — migration com `BEGIN/COMMIT` e **sem `IF NOT EXISTS`**: falhar cedo é mais seguro que seguir sobre schema parcialmente diferente.

---

## Prova

**Ambiente:** não há servidor Postgres na VPS (só cliente) nem Docker. Usei um **schema descartável no próprio projeto** (`tom_router_test`), em vez de um branch. A razão não é custo: os roles `anon`, `authenticated` e `service_role` são os **reais de produção**, então o teste de privilégio vale de verdade — num branch eu testaria roles de um banco que não é este. Nada em `public` é tocado; o schema é dropado no início e no fim, e a verificação final confirma `0` restante.

**O teste aplica a MIGRATION REAL** (`sed public.→tom_router_test.`), não uma cópia — cópia diverge e não prova nada.

```
=== testes de privilégio, corrida, lease/crash e fluxo ===
 passou | falhou | total
     60 |      0 |    60

=== corrida REAL: 8 conexões simultâneas no mesmo inbound ===
claimed
in_progress_elsewhere   (×7)
linhas de ownership para o mesmo inbound: 1 (esperado 1)
operações criadas: 1 (esperado 1)

=== limpeza ===
schema restante: 0 (esperado 0)
=== TODAS AS CHECAGENS PASSARAM ===
```

As 60 asserções cobrem: privilégio de `anon`/`authenticated`/`service_role` nas 6 funções e nas 3 tabelas, RLS ligada, claim/corrida, crash com lease vencido, retomada pelo mesmo dono, bloqueio de retomada por outro dono, `completed` suprimindo, `failed` retomável, heartbeat (inclusive heartbeat de outro dono não pegando), outbound nos 4 desfechos, um interativo por conversa, grupo como conversa própria, e as transições de fase legais e ilegais.

**Router:** 17/17 (128 combinações). **Suíte:** 2096 pass / 3 fail = baseline.

Reprodutível por qualquer um: `bash scripts/test-router-ownership.sh` no host com `DATABASE_URL`.

---

## Estado e o que segue bloqueado

- Migration **não aplicada** — verificado: `tabelas_em_public = 0`.
- Router **não ligado** ao ingress.
- Canário **não aberto**.
- RPCs de ação de negócio continuam **fora** (dependem do E2.0).
- `soul/` e `skills/` intocados.

Aceito sua sequência: **1.1** (esta) → **2** (capturar ID de outbound no v1, e só considerar envio bem-sucedido quando o ledger receber o ID) → **3** (router transparente com telemetria) → **4** (shadow) → **5** (canário).

Um ponto da sua fatia 2 que quero registrar antes de executá-la: *"só considerar envio bem-sucedido quando o ledger receber o ID"* muda a semântica de sucesso do envio no v1. Se a UAZAPI entregar mas o ledger falhar, hoje o v1 consideraria enviado. Vou tratar isso como decisão explícita na spec da fatia 2, não como detalhe de implementação.

**Arquivos:** `migrations/2026-08-03-tom-router-ownership.sql` · `scripts/sql/test-router-ownership.sql` · `scripts/test-router-ownership.sh` · `src/router/route-decision.js` + teste
