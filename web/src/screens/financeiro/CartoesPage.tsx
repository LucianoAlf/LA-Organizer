// Lista de cartões de crédito (tile leve "B") + sheet de cadastro.
// Tocar num tile → detalhe (/financeiro/cartoes/:id). Padrão espelhado de CarteirasPage.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreditCard, Plus } from 'lucide-react';
import { BottomSheet } from '../../components/BottomSheet';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { Button } from '../../components/Button';
import { Fab } from '../../components/Fab';
import {
  useCards, useCardUsage, useCardInvoice, useCreateCard,
} from '../../hooks/useFinanceiro';
import { useFinanceiroAuth } from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import { currentCompetencia, type PfCard } from '../../lib/cartoes';

const fmtBRL = (v: number) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BRANDS = [
  { value: 'roxo', label: 'Nubank (roxo)', color: '#820ad1' },
  { value: 'visa', label: 'Visa (azul)', color: '#1a1f71' },
  { value: 'master', label: 'Mastercard (laranja)', color: '#eb5b1e' },
  { value: 'elo', label: 'Elo (preto)', color: '#1c1c1c' },
  { value: 'amex', label: 'Amex (verde)', color: '#2e7d32' },
  { value: 'outro', label: 'Outro', color: '#3f3f46' },
];

function daysUntil(day: number): number {
  const today = new Date();
  const dom = today.getUTCDate();
  return day >= dom ? day - dom : day; // aprox; só pra "fecha em Xd"
}

function CardTile({ card }: { card: PfCard }) {
  const navigate = useNavigate();
  const usage = useCardUsage(card);
  const invoice = useCardInvoice(card.id, currentCompetencia(card));
  const pct = usage.data ? Math.round(usage.data.pct * 100) : 0;
  const color = card.color || '#820ad1';
  return (
    <button
      type="button"
      onClick={() => navigate(`/financeiro/cartoes/${card.id}`)}
      className="text-left rounded-lg border border-border bg-bg-surface p-md flex flex-col gap-2 focus-ring"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-md flex items-center justify-center text-sm" style={{ background: color }}>💳</span>
          <div>
            <div className="font-semibold text-fg">{card.name}</div>
            <div className="text-label text-fg-muted">vence dia {card.due_day} · fecha em {daysUntil(card.closing_day)}d</div>
          </div>
        </div>
        <span className="text-label px-2 py-0.5 rounded-full bg-bg-elevated text-fg-muted">{pct}%</span>
      </div>
      <div className="text-2xl font-bold text-fg">{fmtBRL(invoice.data?.total ?? 0)}</div>
      <div className="text-label text-fg-muted -mt-1">fatura atual</div>
      <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
        <div className="h-full rounded-full bg-tom" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="flex justify-between text-label text-fg-muted">
        <span>limite {fmtBRL(card.credit_limit)}</span>
        <span>disponível {fmtBRL(usage.data?.available ?? card.credit_limit)}</span>
      </div>
    </button>
  );
}

function CartaoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createMut = useCreateCard();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('roxo');
  const [limit, setLimit] = useState('');
  const [closing, setClosing] = useState('');
  const [due, setDue] = useState('');

  const valid = name.trim() && Number(limit) > 0 &&
    Number(closing) >= 1 && Number(closing) <= 31 && Number(due) >= 1 && Number(due) <= 31;

  async function submit() {
    if (!valid) return;
    const b = BRANDS.find((x) => x.value === brand);
    await createMut.mutateAsync({
      name: name.trim(), brand, color: b?.color ?? null,
      credit_limit: Number(limit), closing_day: Number(closing), due_day: Number(due),
    });
    setName(''); setLimit(''); setClosing(''); setDue(''); setBrand('roxo');
    onClose();
  }

  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';
  return (
    <BottomSheet open={open} onClose={onClose} title="Novo cartão">
      <div className="flex flex-col gap-md">
        <Field label="Nome do cartão">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Nubank" />
        </Field>
        <Field label="Bandeira / cor">
          <CustomSelect value={brand} options={BRANDS.map((b) => ({ value: b.value, label: b.label }))} onChange={setBrand} />
        </Field>
        <Field label="Limite (R$)">
          <input className={inputCls} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="5000" />
        </Field>
        <div className="grid grid-cols-2 gap-md">
          <Field label="Dia de fechamento">
            <input className={inputCls} inputMode="numeric" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="6" />
          </Field>
          <Field label="Dia de vencimento">
            <input className={inputCls} inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value)} placeholder="10" />
          </Field>
        </div>
        <Button variant="primary" fullWidth loading={createMut.isPending} onClick={submit}>
          Cadastrar cartão
        </Button>
      </div>
    </BottomSheet>
  );
}

export function CartoesPage() {
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_cards', 'pf_card_payments', 'pf_transactions'], cid);
  const cardsQ = useCards();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-md p-md pb-32 md:pb-md md:max-w-5xl md:mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/financeiro" className="text-label text-fg-muted">← Finanças</Link>
          <h1 className="text-xl font-bold text-fg">Cartões de Crédito</h1>
        </div>
      </header>

      {cardsQ.isLoading && <p className="text-fg-muted">Carregando…</p>}

      {cardsQ.data && cardsQ.data.length === 0 && (
        <div className="rounded-lg border border-border bg-bg-surface p-md flex flex-col items-center gap-2 text-center">
          <CreditCard className="text-fg-muted" />
          <p className="text-fg-muted">Nenhum cartão ainda. Cadastre seu primeiro cartão de crédito.</p>
          <Button variant="secondary" leadingIcon={<Plus size={16} />} onClick={() => setCreating(true)}>Novo cartão</Button>
        </div>
      )}

      {cardsQ.data && cardsQ.data.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          {cardsQ.data.map((c) => <CardTile key={c.id} card={c} />)}
        </div>
      )}

      <Fab ariaLabel="Novo cartão" onClick={() => setCreating(true)} />
      <CartaoSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
