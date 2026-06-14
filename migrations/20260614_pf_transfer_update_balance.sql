-- Editar transferência no extrato da carteira (Sug Rose 14/06): o trigger de saldo só tratava
-- INSERT/DELETE. Sem UPDATE, editar valor/conta de uma transferência deixava os saldos errados.
-- Estende pf_sync_balance_on_transfer pra UPDATE: reverte o saldo do OLD (contas/valor antigos)
-- e aplica o NEW — cobre mudança de valor E de contas, e é atômico no próprio UPDATE.

CREATE OR REPLACE FUNCTION public.pf_sync_balance_on_transfer()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if TG_OP='INSERT' then
    update pf_accounts set balance = balance - NEW.amount, updated_at=now() where id = NEW.from_account;
    update pf_accounts set balance = balance + NEW.amount, updated_at=now() where id = NEW.to_account;
  elsif TG_OP='DELETE' then
    update pf_accounts set balance = balance + OLD.amount, updated_at=now() where id = OLD.from_account;
    update pf_accounts set balance = balance - OLD.amount, updated_at=now() where id = OLD.to_account;
  elsif TG_OP='UPDATE' then
    -- reverte saldos da transferência antiga (from/to e valor podem ter mudado)
    update pf_accounts set balance = balance + OLD.amount, updated_at=now() where id = OLD.from_account;
    update pf_accounts set balance = balance - OLD.amount, updated_at=now() where id = OLD.to_account;
    -- aplica a transferência nova
    update pf_accounts set balance = balance - NEW.amount, updated_at=now() where id = NEW.from_account;
    update pf_accounts set balance = balance + NEW.amount, updated_at=now() where id = NEW.to_account;
  end if;
  return null;
end; $function$;

DROP TRIGGER IF EXISTS trg_pf_transfer_balance ON public.pf_transfers;
CREATE TRIGGER trg_pf_transfer_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.pf_transfers
  FOR EACH ROW EXECUTE FUNCTION pf_sync_balance_on_transfer();
