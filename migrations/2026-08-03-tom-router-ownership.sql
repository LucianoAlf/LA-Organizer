-- =====================================================================================
-- TOM v1/v2 — ledger de propriedade (roteamento entre runtimes)
-- Data: 03/08/2026 · Origem: auditoria de viabilidade Hermes+UAZAPI (Alfredo)
--
-- NÃO APLICADA. Escrita para auditoria antes do deploy, conforme o processo acordado.
--
-- Por que estas tabelas existem: dois agentes no MESMO número de WhatsApp precisam de um
-- dono por mensagem e por entidade. Sem isso, um reply não sabe quem deve responder e
-- dois dispatchers podem cobrar a mesma tarefa.
--
-- Por que NÃO reaproveitar `conversation_history`: é o histórico do v1, já tem exceções,
-- e o writer da resposta normal descarta o ID devolvido pela UAZAPI — medido em
-- 4.288 outbounds sem `whatsapp_message_id` nos últimos 30 dias (contra 1.119 com ID,
-- todos do caminho proativo). Um ledger de governança não pode nascer com 79% de buracos.
--
-- Acesso: só service_role (os runtimes). RLS habilitada SEM policy permissiva — sem
-- policy, anon/authenticated não leem nada; service_role ignora RLS por definição.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. tom_message_ownership — de quem é cada mensagem do WhatsApp
--    Serve para (a) rotear o reply de volta ao dono e (b) dedupe PERSISTENTE de inbound.
--    O dedupe atual do v1 é memória local com teto de 1.000 e morre no restart
--    (src/services/dedupe.js), então não serve como contrato entre dois runtimes.
-- -------------------------------------------------------------------------------------
create table if not exists public.tom_message_ownership (
  id                    uuid primary key default gen_random_uuid(),
  wa_message_id         text        not null,
  direction             text        not null check (direction in ('inbound','outbound')),
  owner                 text        not null check (owner in ('v1','v2')),
  phone                 text,
  collaborator_id       uuid        references public.collaborators(id) on delete set null,
  quoted_wa_message_id  text,
  entity_type           text        check (entity_type is null or entity_type in ('task','event','habit','reminder','bill','note')),
  entity_id             uuid,
  operation_id          uuid,
  route_reason          text,
  route_conflict        text,        -- quote e fluxo discordaram; telemetria, não erro
  created_at            timestamptz not null default now()
);

-- Um ID de mensagem tem UM dono. É esta constraint que sustenta tanto o roteamento por
-- quote quanto o dedupe de inbound — sem ela, o ledger vira sugestão.
create unique index if not exists tom_message_ownership_wa_id_uq
  on public.tom_message_ownership (wa_message_id);

create index if not exists tom_message_ownership_quoted_idx
  on public.tom_message_ownership (quoted_wa_message_id) where quoted_wa_message_id is not null;
create index if not exists tom_message_ownership_entity_idx
  on public.tom_message_ownership (entity_type, entity_id) where entity_id is not null;
create index if not exists tom_message_ownership_collab_idx
  on public.tom_message_ownership (collaborator_id, created_at desc);

alter table public.tom_message_ownership enable row level security;

comment on table  public.tom_message_ownership is
  'Dono (v1/v2) de cada mensagem WhatsApp. Roteia reply e deduplica inbound entre runtimes.';
comment on column public.tom_message_ownership.route_conflict is
  'Quote e fluxo aberto discordaram na rota. Não bloqueia; existe para não virar bug invisível.';

-- -------------------------------------------------------------------------------------
-- 2. tom_flow_ownership — de quem é cada ENTIDADE de negócio
--    O v1 continua dono de tudo que já existe. O v2 nasce dono só do que ele criar no
--    canário. É isto que impede dois dispatchers de cobrarem a mesma tarefa: nenhum
--    runtime pode agendar/mutar entidade cujo dono ativo é o outro.
-- -------------------------------------------------------------------------------------
create table if not exists public.tom_flow_ownership (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text        not null check (entity_type in ('task','event','habit','reminder','bill','note')),
  entity_id       uuid        not null,
  collaborator_id uuid        references public.collaborators(id) on delete cascade,
  owner           text        not null check (owner in ('v1','v2')),
  -- canary  = fluxo vivo, aceita novas interações
  -- draining= rollback acionado: não abre nada novo, mas o que já começou termina aqui
  -- retired = encerrado; não prende mais a conversa
  phase           text        not null default 'canary' check (phase in ('canary','draining','retired')),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  note            text
);

-- Uma entidade tem NO MÁXIMO UM dono ativo. Parcial porque histórico fechado pode repetir.
create unique index if not exists tom_flow_ownership_active_uq
  on public.tom_flow_ownership (entity_type, entity_id) where closed_at is null;

create index if not exists tom_flow_ownership_collab_idx
  on public.tom_flow_ownership (collaborator_id) where closed_at is null;

alter table public.tom_flow_ownership enable row level security;

comment on table public.tom_flow_ownership is
  'Dono (v1/v2) de cada entidade de negócio. Impede dois runtimes de mutarem/cobrarem a mesma coisa.';

