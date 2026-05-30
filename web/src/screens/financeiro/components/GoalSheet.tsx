import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useCreateGoal } from '../../../hooks/useFinanceiro';

const ICON_OPTIONS = ['🎯','🚗','🏠','✈️','🎓','💍','🧱','💻','🛒','🌱'];

export function GoalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createMut = useCreateGoal();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🎯');
  const [targetText, setTargetText] = useState('');
  const [monthlyText, setMonthlyText] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(''); setIcon('🎯'); setTargetText(''); setMonthlyText(''); setDeadline(''); setError(null);
  }, [open]);

  async function submit() {
    setError(null);
    const target = Number(targetText.replace(',', '.'));
    const monthly = monthlyText.trim() ? Number(monthlyText.replace(',', '.')) : null;
    if (!name.trim()) return setError('Dá um nome pro sonho.');
    if (!isFinite(target) || target <= 0) return setError('Valor da meta precisa ser maior que zero.');
    if (monthly != null && (!isFinite(monthly) || monthly < 0)) return setError('Valor mensal inválido.');
    try {
      await createMut.mutateAsync({
        name: name.trim(),
        target_amount: target,
        monthly_contribution: monthly,
        deadline: deadline || null,
        icon,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const submitting = createMut.isPending;

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Nova meta" size="sm">
      <div className="flex flex-col gap-md p-md">
        <Field label="O que você quer conquistar?">
          <div className="flex items-center gap-2">
            <span className="text-2xl shrink-0" aria-hidden>{icon}</span>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Carro, viagem, casa…"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
            />
          </div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {ICON_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIcon(emoji)}
                aria-label={`Usar ícone ${emoji}`}
                className={[
                  'h-8 w-8 rounded-full flex items-center justify-center text-lg transition-colors focus-ring',
                  icon === emoji ? 'bg-tom/15 ring-2 ring-tom' : 'bg-bg-elevated hover:bg-bg-surface',
                ].join(' ')}
              >
                {emoji}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Quanto vai custar?">
          <div className="flex items-baseline gap-2">
            <span className="text-fg-muted text-body-md">R$</span>
            <input
              inputMode="decimal"
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder="0,00"
              className="w-full bg-transparent border-0 border-b border-border focus:border-tom outline-none text-[24px] font-bold tabular-nums py-1 text-fg placeholder:text-fg-muted/40"
            />
          </div>
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field label="Guardar por mês" sub="Opcional. Ajuda o TOM a te lembrar.">
            <div className="flex items-baseline gap-2">
              <span className="text-fg-muted text-body-sm">R$</span>
              <input
                inputMode="decimal"
                value={monthlyText}
                onChange={(e) => setMonthlyText(e.target.value)}
                placeholder="0,00"
                className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom tabular-nums"
              />
            </div>
          </Field>
          <Field label="Prazo" sub="Opcional. Quando você quer chegar lá.">
            <DateInput value={deadline} onChange={setDeadline} />
          </Field>
        </div>

        {error && <p className="text-body-sm text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={submitting || !name.trim() || !targetText.trim()}>
            {submitting ? 'Criando…' : 'Criar meta'}
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
