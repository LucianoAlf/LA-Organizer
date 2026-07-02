-- Fila de envio DURÁVEL genérica — anti-ban WhatsApp (02/07).
-- Convites de reunião, avisos de reschedule e qualquer fan-out passam por aqui:
-- o dispatcher drena espaçado (jitter + quiet-hours). Sobrevive a restart do pm2.
-- Ver src/lib/outbound-queue.js + src/rituals/dispatcher.js (drainOutboundQueue).
create table if not exists outbound_queue (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  body text not null,
  meta jsonb not null default '{}',            -- {collaborator_id, kind, event_id, sender_name}
  scheduled_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','sent','failed','canceled')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbound_queue_drain_idx on outbound_queue (status, scheduled_at);
-- RLS ligada sem policy pública: a engine escreve/lê via service_role.
alter table outbound_queue enable row level security;
