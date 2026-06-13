// Detalhe da carteira ("entrar na carteira"): herói (logo/cor/saldo/meta),
// extrato de lançamentos e ações transferir / lançar aqui / editar / principal.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import {
  useAccounts, useAccountTransactions, useCategoryLookup, useFinanceiroAuth, useSetPrimaryAccount,
} from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import { BANKS } from '../../lib/banks';
import type { PfAccountType, PfTransaction } from '../../lib/financeiro';
import { AccountSheet } from './components/AccountSheet';
import { BankLogo } from './components/BankLogo';
import { LancamentoSheet } from './components/LancamentoSheet';
import { TransactionSheet } from './components/TransactionSheet';
import { TransferSheet } from './components/TransferSheet';

const fmtBRL = (v: number) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_LABEL: Record<PfAccountType, string> = {
  checking: 'Conta corrente', savings: 'Poupança', wallet: 'Carteira', investment: 'Investimento',
};

const PT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// YYYY-MM local (sem UTC shift no fim do mês após 21h BRT).
function localYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function CarteiraDetalhePage() {
  const { id = '' } = useParams();
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_accounts', 'pf_transactions', 'pf_transfers'], cid);

  const accountsQ = useAccounts();
  const acc = accountsQ.data?.find((a) => a.id === id);
  const [monthYear, setMonthYear] = useState(localYm());
  const txQ = useAccountTransactions(id, monthYear);
  const cat = useCategoryLookup();
  const setPrimary = useSetPrimaryAccount();

  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [lancarOpen, setLancarOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<PfTransaction | null>(null);

  if (!acc) {
    return (
      <div className="p-md md:max-w-3xl md:mx-auto">
        <Link to="/financeiro/carteiras" className="text-label text-fg-muted">← Carteiras</Link>
        <p className="text-fg-muted mt-4">{accountsQ.isLoading ? 'Carregando…' : 'Carteira não encontrada.'}</p>
      </div>
    );
  }

  const color = acc.color || (acc.bank_slug ? BANKS[acc.bank_slug]?.color : undefined) || '#2dbe7e';
  const balance = Number(acc.balance);

  const txs = txQ.data ?? [];
  // "Guardado no mês" = soma (receita − despesa) do mês selecionado (txs já vêm filtrados por mês).
  const savedThisMonth = txs.reduce((sum, t) => {
    if (t.is_adjustment) return sum; // acerto de caixa não conta
    return sum + (t.type === 'income' ? Number(t.amount) : -Number(t.amount));
  }, 0);
  const [my, mm] = monthYear.split('-').map(Number);
  const monthLabel = `${PT_MONTHS[mm - 1]} ${my}`;

  async function tornarPrincipal() {
    try {
      await setPrimary.mutateAsync(acc!.id);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-md pb-32 md:pb-md">
      <header className="flex items-center justify-between gap-3">
        <Link to="/financeiro/carteiras" className="text-label text-fg-muted">← Carteiras</Link>
        <div className="flex items-center gap-1">
          {!acc.is_primary && (
            <Button size="sm" variant="ghost" onClick={tornarPrincipal} disabled={setPrimary.isPending}>
              ⭐ Tornar principal
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>✏️ Editar</Button>
        </div>
      </header>

      {/* Herói */}
      <section
        className="rounded-lg border border-border bg-bg-surface p-md border-l-4"
        style={{ borderLeftColor: color }}
      >
        <div className="flex items-center gap-3 mb-3">
          <BankLogo slug={acc.bank_slug} name={acc.name} color={acc.color} size={44} />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-fg truncate">{acc.name}</h1>
            <div className="text-label text-fg-muted">
              {TYPE_LABEL[acc.type]}{acc.is_primary && ' · principal'}
            </div>
          </div>
        </div>

        <div className="text-label text-fg-muted uppercase tracking-wide">Saldo</div>
        <div className={`text-3xl font-bold tabular-nums ${balance < 0 ? 'text-danger' : 'text-fg'}`}>
          {fmtBRL(balance)}
        </div>

        {acc.goal_monthly != null && (
          <div className="mt-3 rounded-md bg-bg-elevated border border-border px-3 py-2 text-body-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-fg-muted">Meta de guardar/mês</span>
              <span className="text-fg tabular-nums">{fmtBRL(Number(acc.goal_monthly))}</span>
            </div>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-tom">Guardado no mês</span>
              <span className="text-tom font-semibold tabular-nums">{fmtBRL(Math.max(0, savedThisMonth))}</span>
            </div>
          </div>
        )}
      </section>

      {/* Ações */}
      <div className="grid grid-cols-2 gap-md">
        <Button variant="primary" onClick={() => setTransferOpen(true)}>Transferir</Button>
        <Button variant="secondary" onClick={() => setLancarOpen(true)}>Lançar aqui</Button>
      </div>

      {/* Extrato — navegação mês a mês */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-label uppercase tracking-wide text-fg-muted font-bold">Lançamentos</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMonthYear((m) => shiftMonth(m, -1))} aria-label="Mês anterior"
              className="w-7 h-7 rounded-md border border-border bg-bg-surface text-fg hover:bg-bg-elevated focus-ring">‹</button>
            <span className="text-body-sm text-fg tabular-nums w-24 text-center">{monthLabel}</span>
            <button type="button" onClick={() => setMonthYear((m) => shiftMonth(m, 1))} aria-label="Próximo mês"
              className="w-7 h-7 rounded-md border border-border bg-bg-surface text-fg hover:bg-bg-elevated focus-ring">›</button>
          </div>
        </div>
        {txQ.isLoading && <p className="text-fg-muted text-body-sm">Carregando…</p>}
        {!txQ.isLoading && txs.length === 0 && (
          <p className="text-fg-muted text-body-sm">Sem lançamentos em {monthLabel}.</p>
        )}
        {txs.map((t) => {
          const isIncome = t.type === 'income';
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setEditingTx(t)}
              className="w-full text-left flex items-center gap-3 p-3 rounded-md bg-bg-surface border border-border hover:bg-bg-elevated focus-ring transition-colors"
            >
              <span className="w-7 h-7 rounded-md bg-bg-elevated flex items-center justify-center text-sm shrink-0">
                {cat.emoji(t.category)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-fg font-medium truncate">{t.description || cat.label(t.category)}</div>
                <div className="text-label text-fg-muted">
                  {t.transaction_date.slice(8, 10)}/{t.transaction_date.slice(5, 7)}
                </div>
              </div>
              <div className={`font-semibold tabular-nums ${isIncome ? 'text-tom' : 'text-danger'}`}>
                {isIncome ? '+ ' : '− '}{fmtBRL(Number(t.amount))}
              </div>
            </button>
          );
        })}
      </section>

      <AccountSheet open={editOpen} initial={acc} onClose={() => setEditOpen(false)} />
      <TransferSheet open={transferOpen} fromAccountId={acc.id} onClose={() => setTransferOpen(false)} />
      <LancamentoSheet open={lancarOpen} initialAccountId={acc.id} onClose={() => setLancarOpen(false)} />
      <TransactionSheet open={!!editingTx} initial={editingTx ?? undefined} onClose={() => setEditingTx(null)} />
    </div>
  );
}
