# Handoff → chat "Financeiro Pessoal" (2026-06-24)

Origem: chat de coordenação (não-engine). Estes 2 itens são **insumos do teu programa de raízes** — já investigados/testados nesta sessão. Integra quando chegar na Raiz 2 e na Raiz 1/3. Eu **não** vou tocar no `engine.js` (é teu).

---

## 1. FATURA: comprovante "Sim" = no-op (FIN-RECEIPT-CONFIRM-NOOP) — **Raiz 2**

**Sintoma (Alf, 22/06):** mandou o comprovante da fatura Nubank → TOM perguntou *"marco como paga? Confirma?"* → Alf "Sim" → TOM "✅ assunto fechado". Mas a tarefa `931c3ce1` seguiu `pending` e `pf_card_payments` ficou **vazia**.

**Causa-raiz:** o comprovante virava PERGUNTA em prosa do LLM → intent `kind=confirmation` **PASSIVA** (sem `payload.actions`) → o "Sim" auto-resolvia `confirmed` mas era no-op. O motor determinístico `stagePayInvoice` (engine.js:7104) nunca era chamado porque dependia do LLM emitir `pay_invoice`. (É a tua Raiz 2 na veia: confab/sincronia fala↔execução, consertada por prompt no passado, furou de novo.)

**Fix pronto e testado** (já no disco, podes ler direto):
- `src/finance/invoice-receipt.js` — detector puro `detectInvoicePaymentReceipt(text)` → `{cardHint, amount}` ou `null`. Discrimina comprovante de fatura vs gasto comum/Pix/import.
- `src/finance/invoice-receipt.test.js` — **8/8**, inclui o texto REAL do comprovante do Alf → `{Nubank, 6295.54}`.

**Wiring (eu REVERTI do engine.js pra não colidir contigo — re-aplica quando integrar):**
```js
// 1) require no topo (junto aos outros finance, ~linha 53):
const invoiceReceipt = require('./finance/invoice-receipt');

// 2) no processMessage, logo após `const _refYear = ...` e ANTES do "Intercept A0":
try {
  const _rcpt = invoiceReceipt.detectInvoicePaymentReceipt(text);
  if (_rcpt) {
    const _staged = await stagePayInvoice(collab.id, { card: _rcpt.cardHint, amount: _rcpt.amount });
    if (_staged) {
      const _pv = launchConfirm.buildPayInvoicePreview(_staged.display);
      const _pid = _pv ? await pendingIntents.openIntent(collab.id, 'finance_source',
        { form: 'launch_confirm', actions: [_staged.action], close_tasks: _staged.close_tasks }, _pv) : null;
      if (_pid) { await whatsapp.sendMessage(phone, _pv); await logConversation(collab.id, 'outbound', _pv); return; }
    }
  }
} catch (e) { console.warn('[Fatura] intercept A2 (comprovante) err:', e.message); }
```
O executor que **paga + fecha a tarefa** no "Sim" já existe (engine.js:7929, lê `payload.close_tasks`, escopo do dono). Reparo de dado pendente: a tarefa `931c3ce1` do Alf segue `pending` — fechar OU pedir pro Alf reenviar o comprovante pós-fix.

---

## 2. DELETE-ÓRFÃO: deletar evento deixa tarefas cobrando — **Raiz 1+3**

**Causa-raiz (provada no banco):** FK `tasks.school_event_id` = `SET NULL` (não CASCADE/cancel). Deletar um `school_events` deixa as tarefas-filhas vivas (`pending`), só **desvinculadas** → viram cobrança fantasma sem contexto. (Caso Alf: o evento de 28/06 na verdade NÃO foi deletado — está vivo/legítimo — mas a regra está furada pra quando *de fato* deletar. `project_id` tem o mesmo `SET NULL`.)

**Fix sugerido:** ao deletar evento, **cancelar as filhas abertas** (`status='cancelled'`) — app-level no handler de delete (`web/.../EventoDetalhe`/`EditEventSheet`) + (Raiz 3) trigger/constraint no banco. Defesa em profundidade.

---

*Qualquer dúvida, o chat de coordenação fica de revisor (segundo par de olhos + teste com a frase real). Não mexo no engine sem combinar.*
