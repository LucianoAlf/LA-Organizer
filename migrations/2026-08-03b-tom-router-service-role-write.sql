-- =====================================================================================
-- TOM v1/v2 — correção de privilégio: service_role não escreve direto nas tabelas do ledger
-- Data: 03/08/2026 · Origem: verificação pós-aplicação (achado próprio, rodada 14)
--
-- POR QUE ESTE ARQUIVO EXISTE
-- A migration 2026-08-03-tom-router-ownership.sql foi aplicada em `public` com o revoke
-- de tabela cobrindo só `public, anon, authenticated`. O Supabase mantém
--   alter default privileges in schema public grant all on tables
--     to anon, authenticated, service_role
-- portanto TODA tabela nova em public nasce com ALL para os três roles. O `grant select
-- ... to service_role` da migration era decorativo: o ALL herdado do default continuava
-- valendo, e o runtime podia gravar direto — contornando token, lease e máquina de
-- estados, que é exatamente o que o R5-4 se propunha a impedir.
--
-- A suíte no schema descartável NÃO pegou isso porque `alter default privileges` é por
-- schema: o schema temporário nasce sem essa ACL. O teste passava por causa do ambiente,
-- não do código. O runner passou a espelhar as default privileges de public.
--
-- O arquivo original já foi corrigido para quem aplicar do zero. ESTE arquivo é para
-- bancos onde a versão anterior já foi aplicada. Idempotente.
--
-- SEGURANÇA: as 4 tabelas estão vazias e nenhum código as chama. As RPCs são
-- SECURITY DEFINER — escrevem como owner, sem depender do privilégio do chamador.
-- =====================================================================================

begin;

revoke all on table public.tom_message_ownership, public.tom_flow_ownership,
                    public.tom_operations, public.tom_operation_steps
  from public, anon, authenticated, service_role;

grant select on table public.tom_message_ownership, public.tom_flow_ownership,
                      public.tom_operations, public.tom_operation_steps
  to service_role;

commit;
