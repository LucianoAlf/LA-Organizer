-- Escrita de credenciais pelo TOM. O gate de acesso mora AQUI, alem do engine:
-- se algum dia alguem chamar estas funcoes de outro ponto do codigo esquecendo
-- de checar is_system_admin, elas negam sozinhas.

create or replace function upsert_credencial(
  p_collaborator_id uuid,
  p_cred_id uuid,            -- null = create; preenchido = update
  p_nome text,
  p_categoria text,
  p_servico text,
  p_projeto text,
  p_url_ref text,
  p_observacoes text,
  p_campos jsonb
)
returns uuid
language plpgsql
as $$
declare v_admin boolean; v_id uuid;
begin
  select coalesce(c.is_system_admin, false) into v_admin
  from collaborators c where c.id = p_collaborator_id and c.is_active = true;
  if v_admin is null or v_admin = false then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_cred_id is null then
    insert into governance_credentials (nome, categoria, servico, projeto, url_ref, observacoes, campos, status, visivel_tom)
    values (p_nome, coalesce(nullif(btrim(p_categoria), ''), 'outro'), p_servico, p_projeto, p_url_ref, p_observacoes, coalesce(p_campos, '[]'::jsonb), 'ok', false)
    returning id into v_id;
  else
    update governance_credentials g set
      nome        = coalesce(p_nome, g.nome),
      categoria   = coalesce(p_categoria, g.categoria),
      servico     = coalesce(p_servico, g.servico),
      projeto     = coalesce(p_projeto, g.projeto),
      url_ref     = coalesce(p_url_ref, g.url_ref),
      observacoes = coalesce(p_observacoes, g.observacoes),
      campos      = coalesce(p_campos, g.campos),
      updated_at  = now()
    where g.id = p_cred_id
    returning g.id into v_id;
    if v_id is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end; $$;

create or replace function delete_credencial(p_collaborator_id uuid, p_cred_id uuid)
returns boolean
language plpgsql
as $$
declare v_admin boolean; v_ok boolean;
begin
  select coalesce(c.is_system_admin, false) into v_admin
  from collaborators c where c.id = p_collaborator_id and c.is_active = true;
  if v_admin is null or v_admin = false then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from governance_credentials where id = p_cred_id returning true into v_ok;
  return coalesce(v_ok, false);
end; $$;

-- A anon key esta no bundle publico do PWA.
revoke execute on function upsert_credencial(uuid,uuid,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function delete_credencial(uuid,uuid) from public, anon, authenticated;
grant execute on function upsert_credencial(uuid,uuid,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function delete_credencial(uuid,uuid) to service_role;

-- Kind novo para a confirmacao de escrita. PORTA 1 DE 2 — a outra e o
-- VALID_KINDS de src/services/pending-intents.js (Task 5).
alter table pending_intents drop constraint pending_intents_kind_check;
alter table pending_intents add constraint pending_intents_kind_check
  check (kind = any (array['task_creation', 'event_creation', 'approval_pending', 'confirmation', 'finance_source', 'invoice_import', 'reschedule_confirm', 'event_create_confirm', 'bill_from_boleto', 'credencial_write']));
