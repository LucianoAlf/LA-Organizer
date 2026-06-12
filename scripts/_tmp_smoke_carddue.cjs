// Smoke E2E do fix CARD-DUE-RECURRING-GAP — roda na VPS (engine.js já patchado).
// NÃO muta dados: usa card_confirm (não escreve) + ask_value; e prova que o caminho antigo
// (createBill amount null) ainda estoura no serviço (insert rejeitado por NOT NULL, sem row).
const { handleFinanceAction } = require('/opt/LA-Organizer/src/engine');
const financeService = require('/opt/LA-Organizer/src/services/financeiro-service');
const ROSE = '8bfb18b6-3c2e-4579-b4a9-06409d7e84c4';

(async () => {
  const cards = await financeService.listCards(ROSE);
  console.log('CARDS:', JSON.stringify(cards.map((c) => ({ name: c.name, due_day: c.due_day }))));
  const collab = { id: ROSE };

  // 1) card_confirm — cartão COM due_day → confirma, sem mutar, sem throw.
  const withDue = cards.find((c) => c.due_day != null);
  if (withDue) {
    const o = {};
    const r = await handleFinanceAction(collab, 'register_bill', { name: withDue.name }, o);
    console.log('\n[1] CARD_CONFIRM persisted=' + o.persisted + '\n    ' + r);
  } else {
    console.log('\n[1] (nenhum cartão com due_day para testar confirm)');
  }

  // 2) ask_value — nome que não é cartão, sem amount → pede valor, sem throw, sem cadastrar.
  {
    const o = {};
    const r = await handleFinanceAction(collab, 'register_bill', { name: 'ZZ_TESTE_NAO_EXISTE_CARDDUE' }, o);
    console.log('\n[2] ASK_VALUE persisted=' + o.persisted + '\n    ' + r);
  }

  // 3) Prova da causa-raiz: caminho antigo (createBill amount null) AINDA estoura no serviço.
  //    Insert é rejeitado por NOT NULL → throw, nenhuma linha criada (não muta).
  try {
    await financeService.createBill(ROSE, { name: 'ZZ_TESTE_NULLAMT', due_day: 10, recurrence: 'monthly' });
    console.log('\n[3] OLD PATH: NÃO estourou (inesperado!)');
  } catch (e) {
    console.log('\n[3] OLD PATH ainda estoura no serviço (esperado): ' + e.message);
  }

  process.exit(0);
})();
