-- Rename: a fonte é governance_credentials, não uma tabela de "links".
-- ALTER FUNCTION ... RENAME preserva os privilégios (o revoke de anon
-- continua valendo), mas o Step 3 verifica isso explicitamente.
alter function get_team_links() rename to get_credenciais_publicas;

comment on column governance_credentials.visivel_tom is
  'Se true, nome e url_ref desta linha podem ser lidos pelo TOM via get_credenciais_publicas(). Nunca expõe campos/observacoes/senhas.';
