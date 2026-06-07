// Gate de carregamento da skill financeiro-pessoal (pickSkill em system.js).
// Extraído pra módulo único + testável porque ESTE regex já causou 2 incidentes de
// "skill: none → TOM nega capacidade / manda usar o app" (FIN-LIST-SKILL 03/06,
// FIN-GATE-CONTAS 07/06). Toda vez que uma frase financeira real escapa daqui, o
// TOM regride. Mudou o regex? Rode scripts/smoke-finance-gate.js.
//
// Cobre: comprovante; "R$ <n>"; verbos (gastei/recebi/paguei); cartão/fatura/parcela/
// crédito/débito/pix/boleto; categorias comuns (ifood/mercado/uber/gasolina/combustível/
// farmácia); orçamento/meta/poupança/investir/selic; contas fixas (singular E PLURAL) e
// "pagar dia N / preciso pagar"; carteiras; assinaturas conhecidas.
// Cobre também (F5 — R-GASTOS/R-CONTA/R-EXTRATO): extrato, gasto|gastos, lançament,
// saldo, quanto tenho, como (está|tá|ta) (o|a|meu|minha).
// Cobre também (F6 — R-DIARIO/R-SEMANA/R-MENSAL): resumo do dia/semana/mês,
// balanço do dia, fechamento (do mês), como fechou <mês>, resumo de <mês>.
const MESES = 'janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const FINANCE_RE = new RegExp(
  '\\b(comprovante|nota\\s+fiscal|cupom\\s+fiscal|r\\$\\s*\\d+|gastei|gastos?\\b|recebi|paguei|cart[ãa]o|fatura|parcel\\w+|transfer[eiêí]\\w*|cr[ée]dito|d[ée]bito|\\bpix\\b|boleto|\\d+\\s*x\\b|limite|sal[áa]rio|comiss[ãa]o|aluguel|ifood|mercado|uber|gasolina|combust[íi]vel|farm[áa]cia|or[çc]amento|meta|guard\\w+\\s+(?:r\\$\\s*)?\\d+|separ\\w+\\s+(?:r\\$\\s*)?\\d+|guard\\w+\\s+(?:dinheiro|grana)|poupan[çc]a|caixinha|cofrinho|investir|selic|juros|sonho|quanto\\s+gastei|extrato|lan[çc]ament\\w*|saldo|quanto\\s+tenho|contas?\\s+(?:a\\s+pagar|vencendo|fix\\w+|de\\s+(?:luz|[áa]gua|internet|telefone|g[áa]s))|(?:preciso|tenho|falta|o\\s+que\\s+(?:eu\\s+)?(?:tenho|preciso))\\s+(?:pra\\s+|para\\s+)?pagar|pagar\\s+dia\\s+\\d+|cadastr\\w*\\s+(?:a\\s+)?(?:uma\\s+)?conta|(?:cria\\w*|nova|abr\\w+|cadastr\\w*)\\s+(?:uma\\s+)?carteira|minhas?\\s+carteiras?|assinatura|mensalidade|netflix|spotify|disney|academia|condom[íi]nio|' +
  // F6 — R-DIARIO
  'resumo\\s+do\\s+dia|balan[çc]o\\s+do\\s+dia|' +
  // F6 — R-SEMANA
  'resumo\\s+da\\s+semana|' +
  // F6 — R-MENSAL: fechamento + resumo de <mês>
  'fechamento(?:\\s+do\\s+m[êe]s)?|resumo\\s+de\\s+(?:' + MESES + ')' +
  ')\\b|' +
  // F5: como está/tá o/a/meu/minha
  'como\\s+(?:est[áa]|t[aá])\\s+(?:o|a|meu|minha)\\b|' +
  // F6: como fechou <mês>
  'como\\s+fechou\\s+(?:' + MESES + ')\\b',
  'i'
);

function financeGateMatches(message) {
  return FINANCE_RE.test(String(message || ''));
}

module.exports = { FINANCE_RE, financeGateMatches };
