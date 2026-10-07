-- PIX-NO-1A1 (Ana Paula, DM 05/10; coordenação 07/10): casa do "número -> cliente" da lista do PIX
-- que o TOM manda no 1:1 (src/services/pix-dm-numeracao.js). A pessoa responde "8 já cadastrado" e
-- o 8 tem que virar o cliente da lista que ELA recebeu. Uma linha por lista enviada; o TOM lê a mais
-- recente da pessoa dentro de 24h. Antes morava provisoriamente em marker_logs (PIX_LISTA_DM).
-- Autorizada pelo dono e aplicada em produção em 2026-10-07 (projeto cesnbnrynvxvgdhfmaua).
-- RLS ligado e SEM policy: só o service role lê/escreve (nomes de cliente).

create table public.pix_dm_numeracao (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references public.collaborators(id) on delete cascade,
  itens jsonb not null,
  created_at timestamptz not null default now()
);

create index pix_dm_numeracao_collab_created_idx
  on public.pix_dm_numeracao (collaborator_id, created_at desc);

alter table public.pix_dm_numeracao enable row level security;
