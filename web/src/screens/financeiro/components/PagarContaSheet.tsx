// Sheet de pagamento de conta fixa: valor real (default = previsto) + meio de pagamento
// (carteira/cartão/nenhum) + data. Não altera o valor previsto da conta.
import { useEffect, useMemo, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { ComboBox } from '../../../components/ComboBox';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useAccounts, useBillOverrides, useCards, usePayBill } from '../../../hooks/useFinanceiro';
import { parsePayMethod } from '../../../lib/payMethod';
import { resolveBillAmount, type PfBill } from '../../../lib/financeiro';

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtBRL = (v: number) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PagarContaSheet({ open, onClose, bill }: { open: boolean; onClose: () => void; bill: PfBill | null }) {
  const accountsQ = useAccounts();
  const cardsQ = useCards();
  const payMut = usePayBill();
  // Override de valor do MÊS CORRENTE (feature override mensal): vira o valor sugerido no pagamento.
  const compCorrente = todayYmd().slice(0, 7) + '-01';
  const overridesQ = useBillOverrides(compCorrente);
  const override = bill ? overridesQ.data?.[bill.id] : undefined;
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState('none');
  const [date, setDate] = useState(todayYmd());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bill) return;
    setAmountText(String(resolveBillAmount(bill, override))); // previsto do mês: override > base
    setMethod('none');
    setDate(todayYmd());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bill, override]);

  const methodOptions = useMemo(() => {
    const accounts = accountsQ.data ?? [];
    const cards = bill?.type !== 'income' ? (cardsQ.data ?? []) : [];
    const cardNames = new Set(cards.map((c) => c.name.toLowerCase()));
    const acctNames = new Set(accounts.map((a) => a.name.toLowerCase()));
    const collision = (name: string) => cardNames.has(name.toLowerCase()) && acctNames.has(name.toLowerCase());
    return [
      { value: 'none', label: 'Só registrar (sem carteira)' },
      ...accounts.map((a) => ({
        value: `acc:${a.id}`,
        label: `🏦  ${a.name}${collision(a.name) ? ' — conta' : ''}`,
      })),
      ...cards.map((c) => ({
        value: `card:${c.id}`,
        label: `💳  ${c.name}${collision(c.name) ? ' — cartão' : ''}`,
      })),
    ];
  }, [accountsQ.data, cardsQ.data, bill?.type]);

  if (!bill) return null;

  const amount = Number(amountText.replace(',', '.'));
  const previsto = resolveBillAmount(bill, override);
  const variou = isFinite(amount) && Math.round(amount * 100) !== Math.round(previsto * 100);

  async function submit() {
    if (!bill) return;
    setError(null);
    if (!isFinite(amount) || amount <= 0) { setError('Informe um valor maior que zero.'); return; }
    const m = parsePayMethod(method);
    const card = m.kind === 'card' ? (cardsQ.data ?? []).find((c) => c.id === m.id) : undefined;
    try {
      await payMut.mutateAsync({
        bill,
        amount,
        account_id: m.kind === 'account' ? m.id : null,
        card: card ? { id: card.id, closing_day: card.closing_day } : null,
        date,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const isIncome = bill.type === 'income';

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={isIncome ? `Receber ${bill.name}` : `Pagar ${bill.name}`} size="sm">
      <div className="flex flex-col gap-md p-md">
        <Field label={isIncome ? 'Valor recebido' : 'Valor pago'}>
          <div className="flex items-baseline gap-2">
            <span className="text-fg-muted text-body-md">R$</span>
            <input
              inputMode="decimal"
              autoFocus
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0,00"
              className="w-full bg-transparent border-0 border-b border-border focus:border-tom outline-none text-[28px] font-black tabular-nums py-1 text-fg placeholder:text-fg-muted/40"
            />
          </div>
        </Field>
        {variou && (
          <p className="text-body-sm text-fg-muted -mt-2">previu {fmtBRL(previsto)} · paga {fmtBRL(amount)}</p>
        )}

        <Field label={isIncome ? 'Recebido em' : 'Pago com'}>
          <ComboBox value={method} options={methodOptions} onChange={setMethod} placeholder="Buscar carteira/cartão…" />
        </Field>

        <Field label="Data">
          <DateInput value={date} onChange={setDate} />
        </Field>

        {error && <p className="text-body-sm text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={payMut.isPending}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={payMut.isPending || !amountText.trim()}>
            {payMut.isPending ? (isIncome ? 'Registrando…' : 'Pagando…') : (isIncome ? 'Confirmar recebimento' : 'Confirmar pagamento')}
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
