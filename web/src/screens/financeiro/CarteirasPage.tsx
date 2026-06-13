import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Fab } from '../../components/Fab';
import { useAccounts, useDeactivateAccount, useSetPrimaryAccount, useFinanceiroAuth } from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import type { PfAccount, PfAccountType } from '../../lib/financeiro';
import { AccountSheet } from './components/AccountSheet';
import { BankLogo } from './components/BankLogo';
import { BANKS } from '../../lib/banks';

const TYPE_LABEL: Record<PfAccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  wallet: 'Carteira',
  investment: 'Investimento',
};

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function AccountCard({ account, onDeactivate, onSetPrimary, primaryPending, onOpen }: { account: PfAccount; onDeactivate: (a: PfAccount) => void; onSetPrimary: (a: PfAccount) => void; primaryPending: boolean; onOpen: (id: string) => void }) {
  const balance = Number(account.balance);
  const tone = balance < 0 ? 'text-danger' : balance > 0 ? 'text-tom' : 'text-fg';
  const borderColor = account.color || (account.bank_slug ? BANKS[account.bank_slug]?.color : '') || '#16a34a';
  return (
    <article
      className="rounded-lg border border-border bg-bg-surface p-md flex flex-col gap-2 cursor-pointer"
      style={{ borderLeft: `4px solid ${borderColor}` }}
      onClick={() => onOpen(account.id)}
    >
      <header className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0" aria-hidden>
            <BankLogo slug={account.bank_slug} name={account.name} color={account.color} size={40} />
          </span>
          <div className="min-w-0">
            <div className="text-body-md font-semibold text-fg truncate">{account.name}</div>
            <div className="text-body-sm text-fg-muted">{TYPE_LABEL[account.type]}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSetPrimary(account); }}
          disabled={primaryPending || account.is_primary}
          aria-label={account.is_primary ? 'Conta principal' : 'Definir como principal'}
          title={account.is_primary ? 'Conta principal' : 'Definir como principal'}
          className="text-lg shrink-0 focus-ring rounded-full px-1"
        >
          {account.is_primary ? '⭐' : '☆'}
        </button>
      </header>

      <div className="border-t border-border pt-3 flex items-baseline justify-between">
        <span className="text-label text-fg-muted uppercase tracking-wide">Saldo</span>
        <span className={`text-body-lg font-bold tabular-nums ${tone}`}>
          {balance < 0 ? '−' : balance > 0 ? '+' : ''}R$ {brl(Math.abs(balance))}
        </span>
      </div>

      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onDeactivate(account); }}>Desativar</Button>
      </div>
    </article>
  );
}

export function CarteirasPage() {
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_accounts', 'pf_transactions', 'pf_transfers'], cid);
  const accountsQ = useAccounts();
  const deactivateMut = useDeactivateAccount();
  const setPrimaryMut = useSetPrimaryAccount();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  async function deactivate(account: PfAccount) {
    const saldo = Number(account.balance);
    const aviso = Math.abs(saldo) > 0.005
      ? `Atenção: a carteira "${account.name}" tem saldo de R$ ${saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.\n\nAo arquivar, ela some da lista, mas o saldo NÃO é zerado — fica guardado e volta se você reativar. Estornos de fatura voltarão pra ela mesmo arquivada.\n\nArquivar mesmo assim?`
      : `Desativar carteira "${account.name}"? Ela some da lista, mas as transações vinculadas seguem no histórico.`;
    if (!confirm(aviso)) return;
    try { await deactivateMut.mutateAsync(account.id); } catch (e) { alert((e as Error).message); }
  }

  const accounts = accountsQ.data ?? [];
  const empty = !accountsQ.isLoading && accounts.length === 0;
  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance), 0);

  return (
    <div className="flex flex-col gap-md pb-32 md:pb-md">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-section-title">Carteiras</h2>
        <button
          type="button"
          onClick={() => navigate('/financeiro')}
          className="text-body-sm text-fg-muted hover:text-fg focus-ring rounded"
        >
          ← Voltar
        </button>
      </header>

      {!empty && (
        <section className="rounded-lg border border-border bg-bg-surface px-md py-3 flex items-baseline justify-between tabular-nums">
          <div className="text-label text-fg-muted uppercase tracking-wide">Total</div>
          <div className={`text-body-lg font-bold ${totalBalance < 0 ? 'text-danger' : totalBalance > 0 ? 'text-tom' : 'text-fg'}`}>
            {totalBalance < 0 ? '−' : totalBalance > 0 ? '+' : ''}R$ {brl(Math.abs(totalBalance))}
          </div>
        </section>
      )}

      {empty && (
        <section className="rounded-lg border border-dashed border-border bg-bg-surface px-md py-lg text-center">
          <div className="text-[44px] leading-none mb-2" aria-hidden>🏦</div>
          <p className="text-body-md text-fg mb-1">Sem carteiras cadastradas.</p>
          <p className="text-body-sm text-fg-muted mb-md max-w-md mx-auto">
            Cria pelo + ou manda um zap pro TOM: <em>“cria carteira Nubank”</em>.
            Ao vincular transações a uma carteira, o saldo dela é atualizado automaticamente.
          </p>
        </section>
      )}

      {accounts.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-md">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} onDeactivate={deactivate} onSetPrimary={(acc) => setPrimaryMut.mutate(acc.id)} primaryPending={setPrimaryMut.isPending} onOpen={(id) => navigate('/financeiro/carteiras/' + id)} />
          ))}
        </section>
      )}

      <AccountSheet open={creating} onClose={() => setCreating(false)} />
      <Fab label="Nova carteira" ariaLabel="Criar carteira" onClick={() => setCreating(true)} />
    </div>
  );
}
