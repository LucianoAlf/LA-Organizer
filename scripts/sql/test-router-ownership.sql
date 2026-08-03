-- Testes do ledger de ownership (rodada 3 do Alfredo).
-- Roda contra o schema descartável `tom_router_test`, onde a MIGRATION REAL foi aplicada
-- por scripts/test-router-ownership.sh (sed public.→tom_router_test.). Testar uma cópia
-- do DDL não provaria nada: a cópia diverge.
--
-- Sem ON_ERROR_STOP: cada teste registra ok/falha em _res e o runner soma no final.

set search_path = tom_router_test, public;

drop table if exists _res;
create table _res (n serial, label text, ok boolean, detail text);

-- ============================ R3-A1 — privilégios ============================
-- O default do banco concede EXECUTE a PUBLIC. Sem os REVOKE da migration, estas RPCs
-- nasceriam chamáveis por qualquer JWT anon.
insert into _res (label, ok, detail)
select 'A1 anon NÃO executa ' || f, not has_function_privilege('anon', f, 'EXECUTE'), f
from unnest(array[
  'tom_router_test.tom_route_claim_inbound(text,text,text,uuid,text,text,text,text,int)',
  'tom_router_test.tom_route_heartbeat(text,text,int)',
  'tom_router_test.tom_route_finish_inbound(text,text,text,text)',
  'tom_router_test.tom_record_outbound(text,text,text,uuid,text,text,uuid,uuid)',
  'tom_router_test.tom_flow_open(text,text,uuid,text,uuid,boolean,text,text)',
  'tom_router_test.tom_flow_set_phase(text,uuid,text)'
]) f;

insert into _res (label, ok, detail)
select 'A1 authenticated NÃO executa ' || f, not has_function_privilege('authenticated', f, 'EXECUTE'), f
from unnest(array[
  'tom_router_test.tom_route_claim_inbound(text,text,text,uuid,text,text,text,text,int)',
  'tom_router_test.tom_record_outbound(text,text,text,uuid,text,text,uuid,uuid)',
  'tom_router_test.tom_flow_set_phase(text,uuid,text)'
]) f;

insert into _res (label, ok, detail)
select 'A1 service_role EXECUTA ' || f, has_function_privilege('service_role', f, 'EXECUTE'), f
from unnest(array[
  'tom_router_test.tom_route_claim_inbound(text,text,text,uuid,text,text,text,text,int)',
  'tom_router_test.tom_record_outbound(text,text,text,uuid,text,text,uuid,uuid)',
  'tom_router_test.tom_flow_set_phase(text,uuid,text)'
]) f;

-- tabelas: anon não lê nem escreve
insert into _res (label, ok, detail)
select 'A1 anon sem ' || p || ' em ' || t,
       not has_table_privilege('anon', t, p), t || '/' || p
from unnest(array['tom_router_test.tom_message_ownership','tom_router_test.tom_flow_ownership','tom_router_test.tom_operations']) t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;

-- RLS ligada nas três
insert into _res (label, ok, detail)
select 'A1 RLS ligada em ' || relname, relrowsecurity, relname
from pg_class where relnamespace = 'tom_router_test'::regnamespace
  and relname in ('tom_message_ownership','tom_flow_ownership','tom_operations');

-- ============================ R3-A2 — claim e corrida ============================
do $$
declare r record; r2 record;
begin
  select * into r from tom_route_claim_inbound('wa-A2-1','v1');
  insert into _res (label, ok, detail) values ('A2 primeiro claim = claimed', r.outcome='claimed', r.outcome);
  insert into _res (label, ok, detail) values ('A2 claim cria operação', r.operation_id is not null, r.operation_id::text);

  -- segundo claim, OUTRO runtime, lease ainda válido: não pode receber "novo"
  select * into r2 from tom_route_claim_inbound('wa-A2-1','v2');
  insert into _res (label, ok, detail) values
    ('A2 perdedor NÃO recebe claimed', r2.outcome <> 'claimed', r2.outcome),
    ('A2 perdedor vê in_progress_elsewhere', r2.outcome = 'in_progress_elsewhere', r2.outcome),
    ('A2 perdedor recebe o dono vencedor', r2.owner = 'v1', r2.owner);

  -- uma operação só para o inbound
  insert into _res (label, ok, detail)
  select 'A2 uma operação por inbound', count(*) = 1, count(*)::text
    from tom_operations where inbound_wa_message_id = 'wa-A2-1';
