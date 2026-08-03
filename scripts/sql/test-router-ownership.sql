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
  'tom_router_test.tom_route_heartbeat(text,text,int,uuid)',
  'tom_router_test.tom_route_finish_inbound(text,text,text,text,uuid)',
  'tom_router_test.tom_record_outbound(text,text,text,uuid,text,text,uuid,uuid,uuid)',
  'tom_router_test.tom_flow_open(text,text,uuid,text,uuid,boolean,text,text,int)',
  'tom_router_test.tom_flow_touch(text,int,text,uuid)',
  'tom_router_test.tom_flow_set_phase(text,uuid,text,uuid)',
  'tom_router_test.tom_operation_step_begin(uuid,text,uuid)',
  'tom_router_test.tom_operation_step_finish(uuid,text,jsonb,text,text,uuid)',
  'tom_router_test.tom_operation_step_verify(uuid,text,boolean,jsonb,uuid)',
  'tom_router_test.tom_route_assert_lease(text,text,uuid)',
  'tom_router_test.tom_flow_active_for_conversation(text)'
]) f;

insert into _res (label, ok, detail)
select 'A1 authenticated NÃO executa ' || f, not has_function_privilege('authenticated', f, 'EXECUTE'), f
from unnest(array[
  'tom_router_test.tom_route_claim_inbound(text,text,text,uuid,text,text,text,text,int)',
  'tom_router_test.tom_record_outbound(text,text,text,uuid,text,text,uuid,uuid,uuid)',
  'tom_router_test.tom_flow_set_phase(text,uuid,text,uuid)'
]) f;

insert into _res (label, ok, detail)
select 'A1 service_role EXECUTA ' || f, has_function_privilege('service_role', f, 'EXECUTE'), f
from unnest(array[
  'tom_router_test.tom_route_claim_inbound(text,text,text,uuid,text,text,text,text,int)',
  'tom_router_test.tom_record_outbound(text,text,text,uuid,text,text,uuid,uuid,uuid)',
  'tom_router_test.tom_flow_set_phase(text,uuid,text,uuid)'
]) f;

-- tabelas: anon não lê nem escreve
insert into _res (label, ok, detail)
select 'A1 anon sem ' || p || ' em ' || t,
       not has_table_privilege('anon', t, p), t || '/' || p
from unnest(array['tom_router_test.tom_message_ownership','tom_router_test.tom_flow_ownership','tom_router_test.tom_operations','tom_router_test.tom_operation_steps']) t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;

