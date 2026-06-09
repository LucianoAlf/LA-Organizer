# Editar / Excluir Cartão + Apagar Lançamento da Fatura — Plan

> Design aprovado ao vivo (Matheus: "não consigo ajustar o limite do cartão, nem apagar o que foi criado").

**Goal:** Expor no PWA a edição de cartão (limite/fechamento/vencimento/nome/bandeira), a exclusão do cartão, e a exclusão de um lançamento da fatura — tudo na tela de detalhe do cartão.

**Contexto:** Hoje o app só CRIA (`CartaoSheet` em `CartoesPage`) e desativa por baixo (`useDeactivateCard`, sem botão). Não há `updateCard` na lib nem `useUpdateCard`; a `CartaoDetalhePage` só tem Pagar/Ajustar fatura. O backend (`financeiro-service.updateCard`) já suporta editar.

**Tech:** React+TS+Tailwind (DS), Supabase. Validação: `tsc` + `vite build` + preview 4173.

> Convenção: sem commit por task; web deploya via Vercel no push (Stop hook). `cd _remote/web`.

---

### Task 1: lib `updateCard` + hook `useUpdateCard`

**Files:** `web/src/lib/cartoes.ts`, `web/src/hooks/useFinanceiro.ts`

- [ ] **Step 1: lib** — em `cartoes.ts`, logo após `deactivateCard`, adicionar:

```ts
export async function updateCard(collaboratorId: string, id: string, patch: {
  name?: string; brand?: string | null; color?: string | null;
  credit_limit?: number; closing_day?: number; due_day?: number; icon?: string | null;
}): Promise<PfCard> {
  const { data, error } = await supabase.from('pf_cards')
    .update(patch).eq('id', id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data as PfCard;
}
```

- [ ] **Step 2: hook** — em `useFinanceiro.ts`, ao lado de `useDeactivateCard`, adicionar:

```ts
export const useUpdateCard = () => useFinMutation(
  (cid, input: { id: string; patch: Parameters<typeof cartoes.updateCard>[2] }) => cartoes.updateCard(cid, input.id, input.patch)
);
```

- [ ] **Step 3: tsc** — `npx tsc --noEmit` (em `_remote/web`). Expected: limpo.

---

### Task 2: Extrair `CartaoSheet` p/ `components/` com modo edição

**Files:** Create `web/src/screens/financeiro/components/CartaoSheet.tsx`; Modify `web/src/screens/financeiro/CartoesPage.tsx`

- [ ] **Step 1: Criar `components/CartaoSheet.tsx`** (código completo)

```tsx
// Sheet de cadastro/edição de cartão. card? presente → modo edição (pré-preenche + updateCard).
import { useEffect, useState } from 'react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { Button } from '../../../components/Button';
import { useCreateCard, useUpdateCard } from '../../../hooks/useFinanceiro';
import type { PfCard } from '../../../lib/cartoes';

export const BRANDS = [
  { value: 'roxo', label: 'Nubank (roxo)', color: '#820ad1' },
  { value: 'visa', label: 'Visa (azul)', color: '#1a1f71' },
  { value: 'master', label: 'Mastercard (laranja)', color: '#eb5b1e' },
  { value: 'elo', label: 'Elo (preto)', color: '#1c1c1c' },
  { value: 'amex', label: 'Amex (verde)', color: '#2e7d32' },
  { value: 'outro', label: 'Outro', color: '#3f3f46' },
];

export function CartaoSheet({ open, onClose, card }: { open: boolean; onClose: () => void; card?: PfCard }) {
  const createMut = useCreateCard();
  const updateMut = useUpdateCard();
  const isEdit = !!card;
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('roxo');
  const [limit, setLimit] = useState('');
  const [closing, setClosing] = useState('');
  const [due, setDue] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(card?.name ?? '');
    setBrand(card?.brand ?? 'roxo');
    setLimit(card ? String(card.credit_limit) : '');
    setClosing(card ? String(card.closing_day) : '');
    setDue(card ? String(card.due_day) : '');
  }, [open, card]);

  const valid = !!name.trim() && Number(limit) > 0 &&
    Number(closing) >= 1 && Number(closing) <= 31 && Number(due) >= 1 && Number(due) <= 31;

  async function submit() {
    if (!valid) return;
    const b = BRANDS.find((x) => x.value === brand);
    const data = {
      name: name.trim(), brand, color: b?.color ?? null,
      credit_limit: Number(limit), closing_day: Number(closing), due_day: Number(due),
    };
    if (isEdit && card) await updateMut.mutateAsync({ id: card.id, patch: data });
    else await createMut.mutateAsync(data);
    onClose();
  }

  const busy = createMut.isPending || updateMut.isPending;
  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';
  return (
    <BottomSheet open={open} onClose={onClose} title={isEdit ? 'Editar cartão' : 'Novo cartão'}>
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
        <Button variant="primary" fullWidth loading={busy} onClick={submit} disabled={!valid}>
          {isEdit ? 'Salvar' : 'Cadastrar cartão'}
        </Button>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: `CartoesPage.tsx`** — remover o `CartaoSheet` local + a const `BRANDS` local, e importar do novo arquivo. Trocar os imports do topo:
  - Remover: `import { BottomSheet } ...`, `import { Field } ...`, `import { CustomSelect } ...` (passam a ser usados só dentro do CartaoSheet extraído).
  - Adicionar: `import { CartaoSheet } from './components/CartaoSheet';`
  - Remover o bloco `const BRANDS = [...]` e a `function CartaoSheet({open,onClose}) {...}` inteiros.
  - `useCreateCard` deixa de ser usado em CartoesPage (vai pro componente) → remover de `useFinanceiro` import dessa página.
  - O uso `<CartaoSheet open={creating} onClose={() => setCreating(false)} />` continua igual (sem `card` = modo criar).

- [ ] **Step 3: tsc** — `npx tsc --noEmit`. Expected: limpo (sem imports órfãos).

---

### Task 3: `CartaoDetalhePage` — Editar + Excluir + apagar item da fatura

**Files:** `web/src/screens/financeiro/CartaoDetalhePage.tsx`

- [ ] **Step 1: imports + hooks** — adicionar:
```tsx
import { useNavigate } from 'react-router-dom';   // junto do useParams existente
import { Pencil, Trash2 } from 'lucide-react';
import { CartaoSheet } from './components/CartaoSheet';
```
E nos hooks de finanças importados, adicionar `useDeactivateCard, useDeleteTransaction`.

- [ ] **Step 2: estado + handlers** — dentro de `CartaoDetalhePage`, após `const [ajustando, setAjustando] = useState(false);` adicionar:
```tsx
  const [editando, setEditando] = useState(false);
  const navigate = useNavigate();
  const deactivateCard = useDeactivateCard();
  const deleteTxn = useDeleteTransaction();

  async function excluirCartao() {
    if (!card) return;
    if (!confirm(`Excluir o cartão "${card.name}"? Os lançamentos já feitos continuam no histórico.`)) return;
    await deactivateCard.mutateAsync(card.id);
    navigate('/financeiro/cartoes');
  }
