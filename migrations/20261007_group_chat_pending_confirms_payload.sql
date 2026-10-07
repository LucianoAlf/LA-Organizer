alter table public.group_chat_pending_confirms add column if not exists payload jsonb;
