// Sheet de pagamento de fatura de cartão (parcial/total + conta de origem).
// Extraído de CartaoDetalhePage pra ser reusado na tela Contas a pagar (seção "Faturas de cartão").
import { useState } from 'react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { Button } from '../../../components/Button';
import { useCards, useCardInvoice, useAccounts, usePayInvoice } from '../../../hooks/useFinanceiro';
import { currentCompetencia, mesDaCompetencia } from '../../../lib/cartoes';

const fmtBRL = (v: number) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PagarFaturaSheet({ open, onClose, cardId, competencia }: { open: boolean; onClose: () => void; cardId: string; competencia?: string }) {
  const cardsQ = useCards();
  const card = cardsQ.data?.find((c) => c.id === cardId);
  const comp = competencia ?? (card ? currentCompetencia(card) : undefined);
  const inv = useCardInvoice(cardId, comp);
  const accountsQ = useAccounts();
  const payMut = usePayInvoice();
  const [amount, setAmount] = useState('');
  const [fromAcc, setFromAcc] = useState('');

  const remaining = inv.data?.remaining ?? 0;
  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';

  async function submit() {
    if (!card || !comp) return;
    const value = Number(amount) > 0 ? Number(amount) : remaining;
    if (value <= 0) return;
    await payMut.mutateAsync({ card, competencia: comp, amount: value, paid_from_account: fromAcc || null });
    setAmount(''); setFromAcc('');
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`Pagar fatura de ${mesDaCompetencia(comp ?? '')}`}>
      <div className="flex flex-col gap-md">
        <p className="text-fg-muted text-body-sm">Fatura atual: <b className="text-fg">{fmtBRL(inv.data?.total ?? 0)}</b> · falta <b className="text-fg">{fmtBRL(remaining)}</b></p>
        <Field label="Valor a pagar" sub="Vazio = paga a fatura toda">
          <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={fmtBRL(remaining)} />
        </Field>
        <Field label="Sai de qual carteira?">
          <CustomSelect
            value={fromAcc}
            options={(accountsQ.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
            onChange={setFromAcc}
            placeholder="Selecione a conta"
          />
        </Field>
        <Button variant="primary" fullWidth loading={payMut.isPending} onClick={submit}>
          Registrar pagamento
        </Button>
      </div>
    </BottomSheet>
  );
}