```
> Nota: `ItemRow` precisa de um `onDelete`. Passar uma função do pai. Atualizar a assinatura do `ItemRow` (Step 4).

- [ ] **Step 3: header com lápis** — trocar o `<header>` por:
```tsx
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link to="/financeiro/cartoes" className="text-label text-fg-muted">← Cartões</Link>
          <h1 className="text-xl font-bold text-fg">{card.name}</h1>
        </div>
        <button type="button" onClick={() => setEditando(true)} aria-label="Editar cartão"
          className="h-9 w-9 grid place-items-center rounded-md text-fg-muted hover:bg-bg-elevated focus-ring">
          <Pencil size={18} />
        </button>
      </header>
```

- [ ] **Step 4: itens tocáveis (apagar)** — atualizar `ItemRow` p/ aceitar `onDelete` e virar clicável:
```tsx
function ItemRow({ it, onDelete }: { it: CardInvoiceItem; onDelete: (it: CardInvoiceItem) => void }) {
  const parc = it.installments_total && it.installments_total > 1
    ? ` (${it.installment_no}/${it.installments_total})` : '';
  return (
    <div className="flex items-center gap-3 p-3 rounded-md bg-bg-surface border border-border">
      <span className="w-7 h-7 rounded-md bg-bg-elevated flex items-center justify-center text-sm">
        {CAT_ICON[it.category] ?? '🗂️'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-fg font-medium truncate">{(it.description || 'Compra') + parc}</div>
        <div className="text-label text-fg-muted">{it.category} · {it.transaction_date.slice(8, 10)}/{it.transaction_date.slice(5, 7)}</div>
      </div>
      <div className="font-semibold text-fg">{fmtBRL(it.amount)}</div>
      <button type="button" onClick={() => onDelete(it)} aria-label="Apagar lançamento"
        className="shrink-0 h-8 w-8 grid place-items-center rounded-md text-fg-muted hover:text-danger hover:bg-danger/10 focus-ring">
        <Trash2 size={15} />
      </button>
    </div>
  );
}
```
E no pai, a função de apagar + uso do ItemRow:
```tsx
  async function apagarItem(it: CardInvoiceItem) {
    const aviso = it.installments_total && it.installments_total > 1
      ? `Apagar a parcela ${it.installment_no}/${it.installments_total} de "${it.description || 'Compra'}"? (só esta parcela)`
      : `Apagar "${it.description || 'Compra'}" (${fmtBRL(it.amount)}) desta fatura?`;
    if (!confirm(aviso)) return;
    await deleteTxn.mutateAsync(it.id);
  }
```
```tsx
        {inv.data?.items.map((it) => <ItemRow key={it.id} it={it} onDelete={apagarItem} />)}
```

- [ ] **Step 5: botão Excluir cartão** — antes do `<PagarSheet ...>` no fim, adicionar:
```tsx
      <Button variant="ghost" fullWidth onClick={excluirCartao} loading={deactivateCard.isPending}>
        <span className="text-danger">Excluir cartão</span>
      </Button>

      <CartaoSheet open={editando} onClose={() => setEditando(false)} card={card} />
```

- [ ] **Step 6: tsc** — `npx tsc --noEmit`. Expected: limpo.

---

### Task 4: Validação

- [ ] **Step 1:** `cd _remote/web && npx tsc --noEmit && npx vite build` → limpos.
- [ ] **Step 2: Preview 4173** (limpar SW): editar limite de um cartão → salva e reflete no "limite"/"livre"; excluir cartão → volta pra lista sem ele; apagar item da fatura → some + total recalcula. 375 + 1440.
- [ ] **Step 3:** Deploy via Vercel no push (Stop hook).

---

## Self-Review
- **Editar (limite/etc)** → Task 1 (updateCard+hook) + Task 2 (sheet edit) + Task 3 Step 3 (lápis). ✅
- **Excluir cartão** → Task 3 Step 2/5 (useDeactivateCard + botão + navigate). ✅
- **Apagar item da fatura** → Task 3 Step 4 (ItemRow tocável + useDeleteTransaction, aviso de parcela). ✅
- **Type consistency:** `updateCard(cid,id,patch)`; `useUpdateCard.mutateAsync({id,patch})`; `CartaoSheet card?:PfCard`; `ItemRow onDelete:(CardInvoiceItem)=>void`. Consistente. ✅
- **Placeholder scan:** código completo em cada step; sem TBD. ✅