end $$;

-- ============================ R3-A3 — lease, crash e recibo ============================
do $$
declare r record;
begin
  -- crash: claim gravado, lease vencido, nada concluído
  perform tom_route_claim_inbound('wa-A3-crash','v1');
  update tom_message_ownership set lease_until = now() - interval '1 minute'
   where wa_message_id = 'wa-A3-crash';

  select * into r from tom_route_claim_inbound('wa-A3-crash','v1');
  insert into _res (label, ok, detail) values
    ('A3 mesmo dono RETOMA claim abandonado', r.outcome = 'resumed', r.outcome);

  insert into _res (label, ok, detail)
  select 'A3 retomada incrementa attempts', attempts = 2, attempts::text
    from tom_message_ownership where wa_message_id = 'wa-A3-crash';

  -- outro dono NÃO pode retomar (efeito parcial do primeiro é desconhecido)
  update tom_message_ownership set lease_until = now() - interval '1 minute'
   where wa_message_id = 'wa-A3-crash';
  select * into r from tom_route_claim_inbound('wa-A3-crash','v2');
  insert into _res (label, ok, detail) values
    ('A3 outro dono NÃO retoma', r.outcome = 'owned_by_other', r.outcome);

  -- recibo: só depois de completed o dedupe suprime
  perform tom_route_finish_inbound('wa-A3-crash','v1','completed');
  select * into r from tom_route_claim_inbound('wa-A3-crash','v1');
  insert into _res (label, ok, detail) values
    ('A3 concluído vira already_completed', r.outcome = 'already_completed', r.outcome);

  -- failed devolve para retentativa do mesmo dono
  perform tom_route_claim_inbound('wa-A3-fail','v1');
  perform tom_route_finish_inbound('wa-A3-fail','v1','failed','erro simulado');
  select * into r from tom_route_claim_inbound('wa-A3-fail','v1');
  insert into _res (label, ok, detail) values
    ('A3 failed é retomável', r.outcome = 'resumed', r.outcome);

  -- heartbeat segura o lease de trabalho longo
  perform tom_route_claim_inbound('wa-A3-hb','v1', p_lease_seconds => 1);
  insert into _res (label, ok, detail)
  select 'A3 heartbeat renova e marca processing', tom_route_heartbeat('wa-A3-hb','v1',600), null;
  insert into _res (label, ok, detail)
  select 'A3 heartbeat empurrou o lease', lease_until > now() + interval '5 minutes', lease_until::text
    from tom_message_ownership where wa_message_id = 'wa-A3-hb';
  insert into _res (label, ok, detail)
  select 'A3 heartbeat de outro dono não pega', not tom_route_heartbeat('wa-A3-hb','v2',600), null;

  -- id vazio não vira linha
  select * into r from tom_route_claim_inbound('','v1');
  insert into _res (label, ok, detail) values ('A3 wa_id vazio = invalid', r.outcome = 'invalid', r.outcome);
end $$;

-- ============================ R3-B1 — outbound tipado ============================
do $$
declare r record;
begin
  select * into r from tom_record_outbound('wa-OUT-1','v2');
  insert into _res (label, ok, detail) values ('B1 outbound novo = inserted', r.outcome='inserted', r.outcome);

  select * into r from tom_record_outbound('wa-OUT-1','v2');
  insert into _res (label, ok, detail) values ('B1 repetido mesmo dono = already_recorded_same', r.outcome='already_recorded_same', r.outcome);

  select * into r from tom_record_outbound('wa-OUT-1','v1');
  insert into _res (label, ok, detail) values ('B1 dono diferente = ownership_conflict (não silencioso)', r.outcome='ownership_conflict', r.outcome);

  select * into r from tom_record_outbound(null,'v2');
  insert into _res (label, ok, detail) values ('B1 sem id = missing_message_id', r.outcome='missing_message_id', r.outcome);

  insert into _res (label, ok, detail)
  select 'B1 outbound nasce completed', status='completed', status
    from tom_message_ownership where wa_message_id='wa-OUT-1';
