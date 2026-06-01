import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useAccounts, useCreateTransfer, useCreateTransaction, useCategories } from '../../../hooks/useFinanceiro';

function todayYmd() { return new Date().toISOString().slice(0, 10); }

export function TransferSheet({
  open,
  onClose,
  fromAccountId,
}: {
  open: boolean;
  onClose: () => void;
  fromAccountId?: string;
}) {
  const accountsQ = useAccounts();
  const catsQ = useCategories();
  const transferMut = useCreateTransfer();
  const createTx = useCreateTransaction();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [submitting, setSubmitting] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [category, setCategory] = useState('outros');

  useEffect(() => {
    if (open) {
      setFrom(fromAccountId ?? '');
      setTo('');
      setAmountText('');
      setDate(todayYmd());
      setRecipient('');
      setCategory('outros');
    }
  }, [open, fromAccountId]);

  const accs = accountsQ.data ?? [];
  const optsFrom = [
    { value: '', label: '— escolha —' },
    ...accs.map((a) => ({ value: a.id, label: `${a.icon ?? '🏦'}  ${a.name}` })),
  ];
  const optsTo = [
    { value: '', label: '— escolha —' },
    ...accs
      .filter((a) => a.id !== from)
      .map((a) => ({ value: a.id, label: `${a.icon ?? '🏦'}  ${a.name}` })),
    { value: 'external', label: '👤  Outra pessoa (PIX)' },
  ];
  const expenseCategories = (catsQ.data ?? [])
    .filter((c) => c.type === 'expense')
    .map((c) => ({ value: c.slug, label: `${c.emoji}  ${c.label}` }));
  const amount = Number(amountText.replace(',', '.'));
  const isExternal = to === 'external';
  const invalid = isExternal
    ? !from || !isFinite(amount) || amount <= 0
    : !from || !to || from === to || !isFinite(amount) || amount <= 0;

  async function submit() {
    if (invalid) return;
    setSubmitting(true);
    try {
      if (isExternal) {
        await createTx.mutateAsync({
          type: 'expense',
          category,
          amount,
          description: recipient.trim() ? `PIX ${recipient.trim()}` : 'PIX',
          transaction_date: date,
          account_id: from,
        });
      } else {
        await transferMut.mutateAsync({ from_account: from, to_account: to, amount, transfer_date: date });
      }
      onClose();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Transferir / PIX" size="sm">
      <div className="flex flex-col gap-md p-md">
        <Field label="De">
          <CustomSelect value={from} options={optsFrom} onChange={setFrom} />
        </Field>

        <Field label="Para">
          <CustomSelect value={to} options={optsTo} onChange={setTo} />
        </Field>

        {isExternal && (
          <>
            <Field label="Para quem">
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Nome de quem recebeu"
                className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
              />
            </Field>
            <Field label="Categoria">
              <CustomSelect
                value={category}
                options={expenseCategories}
                onChange={setCategory}
              />
            </Field>
          </>
        )}

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

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting || invalid}>
            {submitting
              ? isExternal ? 'Enviando…' : 'Transferindo…'
              : isExternal ? 'Enviar PIX' : 'Transferir'}
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
