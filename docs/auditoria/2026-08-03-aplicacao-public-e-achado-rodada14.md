# Aplicação em `public` + achado próprio (rodada 14)

**Commit: `338e945b`** · **Estado:** migration **aplicada** em `public`, **inerte** (nenhum código chama).

Autorização do Alf para aplicar. O Alfredo liberou a prova no descartável e não tinha
bloqueio estático pendente.

```
git fetch && git checkout 338e945b
bash scripts/test-router-ownership.sh            # EXIT=0
MUTATE=1 bash scripts/test-router-ownership.sh   # EXIT=0
bash scripts/selftest-mutante.sh                 # EXIT=0
psql "$DATABASE_URL" -qAt -f scripts/sql/verificar-router-public.sql
```

---

## O que foi aplicado

4 tabelas + 12 funções `SECURITY DEFINER`, em transação única. Nenhum `create extension`,
`alter role/database/system` ou objeto fora do escopo — verificado antes de aplicar.

Estado depois: **4 tabelas vazias**, RLS ligada nas 4, `restarts=1079` no pm2 (o mesmo de
antes — o engine não foi tocado). A única menção a essas funções no código é um **comentário**
em `src/router/route-decision.js:52`; nenhum consumidor.

## O achado — e ele não veio da suíte

A verificação pós-aplicação acusou o que a suíte dizia estar certo:

```
TAB_INSERT_service_role=4     ← contrato declarado (R5-4): 0
TAB_UPDATE_service_role=4     ← contrato declarado (R5-4): 0
ACL real: service_role=arwdDxtm/postgres   ← ALL, não SELECT
```

**Causa.** O Supabase mantém, no schema `public`:

```sql
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
```

Toda tabela nova em `public` nasce com **ALL** para os três roles. A migration revogava de
`public, anon, authenticated` — **e esquecia o `service_role`**. O `grant select ... to
service_role` logo abaixo era decorativo: o ALL herdado do default continuava valendo.

Consequência prática: o runtime poderia gravar **direto** nas tabelas do ledger,
contornando token, lease e máquina de estados — exatamente o que o R5-4 existia para impedir.

## Por que 181 asserções verdes não pegaram

`alter default privileges` é **por schema**. O schema descartável nasce sem essa ACL.

A asserção R5-4 existia, estava escrita, rodava e passava — **por causa do ambiente, não do
código**. Eu tinha escrito no cabeçalho do runner que usar o banco real fazia "o teste de
privilégio valer de verdade". Valia para os *roles*; não valia para as *default privileges
do schema*. A prova rodava num banco que não é o banco onde a coisa é aplicada.

É o sexto falso-verde da série, e o primeiro em que o instrumento estava correto e o
**ambiente** é que mentia:

| rodada | o instrumento dizia verde porque… |
|---|---|
| 4 | bloco `DO` abortava e o resumo somava só o que sobrou |
| 8 | `UPDATE` afetava zero linhas e a função devolvia `ok=true` |
| 11 | `ERROR` do `psql` virava texto e não casava com o padrão |
| 12 | a suíte concluía "sem erro" por `grep` no formato da mensagem |
| 13 | o mutante aceitava "alguma coisa falhou" como detecção |
| **14** | **o schema de teste não reproduzia a ACL do schema de destino** |

## Correção (TDD, nesta ordem)

1. **Instrumento primeiro.** O runner passou a espelhar as default privileges de `public` no
   schema descartável. Sem a correção da migration: **12 asserções falham** (4 tabelas ×
   INSERT/UPDATE/DELETE), `EXIT=1`. O teste passou a enxergar.
2. **Migration original** inclui `service_role` no revoke — para quem aplicar do zero.
3. **`2026-08-03b-tom-router-service-role-write.sql`** aplica o revoke em bancos onde a
   versão anterior já entrou. Foi o que rodou em `public`.
4. **`scripts/sql/verificar-router-public.sql`** versionado. É a checagem contra o banco
   **real**, a única capaz de pegar essa classe. Deve rodar sempre depois de aplicar.

## Prova

```
antes da correção da migration (com o runner espelhando):  12 falhas · EXIT=1
depois:  181/181 · asserções falhas = 0 · EXIT=0
mutante: 5/5 sensíveis · inesperadas 0 · EXIT=0
selftest: sabotagem e placebo reprovam · EXIT=0
```

`public` depois do fix:
```
funcoes_criadas=12 · funcoes_security_definer=12 · tabelas_criadas=4 · tabelas_com_rls=4
FUNC_EXEC_anon=0 · FUNC_EXEC_authenticated=0 · func_exec_service_role=12
TAB_SELECT_anon=0 · TAB_INSERT_anon=0 · TAB_SELECT_authenticated=0
tab_select_service_role=4 · TAB_INSERT_service_role=0 · TAB_UPDATE_service_role=0
linhas_gravadas=0
ACL real: service_role=r/postgres
```

Resíduo do schema descartável: `schemas=0`, `default_acl_orfa=0`. TOM: `online`, sem restart.

KI registrado: `ROUTER-SERVICEROLE-WRITE-DEFAULTACL` (alto, corrigido).

---

## O que isso significa para o resto

A regra nova não é sobre este bug: **teste em schema espelho não prova privilégio no schema
de destino.** Toda vez que a prova roda num schema que não é o de produção, é preciso
perguntar o que o schema de destino tem que o espelho não tem — e reproduzir, ou verificar
depois no real. Aqui era `alter default privileges`; noutro lugar pode ser policy padrão,
trigger de auditoria, extensão.

## Estado

Migration **aplicada e inerte** · router **não ligado** · canário **não aberto** · RPCs de
negócio fora (E2.0) · `soul/` e `skills/` intocados · TOM v1 sem alteração nenhuma.

Segue aberto: as 5 funções `SECURITY DEFINER` **antigas** (anteriores a este trabalho) em
produção executáveis por `anon`, incluindo `current_collab_id`. As 12 novas nascem fechadas.