-- RLS ligada nas três
insert into _res (label, ok, detail)
select 'A1 RLS ligada em ' || relname, relrowsecurity, relname
from pg_class where relnamespace = 'tom_router_test'::regnamespace
  and relname in ('tom_message_ownership','tom_flow_ownership','tom_operations','tom_operation_steps');

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
  perform tom_route_finish_inbound('wa-A3-crash','v1','completed', null,
    (select lease_token from tom_message_ownership where wa_message_id='wa-A3-crash'));
  select * into r from tom_route_claim_inbound('wa-A3-crash','v1');
  insert into _res (label, ok, detail) values
    ('A3 concluído vira already_completed', r.outcome = 'already_completed', r.outcome);

  -- failed devolve para retentativa do mesmo dono
  perform tom_route_claim_inbound('wa-A3-fail','v1');
  perform tom_route_finish_inbound('wa-A3-fail','v1','failed','erro simulado',
    (select lease_token from tom_message_ownership where wa_message_id='wa-A3-fail'));
  select * into r from tom_route_claim_inbound('wa-A3-fail','v1');
  insert into _res (label, ok, detail) values
    ('A3 failed é retomável', r.outcome = 'resumed', r.outcome);

  -- heartbeat segura o lease de trabalho longo
  perform tom_route_claim_inbound('wa-A3-hb','v1', p_lease_seconds => 1);
  insert into _res (label, ok, detail)
  select 'A3 heartbeat renova e marca processing',
         tom_route_heartbeat('wa-A3-hb','v1',600,(select lease_token from tom_message_ownership where wa_message_id='wa-A3-hb')), null;
  insert into _res (label, ok, detail)
  select 'A3 heartbeat empurrou o lease', lease_until > now() + interval '5 minutes', lease_until::text
    from tom_message_ownership where wa_message_id = 'wa-A3-hb';
  insert into _res (label, ok, detail)
  select 'A3 heartbeat de outro dono não pega',
         not tom_route_heartbeat('wa-A3-hb','v2',600,(select lease_token from tom_message_ownership where wa_message_id='wa-A3-hb')), null;

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
  select id into a from tom_flow_open('5521999@s.whatsapp.net','task',e1,'v2');
  insert into _res (label, ok, detail) values ('A4 abre fluxo interativo', a is not null, a::text);

  -- segundo interativo NA MESMA conversa (outra entidade) tem que ser recusado:
  -- é o que dá ao adapter UM flowOwner determinístico
  select id into b from tom_flow_open('5521999@s.whatsapp.net','task',e2,'v2');
  insert into _res (label, ok, detail) values ('A4 segundo interativo na mesma conversa é recusado', b is null, b::text);

  -- não-interativo coexiste (entidade com dono, sem prender a conversa)
  select id into c from tom_flow_open('5521999@s.whatsapp.net','task',e2,'v2', p_interactive => false);
  insert into _res (label, ok, detail) values ('A4 não-interativo coexiste', c is not null, c::text);

  -- mesma entidade duas vezes = recusado
  select id into d from tom_flow_open('outra-conversa@g.us','task',e1,'v1');
  insert into _res (label, ok, detail) values ('A4 entidade já com dono é recusada', d is null, d::text);

  -- grupo é conversa própria
  insert into _res (label, ok, detail)
  select 'A4 grupo abre fluxo próprio', (select id from tom_flow_open('120363@g.us','task',gen_random_uuid(),'v2')) is not null, null;

  insert into _res (label, ok, detail)
  select 'A4 um interativo ativo por conversa', count(*) = 1, count(*)::text
    from tom_flow_ownership where conversation_key='5521999@s.whatsapp.net' and closed_at is null and interactive;
end $$;

-- ============================ R3-B2 — transições de fase ============================
do $$
declare r record; ent uuid := gen_random_uuid(); tok uuid;
begin
  select flow_token into tok from tom_flow_open('conv-fase@s.whatsapp.net','task',ent,'v2');

  select * into r from tom_flow_set_phase('task',ent,'draining', tok);
  insert into _res (label, ok, detail) values ('B2 canary→draining permitido', r.outcome='ok', r.outcome);

  select * into r from tom_flow_set_phase('task',ent,'canary', tok);
  insert into _res (label, ok, detail) values ('B2 draining→canary BLOQUEADO', r.outcome='illegal_transition', r.outcome);

  select * into r from tom_flow_set_phase('task',ent,'draining', tok);
  insert into _res (label, ok, detail) values ('B2 mesma fase = unchanged', r.outcome='unchanged', r.outcome);

  select * into r from tom_flow_set_phase('task',ent,'retired', tok);
  insert into _res (label, ok, detail) values ('B2 draining→retired permitido', r.outcome='ok', r.outcome);

  insert into _res (label, ok, detail)
  select 'B2 retired fecha o fluxo', closed_at is not null, closed_at::text
    from tom_flow_ownership where entity_type='task' and entity_id=ent;

  select * into r from tom_flow_set_phase('task',ent,'draining', tok);
  insert into _res (label, ok, detail) values ('B2 fluxo fechado não aceita fase', r.outcome='not_found', r.outcome);

  -- conversa liberada depois do retired
  insert into _res (label, ok, detail)
  select 'B2 conversa liberada após retired', (select id from tom_flow_open('conv-fase@s.whatsapp.net','task',gen_random_uuid(),'v1')) is not null, null;
