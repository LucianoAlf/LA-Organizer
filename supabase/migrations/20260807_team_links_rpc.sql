-- Links de sistemas visíveis ao TOM.
-- default false: as 40+ credenciais existentes permanecem invisíveis sem ação.
alter table governance_credentials
  add column if not exists visivel_tom boolean not null default false;

comment on column governance_credentials.visivel_tom is
  'Se true, nome e url_ref desta linha podem ser lidos pelo TOM via get_team_links(). Nunca expõe campos/observacoes/senhas.';

-- Contrato de colunas no schema: ampliar o que vaza exige reescrever esta
-- função via migration (mudança versionada e visível), não uma linha de .select() em JS.
create or replace function get_team_links()
returns table (nome text, url_ref text)
language sql
stable
as $$
  select nome, url_ref
  from governance_credentials
  where visivel_tom = true
    and status = 'ok'
    and url_ref is not null
  order by nome;
$$;

-- A anon key do Supabase está no bundle público do PWA. Sem este revoke,
-- qualquer pessoa na internet poderia enumerar os sistemas internos da escola.
revoke execute on function get_team_links() from public;
revoke execute on function get_team_links() from anon;
revoke execute on function get_team_links() from authenticated;
grant execute on function get_team_links() to service_role;
