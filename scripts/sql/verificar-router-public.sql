-- Verificação pós-aplicação do ledger de ownership em `public`. Contrato, não aparência.
--
-- POR QUE ELE EXISTE: a suíte do schema descartável não vê as DEFAULT PRIVILEGES que o
-- Supabase mantém em `public` (alter default privileges ... grant all on tables to anon,
-- authenticated, service_role) — `alter default privileges` é POR SCHEMA. Foi este
-- verificador, e não a suíte, que pegou o service_role chegando a public com ALL.
-- Rode SEMPRE depois de aplicar a migration num banco real.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -f scripts/sql/verificar-router-public.sql
--
-- Contrato esperado (linhas em MAIÚSCULA são as que não podem variar):
--   funcoes_criadas=12 · funcoes_security_definer=12 · tabelas_criadas=4 · tabelas_com_rls=4
--   FUNC_EXEC_anon=0 · FUNC_EXEC_authenticated=0 · func_exec_service_role=12
--   TAB_SELECT_anon=0 · TAB_INSERT_anon=0 · TAB_SELECT_authenticated=0
--   tab_select_service_role=4 · TAB_INSERT_service_role=0 · TAB_UPDATE_service_role=0
with f as (
  select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'tom~_route~_%' escape '~'
       or p.proname like 'tom~_flow~_%' escape '~'
       or p.proname like 'tom~_operation~_%' escape '~'
       or p.proname = 'tom_record_outbound')
), t as (
  select c.oid, c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('tom_message_ownership','tom_flow_ownership','tom_operations','tom_operation_steps')
)
select 'funcoes_criadas='                || (select count(*) from f)                                                          union all
select 'funcoes_security_definer='       || (select count(*) from f join pg_proc p on p.oid = f.oid where p.prosecdef)        union all
select 'FUNC_EXEC_anon='                 || (select count(*) from f where has_function_privilege('anon', oid, 'EXECUTE'))     union all
select 'FUNC_EXEC_authenticated='        || (select count(*) from f where has_function_privilege('authenticated', oid, 'EXECUTE')) union all
select 'func_exec_service_role='         || (select count(*) from f where has_function_privilege('service_role', oid, 'EXECUTE')) union all
select 'tabelas_criadas='                || (select count(*) from t)                                                         union all
select 'tabelas_com_rls='                || (select count(*) from t where relrowsecurity)                                     union all
select 'TAB_SELECT_anon='                || (select count(*) from t where has_table_privilege('anon', oid, 'SELECT'))         union all
select 'TAB_INSERT_anon='                || (select count(*) from t where has_table_privilege('anon', oid, 'INSERT'))         union all
select 'TAB_SELECT_authenticated='       || (select count(*) from t where has_table_privilege('authenticated', oid, 'SELECT')) union all
select 'tab_select_service_role='        || (select count(*) from t where has_table_privilege('service_role', oid, 'SELECT')) union all
select 'TAB_INSERT_service_role='        || (select count(*) from t where has_table_privilege('service_role', oid, 'INSERT')) union all
select 'TAB_UPDATE_service_role='        || (select count(*) from t where has_table_privilege('service_role', oid, 'UPDATE')) union all
select 'linhas_gravadas='                || (select coalesce(sum(n),0) from (
          select count(*) n from public.tom_message_ownership
    union all select count(*) from public.tom_flow_ownership
    union all select count(*) from public.tom_operations
    union all select count(*) from public.tom_operation_steps) x);