end $$;

-- ==================== R4-1 — fencing token (posse por tentativa) ====================
-- Worker antigo do MESMO runtime pode voltar depois do lease vencer (GC pause, rede) e
-- continuar agindo. `owner` não distingue tentativas: só um token por posse resolve.
do $$
declare r1 record; r2 record; ok boolean;
begin
  select * into r1 from tom_route_claim_inbound('wa-R4-fence','v2');
  insert into _res (label, ok, detail) values ('R4-1 claim devolve lease_token', r1.lease_token is not null, r1.lease_token::text);

  -- lease vence; OUTRO worker do mesmo v2 retoma
  update tom_message_ownership set lease_until = now() - interval '1 minute' where wa_message_id='wa-R4-fence';
  select * into r2 from tom_route_claim_inbound('wa-R4-fence','v2');
  insert into _res (label, ok, detail) values
    ('R4-1 retomada gera token NOVO', r2.lease_token is distinct from r1.lease_token, r2.lease_token::text);

  -- o worker VELHO acorda e tenta renovar com o token antigo
  ok := tom_route_heartbeat('wa-R4-fence','v2',600, r1.lease_token);
  insert into _res (label, ok, detail) values ('R4-1 heartbeat com token VELHO é rejeitado', not ok, null);

  ok := tom_route_heartbeat('wa-R4-fence','v2',600, r2.lease_token);
  insert into _res (label, ok, detail) values ('R4-1 heartbeat com token atual funciona', ok, null);

  -- e o velho também não pode fechar a mensagem
  select f.ok into ok from tom_route_finish_inbound('wa-R4-fence','v2','completed',null, r1.lease_token) f;
  insert into _res (label, ok, detail) values ('R4-1 finish com token VELHO é rejeitado', not ok, null);

  insert into _res (label, ok, detail)
  select 'R4-1 mensagem NÃO foi fechada pelo worker velho', status <> 'completed', status
    from tom_message_ownership where wa_message_id='wa-R4-fence';

  select f.ok into ok from tom_route_finish_inbound('wa-R4-fence','v2','completed',null, r2.lease_token) f;
  insert into _res (label, ok, detail) values ('R4-1 finish com token atual funciona', ok, null);
end $$;

-- ==================== R4-2 — idempotência por etapa ====================
-- Retomar "pelo mesmo dono" não pode reexecutar mutação já feita antes do crash.
-- Cada passo com efeito é reivindicado ANTES de agir; retomada vê 'done' e não repete.
do $$
declare r record; op uuid; s record;
begin
  select * into r from tom_route_claim_inbound('wa-R4-step','v2');
  op := r.operation_id;

  select * into s from tom_operation_step_begin(op, 'concluir_tarefa', r.lease_token);
  insert into _res (label, ok, detail) values ('R4-2 primeiro begin = new', s.outcome='new', s.outcome);

  -- ... aqui o worker mutaria a entidade e cairia ANTES de fechar o passo
  select * into s from tom_operation_step_begin(op, 'concluir_tarefa', r.lease_token);
  insert into _res (label, ok, detail) values
    ('R4-2 mesmo worker rechamando = in_progress_active', s.outcome='in_progress_active', s.outcome);

  perform tom_operation_step_finish(op, 'concluir_tarefa', '{"task":"ok"}'::jsonb, 'done', null, r.lease_token);

  select * into s from tom_operation_step_begin(op, 'concluir_tarefa', r.lease_token);
  insert into _res (label, ok, detail) values
    ('R4-2 passo concluído devolve done', s.outcome='done', s.outcome),
    ('R4-2 done devolve o resultado guardado', s.result->>'task' = 'ok', s.result::text);

  -- passos diferentes são independentes
  select * into s from tom_operation_step_begin(op, 'enviar_resposta', r.lease_token);
  insert into _res (label, ok, detail) values ('R4-2 outro passo é independente', s.outcome='new', s.outcome);

  insert into _res (label, ok, detail)
  select 'R4-2 nunca duplica linha de passo', count(*)=1, count(*)::text
    from tom_operation_steps where operation_id=op and step_key='concluir_tarefa';

  -- retomada depois do crash: o claim informa quantos passos já fecharam
  update tom_message_ownership set lease_until = now() - interval '1 minute' where wa_message_id='wa-R4-step';
  select * into r from tom_route_claim_inbound('wa-R4-step','v2');
  insert into _res (label, ok, detail) values
    ('R4-2 retomada informa passos concluídos', r.steps_done = 1, r.steps_done::text),
    ('R4-2 retomada mantém a MESMA operação', r.operation_id = op, r.operation_id::text);
