-- =====================================================================================
-- TOM v1/v2 — ledger de propriedade (roteamento entre runtimes)
-- Data: 03/08/2026 · Origem: auditoria de viabilidade + rodada 3 (Alfredo)
--
-- NÃO APLICADA em produção. Escrita para auditoria; validada em schema descartável.
--
-- Por que estas tabelas existem: dois agentes no MESMO número de WhatsApp precisam de um
-- dono por mensagem e por entidade. Sem isso, um reply não sabe quem deve responder e
-- dois dispatchers podem cobrar a mesma tarefa.
--
-- Por que NÃO reaproveitar `conversation_history`: é o histórico do v1 e o writer da
-- resposta normal descarta o ID devolvido pela UAZAPI — 4.288 outbounds sem
-- `whatsapp_message_id` nos últimos 30 dias contra 1.119 com ID (só o caminho proativo).
-- Um ledger de governança não pode nascer com ~79% de buracos.
--
-- RODADA 3 — os quatro bloqueios corrigidos aqui:
--   R3-A1  EXECUTE das RPCs revogado de PUBLIC/anon/authenticated (o default do banco
--          concede a todos: as 5 funções SECURITY DEFINER que já existem hoje estão
--          abertas para anon — verificado com has_function_privilege).
--   R3-A2  Claim distingue QUEM INSERIU: o perdedor da corrida nunca recebe "novo".
--   R3-A3  Claim ≠ concluído. Estados + lease: crash depois do claim é RETOMÁVEL, e só
--          'completed' suprime reprocessamento. A operação nasce na MESMA transação.
--   R3-A4  `conversation_key` + no máximo um fluxo interativo ativo por conversa, para
--          o adapter obter UM flowOwner determinístico (grupos incluídos).
--
-- Transação explícita e sem IF NOT EXISTS (R3-B4): os objetos não existem: falhar cedo
-- é mais seguro do que seguir sobre schema parcialmente diferente.
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1. tom_message_ownership — dono e CICLO DE VIDA de cada mensagem do WhatsApp
-- -------------------------------------------------------------------------------------
create table public.tom_message_ownership (
  id                    uuid primary key default gen_random_uuid(),
  wa_message_id         text        not null,
  direction             text        not null check (direction in ('inbound','outbound')),
  owner                 text        not null check (owner in ('v1','v2')),
  -- R3-A3: "reivindiquei" não é "terminei". Só 'completed' suprime reprocessamento.
  -- inbound nasce 'claimed'; outbound já nasce 'completed' (não há o que processar).
  status                text        not null default 'claimed'
                        check (status in ('claimed','processing','completed','failed')),
  lease_until           timestamptz,
  -- R4-1 (fencing token): `owner` não distingue TENTATIVAS. Um worker do mesmo v2 que
  -- travou (GC pause, rede) pode acordar depois do lease vencer, quando outro worker já
  -- retomou, e renovar/fechar como se ainda fosse o dono — dois workers agindo. Cada
  -- posse recebe um token; heartbeat e finish exigem o token ATUAL. Token velho não age.
  lease_token           uuid,
  attempts              int         not null default 0,
  phone                 text,
  collaborator_id       uuid        references public.collaborators(id) on delete set null,
  conversation_key      text,
  quoted_wa_message_id  text,
  entity_type           text        check (entity_type is null or entity_type in ('task','event','habit','reminder','bill','note')),
  entity_id             uuid,
  operation_id          uuid,
  route_reason          text,
  route_conflict        text,
  last_error            text,
  created_at            timestamptz not null default now(),
  finished_at           timestamptz
);

-- Um ID de mensagem tem UM dono. Sustenta o roteamento por quote e o dedupe de inbound.
create unique index tom_message_ownership_wa_id_uq
  on public.tom_message_ownership (wa_message_id);
create index tom_message_ownership_quoted_idx
  on public.tom_message_ownership (quoted_wa_message_id) where quoted_wa_message_id is not null;
create index tom_message_ownership_entity_idx
  on public.tom_message_ownership (entity_type, entity_id) where entity_id is not null;
-- claims vivos/abandonados: alvo do recuperador
create index tom_message_ownership_open_idx
  on public.tom_message_ownership (lease_until) where status in ('claimed','processing');

alter table public.tom_message_ownership enable row level security;

comment on table  public.tom_message_ownership is
  'Dono (v1/v2) e ciclo de vida de cada mensagem WhatsApp. Roteia reply e deduplica inbound.';
comment on column public.tom_message_ownership.status is
  'claimed→processing→completed|failed. Só completed suprime reprocessamento: claim não é recibo.';
comment on column public.tom_message_ownership.lease_until is
  'Enquanto válido, ninguém mais processa. Vencido sem completed = crash → retomável.';

