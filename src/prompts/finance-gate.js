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
const FINANCE_RE = /\b(comprovante|nota\s+fiscal|cupom\s+fiscal|r\$\s*\d+|gastei|recebi|paguei|cart[ãa]o|fatura|parcel\w+|transfer[eiêí]\w*|cr[ée]dito|d[ée]bito|\bpix\b|boleto|\d+\s*x\b|limite|sal[áa]rio|comiss[ãa]o|aluguel|ifood|mercado|uber|gasolina|combust[íi]vel|farm[áa]cia|or[çc]amento|meta|guard\w+\s+(?:r\$\s*)?\d+|separ\w+\s+(?:r\$\s*)?\d+|guard\w+\s+(?:dinheiro|grana)|poupan[çc]a|caixinha|cofrinho|investir|selic|juros|sonho|quanto\s+gastei|contas?\s+(?:a\s+pagar|vencendo|fix\w+|de\s+(?:luz|[áa]gua|internet|telefone|g[áa]s))|(?:preciso|tenho|falta|o\s+que\s+(?:eu\s+)?(?:tenho|preciso))\s+(?:pra\s+|para\s+)?pagar|pagar\s+dia\s+\d+|cadastr\w*\s+(?:a\s+)?(?:uma\s+)?conta|(?:cria\w*|nova|abr\w+|cadastr\w*)\s+(?:uma\s+)?carteira|minhas?\s+carteiras?|assinatura|mensalidade|netflix|spotify|disney|academia|condom[íi]nio)\b/i;

function financeGateMatches(message) {
  return FINANCE_RE.test(String(message || ''));
}

module.exports = { FINANCE_RE, financeGateMatches };