end $$;

-- ==================== R4-3 — TTL do fluxo interativo ====================
-- Se o v2 cair antes de retired, a conversa não pode ficar presa nele para sempre.
do $$
declare a uuid; b uuid; ent1 uuid := gen_random_uuid(); ent2 uuid := gen_random_uuid(); r record; tok uuid;
begin
  select id, flow_token into a, tok from tom_flow_open('conv-ttl@s.whatsapp.net','task',ent1,'v2', p_interactive_ttl_seconds => 3600);
  insert into _res (label, ok, detail) values ('R4-3 abre fluxo com TTL', a is not null, a::text);

  insert into _res (label, ok, detail)
  select 'R4-3 TTL gravado no futuro', interactive_until > now(), interactive_until::text
    from tom_flow_ownership where id = a;

  -- enquanto vivo, continua prendendo a conversa
  select id into b from tom_flow_open('conv-ttl@s.whatsapp.net','task',ent2,'v2');
  insert into _res (label, ok, detail) values ('R4-3 fluxo vivo ainda bloqueia outro interativo', b is null, b::text);

  -- v2 caiu: TTL vence
  update tom_flow_ownership set interactive_until = now() - interval '1 minute' where id = a;

  insert into _res (label, ok, detail)
  select 'R4-3 fluxo expirado não conta como interativo ativo', count(*) = 0, count(*)::text
    from tom_flow_ownership
   where conversation_key='conv-ttl@s.whatsapp.net' and closed_at is null and interactive
     and (interactive_until is null or interactive_until > now());

  -- e a conversa é liberada: abrir novo expropria o expirado
  select id, flow_token into b, tok from tom_flow_open('conv-ttl@s.whatsapp.net','task',ent2,'v2');
  insert into _res (label, ok, detail) values ('R4-3 conversa liberada após TTL vencer', b is not null, b::text);

  insert into _res (label, ok, detail)
  select 'R4-3 expirado foi aposentado com motivo', phase='retired' and note like '%expired%', coalesce(note,'(sem note)')
    from tom_flow_ownership where id = a;

  -- touch renova enquanto o dono está vivo
  insert into _res (label, ok, detail)
  select 'R4-3 touch renova o TTL', tom_flow_touch('conv-ttl@s.whatsapp.net', 7200, 'v2', tok), null;
  insert into _res (label, ok, detail)
  select 'R4-3 TTL renovado empurrou o vencimento', interactive_until > now() + interval '90 minutes', interactive_until::text
    from tom_flow_ownership where id = b;

  -- touch em conversa sem fluxo não inventa nada
  insert into _res (label, ok, detail)
  select 'R4-3 touch sem fluxo devolve false', not tom_flow_touch('conversa-inexistente@s.whatsapp.net', 3600, 'v2', tok), null;
end $$;

