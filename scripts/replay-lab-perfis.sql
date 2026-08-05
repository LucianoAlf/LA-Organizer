-- scripts/replay-lab-perfis.sql
-- Perfis de QA do TOM Replay Lab (spec 05/08, passo 1). IDEMPOTENTE.
--
-- Quatro perfis porque a fila do TOM serializa POR TELEFONE: um cenário de 20 repetições
-- num perfil só leva ~33 min; em quatro, ~10.
--
-- Telefones na faixa 5500... — DDD 00 não existe no Brasil, então nenhum número real cai
-- aqui. É a segunda metade da guarda dupla da trava de saída (a primeira é a lista
-- TOM_QA_PHONES): se alguém puser um telefone de gente na lista, a faixa segura.
--
-- role='collaborator' e unit=NULL de propósito: perfil de QA não pode aparecer em digest
-- de liderança, scorecard por unidade nem governança. É isolamento por DADO, somado aos
-- guards de CÓDIGO — nenhum dos dois sozinho basta.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/replay-lab-perfis.sql

begin;

insert into public.collaborators (full_name, phone, role, unit, is_active, onboarding_completed)
values
  ('[QA] Replay 01', '5500000000001', 'collaborator', null, true, true),
  ('[QA] Replay 02', '5500000000002', 'collaborator', null, true, true),
  ('[QA] Replay 03', '5500000000003', 'collaborator', null, true, true),
  ('[QA] Replay 04', '5500000000004', 'collaborator', null, true, true)
on conflict (phone) do update
  set full_name = excluded.full_name,
      role = excluded.role,
      unit = excluded.unit,
      is_active = excluded.is_active,
      onboarding_completed = excluded.onboarding_completed;

-- Recibo: o script não afirma sucesso, ele mede.
select '[QA] perfis existentes = ' || count(*) ||
       ' | ativos = ' || count(*) filter (where is_active) ||
       ' | fora da faixa 5500 = ' || count(*) filter (where phone !~ '^5500[0-9]{9}$')
  from public.collaborators
 where full_name like '[QA]%';

commit;
