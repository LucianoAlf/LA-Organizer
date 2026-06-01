# Carteiras — CRUD + Detalhe/Extrato + Transferência + Identidade do Banco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps usam checkbox (`- [ ]`).

**Goal:** CRUD completo de carteiras no PWA (editar/personalizar com logo+cor do banco, meta mensal), tela de detalhe com extrato, transferência entre carteiras, e bilateralidade TOM (edit_account + create_account auto-banco).

**Architecture:** Migration leve (`bank_slug`+`color` em pf_accounts). Catálogo de bancos em código (`banks.ts`/`banks.js`) + componente `BankLogo` (img `/banks/<slug>.svg` → fallback inicial-na-cor). Transferência = INSERT em `pf_transfers` (trigger do banco ajusta os 2 saldos — confirmado). Reusa LancamentoSheet (com nova prop) e o molde da CartaoDetalhePage.

**Tech Stack:** Supabase (MCP), Node CommonJS (engine), React+TS+Tailwind (PWA), Vitest (puro).

**Convenções (CLAUDE.md):**
- **NÃO commitar entre tasks** (Stop hook → Vercel). Última linha = validação.
- Engine (`src/`,`skills/`) precisa **SCP imediato**: `scp /d/la-organizer/_remote/<p> tom:/opt/LA-Organizer/<p> && ssh tom "pm2 restart tom"`.
- **Segurança:** toda query nova filtra `.eq('collaborator_id', cid)`; updates com whitelist.
- PWA: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`. DS: BankLogo/CustomSelect/DateInput/Button/Field/AdaptiveSheet. Token `tom`, **texto preto sobre verde**.
- SVGs já em `web/public/banks/`: nubank, itau, santander, c6, mercadopago (mastercard é bandeira, ignorar). Bancos sem SVG → fallback inicial-na-cor (automático).

---

## Task 1: Migration — `pf_accounts` ganha `bank_slug` + `color`

**Files:** Create `migrations/20260531_pf_accounts_bank_color.sql`; Apply MCP `apply_migration` (name `pf_accounts_bank_color`)

- [ ] **Step 1: Escrever a migration**
```sql
ALTER TABLE pf_accounts
  ADD COLUMN IF NOT EXISTS bank_slug text,
  ADD COLUMN IF NOT EXISTS color text;
```
- [ ] **Step 2: Aplicar** via `apply_migration` (project `cesnbnrynvxvgdhfmaua`, name `pf_accounts_bank_color`).
- [ ] **Step 3: Verificar** — `execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='pf_accounts' AND column_name IN ('bank_slug','color') ORDER BY column_name;
```
Esperado: `bank_slug text`, `color text`.
- [ ] **Step 4 (opcional, bom): backfill dos bancos óbvios** das carteiras existentes — `execute_sql`:
```sql
UPDATE pf_accounts SET bank_slug='itau',       color='#ec7000' WHERE bank_slug IS NULL AND lower(name) LIKE '%itau%';
UPDATE pf_accounts SET bank_slug='nubank',     color='#820ad1' WHERE bank_slug IS NULL AND lower(name) LIKE '%nubank%';
UPDATE pf_accounts SET bank_slug='santander',  color='#ec0000' WHERE bank_slug IS NULL AND lower(name) LIKE '%santander%';
UPDATE pf_accounts SET bank_slug='c6',         color='#242424' WHERE bank_slug IS NULL AND (lower(name) LIKE '%c6%');
```

---

## Task 2: PWA — catálogo de bancos `banks.ts` (puro, Vitest)

**Files:** Create `web/src/lib/banks.ts`, `web/src/lib/__tests__/banks.test.ts`

- [ ] **Step 1: Teste (falha primeiro)** — `web/src/lib/__tests__/banks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { matchBankSlug, logoUrl, BANKS } from '../banks';