-- ============ R5-1 — o token precisa cercar TODA escrita com efeito ============
-- Fencing só em heartbeat/finish deixava o worker velho marcar passo como done e
-- registrar saída. O passo é o que AUTORIZA a mutação: sem token ali, o token não serve.
do $$
declare r1 record; r2 record; s record; o record;
begin
  select * into r1 from tom_route_claim_inbound('wa-R5-tok','v2');
  update tom_message_ownership set lease_until = now() - interval '1 minute' where wa_message_id='wa-R5-tok';
  select * into r2 from tom_route_claim_inbound('wa-R5-tok','v2');   -- outro worker retoma

  -- worker VELHO tenta reivindicar passo
  select * into s from tom_operation_step_begin(r1.operation_id,'mutar_tarefa', r1.lease_token);
  insert into _res (label, ok, detail) values
    ('R5-1 step_begin com token velho = stale_lease', s.outcome='stale_lease', s.outcome);

  insert into _res (label, ok, detail)
  select 'R5-1 token velho NÃO criou linha de passo', count(*)=0, count(*)::text
    from tom_operation_steps where operation_id=r1.operation_id and step_key='mutar_tarefa';

  -- worker ATUAL consegue
  select * into s from tom_operation_step_begin(r2.operation_id,'mutar_tarefa', r2.lease_token);
  insert into _res (label, ok, detail) values ('R5-1 token atual funciona', s.outcome='new', s.outcome);

  -- worker VELHO tenta FECHAR o passo do atual
  insert into _res (label, ok, detail)
  select 'R5-1 step_finish com token velho é rejeitado',
         (select ok from tom_operation_step_finish(r2.operation_id,'mutar_tarefa','{}'::jsonb,'done',null, r1.lease_token)) = false, null;

  insert into _res (label, ok, detail)
  select 'R5-1 passo continua aberto após tentativa do velho', status='in_progress', status
    from tom_operation_steps where operation_id=r2.operation_id and step_key='mutar_tarefa';

  -- outbound com operação: token velho não registra
  select * into o from tom_record_outbound('wa-R5-out','v2', p_operation_id => r2.operation_id, p_lease_token => r1.lease_token);
  insert into _res (label, ok, detail) values
    ('R5-1 record_outbound com token velho = stale_lease', o.outcome='stale_lease', o.outcome);

  select * into o from tom_record_outbound('wa-R5-out','v2', p_operation_id => r2.operation_id, p_lease_token => r2.lease_token);
  insert into _res (label, ok, detail) values ('R5-1 record_outbound com token atual grava', o.outcome='inserted', o.outcome);

  -- assert_lease: o worker checa a posse ANTES de enviar
  insert into _res (label, ok, detail)
  select 'R5-1 assert_lease rejeita token velho', not tom_route_assert_lease('wa-R5-tok','v2', r1.lease_token), null;
  insert into _res (label, ok, detail)
  select 'R5-1 assert_lease aceita token atual', tom_route_assert_lease('wa-R5-tok','v2', r2.lease_token), null;
end $$;

-- ============ R5-2 — o caso perigoso: mutação gravada + crash antes do recibo ============
-- Antes, `in_progress` só "avisava para verificar". Aviso não é barreira: quem retoma
-- precisa RESOLVER o passo (confirmando o efeito ou negando) antes de poder agir.
do $$
declare r1 record; r2 record; s record;
begin
  select * into r1 from tom_route_claim_inbound('wa-R5-crash','v2');
  select * into s  from tom_operation_step_begin(r1.operation_id,'concluir', r1.lease_token);
  -- ... o worker MUTOU a entidade aqui e caiu ANTES do step_finish ...

  update tom_message_ownership set lease_until = now() - interval '1 minute' where wa_message_id='wa-R5-crash';
  select * into r2 from tom_route_claim_inbound('wa-R5-crash','v2');
  insert into _res (label, ok, detail) values ('R5-2 retomada após crash', r2.outcome='resumed', r2.outcome);

  -- quem retoma NÃO recebe autorização para executar
  select * into s from tom_operation_step_begin(r2.operation_id,'concluir', r2.lease_token);
  insert into _res (label, ok, detail) values
    ('R5-2 passo órfão exige verificação (não é new)', s.outcome='needs_verification', s.outcome);

  -- e continua exigindo enquanto não for resolvido — o aviso não "passa" na segunda vez
  select * into s from tom_operation_step_begin(r2.operation_id,'concluir', r2.lease_token);
  insert into _res (label, ok, detail) values
    ('R5-2 sem resolver, continua bloqueado', s.outcome='needs_verification', s.outcome);

  -- caminho A: releitura CONFIRMA que a mutação ocorreu → fecha sem reexecutar
  insert into _res (label, ok, detail)
  select 'R5-2 verify confirmado fecha o passo',
         tom_operation_step_verify(r2.operation_id,'concluir', true, '{"via":"releitura"}'::jsonb, r2.lease_token), null;
  select * into s from tom_operation_step_begin(r2.operation_id,'concluir', r2.lease_token);
  insert into _res (label, ok, detail) values
    ('R5-2 após confirmar, passo é done (não reexecuta)', s.outcome='done', s.outcome),
    ('R5-2 resultado da verificação preservado', s.result->>'via'='releitura', s.result::text);
