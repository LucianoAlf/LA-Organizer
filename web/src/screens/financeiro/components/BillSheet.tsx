import { useEffect, useMemo, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useCategories, useCreateBill, useDeactivateBill, useUpdateBill } from '../../../hooks/useFinanceiro';
import type { PfBill, PfBillType, PfCategory } from '../../../lib/financeiro';

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` }));

export interface BillSheetProps {
  open: boolean;
  onClose: () => void;
  initial?: PfBill;
}

export function BillSheet({ open, onClose, initial }: BillSheetProps) {
  const isEdit = !!initial;
  const createMut = useCreateBill();
  const updateMut = useUpdateBill();
  const deactivateMut = useDeactivateBill();
  const catsQ = useCategories();
  const allCats = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  const expenseCats = useMemo(() => allCats.filter((c) => c.type === 'expense').map((c) => ({ value: c.slug, label: `${c.emoji}  ${c.label}` })), [allCats]);
  const incomeCats = useMemo(() => allCats.filter((c) => c.type === 'income').map((c) => ({ value: c.slug, label: `${c.emoji}  ${c.label}` })), [allCats]);
  const [type, setType] = useState<PfBillType>('expense');
  const [recurrence, setRecurrence] = useState<'monthly' | 'once'>('monthly');
  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dueDay, setDueDay] = useState<string>('10');
  const [dueDate, setDueDate] = useState<string>('');
  const [category, setCategory] = useState<PfCategory>('moradia');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(initial?.type ?? 'expense');
    const rec = initial?.recurrence ?? 'monthly';
    setRecurrence(rec);
    setName(initial?.name ?? '');
    setAmountText(initial ? String(initial.amount) : '');
    setDueDay(initial?.due_day != null ? String(initial.due_day) : '10');
    setDueDate(rec === 'once' ? (initial?.due_date ?? '') : todayYmd());
    setCategory(initial?.category ?? 'moradia');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  function switchType(next: PfBillType) {
    setType(next);
    if (next === 'expense' && !expenseCats.find((o) => o.value === category)) setCategory('moradia');
    if (next === 'income' && !incomeCats.find((o) => o.value === category)) setCategory('salario');
  }

  async function submit() {
    setError(null);
    const amount = Number(amountText.replace(',', '.'));
    if (!name.trim()) return setError('Dá um nome pra essa conta.');
    if (!isFinite(amount) || amount <= 0) return setError('Informe um valor válido.');
    try {
      if (recurrence === 'monthly') {
        const dd = Number(dueDay);
        if (!Number.isInteger(dd) || dd < 1 || dd > 31) return setError('Dia precisa ser entre 1 e 31.');
        await createMut.mutateAsync({ name: name.trim(), amount, due_day: dd, due_date: null, recurrence: 'monthly', category, type });
      } else {
        if (!dueDate) return setError('Informe a data de vencimento.');
        const dd = Number(dueDate.slice(8, 10));
        await createMut.mutateAsync({ name: name.trim(), amount, recurrence: 'once', due_date: dueDate, due_day: dd, category, type });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!initial) return;
    setError(null);
    const amount = Number(amountText.replace(',', '.'));
    if (!name.trim()) return setError('Dá um nome pra essa conta.');
    if (!isFinite(amount) || amount <= 0) return setError('Informe um valor válido.');
    try {
      if (recurrence === 'monthly') {
        const dd = Number(dueDay);
        if (!Number.isInteger(dd) || dd < 1 || dd > 31) return setError('Dia precisa ser entre 1 e 31.');
        await updateMut.mutateAsync({ id: initial.id, patch: { name: name.trim(), amount, due_day: dd, due_date: null, recurrence: 'monthly', category, type } });
      } else {
        if (!dueDate) return setError('Informe a data de vencimento.');
        const dd = Number(dueDate.slice(8, 10));
        await updateMut.mutateAsync({ id: initial.id, patch: { name: name.trim(), amount, recurrence: 'once', due_date: dueDate, due_day: dd, category, type } });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!initial) return;
    if (!confirm(`Desativar conta "${initial.name}"?`)) return;
    try {
      await deactivateMut.mutateAsync(initial.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const categoryOptions = type === 'expense' ? expenseCats : incomeCats;
  const submitting = createMut.isPending || updateMut.isPending || deactivateMut.isPending;
  const dueDateMissing = recurrence === 'once' && !dueDate;

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={isEdit ? 'Editar conta' : 'Nova conta fixa'} size="sm">
      <div className="flex flex-col gap-md p-md">
        <div className="grid grid-cols-2 rounded-full bg-bg-elevated p-1 text-body-sm">
          <button
            type="button"
            onClick={() => switchType('expense')}
            className={[
              'h-9 rounded-full transition-colors focus-ring',
              type === 'expense' ? 'bg-danger/10 text-danger font-semibold' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            A pagar
          </button>
          <button
            type="button"
            onClick={() => switchType('income')}
            className={[
              'h-9 rounded-full transition-colors focus-ring',
              type === 'income' ? 'bg-success/10 text-success font-semibold' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            A receber
          </button>
        </div>

        <Field label="Nome">
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aluguel, Netflix, Salário…"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
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

        {/* Segmented Tipo de conta */}
        <div className="grid grid-cols-2 rounded-full bg-bg-elevated p-1 text-body-sm">
          <button
            type="button"
            onClick={() => setRecurrence('monthly')}
            className={['h-9 rounded-full transition-colors focus-ring', recurrence === 'monthly' ? 'bg-tom text-black font-semibold' : 'text-fg-muted hover:text-fg'].join(' ')}
          >
            Recorrente
          </button>
          <button
            type="button"
            onClick={() => setRecurrence('once')}
            className={['h-9 rounded-full transition-colors focus-ring', recurrence === 'once' ? 'bg-tom text-black font-semibold' : 'text-fg-muted hover:text-fg'].join(' ')}
          >
            Única
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          {recurrence === 'monthly' ? (
            <Field label="Vence dia" sub="Dia do mês (1–31).">
              <CustomSelect value={dueDay} options={DAY_OPTIONS} onChange={setDueDay} />
            </Field>
          ) : (
            <Field label="Vencimento">
              <DateInput value={dueDate} onChange={setDueDate} />
            </Field>
          )}
          <Field label="Categoria">
            <CustomSelect value={category} options={categoryOptions} onChange={(v) => setCategory(v as PfCategory)} />
          </Field>
        </div>

        {error && <p className="text-body-sm text-danger">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-2">
          {isEdit ? (
            <Button variant="danger" size="sm" onClick={remove} disabled={submitting}>
              Excluir
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
            {!isEdit && (
              <Button variant="primary" onClick={submit} disabled={submitting || !name.trim() || !amountText.trim() || dueDateMissing}>
                {submitting ? 'Salvando…' : 'Cadastrar conta'}
              </Button>
            )}
            {isEdit && (
              <Button variant="primary" onClick={save} disabled={submitting || !name.trim() || !amountText.trim() || dueDateMissing}>
                {submitting ? 'Salvando…' : 'Salvar'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
