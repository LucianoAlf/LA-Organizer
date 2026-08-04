-- 1) Quantas vezes o TOM pede "Confirma o fechamento" DEPOIS de o usuário já ter dito que fez
with pedidos as (
  select ch.id, ch.collaborator_id, ch.created_at
    from conversation_history ch
   where ch.direction='outbound' and ch.content ~ 'Confirma o fechamento'
     and ch.created_at > now() - interval '30 days'
), com_confirmacao_antes as (
  select p.id,
    (select ch2.content from conversation_history ch2
      where ch2.collaborator_id = p.collaborator_id and ch2.direction='inbound'
        and ch2.created_at < p.created_at and ch2.created_at > p.created_at - interval '2 minutes'
      order by ch2.created_at desc limit 1) as fala_anterior
  from pedidos p
)
select 'pedidos de confirmacao de fechamento (30d) = ' || (select count(*) from pedidos)
union all
select 'destes, o usuario JA tinha dito que fez = ' || count(*)
  from com_confirmacao_antes
 where fala_anterior ~* '\m(feit[ao]s?|conclu[ií]|pronto|j[áa] fiz|todas|tudo certo|fechad[ao]s?|ok)\M';