end $$;

do $$
declare r1 record; r2 record; s record;
begin
  -- caminho B: releitura NEGA a mutação → libera para executar de novo
  select * into r1 from tom_route_claim_inbound('wa-R5-crash2','v2');
  perform tom_operation_step_begin(r1.operation_id,'concluir', r1.lease_token);
  update tom_message_ownership set lease_until = now() - interval '1 minute' where wa_message_id='wa-R5-crash2';
  select * into r2 from tom_route_claim_inbound('wa-R5-crash2','v2');

  insert into _res (label, ok, detail)
  select 'R5-2 verify negado libera reexecução',
         tom_operation_step_verify(r2.operation_id,'concluir', false, null, r2.lease_token), null;
  select * into s from tom_operation_step_begin(r2.operation_id,'concluir', r2.lease_token);
  insert into _res (label, ok, detail) values
    ('R5-2 após negar, pode executar de novo', s.outcome='new', s.outcome);

  -- verify com token velho não resolve nada
  insert into _res (label, ok, detail)
  select 'R5-2 verify com token velho é rejeitado',
         not tom_operation_step_verify(r2.operation_id,'concluir', true, null, r1.lease_token), null;
end $$;

-- ============ R5-3 — consulta única de fluxo ativo com TTL + touch cercado ============
do $$
declare f record; g record; ent uuid := gen_random_uuid();
begin
  select * into f from tom_flow_open('conv-R5@s.whatsapp.net','task',ent,'v2', p_interactive_ttl_seconds => 3600);
  insert into _res (label, ok, detail) values
    ('R5-3 open devolve id e flow_token', f.id is not null and f.flow_token is not null, f.flow_token::text);

  -- a consulta ÚNICA que o adapter usa: já aplica TTL e devolve no máximo uma linha
  select * into g from tom_flow_active_for_conversation('conv-R5@s.whatsapp.net');
  insert into _res (label, ok, detail) values
    ('R5-3 consulta única devolve o dono', g.owner='v2', coalesce(g.owner,'(nulo)')),
    ('R5-3 consulta única diz que não expirou', g.expired = false, g.expired::text);

  -- token velho não mantém o fluxo vivo
  insert into _res (label, ok, detail)
  select 'R5-3 touch com token errado é rejeitado',
         not tom_flow_touch('conv-R5@s.whatsapp.net', 7200, 'v2', gen_random_uuid()), null;
  insert into _res (label, ok, detail)
  select 'R5-3 touch de outro owner é rejeitado',
         not tom_flow_touch('conv-R5@s.whatsapp.net', 7200, 'v1', f.flow_token), null;
  insert into _res (label, ok, detail)
  select 'R5-3 touch com owner+token corretos funciona',
         tom_flow_touch('conv-R5@s.whatsapp.net', 7200, 'v2', f.flow_token), null;

  -- TTL vencido: a consulta única marca expirado e NÃO devolve dono para rotear
  update tom_flow_ownership set interactive_until = now() - interval '1 minute' where id = f.id;
  select * into g from tom_flow_active_for_conversation('conv-R5@s.whatsapp.net');
  insert into _res (label, ok, detail) values
    ('R5-3 expirado não devolve owner p/ rota', g.owner is null, coalesce(g.owner,'(nulo)')),
    ('R5-3 expirado é sinalizado', g.expired = true, g.expired::text);

  -- set_phase também exige token
  insert into _res (label, ok, detail)
  select 'R5-3 set_phase com token errado é rejeitado',
         (select outcome from tom_flow_set_phase('task',ent,'draining', gen_random_uuid())) = 'stale_token', null;
