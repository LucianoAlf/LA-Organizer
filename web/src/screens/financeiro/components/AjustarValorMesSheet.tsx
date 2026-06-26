// Sheet de ajuste do valor PREVISTO de uma conta fixa para UM mês específico (override mensal).
// NÃO altera o valor-base da conta (isso é o BillSheet) — só o mês exibido. "Voltar ao padrão"
// remove o override (a conta volta ao valor base naquele mês).
import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { useSetBillOverride, useDeleteBillOverride } from '../../../hooks/useFinanceiro';

const fmtBRL = (v: number) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AjustarValorMesSheet({ open, onClose, bill, baseAmount, currentOverride, competencia, mesLabel }: {
  open: boolean;
  onClose: () => void;
  bill: { id: string; name: string } | null;
  baseAmount: number;
  currentOverride: number | null;
  competencia: string;
  mesLabel: string;
}) {
  const setMut = useSetBillOverride();
  const delMut = useDeleteBillOverride();
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bill) return;
    setAmountText(String(currentOverride ?? baseAmount));
    setError(null);
  }, [open, bill, currentOverride, baseAmount]);

  if (!bill) return null;

  const amount = Number(amountText.replace(',', '.'));
  const busy = setMut.isPending || delMut.isPending;

  async function salvar() {
    if (!bill) return;
    setError(null);
    if (!isFinite(amount) || amount <= 0) { setError('Informe um valor maior que zero.'); return; }
    try {
      await setMut.mutateAsync({ billId: bill.id, competencia, amount });
      onClose();
    } catch (e) { setError((e as Error).message); }
  }
  async function voltarAoPadrao() {
    if (!bill) return;
    setError(null);
    try {
      await delMut.mutateAsync({ billId: bill.id, competencia });
      onClose();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title={`Ajustar · ${bill.name}`} size="sm">
      <div className="flex flex-col gap-md p-md">
        <p className="text-body-sm text-fg-muted -mb-1">
          Valor previsto só para <span className="text-fg font-semibold">{mesLabel}</span>. Os outros meses seguem no padrão.
        </p>
        <Field label={`Valor previsto · ${mesLabel}`}>
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
        <p className="text-body-sm text-fg-muted -mt-2">
          valor padrão da conta: {fmtBRL(baseAmount)}
          {currentOverride != null && <> · ajuste atual: {fmtBRL(currentOverride)}</>}
        </p>

        {error && <p className="text-body-sm text-danger">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-2">
          <div>
            {currentOverride != null && (
              <Button variant="ghost" onClick={voltarAoPadrao} disabled={busy}>
                {delMut.isPending ? 'Removendo…' : 'Voltar ao padrão'}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button variant="primary" onClick={salvar} disabled={busy || !amountText.trim()}>
              {setMut.isPending ? 'Salvando…' : 'Salvar ajuste'}
            </Button>
          </div>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
