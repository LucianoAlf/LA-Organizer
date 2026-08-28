-- =============================================================================
-- P0-1a v2.4 — Fechar a EXPOSIÇÃO PÚBLICA de 5 tabelas. NADA MAIS.
-- NÃO APLICADO. Aguarda GATE HUMANO A.
--
-- MUDANÇA v2.3 -> v2.4 (bloqueador #4, acatado):
--   A v2.3 misturava duas coisas de classes de risco diferentes na mesma migration:
--     (a) revogar acesso PÚBLICO  -> risco ~zero, consumidor público provado inexistente;
--     (b) reduzir o service_role  -> risco REAL, é o caminho do TOM em produção.
--   Se (b) errasse por um verbo, o TOM quebrava e (a) — que é o P0 — vinha junto no
--   rollback. Agora (b) mora em 20260828000100_p0_1b_least_privilege_service_role.sql,
--   FORA deste gate, com smoke próprio que exercita INSERT/UPDATE e não só SELECT.
--   Esta migration NÃO TOCA em service_role nem em postgres.
-- =============================================================================
--
-- ESTADO MEDIDO (2026-08-27/28, read-only), idêntico nas 5 tabelas:
--   relrowsecurity=false, zero policies, e
--   grant delete, insert, references, select, trigger, truncate, update
--     para anon, authenticated, postgres e service_role.
--
-- PROVAS:
--   catálogo  : has_table_privilege -> 10 linhas (5 tabelas x anon/authenticated), todas com
--               os 5 verbos.
--   tráfego   : GET /rest/v1/<tabela> com a anon key -> HTTP 200 nas 5.
--   PWA       : zero referências às 5 tabelas no fonte e no bundle de produção.
--   engine    : sempre via src/supabase/client.js = service_role (ignora RLS).
--
-- TRUNCATE: o privilégio existe, mas a Data API não expõe verbo para ele. Explorá-lo
-- exigiria uma RPC SECURITY DEFINER que o chamasse; nenhuma identificada. Os quatro verbos
-- REST já bastam como P0.
--
-- Nenhuma policy é criada: não há consumidor legítimo comprovado por anon/authenticated.
-- Default deny. Se aparecer um, cria-se policy por verbo, com predicado.
-- =============================================================================

begin;

alter table public.event_category_leaders            enable row level security;
alter table public.pf_transactions_bkp_20260716_rose enable row level security;
alter table public.task_classifications              enable row level security;
alter table public.voice_message_log                 enable row level security;
alter table public.webhook_queue                     enable row level security;

revoke all on public.event_category_leaders            from anon, authenticated;
revoke all on public.pf_transactions_bkp_20260716_rose from anon, authenticated;
revoke all on public.task_classifications              from anon, authenticated;
revoke all on public.voice_message_log                 from anon, authenticated;
revoke all on public.webhook_queue                     from anon, authenticated;

commit;

-- =============================================================================
-- VERIFICAÇÃO PÓS-APLICAÇÃO (read-only). Esperado nas 5:
--   rls = t, policies = 0, pub = (nenhum), e service_role INALTERADO (os 7 privilégios).
-- =============================================================================
-- select c.relname, c.relrowsecurity rls,
--        (select count(*) from pg_policies p
--          where p.schemaname='public' and p.tablename=c.relname) policies,
--        coalesce((select string_agg(distinct g.grantee,',')
--                    from information_schema.role_table_grants g
--                   where g.table_schema='public' and g.table_name=c.relname
--                     and g.grantee in ('anon','authenticated')),'(nenhum)') pub,
--        (select count(distinct g.privilege_type)
--           from information_schema.role_table_grants g
--          where g.table_schema='public' and g.table_name=c.relname
--            and g.grantee='service_role') sr_privs
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public'
--    and c.relname in ('event_category_leaders','pf_transactions_bkp_20260716_rose',
--                      'task_classifications','voice_message_log','webhook_queue')
--  order by c.relname;