-- -------------------------------------------------------------------------------------
-- 3. tom_operations — trilha intenção → mutação → releitura → recibo
--    Substitui "o marker foi emitido" como prova de que algo aconteceu. É a base do E0
--    (telemetria por operação, não contagem de executed/rejected).
-- -------------------------------------------------------------------------------------
create table if not exists public.tom_operations (
  operation_id           uuid primary key default gen_random_uuid(),
  inbound_wa_message_id  text        not null,
  owner                  text        not null check (owner in ('v1','v2')),
  collaborator_id        uuid        references public.collaborators(id) on delete set null,
  action                 text        check (action is null or action in ('done','in_progress','reschedule','cancel','clarify')),
  entity_type            text,
  entity_id              uuid,
  state_before           jsonb,
  state_after            jsonb,
  verified               boolean,     -- releitura confirmou o efeito? null = não verificado
  verification_detail    text,
  sent_text              text,
  error                  text,
  created_at             timestamptz not null default now(),
  finished_at            timestamptz
);

-- Um inbound gera UMA operação. É o que impede executar duas vezes o mesmo pedido —
-- inclusive entre runtimes e através de restart, ao contrário do dedupe em memória.
create unique index if not exists tom_operations_inbound_uq
  on public.tom_operations (inbound_wa_message_id);

create index if not exists tom_operations_entity_idx
  on public.tom_operations (entity_type, entity_id) where entity_id is not null;
create index if not exists tom_operations_open_idx
  on public.tom_operations (collaborator_id, created_at desc) where finished_at is null;

alter table public.tom_operations enable row level security;

comment on table public.tom_operations is
  'Uma linha por pedido processado: intenção, alvo, estado antes/depois, verificação e recibo.';
comment on column public.tom_operations.verified is
  'Releitura do banco confirmou o efeito. NULL = não verificado — nunca tratar como sucesso.';

-- -------------------------------------------------------------------------------------
-- RPCs de OWNERSHIP (infraestrutura de roteamento).
-- As RPCs de AÇÃO de negócio (tom_v2_apply_reminder_action / tom_v2_verify_operation)
-- NÃO entram aqui de propósito: elas dependem do contrato de ciclo de vida (E2.0). Uma
-- RPC de ação escrita hoje herdaria a mesma mentira de `endSeries1on1`, que devolve
-- {ended:true} sem checar erro. Ver a spec, seção "Contraponto 2".
-- -------------------------------------------------------------------------------------

-- Registra o inbound e devolve se ele JÁ tinha sido processado. Idempotente por
-- wa_message_id: a segunda chamada não cria linha e informa o dono da primeira.
create or replace function public.tom_route_claim_inbound(
  p_wa_message_id text,
  p_owner         text,
  p_phone         text default null,
  p_collaborator  uuid default null,
  p_quoted        text default null,
  p_reason        text default null,
  p_conflict      text default null
) returns table (already_seen boolean, owner text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  select m.owner into v_existing
    from public.tom_message_ownership m
   where m.wa_message_id = p_wa_message_id;

  if v_existing is not null then
    return query select true, v_existing;
    return;
  end if;

  insert into public.tom_message_ownership
    (wa_message_id, direction, owner, phone, collaborator_id, quoted_wa_message_id, route_reason, route_conflict)
  values
    (p_wa_message_id, 'inbound', p_owner, p_phone, p_collaborator, p_quoted, p_reason, p_conflict)
  on conflict (wa_message_id) do nothing;

  -- corrida: outro processo inseriu entre o select e o insert → devolve o dono vencedor
  select m.owner into v_existing
    from public.tom_message_ownership m
   where m.wa_message_id = p_wa_message_id;

  return query select false, coalesce(v_existing, p_owner);
end;
$$;

comment on function public.tom_route_claim_inbound is
  'Reivindica um inbound para um runtime. already_seen=true → outro já processou; não responder de novo.';

-- Grava o ID de saída devolvido pela UAZAPI, tornando a mensagem respondível/roteável.
create or replace function public.tom_record_outbound(
  p_wa_message_id text,
  p_owner         text,
  p_phone         text default null,
  p_collaborator  uuid default null,
  p_entity_type   text default null,
  p_entity_id     uuid default null,
  p_operation_id  uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_wa_message_id is null or p_wa_message_id = '' then
    return null;  -- sem ID não há o que rotear; não inventa linha
  end if;

  insert into public.tom_message_ownership
    (wa_message_id, direction, owner, phone, collaborator_id, entity_type, entity_id, operation_id)
  values
    (p_wa_message_id, 'outbound', p_owner, p_phone, p_collaborator, p_entity_type, p_entity_id, p_operation_id)
  on conflict (wa_message_id) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.tom_record_outbound is
  'Registra o ID devolvido pela UAZAPI. Sem isso, a resposta não pode ser citada e roteada de volta.';

-- Abre a propriedade de uma entidade para um runtime. Falha se já houver dono ativo —
-- a exclusividade vem do índice único parcial, não de checagem na aplicação.
create or replace function public.tom_flow_open(
  p_entity_type   text,
  p_entity_id     uuid,
  p_owner         text,
  p_collaborator  uuid default null,
  p_note          text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.tom_flow_ownership (entity_type, entity_id, owner, collaborator_id, note)
  values (p_entity_type, p_entity_id, p_owner, p_collaborator, p_note)
  on conflict do nothing
  returning id into v_id;
  return v_id;  -- null = já tinha dono ativo; o chamador NÃO deve prosseguir
end;
$$;

-- Muda a fase do fluxo (rollback = 'draining') ou encerra a propriedade.
create or replace function public.tom_flow_set_phase(
  p_entity_type text,
  p_entity_id   uuid,
  p_phase       text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.tom_flow_ownership
     set phase     = p_phase,
         closed_at = case when p_phase = 'retired' then now() else closed_at end
   where entity_type = p_entity_type
     and entity_id   = p_entity_id
     and closed_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

comment on function public.tom_flow_set_phase is
  'draining = rollback: não abre nada novo, mas a operação em andamento termina no dono atual.';