end $$;

-- ============ R5-4 — governança: escrita só pelas RPCs ============
-- service_role com INSERT/UPDATE direto contorna token, lease e máquina de estados.
-- As RPCs são SECURITY DEFINER: escrevem sem precisar do privilégio do chamador.
insert into _res (label, ok, detail)
select 'R5-4 service_role SEM ' || p || ' direto em ' || t,
       not has_table_privilege('service_role', t, p), t || '/' || p
from unnest(array['tom_router_test.tom_message_ownership','tom_router_test.tom_flow_ownership',
                  'tom_router_test.tom_operations','tom_router_test.tom_operation_steps']) t,
     unnest(array['INSERT','UPDATE','DELETE']) p;

insert into _res (label, ok, detail)
select 'R5-4 service_role mantém SELECT em ' || t, has_table_privilege('service_role', t, 'SELECT'), t
from unnest(array['tom_router_test.tom_message_ownership','tom_router_test.tom_flow_ownership',
                  'tom_router_test.tom_operations','tom_router_test.tom_operation_steps']) t;

-- e as RPCs continuam escrevendo mesmo sem o privilégio direto
do $$
declare r record;
begin
  select * into r from tom_route_claim_inbound('wa-R5-gov','v1');
  insert into _res (label, ok, detail) values
    ('R5-4 RPC ainda escreve (SECURITY DEFINER)', r.outcome='claimed', r.outcome);
end $$;

-- ============ R6 — os dois bypasses do protocolo de recuperação ============
-- needs_verification só vale se NÃO houver caminho para contorná-lo. Duas portas
-- ficaram abertas: fechar o passo alheio, e fechar o inbound com passo pendente.

