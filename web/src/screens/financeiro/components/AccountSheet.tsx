import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { Field } from '../../../components/Field';
import { useCreateAccount, useCreateTransaction, useDeactivateAccount, useUpdateAccount } from '../../../hooks/useFinanceiro';
import { BANKS } from '../../../lib/banks';
import type { PfAccount, PfAccountType } from '../../../lib/financeiro';
import { BankLogo } from './BankLogo';

const TYPE_OPTIONS: { value: PfAccountType; label: string }[] = [
  { value: 'checking',   label: '🏦  Conta corrente' },
  { value: 'savings',    label: '🐷  Poupança / Caixinha' },
  { value: 'wallet',     label: '💵  Carteira / Vale / Cash' },
  { value: 'investment', label: '📈  Investimento' },
];
const ICON_OPTIONS = ['🏦','🐷','💵','📈','💳','💰','🪙','🤑'];
const COLOR_PALETTE = ['#820ad1','#ec7000','#ec0000','#2dbe7e','#5b8def','#e7c14b','#e06b8b'];

export function AccountSheet({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: PfAccount;
}) {
  const isEdit = !!initial;
  const createMut = useCreateAccount();
  const updateMut = useUpdateAccount();
  const deactivateMut = useDeactivateAccount();
  const createTx = useCreateTransaction();

  const [name, setName] = useState('');
  const [type, setType] = useState<PfAccountType>('checking');
  const [icon, setIcon] = useState('🏦');
  const [bankSlug, setBankSlug] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [goalText, setGoalText] = useState('');
  const [saldoText, setSaldoText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setType(initial.type);
      setIcon(initial.icon ?? '🏦');
      setBankSlug(initial.bank_slug ?? null);
      setColor(initial.color ?? null);
      setGoalText(initial.goal_monthly != null ? String(initial.goal_monthly) : '');
      setSaldoText(String(initial.balance ?? 0));
    } else {
      setName('');
      setType('checking');
      setIcon('🏦');
      setBankSlug(null);
      setColor(null);
      setGoalText('');
      setSaldoText('');
    }
    setError(null);
  }, [open, initial]);

  async function ajustarSaldo(accountId: string, alvoText: string, currentBalance: number, isCreate: boolean) {
    const alvo = Number(String(alvoText).replace(',', '.'));
    if (!isFinite(alvo)) return;
    const delta = Math.round((alvo - currentBalance) * 100) / 100;
    if (delta === 0) return;
    await createTx.mutateAsync({
      type: delta > 0 ? 'income' : 'expense',
      category: 'outros',
      amount: Math.abs(delta),
      description: isCreate ? 'Saldo inicial' : 'Ajuste de saldo',
      transaction_date: new Date().toISOString().slice(0, 10),
      account_id: accountId,
      is_adjustment: true,
    });
  }

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('Dá um nome pra carteira.');
    try {
      const created: any = await createMut.mutateAsync({
        name: name.trim(),
        type,
        icon,
        bank_slug: bankSlug,
        color,
        goal_monthly: goalText.trim() ? Number(goalText.replace(',', '.')) : null,
      });
      if (saldoText.trim()) {
        const alvo = Number(String(saldoText).replace(',', '.'));
        if (isFinite(alvo) && alvo !== 0) {
          await ajustarSaldo(created.id, saldoText, 0, true);
        }
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!initial) return;
    setError(null);
    if (!name.trim()) return setError('Dá um nome pra carteira.');
    try {
      await updateMut.mutateAsync({
        id: initial.id,
        patch: {
          name: name.trim(),
          type,
          icon,
          bank_slug: bankSlug,
          color,
          goal_monthly: goalText.trim() ? Number(goalText.replace(',', '.')) : null,
        },
      });
      await ajustarSaldo(initial.id, saldoText, Number(initial.balance), false);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deactivate() {
    if (!initial) return;
    const saldo = Number(initial.balance);
    const aviso = Math.abs(saldo) > 0.005
      ? `Atenção: a carteira "${initial.name}" tem saldo de R$ ${saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.\n\nAo arquivar, ela some da lista, mas o saldo NÃO é zerado — fica guardado e volta se você reativar. Se você paga faturas/contas com essa carteira, estornos voltarão pra ela mesmo arquivada.\n\nArquivar mesmo assim?`
      : `Desativar a carteira "${initial.name}"? Ela some da lista mas o histórico fica.`;
    if (!confirm(aviso)) return;
    try {
      await deactivateMut.mutateAsync(initial.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const submitting = createMut.isPending || updateMut.isPending || deactivateMut.isPending || createTx.isPending;
  const bankSlugs = Object.keys(BANKS);

  return (
    <AdaptiveSheet
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar carteira' : 'Nova carteira'}
      size="sm"
    >
      <div className="flex flex-col gap-md p-md">

        {/* Nome + emoji picker */}
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

        {/* Tipo */}
        <Field label="Tipo">
          <CustomSelect value={type} options={TYPE_OPTIONS} onChange={(v) => setType(v as PfAccountType)} />
        </Field>

        {/* Seletor de banco */}
        <Field label="Banco">
          <div className="flex flex-wrap gap-2">
            {bankSlugs.map((slug) => (
              <button
                key={slug}
                type="button"
                title={BANKS[slug].name}
                onClick={() => { setBankSlug(slug); setColor(BANKS[slug].color); }}
                className={[
                  'rounded-xl transition-all focus-ring',
                  bankSlug === slug ? 'ring-2 ring-tom' : 'opacity-70 hover:opacity-100',
                ].join(' ')}
              >
                <BankLogo slug={slug} name={BANKS[slug].name} size={40} />
              </button>
            ))}
            {/* Botão "Outro" */}
            <button
              type="button"
              title="Outro"
              onClick={() => setBankSlug(null)}
              className={[
                'h-10 w-10 rounded-xl flex items-center justify-center text-xl bg-bg-elevated transition-all focus-ring',
                bankSlug === null ? 'ring-2 ring-tom' : 'opacity-70 hover:opacity-100',
              ].join(' ')}
            >
              💵
            </button>
          </div>
        </Field>

        {/* Paleta de cor */}
        <Field label="Cor">
          <div className="flex gap-2 flex-wrap">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                onClick={() => setColor(c)}
                className={[
                  'h-7 w-7 rounded-full transition-all focus-ring',
                  color === c ? 'ring-2 ring-offset-2 ring-tom scale-110' : 'opacity-80 hover:opacity-100',
                ].join(' ')}
                style={{ background: c }}
              />
            ))}
            {/* cor atual do banco se não estiver na paleta */}
            {color && !COLOR_PALETTE.includes(color) && (
              <button
                type="button"
                aria-label={`Cor atual ${color}`}
                onClick={() => setColor(color)}
                className="h-7 w-7 rounded-full ring-2 ring-tom scale-110 focus-ring"
                style={{ background: color }}
              />
            )}
          </div>
        </Field>

        {/* Saldo atual */}
        <Field
          label="Saldo atual"
          sub={isEdit ? 'Mudar aqui cria um lançamento de ajuste no extrato.' : 'Quanto você já tem nessa conta hoje. Opcional.'}
        >
          <div className="flex items-baseline gap-1 border-b border-border">
            <span className="text-fg-muted">R$</span>
            <input
              inputMode="decimal"
              value={saldoText}
              onChange={(e) => setSaldoText(e.target.value)}
              placeholder="0,00"
              className="w-full bg-transparent text-[24px] font-bold tabular-nums text-fg focus:outline-none"
            />
          </div>
        </Field>

        {/* Meta mensal */}
        <Field label="Meta de guardar/mês" sub="Opcional.">
          <div className="flex items-baseline gap-2">
            <span className="text-fg-muted text-body-md">R$</span>
            <input
              inputMode="decimal"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              placeholder="0,00"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
            />
          </div>
        </Field>

        {error && <p className="text-body-sm text-danger">{error}</p>}

        {/* Footer — espelha TransactionSheet */}
        <div className="flex items-center justify-between gap-2 pt-2">
          {isEdit ? (
            <Button variant="danger" size="sm" onClick={deactivate} disabled={submitting}>
              Desativar
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
            {isEdit ? (
              <Button variant="primary" onClick={save} disabled={submitting || !name.trim()}>
                {submitting ? 'Salvando…' : 'Salvar'}
              </Button>
            ) : (
              <Button variant="primary" onClick={submit} disabled={submitting || !name.trim()}>
                {submitting ? 'Salvando…' : 'Criar carteira'}
              </Button>
            )}
          </div>
        </div>

      </div>
    </AdaptiveSheet>
  );
}
