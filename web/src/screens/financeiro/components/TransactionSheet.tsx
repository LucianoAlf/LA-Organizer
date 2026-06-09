import { useEffect, useMemo, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { ComboBox } from '../../../components/ComboBox';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useAccounts, useCategories, useCreateTransaction, useDeleteTransaction, useUpdateTransaction, useCreateCategory } from '../../../hooks/useFinanceiro';
import type { PfCategory, PfTransaction, PfTxType } from '../../../lib/financeiro';

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export interface TransactionSheetProps {
  open: boolean;
  onClose: () => void;
  initial?: PfTransaction;     // se presente, modo edição (editar campos + apagar)
}

export function TransactionSheet({ open, onClose, initial }: TransactionSheetProps) {
  const isEdit = !!initial;
  const accountsQ = useAccounts();
  const createMut = useCreateTransaction();
  const deleteMut = useDeleteTransaction();
  const updateMut = useUpdateTransaction();
  const createCategory = useCreateCategory();
  const isCardTxn = !!initial?.card_id; // compra de cartão: valor/parcelas não editáveis aqui
  const catsQ = useCategories();
  const allCats = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  const expenseCats = useMemo(() => allCats.filter((c) => c.type === 'expense').map((c) => ({ value: c.slug, label: `${c.emoji}  ${c.label}` })), [allCats]);
  const incomeCats = useMemo(() => allCats.filter((c) => c.type === 'income').map((c) => ({ value: c.slug, label: `${c.emoji}  ${c.label}` })), [allCats]);

  const [type, setType] = useState<PfTxType>(initial?.type ?? 'expense');
  const [category, setCategory] = useState<PfCategory>(initial?.category ?? 'alimentacao');
  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(initial?.transaction_date ?? todayYmd());
  const [accountId, setAccountId] = useState<string>(initial?.account_id ?? '');
  const [error, setError] = useState<string | null>(null);

  // Reset quando reabre — `initial` ou `open` muda.
  useEffect(() => {
    if (!open) return;
    setType(initial?.type ?? 'expense');
    setCategory(initial?.category ?? (type === 'expense' ? 'alimentacao' : 'salario'));
    setAmountText(initial ? String(initial.amount) : '');
    setDescription(initial?.description ?? '');
    setDate(initial?.transaction_date ?? todayYmd());
    setAccountId(initial?.account_id ?? '');
    setError(null);
    // intentionally not depending on `type` — only on open/initial
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  // Ajusta a categoria quando troca o tipo (se a categoria atual não bate).
  function switchType(next: PfTxType) {
    setType(next);
    const list = next === 'expense' ? expenseCats : incomeCats;
    if (list.length && !list.find((o) => o.value === category)) setCategory(list[0].value);
  }

  async function submit() {
    setError(null);
    const amount = Number(amountText.replace(',', '.'));
    if (!isFinite(amount) || amount <= 0) {
      setError('Informe um valor maior que zero.');
      return;
    }
    try {
      await createMut.mutateAsync({
        type, category, amount,
        description: description.trim() || null,
        transaction_date: date,
        account_id: accountId || null,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!initial) return;
    setError(null);
    const amount = Number(amountText.replace(',', '.'));
    if (!isFinite(amount) || amount <= 0) { setError('Informe um valor maior que zero.'); return; }
    try {
      await updateMut.mutateAsync({
        id: initial.id,
        patch: {
          type, category, amount: isCardTxn ? undefined : amount,
          description: description.trim() || null,
          transaction_date: date,
          account_id: isCardTxn ? undefined : (accountId || null),
        },
      });
      onClose();
    } catch (e) { setError((e as Error).message); }
  }

  async function remove() {
    if (!initial) return;
    if (!confirm(`Apagar transação "${initial.description ?? initial.category}"?`)) return;
    try {
      await deleteMut.mutateAsync(initial.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const categoryOptions = type === 'expense' ? expenseCats : incomeCats;
  const accountOptions = [
    { value: '', label: '— sem carteira —' },
    ...(accountsQ.data ?? []).map((a) => ({ value: a.id, label: `${a.icon ?? '🏦'}  ${a.name}` })),
  ];
  const submitting = createMut.isPending || deleteMut.isPending || updateMut.isPending;

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={isEdit ? 'Transação' : 'Nova transação'} size="sm">
      <div className="flex flex-col gap-md p-md">
        {/* Toggle income/expense — pill segmentado */}
        <div className="grid grid-cols-2 rounded-full bg-bg-elevated p-1 text-body-sm">
          <button
            type="button"
            onClick={() => switchType('expense')}
            className={[
              'h-9 rounded-full transition-colors focus-ring',
              type === 'expense' ? 'bg-danger/10 text-danger font-semibold' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            − Despesa
          </button>
          <button
            type="button"
            onClick={() => switchType('income')}
            className={[
              'h-9 rounded-full transition-colors focus-ring',
              type === 'income' ? 'bg-success/10 text-success font-semibold' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            + Receita
          </button>
        </div>

        <Field label="Valor">
          <div className="flex items-baseline gap-2">
            <span className="text-fg-muted text-body-md">R$</span>
            <input
              inputMode="decimal"
              autoFocus
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0,00"
              disabled={isCardTxn}
              className="w-full bg-transparent border-0 border-b border-border focus:border-tom outline-none text-[28px] font-black tabular-nums py-1 text-fg placeholder:text-fg-muted/40 disabled:opacity-50"
            />
          </div>
        </Field>
        {isCardTxn && (
          <p className="text-body-sm text-fg-muted">Compra de cartão: pra mudar valor/parcelas, apague e relance. Aqui dá pra ajustar categoria, descrição e data.</p>
        )}

        <Field label="Categoria">
          <ComboBox
            value={category}
            options={categoryOptions}
            onChange={(v) => setCategory(v as PfCategory)}
            placeholder="Buscar ou criar…"
            onCreate={async (text) => {
              const r = await createCategory.mutateAsync({ label: text, emoji: '🏷️', type });
              return (r as { slug: string }).slug;
            }}
          />
        </Field>

        <Field label="Descrição" sub="Opcional. Ex.: iFood, Mercado.">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O quê foi?"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field label="Data">
            <DateInput value={date} onChange={setDate} />
          </Field>
          {accountsQ.data && accountsQ.data.length > 0 && (
            <Field label="Carteira" sub="Opcional. Vincular pra atualizar o saldo dela.">
              <ComboBox value={accountId} options={accountOptions} onChange={setAccountId} placeholder="Buscar carteira…" />
            </Field>
          )}
        </div>

        {error && <p className="text-body-sm text-danger">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-2">
          {isEdit ? (
            <Button variant="danger" size="sm" onClick={remove} disabled={submitting}>
              Apagar
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
            {!isEdit && (
              <Button variant="primary" onClick={submit} disabled={submitting || !amountText.trim()}>
                {submitting ? 'Salvando…' : 'Registrar'}
              </Button>
            )}
            {isEdit && (
              <Button variant="primary" onClick={save} disabled={submitting || !amountText.trim()}>
                {submitting ? 'Salvando…' : 'Salvar'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
