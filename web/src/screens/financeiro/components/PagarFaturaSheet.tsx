// Sheet de pagamento de fatura de cartão (parcial/total + conta de origem).
// Extraído de CartaoDetalhePage pra ser reusado na tela Contas a pagar (seção "Faturas de cartão").
import { useState } from 'react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { Button } from '../../../components/Button';
import { showToast } from '../../../components/Toast';
import { useCards, useCardInvoice, useAccounts, usePayInvoice } from '../../../hooks/useFinanceiro';
import { currentCompetencia, mesDaCompetencia } from '../../../lib/cartoes';

const fmtBRL = (v: number) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PagarFaturaSheet({ open, onClose, cardId, competencia }: { open: boolean; onClose: () => void; cardId: string; competencia?: string }) {
  const cardsQ = useCards();
  const card = cardsQ.data?.find((c) => c.id === cardId);
  const comp = competencia ?? (card ? currentCompetencia(card) : undefined);
  const inv = useCardInvoice(cardId, comp);
  const accountsQ = useAccounts();
  const payMut = usePayInvoice();
  const [amount, setAmount] = useState('');
  const [fromAcc, setFromAcc] = useState('');

  const remaining = inv.data?.remaining ?? 0;
  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';

  // PAGAMENTO QUE SOME (13/08/2026 — caso do Cartão Itaú Matheus, R$ 950,21 de agosto).
  // A pessoa clicou em "Registrar pagamento", o botão girou, e NADA foi gravado — nem em
  // `pf_card_payments` nem em `pf_transactions`. Ela saiu achando que tinha pago.
  //
  // Causa: os três caminhos de falha daqui eram MUDOS.
  //   1. `if (!card || !comp) return`  → some sem dizer
  //   2. `if (value <= 0) return`      → some sem dizer
  //   3. `await mutateAsync(...)` SEM try/catch → o erro (RLS, rede, constraint) virava
  //      rejection não tratada; `useFinMutation` não tem `onError`, então a tela ficava
  //      exatamente igual a antes do clique.
  //
  // Dinheiro que some em silêncio é o pior tipo de falha silenciosa: a pessoa reorganiza a
  // vida financeira dela em cima de uma informação que o sistema sabia ser falsa.
  async function submit() {
    if (!card || !comp) {
      showToast({ kind: 'error', title: 'Não consegui identificar a fatura', msg: 'Fecha e abre de novo. Se persistir, me avisa.' });
      return;
    }
    const value = Number(amount) > 0 ? Number(amount) : remaining;
    if (value <= 0) {
      showToast({
        kind: 'error',
        title: 'Nada a pagar nesta fatura',
        msg: inv.isLoading ? 'A fatura ainda está carregando — espera um segundo e tenta de novo.'
          : 'O valor em aberto está zerado. Digita o valor no campo acima se quiser lançar mesmo assim.',
      });
      return;
    }
    try {
      await payMut.mutateAsync({ card, competencia: comp, amount: value, paid_from_account: fromAcc || null });
    } catch (e) {
      // NUNCA fechar o sheet aqui: fechar depois de falhar é o que faz a pessoa achar que deu certo.
      const m = e instanceof Error ? e.message : String(e);
      const semPermissao = /row-level security|permission|policy|denied/i.test(m);
      showToast({
        kind: 'error',
        title: 'O pagamento NÃO foi registrado',
        msg: semPermissao
          ? 'Esse cartão é de outra pessoa — só quem é dono dele pode dar baixa na fatura.'
          : `Nada foi gravado. Tenta de novo. (${m.slice(0, 120)})`,
      });
      return;
    }
    setAmount(''); setFromAcc('');
    showToast({ kind: 'success', title: 'Pagamento registrado', msg: `${fmtBRL(value)} na fatura de ${mesDaCompetencia(comp)}.` });
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`Pagar fatura de ${mesDaCompetencia(comp ?? '')}`}>
      <div className="flex flex-col gap-md">
        <p className="text-fg-muted text-body-sm">Fatura atual: <b className="text-fg">{fmtBRL(inv.data?.total ?? 0)}</b> · falta <b className="text-fg">{fmtBRL(remaining)}</b></p>
        <Field label="Valor a pagar" sub="Vazio = paga a fatura toda">
          <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={fmtBRL(remaining)} />
        </Field>
        <Field label="Sai de qual carteira?">
          <CustomSelect
            value={fromAcc}
            options={(accountsQ.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
            onChange={setFromAcc}
            placeholder="Selecione a conta"
          />
        </Field>
        <Button variant="primary" fullWidth loading={payMut.isPending} onClick={submit}>
          Registrar pagamento
        </Button>
      </div>
    </BottomSheet>
  );
}
