import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { Field } from '../../../components/Field';
import { useCreateAccount } from '../../../hooks/useFinanceiro';
import type { PfAccountType } from '../../../lib/financeiro';

const TYPE_OPTIONS: { value: PfAccountType; label: string }[] = [
  { value: 'checking',   label: '🏦  Conta corrente' },
  { value: 'savings',    label: '🐷  Poupança / Caixinha' },
  { value: 'wallet',     label: '💵  Carteira / Vale / Cash' },
  { value: 'investment', label: '📈  Investimento' },
];
const ICON_OPTIONS = ['🏦','🐷','💵','📈','💳','💰','🪙','🤑'];

export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createMut = useCreateAccount();
  const [name, setName] = useState('');
  const [type, setType] = useState<PfAccountType>('checking');
  const [icon, setIcon] = useState('🏦');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(''); setType('checking'); setIcon('🏦'); setError(null);
  }, [open]);

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('Dá um nome pra carteira.');
    try {
      await createMut.mutateAsync({ name: name.trim(), type, icon });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const submitting = createMut.isPending;

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Nova carteira" size="sm">
      <div className="flex flex-col gap-md p-md">
        <Field label="Nome">
          <div className="flex items-center gap-2">
            <span className="text-2xl shrink-0" aria-hidden>{icon}</span>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nubank, Vale, Caixinha…"
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

        <Field label="Tipo">
          <CustomSelect value={type} options={TYPE_OPTIONS} onChange={(v) => setType(v as PfAccountType)} />
        </Field>

        {error && <p className="text-body-sm text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? 'Salvando…' : 'Criar carteira'}
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