-- -------------------------------------------------------------------------------------
-- 2. tom_flow_ownership — dono de cada ENTIDADE e da CONVERSA
--    R3-A4: sem chave de conversa o adapter não conseguia transformar "vários fluxos
--    ativos" em UM flowOwner — em grupo, rotearia para o dono errado. `conversation_key`
--    é o remoteJid canônico da UAZAPI (1:1 ou grupo).
-- -------------------------------------------------------------------------------------
create table public.tom_flow_ownership (
  id                  uuid        primary key default gen_random_uuid(),
  conversation_key    text        not null,
  entity_type         text        not null check (entity_type in ('task','event','habit','reminder','bill','note')),
  entity_id           uuid        not null,
  collaborator_id     uuid        references public.collaborators(id) on delete cascade,
  owner               text        not null check (owner in ('v1','v2')),
  -- canary   = fluxo vivo, aceita novas interações
  -- draining = rollback: não abre nada novo, mas o que começou termina aqui
  -- retired  = encerrado; não prende mais a conversa
  phase               text        not null default 'canary' check (phase in ('canary','draining','retired')),
  -- true = é ESTE fluxo que prende a conversa (só um por conversa)
  interactive         boolean     not null default true,
  -- R4-3 (TTL): sem prazo, um v2 que caia antes de `retired` prende a conversa PARA
  -- SEMPRE — a pessoa nunca mais é atendida pelo v1 naquele chat. Fluxo interativo tem
  -- validade; expirado é expropriado por quem precisar da conversa.
  interactive_until   timestamptz,
  -- R5-3: posse do fluxo. Sem isto, worker velho mantem a conversa presa com touch.
  flow_token          uuid        not null default gen_random_uuid(),
  opened_by_wa_id     text,
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz,
  note                text
);

-- Uma entidade tem NO MÁXIMO UM dono ativo.
create unique index tom_flow_ownership_entity_active_uq
  on public.tom_flow_ownership (entity_type, entity_id) where closed_at is null;

-- R3-A4: NO MÁXIMO UM fluxo interativo ativo por conversa. É esta constraint — e não uma
-- consulta "último fluxo do colaborador" — que torna o flowOwner determinístico.
create unique index tom_flow_ownership_conversation_active_uq
  on public.tom_flow_ownership (conversation_key) where closed_at is null and interactive;

create index tom_flow_ownership_conv_idx
  on public.tom_flow_ownership (conversation_key) where closed_at is null;

alter table public.tom_flow_ownership enable row level security;

comment on column public.tom_flow_ownership.conversation_key is
  'remoteJid canônico (1:1 ou grupo). Unidade de fluxo — evita rotear conversa de grupo pelo dono errado.';
comment on column public.tom_flow_ownership.interactive is
  'Só um fluxo interativo ativo por conversa. Entidades não-interativas coexistem sem prender a conversa.';

-- -------------------------------------------------------------------------------------
-- 3. tom_operations — trilha intenção → mutação → releitura → recibo
-- -------------------------------------------------------------------------------------
create table public.tom_operations (
  operation_id           uuid primary key default gen_random_uuid(),
  inbound_wa_message_id  text        not null,
  owner                  text        not null check (owner in ('v1','v2')),
  collaborator_id        uuid        references public.collaborators(id) on delete set null,
  conversation_key       text,
  action                 text        check (action is null or action in ('done','in_progress','reschedule','cancel','clarify')),
  entity_type            text,
  entity_id              uuid,
  state_before           jsonb,
  state_after            jsonb,
  verified               boolean,
  verification_detail    text,
  sent_text              text,
  sent_wa_message_id     text,
  error                  text,
  attempt                int         not null default 1,
  created_at             timestamptz not null default now(),
  finished_at            timestamptz
);

-- Um inbound gera UMA operação — inclusive entre runtimes e através de restart.
create unique index tom_operations_inbound_uq
  on public.tom_operations (inbound_wa_message_id);
create index tom_operations_entity_idx
  on public.tom_operations (entity_type, entity_id) where entity_id is not null;
create index tom_operations_open_idx
  on public.tom_operations (collaborator_id, created_at desc) where finished_at is null;

alter table public.tom_operations enable row level security;

comment on column public.tom_operations.verified is
  'Releitura do banco confirmou o efeito. NULL = não verificado — nunca tratar como sucesso.';