end $$;

-- ============================ R3-A4 — fluxo por conversa ============================
do $$
declare a uuid; b uuid; c uuid; d uuid; e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid();
begin
  a := tom_flow_open('5521999@s.whatsapp.net','task',e1,'v2');
  insert into _res (label, ok, detail) values ('A4 abre fluxo interativo', a is not null, a::text);

  -- segundo interativo NA MESMA conversa (outra entidade) tem que ser recusado:
  -- é o que dá ao adapter UM flowOwner determinístico
  b := tom_flow_open('5521999@s.whatsapp.net','task',e2,'v2');
  insert into _res (label, ok, detail) values ('A4 segundo interativo na mesma conversa é recusado', b is null, b::text);

  -- não-interativo coexiste (entidade com dono, sem prender a conversa)
  c := tom_flow_open('5521999@s.whatsapp.net','task',e2,'v2', p_interactive => false);
  insert into _res (label, ok, detail) values ('A4 não-interativo coexiste', c is not null, c::text);

  -- mesma entidade duas vezes = recusado
  d := tom_flow_open('outra-conversa@g.us','task',e1,'v1');
  insert into _res (label, ok, detail) values ('A4 entidade já com dono é recusada', d is null, d::text);

  -- grupo é conversa própria
  insert into _res (label, ok, detail)
  select 'A4 grupo abre fluxo próprio', tom_flow_open('120363@g.us','task',gen_random_uuid(),'v2') is not null, null;

  insert into _res (label, ok, detail)
  select 'A4 um interativo ativo por conversa', count(*) = 1, count(*)::text
    from tom_flow_ownership where conversation_key='5521999@s.whatsapp.net' and closed_at is null and interactive;
end $$;

-- ============================ R3-B2 — transições de fase ============================
do $$
declare r record; ent uuid := gen_random_uuid();
begin
  perform tom_flow_open('conv-fase@s.whatsapp.net','task',ent,'v2');

  select * into r from tom_flow_set_phase('task',ent,'draining');
  insert into _res (label, ok, detail) values ('B2 canary→draining permitido', r.outcome='ok', r.outcome);

  select * into r from tom_flow_set_phase('task',ent,'canary');
  insert into _res (label, ok, detail) values ('B2 draining→canary BLOQUEADO', r.outcome='illegal_transition', r.outcome);

  select * into r from tom_flow_set_phase('task',ent,'draining');
  insert into _res (label, ok, detail) values ('B2 mesma fase = unchanged', r.outcome='unchanged', r.outcome);

  select * into r from tom_flow_set_phase('task',ent,'retired');
  insert into _res (label, ok, detail) values ('B2 draining→retired permitido', r.outcome='ok', r.outcome);

  insert into _res (label, ok, detail)
  select 'B2 retired fecha o fluxo', closed_at is not null, closed_at::text
    from tom_flow_ownership where entity_type='task' and entity_id=ent;

  select * into r from tom_flow_set_phase('task',ent,'draining');
  insert into _res (label, ok, detail) values ('B2 fluxo fechado não aceita fase', r.outcome='not_found', r.outcome);

  -- conversa liberada depois do retired
  insert into _res (label, ok, detail)
  select 'B2 conversa liberada após retired', tom_flow_open('conv-fase@s.whatsapp.net','task',gen_random_uuid(),'v1') is not null, null;
end $$;

-- ============================ resultado ============================
select label, case when ok then 'OK' else 'FALHOU' end as status, detail
from _res where not ok order by n;

select count(*) filter (where ok)     as passou,
       count(*) filter (where not ok) as falhou,
       count(*)                       as total
from _res;
