import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useAddToGoal } from '../../../hooks/useFinanceiro';
import type { PfGoal } from '../../../lib/financeiro';

function todayYmd() { return new Date().toISOString().slice(0, 10); }

export function ContributionSheet({
  open,
  onClose,
  goal,
}: {
  open: boolean;
  onClose: () => void;
  goal: PfGoal | null;
}) {
  const addMut = useAddToGoal();
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAmountText('');
      setDate(todayYmd());
      setNote('');
    }
  }, [open]);

  async function submit() {
    const amount = Number(amountText.replace(',', '.'));
    if (!goal || !isFinite(amount) || amount <= 0) return;
    setSubmitting(true);
    try {
      await addMut.mutateAsync({ goalId: goal.id, amount, note: note.trim() || undefined, date });
      onClose();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={goal ? `Guardar pra "${goal.name}"` : 'Guardar'} size="sm">
      <div className="flex flex-col gap-md p-md">
        <Field label="Valor">
          <div className="flex items-baseline gap-2">
            <span className="text-fg-muted text-body-md">R$</span>
            <input
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0,00"
              autoFocus
              className="w-full bg-transparent border-0 border-b border-border focus:border-tom outline-none text-[24px] font-bold tabular-nums py-1 text-fg placeholder:text-fg-muted/40"
            />
          </div>
        </Field>

        <Field label="Data">
          <DateInput value={date} onChange={setDate} />
        </Field>

        <Field label="Nota" sub="Opcional. Ex.: 13º salário, sobrou do mês.">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="O que foi?"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={submitting || !amountText.trim()}
          >
            {submitting ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