describe('matchBankSlug', () => {
  it('casa nome exato e variações', () => {
    expect(matchBankSlug('Nubank')).toBe('nubank');
    expect(matchBankSlug('C6 Bank')).toBe('c6');
    expect(matchBankSlug('Itaú')).toBe('itau');
    expect(matchBankSlug('Mercado Pago')).toBe('mercadopago');
    expect(matchBankSlug('Banco do Brasil')).toBe('bb');
  });
  it('retorna null pra desconhecido/vazio', () => {
    expect(matchBankSlug('Carteira XPTO')).toBeNull();
    expect(matchBankSlug('')).toBeNull();
  });
});
describe('logoUrl', () => {
  it('monta o caminho público', () => { expect(logoUrl('nubank')).toBe('/banks/nubank.svg'); });
});
describe('BANKS', () => {
  it('tem cor pros bancos com svg', () => {
    for (const s of ['nubank','itau','santander','c6','mercadopago']) expect(BANKS[s]?.color).toMatch(/^#/);
  });
});
```
- [ ] **Step 2: Rodar e ver falhar** — `cd /d/la-organizer/_remote/web && npx vitest run src/lib/__tests__/banks.test.ts` (FAIL: módulo não existe).
- [ ] **Step 3: Implementar** `web/src/lib/banks.ts`:
```ts
export interface BankInfo { name: string; color: string; }

// Cores semeadas a partir do material do Alf (bank-logos.tsx). Logos oficiais ficam em /banks/<slug>.svg.
export const BANKS: Record<string, BankInfo> = {
  nubank:      { name: 'Nubank',          color: '#820ad1' },
  itau:        { name: 'Itaú',            color: '#ec7000' },
  bradesco:    { name: 'Bradesco',        color: '#cc092f' },
  santander:   { name: 'Santander',       color: '#ec0000' },
  bb:          { name: 'Banco do Brasil', color: '#fcbf00' },
  caixa:       { name: 'Caixa',           color: '#005ca9' },
  c6:          { name: 'C6 Bank',         color: '#242424' },
  inter:       { name: 'Inter',           color: '#ff7a00' },
  mercadopago: { name: 'Mercado Pago',    color: '#00b1ea' },
  picpay:      { name: 'PicPay',          color: '#21c25e' },
  neon:        { name: 'Neon',            color: '#00e5a0' },
  will:        { name: 'Will Bank',       color: '#ff0066' },
  pagbank:     { name: 'PagBank',         color: '#00a651' },
  btg:         { name: 'BTG',             color: '#00263a' },
  next:        { name: 'Next',            color: '#00dc5a' },
  original:    { name: 'Original',        color: '#00a868' },
};

export function logoUrl(slug: string): string { return `/banks/${slug}.svg`; }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function matchBankSlug(name: string): string | null {
  if (!name) return null;
  const n = norm(name);
  for (const [slug, info] of Object.entries(BANKS)) {
    if (n === slug || n.includes(slug) || n.includes(norm(info.name))) return slug;
  }
  return null;
}
```
- [ ] **Step 4: Rodar e ver passar** — `cd /d/la-organizer/_remote/web && npx vitest run src/lib/__tests__/banks.test.ts` (PASS).

---

## Task 3: PWA lib — PfAccount + updateAccount + createTransfer + extrato

**Files:** Modify `web/src/lib/financeiro.ts` (PfAccount ~14; listAccounts ~52; createAccount ~59)

- [ ] **Step 1: Estender `PfAccount`** (~14):
```ts
export interface PfAccount {
  id: string; name: string; type: PfAccountType; balance: number; icon: string | null; is_primary: boolean;
  bank_slug: string | null; color: string | null; goal_monthly: number | null; is_active?: boolean;
}
```
- [ ] **Step 2: `listAccounts` select** (~52) — incluir os campos novos:
```ts
    .select('id, name, type, balance, icon, is_primary, bank_slug, color, goal_monthly')
```
- [ ] **Step 3: `createAccount`** (~59) — aceitar bank_slug/color:
```ts
export async function createAccount(collaboratorId: string, input: { name: string; type?: PfAccountType; icon?: string | null; goal_monthly?: number | null; bank_slug?: string | null; color?: string | null }) {
  const { data, error } = await supabase.from('pf_accounts')
    .insert({ collaborator_id: collaboratorId, name: input.name, type: input.type ?? 'checking',
              icon: input.icon ?? null, goal_monthly: input.goal_monthly ?? null,
              bank_slug: input.bank_slug ?? null, color: input.color ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
```
- [ ] **Step 4: Adicionar `updateAccount`, `createTransfer`, `listAccountTransactions`** (perto das funções de conta):
```ts
export async function updateAccount(collaboratorId: string, id: string, patch: { name?: string; type?: PfAccountType; icon?: string | null; goal_monthly?: number | null; bank_slug?: string | null; color?: string | null }) {
  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['name', 'type', 'icon', 'goal_monthly', 'bank_slug', 'color'] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { data, error } = await supabase.from('pf_accounts')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}

// Transferência: insere em pf_transfers; um TRIGGER no banco ajusta os 2 saldos (sem math manual).
export async function createTransfer(collaboratorId: string, input: { from_account: string; to_account: string; amount: number; description?: string | null; transfer_date?: string }) {
  const row: Record<string, unknown> = {
    collaborator_id: collaboratorId, from_account: input.from_account, to_account: input.to_account,
    amount: input.amount, description: input.description ?? null,
  };
  if (input.transfer_date) row.transfer_date = input.transfer_date;
  const { data, error } = await supabase.from('pf_transfers').insert(row).select().single();
  if (error) throw error;
  return data;
}

// Extrato da carteira: lançamentos (caixa) dessa conta, recentes primeiro.
export async function listAccountTransactions(collaboratorId: string, accountId: string, limit = 50): Promise<PfTransaction[]> {
  const { data, error } = await supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, purchase_group')
    .eq('collaborator_id', collaboratorId).eq('account_id', accountId)
    .order('transaction_date', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as PfTransaction[]) ?? [];
}
```
- [ ] **Step 5: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit` (a mudança de PfAccount pode acusar pontos que não passam bank_slug/color — mas como são campos novos lidos, não deve quebrar consumidores; se acusar, reporte).

---

## Task 4: PWA hooks — useUpdateAccount + useCreateTransfer + useAccountTransactions

**Files:** Modify `web/src/hooks/useFinanceiro.ts`

- [ ] **Step 1: Adicionar** (perto de useCreateAccount ~145):
```ts
export const useUpdateAccount = () => useFinMutation(
  (cid, args: { id: string; patch: Parameters<typeof fin.updateAccount>[2] }) => fin.updateAccount(cid, args.id, args.patch)
);
export const useCreateTransfer = () => useFinMutation(
  (cid, args: Parameters<typeof fin.createTransfer>[1]) => fin.createTransfer(cid, args)
);
export function useAccountTransactions(accountId: string | undefined) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'account-tx', accountId, cid],
    queryFn: () => fin.listAccountTransactions(cid!, accountId!),
    enabled: !!cid && !!accountId,
  });
}
```
- [ ] **Step 2: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit`.

---

## Task 5: PWA — componente `BankLogo`

**Files:** Create `web/src/screens/financeiro/components/BankLogo.tsx`

- [ ] **Step 1: Implementar** (img oficial → fallback inicial-na-cor):
```tsx
import { useState } from 'react';
import { BANKS, logoUrl } from '../../../lib/banks';

export function BankLogo({ slug, name, color, size = 38 }: { slug?: string | null; name?: string | null; color?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const info = slug ? BANKS[slug] : undefined;
  const bg = color || info?.color || '#6B7280';
  const showImg = !!slug && !failed;
  const initial = (name || info?.name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="inline-flex items-center justify-center rounded-[10px] overflow-hidden shrink-0"
      style={{ width: size, height: size, background: showImg ? '#fff' : bg }}>
      {showImg ? (
        <img src={logoUrl(slug!)} alt={name || slug || ''} width={size} height={size}
          style={{ objectFit: 'contain', padding: size * 0.12 }} onError={() => setFailed(true)} />
      ) : (
        <span style={{ color: '#fff', fontWeight: 800, fontSize: size * 0.42 }}>{initial}</span>
      )}
    </span>
  );
}
```
- [ ] **Step 2: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`.

---

## Task 6: PWA — `AccountSheet` edição + personalização (banco/cor/meta)

**Files:** Modify `web/src/screens/financeiro/components/AccountSheet.tsx`

Contexto: hoje é create-only (props `{ open, onClose }`), campos name + emoji picker + type. Vamos: prop `initial?: PfAccount` (edição), seletor de banco (BankLogo grid → seta bank_slug+color do catálogo), paleta de cor, meta mensal (goal_monthly), opção "outro" (emoji, sem banco), e Desativar no footer (edição). Espelhe o footer do `TransactionSheet` (Apagar/Excluir + Salvar).

- [ ] **Step 1: Implementar** — leia o `AccountSheet.tsx` e `TransactionSheet.tsx` (footer) primeiro. Mudanças:
- Props: `{ open: boolean; onClose: () => void; initial?: PfAccount }`. `const isEdit = !!initial;`
- Importar `BankLogo`, `BANKS`, `useUpdateAccount`, `useDeactivateAccount`, `PfAccount`.
- Estado: name, type, icon, `bankSlug: string|null`, `color: string|null`, `goalText` (goal_monthly). `useEffect([open, initial])` pré-preenche de `initial` (ou limpa no create).
- **Seletor de Banco:** grid de `BankLogo` pra cada slug de `BANKS` + um tile "💵 Outro". Clicar num banco → `setBankSlug(slug); setColor(BANKS[slug].color)`. "Outro" → `setBankSlug(null)` (mantém emoji/cor escolhidos).
- **Cor:** paleta de ~6 cores (inclui a do banco) — `setColor`. (Input simples; quando banco escolhido, default = cor dele.)
- **Meta mensal:** input decimal (R$), opcional → goal_monthly (null se vazio).
- **Ícone (emoji):** mantém o picker atual (usado quando "Outro" / sem banco).
- Título: `isEdit ? 'Editar carteira' : 'Nova carteira'`.
- `submit()` (create): `createMut.mutateAsync({ name, type, icon, bank_slug: bankSlug, color, goal_monthly: goalText ? Number(goalText.replace(',','.')) : null })`.
- `save()` (edit): `updateMut.mutateAsync({ id: initial!.id, patch: { name, type, icon, bank_slug: bankSlug, color, goal_monthly: goalText ? Number(goalText.replace(',','.')) : null } })`.
- `deactivate()`: `deactivateMut.mutateAsync(initial!.id)` (com confirm) → onClose.
- Footer: em edit, **Desativar** (`variant="danger" size="sm"`) à esquerda + Cancelar + Salvar; em create, Cancelar + Criar carteira.
- DS puro, token `tom`, texto preto no verde.

- [ ] **Step 2: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`.

---

## Task 7: PWA — `LancamentoSheet` aceita `initialAccountId` (pro "Lançar aqui")

**Files:** Modify `web/src/screens/financeiro/components/LancamentoSheet.tsx`

- [ ] **Step 1: Prop + pré-seleção:**
- Props (`~32`): adicionar `initialAccountId?: string`.
- No `useEffect([open])` que reseta (`~64`): trocar `setMedio('')` por `setMedio(initialAccountId ? \`acc:${initialAccountId}\` : '')`. Adicionar `initialAccountId` às deps do effect: `}, [open, initialAccountId]);`
- [ ] **Step 2: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build` (chamadores existentes sem a prop continuam ok — é opcional).

---

## Task 8: PWA — `TransferSheet` (novo)

**Files:** Create `web/src/screens/financeiro/components/TransferSheet.tsx`

- [ ] **Step 1: Implementar** — sheet de transferência (DS puro):
```tsx
import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { Button } from '../../../components/Button';
import { CustomSelect } from '../../../components/CustomSelect';
import { DateInput } from '../../../components/DateInput';
import { Field } from '../../../components/Field';
import { useAccounts, useCreateTransfer } from '../../../hooks/useFinanceiro';

function todayYmd() { return new Date().toISOString().slice(0, 10); }

export function TransferSheet({ open, onClose, fromAccountId }: { open: boolean; onClose: () => void; fromAccountId?: string }) {
  const accountsQ = useAccounts();
  const mut = useCreateTransfer();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [amountText, setAmountText] = useState(''); const [date, setDate] = useState(todayYmd());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) { setFrom(fromAccountId ?? ''); setTo(''); setAmountText(''); setDate(todayYmd()); } }, [open, fromAccountId]);

  const accs = accountsQ.data ?? [];
  const optsFrom = [{ value: '', label: '— escolha —' }, ...accs.map(a => ({ value: a.id, label: `${a.icon ?? '🏦'}  ${a.name}` }))];
  const optsTo = [{ value: '', label: '— escolha —' }, ...accs.filter(a => a.id !== from).map(a => ({ value: a.id, label: `${a.icon ?? '🏦'}  ${a.name}` }))];
  const amount = Number(amountText.replace(',', '.'));
  const invalid = !from || !to || from === to || !isFinite(amount) || amount <= 0;

  async function submit() {
    if (invalid) return;
    setSubmitting(true);
    try { await mut.mutateAsync({ from_account: from, to_account: to, amount, transfer_date: date }); onClose(); }
    catch (e) { alert((e as Error).message); } finally { setSubmitting(false); }
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Transferir entre carteiras" size="sm">
      <div className="flex flex-col gap-md">
        <Field label="De"><CustomSelect value={from} options={optsFrom} onChange={setFrom} /></Field>
        <Field label="Para"><CustomSelect value={to} options={optsTo} onChange={setTo} /></Field>
        <Field label="Valor">
          <div className="flex items-baseline gap-1 border-b border-border">
            <span className="text-fg-muted">R$</span>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0,00"
              className="w-full bg-transparent text-[24px] font-bold tabular-nums text-fg focus:outline-none" />
          </div>
        </Field>
        <Field label="Data"><DateInput value={date} onChange={setDate} /></Field>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={submitting || invalid}>{submitting ? 'Transferindo…' : 'Transferir'}</Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
```
(Antes: confirme props reais de `AdaptiveSheet`/`Field`/`CustomSelect`/`DateInput` no GoalSheet/ContributionSheet e ajuste.)
- [ ] **Step 2: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`.

---

## Task 9: PWA — `CarteiraDetalhePage` (nova) + rota

**Files:** Create `web/src/screens/financeiro/CarteiraDetalhePage.tsx`; Modify `web/src/App.tsx`

- [ ] **Step 1: Rota** (`App.tsx`) — lazy import + rota (padrão de `financeiro/cartoes/:id`):
```tsx
const CarteiraDetalhePage = lazy(() => import('./screens/financeiro/CarteiraDetalhePage').then(m => ({ default: m.CarteiraDetalhePage })));
// ...
<Route path="financeiro/carteiras/:id" element={<CarteiraDetalhePage />} />
```
- [ ] **Step 2: Criar `CarteiraDetalhePage.tsx`** — molde da CartaoDetalhePage. Estrutura:
- `const { id = '' } = useParams();` `const cid = useFinanceiroAuth();` `useRealtimeFinance(['pf_accounts','pf_transactions','pf_transfers'], cid);`
- `const accountsQ = useAccounts();` `const acc = accountsQ.data?.find(a => a.id === id);` (loading / "Carteira não encontrada" → Link voltar).
- `const txQ = useAccountTransactions(id);`
- Estado: `editOpen`, `transferOpen`, `lancarOpen`.
- **Header:** `<Link to="/financeiro/carteiras">← Carteiras</Link>` + à direita ⭐ (useSetPrimaryAccount, escondido se já primary) + ✏️ Editar (abre AccountSheet initial=acc).
- **Herói:** faixa de cor (`acc.color || BANKS[acc.bank_slug]?.color`) no topo; `<BankLogo slug={acc.bank_slug} name={acc.name} color={acc.color} size={44} />` + nome + tipo (+ "principal" se is_primary) + **saldo** grande (cor: negativo vermelho). Se `acc.goal_monthly`, linha "Meta de guardar/mês: R$ X" + (opcional) "guardado no mês: R$ Y" onde Y = soma líquida (income−expense) das transações da conta no mês corrente, clamp ≥0.
- **Botões:** `Transferir` (`Button` → setTransferOpen) e `Lançar aqui` (`Button variant="secondary"` → setLancarOpen).
- **Extrato:** lista de `txQ.data` (emoji da categoria via catLookup se houver, descrição/categoria, data, valor +/-). Vazio → "Sem lançamentos nesta carteira."
- **Sheets:** `<AccountSheet open={editOpen} initial={acc} onClose=.../>`, `<TransferSheet open={transferOpen} fromAccountId={acc.id} onClose=.../>`, `<LancamentoSheet open={lancarOpen} initialAccountId={acc.id} onClose=.../>`.
- Container `md:max-w-3xl md:mx-auto`. DS puro, texto preto no verde.
- [ ] **Step 3: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build` + preview `/financeiro/carteiras/<id>`.

---

## Task 10: PWA — `CarteirasPage` com BankLogo + card clicável

**Files:** Modify `web/src/screens/financeiro/CarteirasPage.tsx`

- [ ] **Step 1:**
- No `AccountCard`: trocar o emoji por `<BankLogo slug={account.bank_slug} name={account.name} color={account.color} size={40} />`; adicionar acento de cor (ex.: `borderLeft: 4px solid ${account.color || BANKS[account.bank_slug]?.color || 'transparent'}` via style).
- Tornar o card clicável → `navigate('/financeiro/carteiras/' + account.id)`. Os botões ⭐ e Desativar com `e.stopPropagation()` pra não navegar.
- Importar `BankLogo`, `BANKS`, `useNavigate`.
- [ ] **Step 2: Validar** — `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build` + preview (lista com logos; clique abre detalhe).

---

## Task 11: Backend/TOM — updateAccount + edit_account + create_account auto-banco + skill + deploy

**Files:** Modify `src/services/financeiro-service.js`, `src/engine.js`, `skills/financeiro-pessoal.md`

- [ ] **Step 1: Serviço — `matchBankSlug` + cores + `updateAccount`** (em `financeiro-service.js`):
```js
const BANK_CATALOG = {
  nubank:{color:'#820ad1'}, itau:{color:'#ec7000'}, bradesco:{color:'#cc092f'}, santander:{color:'#ec0000'},
  bb:{color:'#fcbf00'}, caixa:{color:'#005ca9'}, c6:{color:'#242424'}, inter:{color:'#ff7a00'},
  mercadopago:{color:'#00b1ea'}, picpay:{color:'#21c25e'}, neon:{color:'#00e5a0'}, will:{color:'#ff0066'},
  pagbank:{color:'#00a651'}, btg:{color:'#00263a'}, next:{color:'#00dc5a'}, original:{color:'#00a868'},
};
const BANK_NAMES = { nubank:'nubank', itau:'itau', bradesco:'bradesco', santander:'santander', bb:'banco do brasil',
  caixa:'caixa', c6:'c6 bank', inter:'inter', mercadopago:'mercado pago', picpay:'picpay', neon:'neon',
  will:'will bank', pagbank:'pagbank', btg:'btg', next:'next', original:'original' };
function _normBank(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim(); }
function matchBankSlug(name){
  const n=_normBank(name); if(!n) return null;
  for (const slug of Object.keys(BANK_CATALOG)) { if (n===slug || n.includes(slug) || n.includes(BANK_NAMES[slug])) return slug; }
  return null;
}
async function updateAccount(collaboratorId, accountId, patch){
  const allowed={}; for (const k of ['name','type','icon','goal_monthly','bank_slug','color']) if (patch[k]!==undefined) allowed[k]=patch[k];
  allowed.updated_at=new Date().toISOString();
  const { data, error } = await supabase.from('pf_accounts').update(allowed).eq('id',accountId).eq('collaborator_id',collaboratorId).select().single();
  if (error) throw error; return data;
}
```
Exportar `updateAccount`, `matchBankSlug` no `module.exports`.

- [ ] **Step 2: `create_account` auto-banco** (engine.js ~6164):
```js
case 'create_account': {
  const slug = financeService.matchBankSlug(params.name || '');
  const color = slug ? financeService.bankColor(slug) : null;
  const a = await financeService.createAccount(cid, { name: params.name, type: params.type, icon: params.icon, goal_monthly: params.goal_monthly, bank_slug: slug, color });
  return `✅ Carteira criada: ${a.icon || '🏦'} ${a.name}.`;
}
```
(Adicionar helper `bankColor(slug)` no serviço: `return (BANK_CATALOG[slug]||{}).color || null;` e exportar.)

- [ ] **Step 3: Nova action `edit_account`** (após create_account):
```js
case 'edit_account': {
  const acc = await financeService.findAccountByName(cid, params.account_name || params.name || '');
  if (!acc) return 'Não achei essa carteira.';
  const patch = {};
  for (const k of ['name','type','icon','goal_monthly']) if (params[k] !== undefined) patch[k] = params[k];
  if (params.bank !== undefined) { const s = financeService.matchBankSlug(params.bank); if (s) { patch.bank_slug = s; patch.color = financeService.bankColor(s); } }
  const a = await financeService.updateAccount(cid, acc.id, patch);
  return `✏️ Carteira atualizada: ${a.icon || '🏦'} ${a.name}.`;
}
```
Registrar `'edit_account'` em `FINANCE_ACTIONS` (~5887).

- [ ] **Step 4: Skill** (`financeiro-pessoal.md`, perto de create_account/transfer):
```
- `create_account` — params: name, type, icon. (O banco é detectado pelo nome → logo+cor no app.)
- `edit_account` — params: account_name + os que mudam: name, type, icon, goal_monthly, bank. Ex.: "põe meta de 500 na carteira Itaú", "renomeia carteira X pra Y".
```

- [ ] **Step 5: Validar + deploy:**
`node --check src/engine.js && node --check src/services/financeiro-service.js`
`scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js && scp /d/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js && scp /d/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md && ssh tom "pm2 restart tom"`

---

## Task 12: Verificação E2E + reconciliação de transferência + deploy

- [ ] **Step 1: Suites + build** — `cd /d/la-organizer/_remote/web && npx vitest run && npx tsc --noEmit && npx vite build`; `node --check src/engine.js src/services/financeiro-service.js`.
- [ ] **Step 2: Smoke PWA (preview, cache SW limpo):** editar carteira (escolher banco → logo+cor; meta mensal); abrir detalhe (logo+saldo+extrato); transferir entre 2 carteiras → conferir que o saldo das duas muda corretamente; "Lançar aqui" abre o LancamentoSheet já na carteira; BankLogo cai na inicial pra banco sem svg. 375 + 1440.
- [ ] **Step 3: Reconciliação da transferência** — `execute_sql` (antes/depois de uma transferência de teste):
```sql
SELECT a.name, a.balance,
       COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END),0)
       + COALESCE((SELECT SUM(amount) FROM pf_transfers WHERE to_account=a.id),0)
       - COALESCE((SELECT SUM(amount) FROM pf_transfers WHERE from_account=a.id),0) AS calc
FROM pf_accounts a LEFT JOIN pf_transactions t ON t.account_id=a.id AND t.card_id IS NULL
WHERE a.collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f' AND a.is_active
GROUP BY a.id, a.name, a.balance;
```
Esperado: `balance == calc` (saldo bate com lançamentos ± transferências) — confirma que o trigger de transferência está correto.
- [ ] **Step 4: Smoke WhatsApp (bilateral):** "cria carteira Bradesco" (vem bank_slug bradesco), "põe meta de 500 na carteira Itaú" (edit_account), "transfere 100 do Itaú pro Nubank" (transfer); conferir reflexo no app.
- [ ] **Step 5: Encerrar turno** — Stop hook commita web/ + migration + spec/plano. Engine já via SCP.

---

## Notas de execução
- **Ordem:** 1 (migration) → 2-4 (catálogo/lib/hooks) → 5 (BankLogo) → 6 (AccountSheet) → 7-8 (LancamentoSheet prop + TransferSheet) → 9 (detalhe + rota) → 10 (lista) → 11 (backend/TOM, deploy) → 12 (verificação). Task 9 (detalhe) e a migration são as sensíveis (Opus); resto Sonnet.
- **Transferência:** só INSERT em pf_transfers — trigger do banco ajusta os 2 saldos. NUNCA fazer math de saldo manual.
- **Segurança:** filtro collaborator_id em updateAccount/createTransfer/listAccountTransactions; whitelist em updateAccount; RLS de pf_accounts/pf_transfers já existente.
- **Logos:** BankLogo tenta `/banks/<slug>.svg`, senão inicial-na-cor. SVGs faltantes não quebram nada.
