import { useMemo, useState } from 'react';
import { Field } from '../../../components/Field';
import { ANNUAL_RATE_ESTIMATE_PCT, MONTHLY_RATE_ESTIMATE, futureValue } from '../../../lib/finance-utils';

function brl(n: number) {
  return Math.round(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

export function CompoundInterestSimulator() {
  const [monthlyText, setMonthlyText] = useState('300');
  const [yearsText, setYearsText] = useState('10');

  const out = useMemo(() => {
    const monthly = Number(monthlyText.replace(',', '.'));
    const years = Number(yearsText.replace(',', '.'));
    if (!isFinite(monthly) || monthly <= 0 || !isFinite(years) || years <= 0) return null;
    const months = Math.round(years * 12);
    const semJuros = monthly * months;
    const comJuros = futureValue(monthly, MONTHLY_RATE_ESTIMATE, months);
    return { monthly, years, semJuros, comJuros, ganho: comJuros - semJuros };
  }, [monthlyText, yearsText]);

  return (
    <div className="rounded-lg border border-border bg-bg-surface p-md">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-label text-fg-muted uppercase tracking-wide">Simulador de juros</h3>
        <span className="text-body-sm text-fg-muted">{`estimativa ~${ANNUAL_RATE_ESTIMATE_PCT.toString().replace('.', ',')}%/ano`}</span>
      </div>

      <div className="grid grid-cols-2 gap-md">
        <Field label="Guardar por mês">
          <div className="flex items-baseline gap-2">
            <span className="text-fg-muted text-body-sm">R$</span>
            <input
              inputMode="decimal"
              value={monthlyText}
              onChange={(e) => setMonthlyText(e.target.value)}
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom tabular-nums"
              aria-label="Valor mensal"
            />
          </div>
        </Field>
        <Field label="Por quantos anos">
          <input
            inputMode="decimal"
            value={yearsText}
            onChange={(e) => setYearsText(e.target.value)}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom tabular-nums"
            aria-label="Prazo em anos"
          />
        </Field>
      </div>

      {out && (
        <div className="mt-md grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="rounded-md border border-border bg-bg-elevated px-3 py-2">
            <div className="text-label text-fg-muted uppercase tracking-wide">Só guardando</div>
            <div className="text-body-lg font-bold tabular-nums text-fg">R$ {brl(out.semJuros)}</div>
          </div>
          <div className="rounded-md border border-tom/40 bg-tom/5 px-3 py-2">
            <div className="text-label text-tom uppercase tracking-wide">Investindo</div>
            <div className="text-body-lg font-bold tabular-nums text-tom">R$ {brl(out.comJuros)}</div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated px-3 py-2">
            <div className="text-label text-fg-muted uppercase tracking-wide">Diferença</div>
            <div className="text-body-lg font-bold tabular-nums text-success">+R$ {brl(out.ganho)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
