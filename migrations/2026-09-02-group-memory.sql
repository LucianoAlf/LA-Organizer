-- group_memory — memória do TOM por GRUPO de trabalho.
-- Espelha collaborator_memory (mesmo vocabulário de memory_type/importance/decay_at/embedding)
-- e acrescenta occurred_on (o dia da conversa), evidence (o trecho literal que originou) e
-- approved_at (o gate das lições: lesson nasce is_active=false e só entra no prompt aprovada).
create table if not exists public.group_memory (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.work_groups(id) on delete cascade,
  memory_type  text not null check (memory_type in ('fact','decision','lesson','preference','context')),
  content      text not null,
  importance   text not null default 'normal' check (importance in ('critical','high','normal','low')),
  decay_at     timestamptz,
  is_active    boolean not null default true,
  approved_at  timestamptz,
  occurred_on  date not null,
  evidence     text,
  source       text,
  embedding    vector(1536),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_group_memory_group_active on public.group_memory (group_id, is_active);
create index if not exists idx_group_memory_group_type   on public.group_memory (group_id, memory_type);
create index if not exists idx_group_memory_occurred     on public.group_memory (group_id, occurred_on desc);
create index if not exists idx_group_memory_fts          on public.group_memory using gin (to_tsvector('portuguese', content));
create index if not exists idx_group_memory_embedding    on public.group_memory using ivfflat (embedding vector_cosine_ops) with (lists = '10');

alter table public.group_memory enable row level security;
