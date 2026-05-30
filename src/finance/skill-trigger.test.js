// Valida o FINANCE_RE (gatilho da skill em pickSkill) contra as mensagens reais
// que falharam no smoke. Mantém o regex em sincronia: o MESMO pattern vai em system.js.
const { test } = require('node:test');
const assert = require('node:assert');

// Pattern CANDIDATO — deve ser idêntico ao FINANCE_RE em src/prompts/system.js.
const FINANCE_RE = /\b(gastei|recebi|paguei|sal[áa]rio|comiss[ãa]o|aluguel|ifood|mercado|uber|gasolina|farm[áa]cia|or[çc]amento|meta|guard\w+\s+(?:r\$\s*)?\d+|separ\w+\s+(?:r\$\s*)?\d+|guard\w+\s+(?:dinheiro|grana)|poupan[çc]a|caixinha|investir|selic|juros|sonho|quanto\s+gastei|conta\s+(?:a\s+pagar|vencendo|fixa|de\s+(?:luz|[áa]gua|internet|telefone|g[áa]s))|cadastr\w*\s+(?:a\s+)?(?:uma\s+)?conta|assinatura|mensalidade|netflix|spotify|disney|academia|condom[íi]nio)\b/i;

// RECURRENCE_RE (cópia do system.js) — pra provar que NÃO sombreia as msgs de meta.
const RECURRENCE_RE = /todo\s+(?:dia|m[eê]s|ano|natal)|toda\s+(?:segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado|domingo|semana)|a\s+cada\s+\d+\s+(?:dia|semana|m[eê]s|ano)|(?:[uú]ltim[ao]|primeir[ao]|segund[ao]|terceir[ao]|quart[ao])\s+(?:segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado|domingo|dia\s+do\s+m[eê]s)|dia\s+[uú]til|fim\s+de\s+semana|mensal|semanal|di[áa]rio|anual|quinzenal|trimestral|recorrente|que\s+se\s+repete|repete\s+(?:toda|todo|a\s+cada)|todo\s+dia\s+\d+/i;

const MATCH = [
  'quero comprar um carro de 20 mil em 2 anos guardando 500 por mês',
  'guardei 500 pro carro',
  'separei 200 pra viagem',
  'quero guardar dinheiro',
  'gastei 45 no iFood',
  'recebi 2800 de salário',
  'define orçamento de alimentação 500',
  'como tá meu orçamento',
  'quanto gastei esse mês?',
  'cadastra conta Netflix de 40 reais dia 2',
  'cadastra a conta de luz dia 10',
  'quero cadastrar uma conta fixa',
  'assinatura da academia',
];
const NO_MATCH = [
  'guardar o equipamento no armário', // inventário, não finanças
  'me lembra de treinar todo dia',
];

for (const m of MATCH) {
  test(`FINANCE_RE casa: "${m}"`, () => assert.ok(FINANCE_RE.test(m), 'deveria casar'));
}
for (const m of NO_MATCH) {
  test(`FINANCE_RE NÃO casa: "${m}"`, () => assert.ok(!FINANCE_RE.test(m), 'não deveria casar'));
}
test('RECURRENCE_RE não sombreia as mensagens de meta', () => {
  assert.ok(!RECURRENCE_RE.test('quero comprar um carro de 20 mil em 2 anos guardando 500 por mês'));
  assert.ok(!RECURRENCE_RE.test('guardei 500 pro carro'));
});

// EDU_FIN_RE (cópia do system.js) — roteamento educação vs ação financeira.
const EDU_FIN_RE = /\b(o\s+que\s+[ée]\s+(?:a\s+)?(?:selic|cdb|tesouro|fgc|caixinha|poupan[çc]a)|como\s+(?:funciona|invisto|come[çc]o\s+a\s+guardar|fa[çc]o\s+pra\s+investir)|me\s+explica\s+(?:juros|selic|investiment)|vale\s+a\s+pena\s+investir|diferen[çc]a\s+entre|tesouro\s+direto|reserva\s+de\s+emerg[êe]ncia|50\/30\/20|juros\s+compost|como\s+investir)\b/i;

test('EDU_FIN_RE casa perguntas conceituais', () => {
  assert.ok(EDU_FIN_RE.test('o que é selic?'));
  assert.ok(EDU_FIN_RE.test('como investir meu dinheiro'));
  assert.ok(EDU_FIN_RE.test('me explica juros compostos'));
  assert.ok(EDU_FIN_RE.test('vale a pena investir na poupança?'));
});
test('EDU_FIN_RE NÃO rouba as ações financeiras (vão pro financeiro)', () => {
  assert.ok(!EDU_FIN_RE.test('gastei 45 no iFood'));
  assert.ok(!EDU_FIN_RE.test('guardei 500 pro carro'));
  assert.ok(!EDU_FIN_RE.test('define orçamento de alimentação 500'));
});