do $$
declare r1 record; r2 record; s record; f record;
begin
  -- crash com passo órfão
  select * into r1 from tom_route_claim_inbound('wa-R6-bypass','v2');
  perform tom_operation_step_begin(r1.operation_id,'mutar', r1.lease_token);
  update tom_message_ownership set lease_until = now() - interval '1 minute' where wa_message_id='wa-R6-bypass';
  select * into r2 from tom_route_claim_inbound('wa-R6-bypass','v2');   -- retomado, token NOVO

  -- BYPASS 1: pular o verify e fechar o passo direto com o token novo
  select * into f from tom_operation_step_finish(r2.operation_id,'mutar','{"x":1}'::jsonb,'done',null, r2.lease_token);
  insert into _res (label, ok, detail) values
    ('R6-1 step_finish NÃO fecha passo aberto por outra posse', f.ok = false, coalesce(f.reason,'(sem reason)'));

  insert into _res (label, ok, detail)
  select 'R6-1 passo órfão continua in_progress', status='in_progress', status
    from tom_operation_steps where operation_id=r2.operation_id and step_key='mutar';

  select * into s from tom_operation_step_begin(r2.operation_id,'mutar', r2.lease_token);
  insert into _res (label, ok, detail) values
    ('R6-1 e continua exigindo verificação', s.outcome='needs_verification', s.outcome);

  -- BYPASS 2: marcar o inbound como concluído com passo pendente
  select * into f from tom_route_finish_inbound('wa-R6-bypass','v2','completed',null, r2.lease_token);
  insert into _res (label, ok, detail) values
    ('R6-2 finish_inbound(completed) bloqueia com passo pendente', f.ok = false, coalesce(f.reason,'(sem reason)'));

  insert into _res (label, ok, detail)
  select 'R6-2 inbound NÃO ficou completed', status <> 'completed', status
    from tom_message_ownership where wa_message_id='wa-R6-bypass';

  -- e o retry continua possível (a pessoa não fica sem resposta)
  update tom_message_ownership set lease_until = now() - interval '1 minute' where wa_message_id='wa-R6-bypass';
  select * into r2 from tom_route_claim_inbound('wa-R6-bypass','v2');
  insert into _res (label, ok, detail) values
    ('R6-2 mensagem segue retomável', r2.outcome='resumed', r2.outcome);

  -- caminho legítimo: resolver o passo e SÓ ENTÃO fechar
  insert into _res (label, ok, detail)
  select 'R6-2 verify resolve o passo',
         tom_operation_step_verify(r2.operation_id,'mutar', true, '{"via":"releitura"}'::jsonb, r2.lease_token), null;
  select * into f from tom_route_finish_inbound('wa-R6-bypass','v2','completed',null, r2.lease_token);
  insert into _res (label, ok, detail) values
    ('R6-2 com tudo resolvido, finish passa', f.ok = true, coalesce(f.reason,'(sem reason)'));
end $$;

do $$
declare r record; f record;
begin
  -- 'failed' NÃO pode ser bloqueado por passo pendente: é justamente o caminho de
  -- devolver a mensagem para retentativa quando algo ficou pela metade.
  select * into r from tom_route_claim_inbound('wa-R6-failed','v2');
  perform tom_operation_step_begin(r.operation_id,'mutar', r.lease_token);
  select * into f from tom_route_finish_inbound('wa-R6-failed','v2','failed','erro no meio', r.lease_token);
  insert into _res (label, ok, detail) values
    ('R6-2 failed com passo pendente é PERMITIDO', f.ok = true, coalesce(f.reason,'(sem reason)'));

  select * into r from tom_route_claim_inbound('wa-R6-failed','v2');
  insert into _res (label, ok, detail) values
    ('R6-2 e a mensagem volta retomável', r.outcome='resumed', r.outcome);
end $$;

do $$
declare r record; f record;
begin
  -- caminho normal, sem crash: quem abriu fecha
  select * into r from tom_route_claim_inbound('wa-R6-normal','v2');
  perform tom_operation_step_begin(r.operation_id,'mutar', r.lease_token);
  select * into f from tom_operation_step_finish(r.operation_id,'mutar','{"ok":true}'::jsonb,'done',null, r.lease_token);
  insert into _res (label, ok, detail) values
    ('R6-1 quem ABRIU o passo fecha normalmente', f.ok = true, coalesce(f.reason,'(sem reason)'));

  select * into f from tom_route_finish_inbound('wa-R6-normal','v2','completed',null, r.lease_token);
  insert into _res (label, ok, detail) values
    ('R6-2 sem passo pendente, finish passa', f.ok = true, coalesce(f.reason,'(sem reason)'));

  -- token velho não fecha nem com passo em ordem
  select * into f from tom_route_finish_inbound('wa-R6-normal','v2','completed',null, gen_random_uuid());
  insert into _res (label, ok, detail) values
    ('R6-2 token errado continua rejeitado', f.ok = false, coalesce(f.reason,'(sem reason)'));
end $$;

-- ============================ resultado ============================
select label, case when ok then 'OK' else 'FALHOU' end as status, detail
from _res where not ok order by n;

select count(*) filter (where ok)     as passou,
       count(*) filter (where not ok) as falhou,
       count(*)                       as total
from _res;
