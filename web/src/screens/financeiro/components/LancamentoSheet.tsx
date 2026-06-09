// Lançamento unificado: cria À vista, Parcelar, Recorrente ou Agendar — adapta o form ao tipo.
// Espelha o visual do TransactionSheet (toggle despesa/receita, valor big, CustomSelect, footer).
// Receita força À vista e esconde segmented + cartões (receita não parcela/agenda nem cai em cartão).
import { useEffect, useMemo, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { ComboBox } from '../../../components/ComboBox';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import {
  useAccounts, useCategories, useCards,
  useCreateTransaction, useCreateCardPurchase, useCreateBill, useCreateCategory,
} from '../../../hooks/useFinanceiro';
import { NovaCategoriaSheet } from './NovaCategoriaSheet';
import { splitInstallments } from '../../../lib/cartoes';
import type { PfCategory, PfTxType } from '../../../lib/financeiro';

type Tipo = 'avista' | 'parcelar' | 'recorrente' | 'agendar';

const TIPO_OPTS: { value: Tipo; label: string }[] = [
  { value: 'avista', label: 'À vista' },
  { value: 'parcelar', label: 'Parcelar' },
  { value: 'recorrente', label: 'Recorrente' },
  { value: 'agendar', label: 'Agendar' },
];
const PARCELA_OPTS = Array.from({ length: 23 }, (_, i) => ({ value: String(i + 2), label: `${i + 2}×` }));
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` }));

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export interface LancamentoSheetProps {
  open: boolean;
  onClose: () => void;
  initialAccountId?: string;
}

export function LancamentoSheet({ open, onClose, initialAccountId }: LancamentoSheetProps) {
  const accountsQ = useAccounts();
  const cardsQ = useCards();
  const catsQ = useCategories();
  const createTransaction = useCreateTransaction();
  const createCardPurchase = useCreateCardPurchase();
  const createBill = useCreateBill();
  const createCategory = useCreateCategory();

  const allCats = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  // Filtra is_active: categorias desativadas ficam no lookup (labels históricos) mas não no picker.
  const expenseCats = useMemo(() => allCats.filter((c) => c.type === 'expense' && c.is_active).map((c) => ({ value: c.slug, label: `${c.emoji}  ${c.label}` })), [allCats]);
  const incomeCats = useMemo(() => allCats.filter((c) => c.type === 'income' && c.is_active).map((c) => ({ value: c.slug, label: `${c.emoji}  ${c.label}` })), [allCats]);
  const cards = useMemo(() => cardsQ.data ?? [], [cardsQ.data]);
  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);

  const [novaCat, setNovaCat] = useState(false);
  const [type, setType] = useState<PfTxType>('expense');
  const [tipo, setTipo] = useState<Tipo>('avista');
  const [category, setCategory] = useState<PfCategory>('alimentacao');
  const [amountText, setAmountText] = useState('');
  const [medio, setMedio] = useState<string>('');           // '' | 'acc:<id>' | 'card:<id>'
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayYmd());             // À vista / 1ª parcela
  const [installments, setInstallments] = useState('2');
  const [dueDay, setDueDay] = useState('10');               // recorrente
  const [dueDate, setDueDate] = useState(todayYmd());       // agendar
  const [error, setError] = useState<string | null>(null);

  // Reset ao reabrir.
  useEffect(() => {
    if (!open) return;
    setType('expense'); setTipo('avista'); setCategory('alimentacao');
    setAmountText(''); setMedio(initialAccountId ? `acc:${initialAccountId}` : ''); setDescription('');
    setDate(todayYmd()); setInstallments('2'); setDueDay('10'); setDueDate(todayYmd());
    setError(null);
  }, [open, initialAccountId]);

  function switchType(next: PfTxType) {
    setType(next);
    if (next === 'income') {
      setTipo('avista');          // receita não parcela/agenda/recorre
      setMedio((m) => (m.startsWith('card:') ? '' : m)); // receita não cai em cartão
    }
    const list = next === 'expense' ? expenseCats : incomeCats;
    if (list.length && !list.find((o) => o.value === category)) setCategory(list[0].value);
  }

  function switchTipo(next: Tipo) {
    setTipo(next);
    // Parcelar trava em cartão: se o meio atual não é cartão, limpa.
    if (next === 'parcelar' && !medio.startsWith('card:')) setMedio('');
  }

  // Opções de meio de pagamento (carteiras + cartões), filtradas por tipo/contexto.
  const medioOptions = useMemo(() => {
    const accOpts = accounts.map((a) => ({ value: `acc:${a.id}`, label: `${a.icon ?? '🏦'}  ${a.name}` }));
    const cardOpts = cards.map((c) => ({ value: `card:${c.id}`, label: `💳  ${c.name}` }));
    if (type === 'income') return [{ value: '', label: '— sem definir —' }, ...accOpts];
    if (tipo === 'parcelar') return [{ value: '', label: '— escolha um cartão —' }, ...cardOpts];
    return [{ value: '', label: '— sem definir —' }, ...accOpts, ...cardOpts];
  }, [accounts, cards, type, tipo]);

  const categoryOptions = type === 'expense' ? expenseCats : incomeCats;

  const amount = Number(amountText.replace(',', '.'));
  const amountValid = isFinite(amount) && amount > 0;
  const nParc = Math.max(2, Number(installments) || 2);
  const parcelaPreview = amountValid ? splitInstallments(amount, nParc)[0].toFixed(2) : '0,00';

  const isCard = medio.startsWith('card:');
  const card = isCard ? cards.find((c) => c.id === medio.slice(5)) : null;
  const accId = medio.startsWith('acc:') ? medio.slice(4) : null;

  // Validação por tipo (controla o disabled do botão).
  const invalid =
    !amountValid ||
    (tipo === 'parcelar' && !card) ||
    (tipo === 'agendar' && !dueDate);

  async function submit() {
    setError(null);
    if (!amountValid) { setError('Informe um valor maior que zero.'); return; }
    const desc = description.trim() || null;
    try {
      if (tipo === 'avista') {
        if (isCard && card) {
          await createCardPurchase.mutateAsync({ cardId: card.id, closingDay: card.closing_day, amount, category, description: desc, installments: 1, firstDate: date });
        } else {
          await createTransaction.mutateAsync({ type, category, amount, description: desc, transaction_date: date, account_id: accId });
        }
      } else if (tipo === 'parcelar') {
        if (!card) { setError('Escolha um cartão pra parcelar.'); return; }
        await createCardPurchase.mutateAsync({ cardId: card.id, closingDay: card.closing_day, amount, category, description: desc, installments: nParc, firstDate: date });
      } else if (tipo === 'recorrente') {
        await createBill.mutateAsync({ name: description.trim() || category, amount, category, type, due_day: Number(dueDay), recurrence: 'monthly' });
      } else if (tipo === 'agendar') {
        if (!dueDate) { setError('Informe a data de vencimento.'); return; }
        await createBill.mutateAsync({ name: description.trim() || category, amount, category, type, recurrence: 'once', due_date: dueDate });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const submitting = createTransaction.isPending || createCardPurchase.isPending || createBill.isPending;
  const showMedio = tipo === 'avista' || tipo === 'parcelar';

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Novo lançamento" size="sm">
      <div className="flex flex-col gap-md p-md">
        {/* Toggle despesa/receita */}
        <div className="grid grid-cols-2 rounded-full bg-bg-elevated p-1 text-body-sm">
          <button
            type="button"
            onClick={() => switchType('expense')}
            className={['h-9 rounded-full transition-colors focus-ring', type === 'expense' ? 'bg-danger/10 text-danger font-semibold' : 'text-fg-muted hover:text-fg'].join(' ')}
          >
            − Despesa
          </button>
          <button
            type="button"
            onClick={() => switchType('income')}
            className={['h-9 rounded-full transition-colors focus-ring', type === 'income' ? 'bg-success/10 text-success font-semibold' : 'text-fg-muted hover:text-fg'].join(' ')}
          >
            + Receita
          </button>
        </div>

        {/* Segmented Tipo — só despesa */}
        {type === 'expense' && (
          <div className="grid grid-cols-4 rounded-full bg-bg-elevated p-1 text-body-sm">
            {TIPO_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => switchTipo(o.value)}
                className={['h-9 rounded-full transition-colors focus-ring', tipo === o.value ? 'bg-tom text-black font-semibold' : 'text-fg-muted hover:text-fg'].join(' ')}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        <Field label="Valor">
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

        <Field label="Categoria">
          <ComboBox
            value={category}
            options={categoryOptions}
            onChange={(v) => setCategory(v as PfCategory)}
            placeholder="Buscar ou criar…"
            onCreate={async (text) => {
              const r = await createCategory.mutateAsync({ label: text, emoji: '🏷️', type });
              return (r as { slug: string }).slug;
            }}
            footerAction={{ label: '➕ Criar com emoji…', onClick: () => setNovaCat(true) }}
          />
        </Field>

        {showMedio && (
          <Field
            label="Meio de pagamento"
            sub={accounts.length === 0 && cards.length === 0
              ? 'Você ainda não tem carteiras nem cartões. Cadastre em Finanças → Carteiras / Cartões pra vincular (dá pra registrar sem isso também).'
              : undefined}
          >
            <ComboBox value={medio} options={medioOptions} onChange={setMedio} placeholder="Buscar carteira/cartão…" />
          </Field>
        )}

        <Field label="Descrição" sub="Opcional. Ex.: iFood, Mercado.">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O quê foi?"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
        </Field>

        {/* Campos condicionais por tipo */}
        {(tipo === 'avista' || tipo === 'parcelar') && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <Field label={tipo === 'parcelar' ? 'Data da 1ª parcela' : 'Data'}>
              <DateInput value={date} onChange={setDate} />
            </Field>
            {tipo === 'parcelar' && (
              <Field label="Nº de parcelas">
                <CustomSelect value={installments} options={PARCELA_OPTS} onChange={setInstallments} />
              </Field>
            )}
          </div>
        )}
        {tipo === 'parcelar' && (
          <p className="text-body-sm text-fg-muted">≈ R$ {parcelaPreview}/mês · {nParc}× · vai pra fatura</p>
        )}
        {tipo === 'recorrente' && (
          <Field label="Dia do vencimento" sub="Dia do mês (1–31).">
            <CustomSelect value={dueDay} options={DAY_OPTIONS} onChange={setDueDay} />
          </Field>
        )}
        {tipo === 'agendar' && (
          <Field label="Vencimento">
            <DateInput value={dueDate} onChange={setDueDate} />
          </Field>
        )}

        {error && <p className="text-body-sm text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={submitting || invalid}>
            {submitting ? 'Salvando…' : 'Registrar'}
          </Button>
        </div>
      </div>
      <NovaCategoriaSheet open={novaCat} type={type} onClose={() => setNovaCat(false)}
        onCreated={(slug) => setCategory(slug as PfCategory)} />
    </AdaptiveSheet>
  );
}
