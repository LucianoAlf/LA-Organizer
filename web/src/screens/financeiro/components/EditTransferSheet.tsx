// Editar/apagar uma transferência direto no extrato da carteira (Sug Rose 14/06).
// O saldo das 2 contas é reajustado pelo trigger pf_sync_balance_on_transfer (INSERT/UPDATE/DELETE).
import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useAccounts, useUpdateTransfer, useDeleteTransfer } from '../../../hooks/useFinanceiro';
import type { PfTransfer } from '../../../lib/financeiro';

export function EditTransferSheet({
  open,
  onClose,
  transfer,
}: {
  open: boolean;
  onClose: () => void;
  transfer?: PfTransfer;
}) {
  const accountsQ = useAccounts();
  const updateMut = useUpdateTransfer();
  const deleteMut = useDeleteTransfer();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (open && transfer) {
      setFrom(transfer.from_account);
      setTo(transfer.to_account);
      setAmountText(String(transfer.amount).replace('.', ','));
      setDate(transfer.transfer_date);
      setConfirmDel(false);
    }
  }, [open, transfer]);

  const accs = accountsQ.data ?? [];
  const optsFrom = [
    { value: '', label: '— escolha —' },
    ...accs.map((a) => ({ value: a.id, label: `${a.icon ?? '🏦'}  ${a.name}` })),
  ];
  const optsTo = [
    { value: '', label: '— escolha —' },
    ...accs.filter((a) => a.id !== from).map((a) => ({ value: a.id, label: `${a.icon ?? '🏦'}  ${a.name}` })),
  ];
  const amount = Number(amountText.replace(',', '.'));
  const invalid = !from || !to || from === to || !isFinite(amount) || amount <= 0;

  async function save() {
    if (invalid || !transfer) return;
    setSubmitting(true);
    try {
      await updateMut.mutateAsync({ id: transfer.id, patch: { from_account: from, to_account: to, amount, transfer_date: date } });
      onClose();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!transfer) return;
    setSubmitting(true);
    try {
      await deleteMut.mutateAsync(transfer.id);
      onClose();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Editar transferência" size="sm">
      <div className="flex flex-col gap-md p-md">
        <Field label="De">
          <CustomSelect value={from} options={optsFrom} onChange={setFrom} />
        </Field>
        <Field label="Para">
          <CustomSelect value={to} options={optsTo} onChange={setTo} />
        </Field>
        <Field label="Valor">
          <div className="flex items-baseline gap-2">
            <span className="text-fg-muted text-body-md">R$</span>
            <input
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0,00"
              className="w-full bg-transparent border-0 border-b border-border focus:border-tom outline-none text-[24px] font-bold tabular-nums py-1 text-fg placeholder:text-fg-muted/40"
            />
          </div>
        </Field>
        <Field label="Data">
          <DateInput value={date} onChange={setDate} />
        </Field>

        {confirmDel ? (
          <div className="rounded-md border border-border bg-bg-elevated p-3 flex flex-col gap-2">
            <p className="text-body-sm text-fg">Apagar esta transferência? O valor volta pra conta de origem.</p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDel(false)} disabled={submitting}>Cancelar</Button>
              <Button variant="danger" onClick={remove} disabled={submitting}>{submitting ? 'Apagando…' : 'Apagar'}</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConfirmDel(true)} disabled={submitting}>🗑️ Apagar</Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
              <Button variant="primary" onClick={save} disabled={submitting || invalid}>{submitting ? 'Salvando…' : 'Salvar'}</Button>
            </div>
          </div>
        )}
      </div>
    </AdaptiveSheet>
  );
}