-- -------------------------------------------------------------------------------------
-- 3.1 tom_operation_steps — R4-2: idempotência POR ETAPA.
--
-- Retomar "pelo mesmo dono" não é seguro se o worker já tinha mutado a entidade antes de
-- cair: a retomada reexecutaria às cegas. Cada passo com efeito é reivindicado ANTES de
-- agir; se a retomada vê 'done', não repete e reaproveita o resultado guardado.
--
-- Fica aqui, e não nas RPCs de ação, de propósito: é infraestrutura genérica de
-- idempotência. As RPCs de negócio (E2.0) vão usá-la em vez de reinventar cada uma.
-- -------------------------------------------------------------------------------------
create table public.tom_operation_steps (
  id            uuid primary key default gen_random_uuid(),
  operation_id  uuid        not null references public.tom_operations(operation_id) on delete cascade,
  step_key      text        not null,
  status        text        not null default 'in_progress' check (status in ('in_progress','done','failed')),
  -- R5-2: qual POSSE abriu o passo. Passo aberto sob token que não e o atual e orfao de
  -- um crash — quem retoma precisa VERIFICAR o efeito antes de agir. Aviso nao e barreira.
  opened_by_token uuid,
  result        jsonb,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- Um passo por operação. É esta constraint que faz o begin ser idempotente sob corrida.
create unique index tom_operation_steps_uq
  on public.tom_operation_steps (operation_id, step_key);

alter table public.tom_operation_steps enable row level security;

comment on table public.tom_operation_steps is
  'Reivindicação de passo com efeito. Retomada após crash consulta aqui em vez de reexecutar.';

-- =====================================================================================
-- RPCs de OWNERSHIP.
-- As RPCs de AÇÃO de negócio (tom_v2_apply_reminder_action / tom_v2_verify_operation)
-- ficam FORA de propósito: dependem do contrato de ciclo de vida (E2.0). Escritas hoje,
-- herdariam a mesma mentira de `endSeries1on1`, que devolve {ended:true} sem checar erro.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- claim de inbound — R3-A2 (corrida) + R3-A3 (lease/crash), numa transação só.
--
-- outcome:
--   'claimed'               reivindiquei agora; PODE processar
--   'resumed'               claim anterior do MESMO dono venceu sem concluir; PODE processar
--   'in_progress_elsewhere' outro runtime está processando com lease válido; NÃO processar
--   'already_completed'     já concluído; NÃO processar (dedupe de verdade)
--   'owned_by_other'        claim vencido, mas de OUTRO dono; NÃO processar sem decisão humana
-- -------------------------------------------------------------------------------------
create function public.tom_route_claim_inbound(
  p_wa_message_id   text,
  p_owner           text,
  p_phone           text default null,
  p_collaborator    uuid default null,
  p_conversation    text default null,
  p_quoted          text default null,
  p_reason          text default null,
  p_conflict        text default null,
  p_lease_seconds   int  default 300
) returns table (outcome text, owner text, operation_id uuid, lease_token uuid, steps_done int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op      uuid;
  v_row     public.tom_message_ownership%rowtype;
  v_ins     boolean := false;
  v_token   uuid;
  v_steps   int := 0;
begin
  if p_wa_message_id is null or p_wa_message_id = '' then
    return query select 'invalid'::text, null::text, null::uuid, null::uuid, 0;
    return;
  end if;

  v_op    := gen_random_uuid();
  v_token := gen_random_uuid();

  -- R3-A2: o RETURNING é o que distingue quem inseriu. Sem ele, o perdedor da corrida
  -- também recebia "novo" e processava a mesma mensagem.
  insert into public.tom_message_ownership
    (wa_message_id, direction, owner, status, lease_until, lease_token, attempts, phone, collaborator_id,
     conversation_key, quoted_wa_message_id, route_reason, route_conflict, operation_id)
  values
    (p_wa_message_id, 'inbound', p_owner, 'claimed',
     clock_timestamp() + make_interval(secs => greatest(p_lease_seconds, 1)), v_token, 1, p_phone, p_collaborator,
     p_conversation, p_quoted, p_reason, p_conflict, v_op)
  on conflict (wa_message_id) do nothing
  returning true into v_ins;

  if coalesce(v_ins, false) then
    -- a operação nasce na MESMA transação do claim: não existe claim sem trilha.
    insert into public.tom_operations (operation_id, inbound_wa_message_id, owner, collaborator_id, conversation_key)
    values (v_op, p_wa_message_id, p_owner, p_collaborator, p_conversation);
    return query select 'claimed'::text, p_owner, v_op, v_token, 0;
    return;
  end if;

  -- não inseri: alguém chegou antes (ou é retentativa). Trava a linha para decidir.
  select * into v_row from public.tom_message_ownership
   where wa_message_id = p_wa_message_id for update;

  -- R4-2: quantos passos com efeito já fecharam. A retomada precisa saber onde parou,
  -- em vez de reexecutar às cegas.
  select count(*) into v_steps from public.tom_operation_steps s
   where s.operation_id = v_row.operation_id and s.status = 'done';

  if v_row.status = 'completed' then
    return query select 'already_completed'::text, v_row.owner, v_row.operation_id, null::uuid, v_steps;
    return;
  end if;

  -- lease ainda válido → outro processo está no meio do trabalho
  if v_row.lease_until is not null and v_row.lease_until > clock_timestamp() then
    return query select 'in_progress_elsewhere'::text, v_row.owner, v_row.operation_id, null::uuid, v_steps;
    return;
  end if;

  -- R3-A3: lease vencido sem conclusão = crash. Retomável — mas só pelo MESMO dono,
  -- senão o outro runtime executaria o que já pode ter tido efeito parcial.
  if v_row.owner is distinct from p_owner then
    return query select 'owned_by_other'::text, v_row.owner, v_row.operation_id, null::uuid, v_steps;
    return;
  end if;

  -- R4-1: nova posse = TOKEN NOVO. O worker anterior, se voltar, não age mais.
  update public.tom_message_ownership
     set status      = 'claimed',
         lease_until = clock_timestamp() + make_interval(secs => greatest(p_lease_seconds, 1)),
         lease_token = v_token,
         attempts    = attempts + 1
   where wa_message_id = p_wa_message_id;

  return query select 'resumed'::text, v_row.owner, v_row.operation_id, v_token, v_steps;
end;
$$;

comment on function public.tom_route_claim_inbound(text,text,text,uuid,text,text,text,text,int) is
  'Reivindica inbound com lease. Só outcome claimed/resumed autoriza processar. claim != recibo.';

-- Renova o lease de um trabalho longo. R4-1: exige o TOKEN da posse atual — sem isso,
-- um worker zumbi do mesmo runtime renovaria por cima de quem retomou.
create function public.tom_route_heartbeat(
  p_wa_message_id text,
  p_owner         text,
  p_lease_seconds int  default 300,
  p_lease_token   uuid default null
) returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare v_m public.tom_message_ownership%rowtype; v_n int;
begin
-- R8 (concorrencia): validar e depois escrever, sem trava, e uma janela aberta. Entre a
-- leitura e o UPDATE outro worker retoma a posse; o UPDATE do antigo afeta ZERO linhas e
-- a funcao ainda devolvia sucesso — recibo falso e silencioso, o pior tipo.
-- Tres travas juntas: (1) SELECT ... FOR UPDATE serializa a linha de ownership;
-- (2) a revalidacao usa clock_timestamp(), porque now() e o instante de INICIO da
-- transacao e nao avanca enquanto se espera no lock — um lease vencido pareceria vivo;
-- (3) o resultado do UPDATE e conferido por row_count: zero linha nunca vira 'ok'.
  select * into v_m from public.tom_message_ownership m
   where m.wa_message_id = p_wa_message_id
   for update;

  if v_m.id is null then
    return query select false, 'not_found'::text;
    return;
  end if;

  -- R7-1: renovar e privilegio de quem AINDA tem a posse; prazo vencido nao se auto-renova.
  if v_m.owner is distinct from p_owner
     or v_m.lease_token is distinct from p_lease_token
     or v_m.status not in ('claimed','processing')
     or v_m.lease_until is null
     or v_m.lease_until <= clock_timestamp() then
    return query select false, 'stale_lease'::text;
    return;
  end if;

  update public.tom_message_ownership
     set lease_until = clock_timestamp() + make_interval(secs => greatest(p_lease_seconds, 1)),
         status      = 'processing'
   where wa_message_id = p_wa_message_id
     and lease_token is not distinct from p_lease_token;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return query select false, 'lost_race'::text;
    return;
  end if;
  return query select true, 'ok'::text;
end;
$$;

comment on function public.tom_route_heartbeat(text,text,int,uuid) is
  'Renova o lease. Exige posse ATUAL e lease VIVO, sob trava de linha.';

create function public.tom_route_finish_inbound(
  p_wa_message_id text,
  p_owner         text,
  p_status        text default 'completed',
  p_error         text default null,
  p_lease_token   uuid default null
) returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare v_m public.tom_message_ownership%rowtype; v_n int;
begin
  if p_status not in ('completed','failed') then
    raise exception 'status invalido: %', p_status;
  end if;

-- R8 (concorrencia): validar e depois escrever, sem trava, e uma janela aberta. Entre a
-- leitura e o UPDATE outro worker retoma a posse; o UPDATE do antigo afeta ZERO linhas e
-- a funcao ainda devolvia sucesso — recibo falso e silencioso, o pior tipo.
-- Tres travas juntas: (1) SELECT ... FOR UPDATE serializa a linha de ownership;
-- (2) a revalidacao usa clock_timestamp(), porque now() e o instante de INICIO da
-- transacao e nao avanca enquanto se espera no lock — um lease vencido pareceria vivo;
-- (3) o resultado do UPDATE e conferido por row_count: zero linha nunca vira 'ok'.
  select * into v_m from public.tom_message_ownership m
   where m.wa_message_id = p_wa_message_id
   for update;

  if v_m.id is null or v_m.owner is distinct from p_owner
     or v_m.lease_token is distinct from p_lease_token then
    return query select false, 'stale_token'::text;
    return;
  end if;

  -- R7-1: quem perdeu o prazo nao decide o desfecho — nem 'completed' nem 'failed'.
  if v_m.status not in ('claimed','processing')
     or v_m.lease_until is null
     or v_m.lease_until <= clock_timestamp() then
    return query select false, 'stale_lease'::text;
    return;
  end if;

  -- R6-2: 'completed' e RECIBO — e recibo suprime retry. Com passo aberto, o efeito
  -- ficou pela metade e ninguem mais volta nessa mensagem. Agora sob a trava, entao
  -- ninguem consegue abrir passo entre esta checagem e a escrita.
  if p_status = 'completed' and exists (
    select 1 from public.tom_operation_steps st
     where st.operation_id = v_m.operation_id
       and st.status = 'in_progress'
  ) then
    return query select false, 'open_steps'::text;
    return;
  end if;

  update public.tom_message_ownership
     set status      = p_status,
         finished_at = now(),
         last_error  = p_error,
         -- 'failed' solta o lease de proposito: pode ser retomado pelo mesmo dono.
         lease_until = case when p_status = 'completed' then null else clock_timestamp() end
   where wa_message_id = p_wa_message_id
     and lease_token is not distinct from p_lease_token;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return query select false, 'lost_race'::text;
    return;
  end if;

  return query select true, 'ok'::text;
end;
$$;

comment on function public.tom_route_finish_inbound(text,text,text,text,uuid) is
  'completed = recibo, sob trava, com posse viva e passos resolvidos; failed devolve para retentativa.';

create function public.tom_route_assert_lease(
  p_wa_message_id text,
  p_owner         text,
  p_lease_token   uuid
) returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tom_message_ownership m
     where m.wa_message_id = p_wa_message_id
       and m.owner = p_owner
       and m.lease_token is not distinct from p_lease_token
       and m.status in ('claimed','processing')
       and m.lease_until is not null
       and m.lease_until > clock_timestamp()
  );
$$;

-- -------------------------------------------------------------------------------------
-- R4-2 — passos idempotentes. Antes de QUALQUER mutação com efeito, o worker reivindica
-- o passo; se a resposta for 'done', a retomada não repete e reusa o resultado.
-- outcome: 'new' (pode executar) | 'in_progress' (alguém está/estava nele) | 'done'
-- -------------------------------------------------------------------------------------
create function public.tom_operation_step_begin(
  p_operation_id uuid,
  p_step_key     text,
  p_lease_token  uuid default null
) returns table (outcome text, result jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ins boolean := false;
  v_row public.tom_operation_steps%rowtype;
begin
  -- R5-1: o PASSO e o que autoriza a mutacao. Fencing so em heartbeat/finish deixava o
  -- worker velho abrir e fechar passo — ou seja, agir — depois de perder a posse.
  -- R8: trava a linha de ownership ANTES de validar. Sem isso, a posse podia mudar
  -- entre a checagem e a escrita do passo. clock_timestamp() porque now() nao avanca
  -- enquanto se espera no lock.
  perform 1 from public.tom_message_ownership m
   where m.operation_id = p_operation_id for update;

  if not exists (
    select 1 from public.tom_message_ownership m
     where m.operation_id = p_operation_id
       and m.lease_token is not distinct from p_lease_token
       and m.status in ('claimed','processing')
       and m.lease_until is not null
       and m.lease_until > clock_timestamp()
  ) then
    return query select 'stale_lease'::text, null::jsonb;
    return;
  end if;

  insert into public.tom_operation_steps (operation_id, step_key, opened_by_token)
  values (p_operation_id, p_step_key, p_lease_token)
  on conflict (operation_id, step_key) do nothing
  returning true into v_ins;

  if coalesce(v_ins, false) then
    return query select 'new'::text, null::jsonb;
    return;
  end if;

  select * into v_row from public.tom_operation_steps s
   where s.operation_id = p_operation_id and s.step_key = p_step_key;

  if v_row.status = 'done' then
    return query select 'done'::text, v_row.result;
    return;
  end if;

  -- R5-2: passo aberto sob a posse ATUAL = este mesmo worker rechamando (retry interno).
  -- Aberto sob OUTRA posse = orfao de crash: alguem ja pode ter mutado a entidade.
  -- Nao basta avisar; so tom_operation_step_verify libera o caminho.
  if v_row.opened_by_token is not distinct from p_lease_token then
    return query select 'in_progress_active'::text, v_row.result;
  else
    return query select 'needs_verification'::text, v_row.result;
  end if;
end;
$$;

-- R5-2: resolve passo orfao. p_effect_confirmed vem de RELEITURA do banco pelo worker:
--   true  -> a mutacao ocorreu; fecha sem reexecutar (idempotencia de verdade)
--   false -> nao ocorreu; libera o passo para nova execucao
create function public.tom_operation_step_verify(
  p_operation_id     uuid,
  p_step_key         text,
  p_effect_confirmed boolean,
  p_result           jsonb default null,
  p_lease_token      uuid  default null
) returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.tom_operation_steps%rowtype; v_n int;
begin
  -- R8: trava a linha de ownership ANTES de validar; clock_timestamp() porque now() nao
  -- avanca enquanto se espera no lock.
  perform 1 from public.tom_message_ownership m
   where m.operation_id = p_operation_id for update;

  if not exists (
    select 1 from public.tom_message_ownership m
     where m.operation_id = p_operation_id
       and m.lease_token is not distinct from p_lease_token
       and m.status in ('claimed','processing')
       and m.lease_until is not null
       and m.lease_until > clock_timestamp()
  ) then
    return query select false, 'stale_lease'::text;
    return;
  end if;

  select * into v_row from public.tom_operation_steps st
   where st.operation_id = p_operation_id and st.step_key = p_step_key
   for update;

  if v_row.id is null then
    return query select false, 'not_found'::text;
    return;
  end if;

  if v_row.status <> 'in_progress' then
    return query select false, 'already_resolved'::text;
    return;
  end if;

  -- R9-1: verify existe para destravar passo ABANDONADO por crash — passo aberto por
  -- posse ANTERIOR. Aplicado a um passo da posse ATUAL, ele viraria o oposto do que
  -- promete: com effect_confirmed=false apagaria um passo AINDA EM VOO, e o begin
  -- seguinte devolveria 'new' — repetindo uma mutacao que talvez esteja acontecendo
  -- neste instante. Passo da propria posse se fecha por step_finish, nao por verify.
  if v_row.opened_by_token is not distinct from p_lease_token then
    return query select false, 'not_orphan'::text;
    return;
  end if;

  if p_effect_confirmed then
    -- a releitura do worker confirmou que a mutacao ocorreu: fecha sem reexecutar
    update public.tom_operation_steps
       set status = 'done', result = p_result, finished_at = now(), opened_by_token = p_lease_token
     where tom_operation_steps.operation_id = p_operation_id
       and tom_operation_steps.step_key = p_step_key
       and tom_operation_steps.status = 'in_progress';
  else
    -- nao ocorreu: libera para nova execucao
    delete from public.tom_operation_steps
     where tom_operation_steps.operation_id = p_operation_id
       and tom_operation_steps.step_key = p_step_key
       and tom_operation_steps.status = 'in_progress';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return query select false, 'lost_race'::text;
    return;
  end if;

  return query select true, 'ok'::text;
end;
$$;

comment on function public.tom_operation_step_verify(uuid,text,boolean,jsonb,uuid) is
  'Resolve passo ORFAO (aberto por posse anterior). O worker rele o banco e diz se o efeito ocorreu.';

create function public.tom_operation_step_finish(
  p_operation_id uuid,
  p_step_key     text,
  p_result       jsonb default null,
  p_status       text  default 'done',
  p_error        text  default null,
  p_lease_token  uuid  default null
) returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.tom_operation_steps%rowtype; v_n int;
begin
  if p_status not in ('done','failed') then
    raise exception 'status invalido: %', p_status;
  end if;

  -- R5-1: fechar passo e declarar efeito. Exige a posse atual.
  -- R8: trava a linha de ownership ANTES de validar. Sem isso, a posse podia mudar
  -- entre a checagem e a escrita do passo. clock_timestamp() porque now() nao avanca
  -- enquanto se espera no lock.
  perform 1 from public.tom_message_ownership m
   where m.operation_id = p_operation_id for update;

  if not exists (
    select 1 from public.tom_message_ownership m
     where m.operation_id = p_operation_id
       and m.lease_token is not distinct from p_lease_token
       and m.status in ('claimed','processing')
       and m.lease_until is not null
       and m.lease_until > clock_timestamp()
  ) then
    return query select false, 'stale_lease'::text;
    return;
  end if;

  select * into v_row from public.tom_operation_steps st
   where st.operation_id = p_operation_id and st.step_key = p_step_key;

  if v_row.id is null then
    return query select false, 'not_found'::text;
    return;
  end if;

  -- R6-1 (bypass): ter a posse ATUAL nao autoriza fechar passo que OUTRA posse abriu.
  -- Sem isto, o worker retomado pulava needs_verification e marcava done sem provar
  -- nada — a barreira de recuperacao virava opcional para quem soubesse o atalho.
  if v_row.opened_by_token is distinct from p_lease_token then
    return query select false, 'not_step_owner'::text;
    return;
  end if;

  -- R7-2: passo ja resolvido nao se reescreve. Uma segunda chamada sobrescrevia o
  -- recibo — inclusive rebaixando um 'done' para 'failed' e apagando o result que a
  -- retomada usaria para NAO reexecutar. Idempotencia que perde a memoria nao e
  -- idempotencia.
  if v_row.status <> 'in_progress' then
    return query select false, 'already_resolved'::text;
    return;
  end if;

  update public.tom_operation_steps
     set status = p_status, result = p_result, error = p_error, finished_at = now()
   where tom_operation_steps.operation_id = p_operation_id
     and tom_operation_steps.step_key = p_step_key
     and tom_operation_steps.status = 'in_progress';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return query select false, 'lost_race'::text;
    return;
  end if;

  return query select true, 'ok'::text;
end;
$$;

comment on function public.tom_operation_step_finish(uuid,text,jsonb,text,text,uuid) is
  'Fecha passo. So quem ABRIU (mesmo token) fecha; orfao de crash passa por step_verify.';

create function public.tom_record_outbound(
  p_wa_message_id text,
  p_owner         text,
  p_phone         text default null,
  p_collaborator  uuid default null,
  p_conversation  text default null,
  p_entity_type   text default null,
  p_entity_id     uuid default null,
  p_operation_id  uuid default null,
  p_lease_token   uuid default null
) returns table (outcome text, id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_row public.tom_message_ownership%rowtype;
begin
  if p_wa_message_id is null or p_wa_message_id = '' then
    -- sem ID a resposta nao e citavel: quem chamou precisa saber, nao receber null mudo.
    return query select 'missing_message_id'::text, null::uuid;
    return;
  end if;

  -- R5-1: quando o outbound pertence a uma operacao, exige a posse atual. Sem isto, o
  -- worker que perdeu a lease ainda registrava saida — e saida registrada vira alvo de
  -- reply roteavel, ou seja, o zumbi entrava de volta no fluxo.
  if p_operation_id is not null then
    perform 1 from public.tom_message_ownership m
     where m.operation_id = p_operation_id for update;
  end if;

  if p_operation_id is not null and not exists (
    select 1 from public.tom_message_ownership m
     where m.operation_id = p_operation_id
       and m.lease_token is not distinct from p_lease_token
       and m.status in ('claimed','processing')
       and m.lease_until is not null
       and m.lease_until > clock_timestamp()
  ) then
    return query select 'stale_lease'::text, null::uuid;
    return;
  end if;

  insert into public.tom_message_ownership
    (wa_message_id, direction, owner, status, phone, collaborator_id, conversation_key,
     entity_type, entity_id, operation_id, finished_at)
  values
    (p_wa_message_id, 'outbound', p_owner, 'completed', p_phone, p_collaborator, p_conversation,
     p_entity_type, p_entity_id, p_operation_id, now())
  on conflict (wa_message_id) do nothing
  returning tom_message_ownership.id into v_id;

  if v_id is not null then
    return query select 'inserted'::text, v_id;
    return;
  end if;

  select * into v_row from public.tom_message_ownership where wa_message_id = p_wa_message_id;
  if v_row.owner is distinct from p_owner or v_row.direction is distinct from 'outbound' then
    return query select 'ownership_conflict'::text, v_row.id;
  else
    return query select 'already_recorded_same'::text, v_row.id;
  end if;
end;
$$;

-- -------------------------------------------------------------------------------------
-- fluxo — abre propriedade de entidade/conversa
-- -------------------------------------------------------------------------------------
create function public.tom_flow_open(
  p_conversation             text,
  p_entity_type              text,
  p_entity_id                uuid,
  p_owner                    text,
  p_collaborator             uuid    default null,
  p_interactive              boolean default true,
  p_opened_by                text    default null,
  p_note                     text    default null,
  p_interactive_ttl_seconds  int     default 3600
) returns table (id uuid, flow_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_tok uuid;
begin
  -- R4-3: expropria fluxo interativo EXPIRADO desta conversa antes de tentar abrir.
  -- Sem isso, um v2 que caiu antes de 'retired' prenderia a conversa para sempre e a
  -- pessoa nunca mais seria atendida naquele chat.
  --
  -- R10 (achado do teste concorrente): o UPDATE de expropriacao faz o SCAN antes de
  -- esperar lock nenhum. Se no instante do scan o TTL ainda estava vivo, a linha nem
  -- entra no conjunto a atualizar — o UPDATE afeta zero linhas e NAO espera. Quem espera
  -- e o INSERT seguinte, que ja encontra o indice unico ocupado e devolve null: a
  -- conversa fica presa mesmo com o TTL vencido. Relogio certo nao resolve isso; o que
  -- resolve e TRAVAR primeiro e so entao avaliar o prazo.
  if p_interactive then
    perform 1 from public.tom_flow_ownership f
     where f.conversation_key = p_conversation
       and f.closed_at is null
       and f.interactive
     for update;
  end if;

  if p_interactive then
    update public.tom_flow_ownership
       set phase     = 'retired',
           closed_at = now(),
           note      = coalesce(note || ' | ', '') || 'expired_ttl'
     where conversation_key = p_conversation
       and closed_at is null
       and interactive
       and interactive_until is not null
       and interactive_until <= clock_timestamp();
  end if;

  insert into public.tom_flow_ownership
    (conversation_key, entity_type, entity_id, owner, collaborator_id, interactive,
     interactive_until, opened_by_wa_id, note)
  values
    (p_conversation, p_entity_type, p_entity_id, p_owner, p_collaborator, p_interactive,
     case when p_interactive then clock_timestamp() + make_interval(secs => greatest(p_interactive_ttl_seconds, 1)) end,
     p_opened_by, p_note)
  on conflict do nothing
  returning tom_flow_ownership.id, tom_flow_ownership.flow_token into v_id, v_tok;
  -- id null = ja ha dono ativo para a entidade OU fluxo interativo VIVO nessa conversa.
  -- O chamador NAO deve prosseguir.
  return query select v_id, v_tok;
end;
$$;

-- R5-3: a consulta UNICA que o adapter usa para achar o dono do fluxo desta conversa.
-- Ja aplica o TTL: expirado NAO devolve owner (nao roteia), so sinaliza. Sem isto, o
-- adapter poderia ler a linha crua e continuar mandando pro v2 morto.
create function public.tom_flow_active_for_conversation(
  p_conversation text
) returns table (flow_id uuid, owner text, phase text, expired boolean)
language sql
security definer
set search_path = public
as $$
  select f.id,
         case when f.interactive_until is not null and f.interactive_until <= clock_timestamp()
              then null else f.owner end,
         f.phase,
         (f.interactive_until is not null and f.interactive_until <= clock_timestamp())
    from public.tom_flow_ownership f
   where f.conversation_key = p_conversation
     and f.closed_at is null
     and f.interactive
   limit 1;
$$;

comment on function public.tom_flow_active_for_conversation(text) is
  'Fonte unica do flowOwner. Expirado devolve owner NULL — TTL aplicado na consulta, nao no chamador.';

-- Renova o TTL enquanto o dono está vivo e conversando. Sem isso o TTL viraria um
-- limite de duração da conversa, não uma proteção contra dono morto.
create function public.tom_flow_touch(
  p_conversation            text,
  p_interactive_ttl_seconds int  default 3600,
  p_owner                   text default null,
  p_flow_token              uuid default null
) returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare v_f public.tom_flow_ownership%rowtype; v_n int;
begin
  -- R9-2: mesma classe temporal da R8, agora no fluxo. Se o touch comeca antes do prazo,
  -- espera no lock e o prazo passa nesse meio tempo, o now() congelado da transacao ainda
  -- veria o TTL vivo — e o fluxo expirado seria RESSUSCITADO, prendendo a conversa no v2.
  select * into v_f from public.tom_flow_ownership f
   where f.conversation_key = p_conversation
     and f.closed_at is null
     and f.interactive
   for update;

  if v_f.id is null then
    return query select false, 'not_found'::text;
    return;
  end if;
  if v_f.owner is distinct from p_owner or v_f.flow_token is distinct from p_flow_token then
    return query select false, 'not_owner'::text;
    return;
  end if;
  if v_f.interactive_until is not null and v_f.interactive_until <= clock_timestamp() then
    -- expirado nao se renova: quem quiser a conversa abre fluxo novo (e expropria este)
    return query select false, 'expired'::text;
    return;
  end if;

  update public.tom_flow_ownership
     set interactive_until = clock_timestamp() + make_interval(secs => greatest(p_interactive_ttl_seconds, 1))
   where id = v_f.id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return query select false, 'lost_race'::text;
    return;
  end if;

  return query select true, 'ok'::text;
end;
$$;

comment on function public.tom_flow_touch(text,int,text,uuid) is
  'Renova o TTL do fluxo vivo, sob trava e relogio real. Nao ressuscita expirado.';

create function public.tom_flow_set_phase(
  p_entity_type text,
  p_entity_id   uuid,
  p_phase       text,
  p_flow_token  uuid default null
) returns table (outcome text, previous_phase text)
language plpgsql
security definer
set search_path = public
as $$
declare v_prev text; v_tok uuid;
begin
  select phase, flow_token into v_prev, v_tok from public.tom_flow_ownership
   where entity_type = p_entity_type and entity_id = p_entity_id and closed_at is null
   for update;

  -- R5-3: drenar/aposentar fluxo alheio e tao grave quanto mante-lo vivo indevidamente.
  if v_prev is not null and v_tok is distinct from p_flow_token then
    return query select 'stale_token'::text, v_prev;
    return;
  end if;

  if v_prev is null then
    return query select 'not_found'::text, null::text;
    return;
  end if;
  if v_prev = p_phase then
    return query select 'unchanged'::text, v_prev;
    return;
  end if;
  -- reabrir um canário drenado é decisão administrativa, não UPDATE genérico.
  if not ((v_prev = 'canary' and p_phase in ('draining','retired'))
       or (v_prev = 'draining' and p_phase = 'retired')) then
    return query select 'illegal_transition'::text, v_prev;
    return;
  end if;

  update public.tom_flow_ownership
     set phase     = p_phase,
         closed_at = case when p_phase = 'retired' then now() else closed_at end
   where entity_type = p_entity_type and entity_id = p_entity_id and closed_at is null;

  return query select 'ok'::text, v_prev;
end;
$$;

comment on function public.tom_flow_set_phase(text,uuid,text,uuid) is
  'Só avança: canary→draining→retired. Reabrir canário é operação administrativa própria.';

-- =====================================================================================
-- R3-A1 — PRIVILÉGIOS. O default do banco concede EXECUTE a PUBLIC (portanto a anon e
-- authenticated): as 5 funções SECURITY DEFINER que já existem hoje estão abertas —
-- verificado com has_function_privilege. Sem estes REVOKE, qualquer chamador com JWT
-- anon poderia reivindicar mensagem, registrar outbound, abrir fluxo ou drenar ownership.
-- Assinaturas completas de propósito: REVOKE por nome não pega sobrecarga.
-- =====================================================================================
revoke all on function public.tom_route_claim_inbound(text,text,text,uuid,text,text,text,text,int)   from public, anon, authenticated;
revoke all on function public.tom_route_heartbeat(text,text,int,uuid)                                 from public, anon, authenticated;
revoke all on function public.tom_route_assert_lease(text,text,uuid)                                  from public, anon, authenticated;
revoke all on function public.tom_operation_step_verify(uuid,text,boolean,jsonb,uuid)                 from public, anon, authenticated;
revoke all on function public.tom_flow_active_for_conversation(text)                                  from public, anon, authenticated;
revoke all on function public.tom_route_finish_inbound(text,text,text,text,uuid)                      from public, anon, authenticated;
revoke all on function public.tom_record_outbound(text,text,text,uuid,text,text,uuid,uuid,uuid)       from public, anon, authenticated;
revoke all on function public.tom_flow_open(text,text,uuid,text,uuid,boolean,text,text,int)           from public, anon, authenticated;
revoke all on function public.tom_flow_touch(text,int,text,uuid)                                      from public, anon, authenticated;
revoke all on function public.tom_flow_set_phase(text,uuid,text,uuid)                                 from public, anon, authenticated;
revoke all on function public.tom_operation_step_begin(uuid,text,uuid)                                from public, anon, authenticated;
revoke all on function public.tom_operation_step_finish(uuid,text,jsonb,text,text,uuid)               from public, anon, authenticated;

grant execute on function public.tom_route_claim_inbound(text,text,text,uuid,text,text,text,text,int) to service_role;
grant execute on function public.tom_route_heartbeat(text,text,int,uuid)                              to service_role;
grant execute on function public.tom_route_assert_lease(text,text,uuid)                               to service_role;
grant execute on function public.tom_operation_step_verify(uuid,text,boolean,jsonb,uuid)              to service_role;
grant execute on function public.tom_flow_active_for_conversation(text)                               to service_role;
grant execute on function public.tom_route_finish_inbound(text,text,text,text,uuid)                   to service_role;
grant execute on function public.tom_record_outbound(text,text,text,uuid,text,text,uuid,uuid,uuid)    to service_role;
grant execute on function public.tom_flow_open(text,text,uuid,text,uuid,boolean,text,text,int)        to service_role;
grant execute on function public.tom_flow_touch(text,int,text,uuid)                                   to service_role;
grant execute on function public.tom_flow_set_phase(text,uuid,text,uuid)                              to service_role;
grant execute on function public.tom_operation_step_begin(uuid,text,uuid)                             to service_role;
grant execute on function public.tom_operation_step_finish(uuid,text,jsonb,text,text,uuid)            to service_role;

-- As tabelas também: RLS sem policy já bloqueia, mas negar o privilégio é a barreira
-- que não depende de ninguém lembrar de não criar uma policy permissiva depois.
-- service_role ENTRA no revoke (corrigido em 03/08, ver 2026-08-03b): o Supabase mantém
-- `alter default privileges in schema public grant all on tables to anon, authenticated,
-- service_role`, então TODA tabela nova em public nasce com ALL para os três. Sem revogar
-- do service_role, o `grant select` abaixo era decorativo — o ALL do default continuava
-- valendo. O schema descartável não tem essa default ACL, e por isso a asserção R5-4
-- passava lá: media um banco que não existe. O runner agora espelha as default privileges.
revoke all on table public.tom_message_ownership, public.tom_flow_ownership,
                    public.tom_operations, public.tom_operation_steps
  from public, anon, authenticated, service_role;
-- R5-4 (governanca): SELECT apenas. Com INSERT/UPDATE direto, o runtime contornaria
-- token, lease e maquina de estados — as barreiras viram sugestao. As RPCs sao
-- SECURITY DEFINER: escrevem sem depender do privilegio de quem chama.
grant select on table public.tom_message_ownership, public.tom_flow_ownership,
                      public.tom_operations, public.tom_operation_steps
  to service_role;

commit;
