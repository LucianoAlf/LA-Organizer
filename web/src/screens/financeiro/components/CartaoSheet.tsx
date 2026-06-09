// Sheet de cadastro/edição de cartão. card? presente → modo edição (pré-preenche + updateCard).
import { useEffect, useState } from 'react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { Button } from '../../../components/Button';
import { useCreateCard, useUpdateCard } from '../../../hooks/useFinanceiro';
import type { PfCard } from '../../../lib/cartoes';

export const BRANDS = [
  { value: 'roxo', label: 'Nubank (roxo)', color: '#820ad1' },
  { value: 'visa', label: 'Visa (azul)', color: '#1a1f71' },
  { value: 'master', label: 'Mastercard (laranja)', color: '#eb5b1e' },
  { value: 'elo', label: 'Elo (preto)', color: '#1c1c1c' },
  { value: 'amex', label: 'Amex (verde)', color: '#2e7d32' },
  { value: 'outro', label: 'Outro', color: '#3f3f46' },
];

export function CartaoSheet({ open, onClose, card }: { open: boolean; onClose: () => void; card?: PfCard }) {
  const createMut = useCreateCard();
  const updateMut = useUpdateCard();
  const isEdit = !!card;
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('roxo');
  const [limit, setLimit] = useState('');
  const [closing, setClosing] = useState('');
  const [due, setDue] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(card?.name ?? '');
    setBrand(card?.brand ?? 'roxo');
    setLimit(card ? String(card.credit_limit) : '');
    setClosing(card ? String(card.closing_day) : '');
    setDue(card ? String(card.due_day) : '');
  }, [open, card]);

  const valid = !!name.trim() && Number(limit) > 0 &&
    Number(closing) >= 1 && Number(closing) <= 31 && Number(due) >= 1 && Number(due) <= 31;

  async function submit() {
    if (!valid) return;
    const b = BRANDS.find((x) => x.value === brand);
    const data = {
      name: name.trim(), brand, color: b?.color ?? null,
      credit_limit: Number(limit), closing_day: Number(closing), due_day: Number(due),
    };
    if (isEdit && card) await updateMut.mutateAsync({ id: card.id, patch: data });
    else await createMut.mutateAsync(data);
    onClose();
  }

  const busy = createMut.isPending || updateMut.isPending;
  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';
  return (
    <BottomSheet open={open} onClose={onClose} title={isEdit ? 'Editar cartão' : 'Novo cartão'}>
      <div className="flex flex-col gap-md">
        <Field label="Nome do cartão">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Nubank" />
        </Field>
        <Field label="Bandeira / cor">
          <CustomSelect value={brand} options={BRANDS.map((b) => ({ value: b.value, label: b.label }))} onChange={setBrand} />
        </Field>
        <Field label="Limite (R$)">
          <input className={inputCls} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="5000" />
        </Field>
        <div className="grid grid-cols-2 gap-md">
          <Field label="Dia de fechamento">
            <input className={inputCls} inputMode="numeric" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="6" />
          </Field>
          <Field label="Dia de vencimento">
            <input className={inputCls} inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value)} placeholder="10" />
          </Field>
        </div>
        <Button variant="primary" fullWidth loading={busy} onClick={submit} disabled={!valid}>
          {isEdit ? 'Salvar' : 'Cadastrar cartão'}
        </Button>
      </div>
    </BottomSheet>
  );
}
