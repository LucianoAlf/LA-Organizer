// Detalhe da carteira ("entrar na carteira"): herói (logo/cor/saldo/meta),
// extrato de lançamentos e ações transferir / lançar aqui / editar / principal.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import {
  useAccounts, useAccountLedger, useAccountBalanceAtMonthEnd, useCategoryLookup, useFinanceiroAuth, useSetPrimaryAccount,
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
  useRealtimeFinance(['pf_accounts', 'pf_transactions', 'pf_transfers', 'pf_card_payments'], cid);

  const accountsQ = useAccounts();
  const acc = accountsQ.data?.find((a) => a.id === id);
  const [monthYear, setMonthYear] = useState(localYm());
  const ledgerQ = useAccountLedger(id, monthYear);
  const saldoFimQ = useAccountBalanceAtMonthEnd(id, monthYear, acc ? Number(acc.balance) : undefined);
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

  const items = ledgerQ.data ?? [];
  // Resumo do mês (conciliação): entrou (+), saiu (−), resultado. Ignora acerto de caixa.
  const entrou = items.filter((i) => i.direction === 'in' && !i.txn?.is_adjustment).reduce((s, i) => s + i.amount, 0);
  const saiu = items.filter((i) => i.direction === 'out' && !i.txn?.is_adjustment).reduce((s, i) => s + i.amount, 0);
  const resultado = entrou - saiu;
  const savedThisMonth = resultado; // "guardado no mês" = resultado líquido (inclui transferências)
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
          <h2 className="text-label uppercase tracking-wide text-fg-muted font-bold">Movimentações</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMonthYear((m) => shiftMonth(m, -1))} aria-label="Mês anterior"
              className="w-7 h-7 rounded-md border border-border bg-bg-surface text-fg hover:bg-bg-elevated focus-ring">‹</button>
            <span className="text-body-sm text-fg tabular-nums w-24 text-center">{monthLabel}</span>
            <button type="button" onClick={() => setMonthYear((m) => shiftMonth(m, 1))} aria-label="Próximo mês"
              className="w-7 h-7 rounded-md border border-border bg-bg-surface text-fg hover:bg-bg-elevated focus-ring">›</button>
          </div>
        </div>
        {saldoFimQ.data != null && (
          <div className="rounded-md bg-bg-elevated border border-border px-3 py-2 flex items-baseline justify-between">
            <span className="text-label text-fg-muted uppercase tracking-wide">🏦 Saldo no fim de {monthLabel}</span>
            <span className="text-body-md font-semibold text-fg tabular-nums">{fmtBRL(saldoFimQ.data)}</span>
          </div>
        )}
        {ledgerQ.isLoading && <p className="text-fg-muted text-body-sm">Carregando…</p>}
        {!ledgerQ.isLoading && items.length === 0 && (
          <p className="text-fg-muted text-body-sm">Sem movimentações em {monthLabel}.</p>
        )}
        {!ledgerQ.isLoading && items.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-1">
            <div className="rounded-md bg-bg-elevated border border-border px-2 py-1.5 text-center">
              <div className="text-label text-fg-muted uppercase tracking-wide">Entrou</div>
              <div className="text-body-sm font-semibold text-tom tabular-nums">{fmtBRL(entrou)}</div>
            </div>
            <div className="rounded-md bg-bg-elevated border border-border px-2 py-1.5 text-center">
              <div className="text-label text-fg-muted uppercase tracking-wide">Saiu</div>
              <div className="text-body-sm font-semibold text-danger tabular-nums">{fmtBRL(saiu)}</div>
            </div>
            <div className="rounded-md bg-bg-elevated border border-border px-2 py-1.5 text-center">
              <div className="text-label text-fg-muted uppercase tracking-wide">Resultado</div>
              <div className={`text-body-sm font-semibold tabular-nums ${resultado < 0 ? 'text-danger' : 'text-tom'}`}>{fmtBRL(resultado)}</div>
            </div>
          </div>
        )}
        {items.map((it) => {
          const icon = it.txn ? cat.emoji(it.txn.category) : it.kind === 'card_payment' ? '💳' : '🔄';
          const label = it.txn ? (it.txn.description || cat.label(it.txn.category)) : it.label;
          const inner = (
            <>
              <span className="w-7 h-7 rounded-md bg-bg-elevated flex items-center justify-center text-sm shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-fg font-medium truncate">{label}</div>
                <div className="text-label text-fg-muted">{it.date.slice(8, 10)}/{it.date.slice(5, 7)}</div>
              </div>
              <div className={`font-semibold tabular-nums shrink-0 ${it.direction === 'in' ? 'text-tom' : 'text-danger'}`}>
                {it.direction === 'in' ? '+ ' : '− '}{fmtBRL(it.amount)}
              </div>
            </>
          );
          return it.txn ? (
            <button key={it.id} type="button" onClick={() => setEditingTx(it.txn!)}
              className="w-full text-left flex items-center gap-3 p-3 rounded-md bg-bg-surface border border-border hover:bg-bg-elevated focus-ring transition-colors">
              {inner}
            </button>
          ) : (
            <div key={it.id} className="w-full flex items-center gap-3 p-3 rounded-md bg-bg-surface border border-border">
              {inner}
            </div>
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
