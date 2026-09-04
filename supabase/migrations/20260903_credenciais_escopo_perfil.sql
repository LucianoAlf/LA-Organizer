-- Quem opera credenciais: ve valor sensivel na tela e pelo TOM.
-- Resolve o TODO(roadmap) de src/rituals/dispatcher.js.
alter table collaborators
  add column if not exists is_system_admin boolean not null default false;

comment on column collaborators.is_system_admin is
  'Se true, acessa qualquer credencial de governance_credentials (inclusive valores sensiveis) pelo TOM. Nao confundir com role=director, que governa a tela do PWA.';

update collaborators
set is_system_admin = true
where is_active = true
  and email in ('hugogmilesi@gmail.com', 'lucianoalf.la@gmail.com', '5521966950296@la.internal');

-- Leitura com escopo decidido NO BANCO, nao na aplicacao.
-- Admin ve todas as 45 com tudo; qualquer outro ve so nome+url das visivel_tom.
-- O campo is_admin no retorno diz ao engine qual formato usar, sem ele
-- precisar consultar collaborators de novo.
create or replace function get_credenciais_para(p_collaborator_id uuid)
returns table (
  id uuid, nome text, url_ref text, servico text, projeto text,
  responsavel text, categoria text, status text, observacoes text,
  campos jsonb, is_admin boolean
)
language plpgsql
stable
as $$
declare v_admin boolean;
begin
  select coalesce(c.is_system_admin, false) into v_admin
  from collaborators c
  where c.id = p_collaborator_id and c.is_active = true;

  if v_admin is null then v_admin := false; end if;

  if v_admin then
    return query
      select g.id, g.nome, g.url_ref, g.servico, g.projeto, g.responsavel,
             g.categoria, g.status, g.observacoes, g.campos, true
      from governance_credentials g
      order by g.nome;
  else
    return query
      select g.id, g.nome, g.url_ref,
             null::text, null::text, null::text, null::text, null::text, null::text,
             '[]'::jsonb, false
      from governance_credentials g
      where g.visivel_tom = true
        and g.status = 'ok'
        and g.url_ref is not null
      order by g.nome;
  end if;
end; $$;

-- A anon key esta no bundle publico do PWA.
revoke execute on function get_credenciais_para(uuid) from public;
revoke execute on function get_credenciais_para(uuid) from anon;
revoke execute on function get_credenciais_para(uuid) from authenticated;
grant execute on function get_credenciais_para(uuid) to service_role;

-- NAO dropar get_credenciais_publicas aqui. O engine em producao so passa a
-- usar a RPC nova no deploy (Task 6); dropar agora deixaria o TOM respondendo
-- "nao tenho nenhum sistema cadastrado" ate la. O drop e o Step 2 da Task 6.
