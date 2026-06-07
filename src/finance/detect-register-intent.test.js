'use strict';
// Testes do detector determinístico de REGISTRO de transação (rede anti-fabricação).
// Roda com: node --test src/finance/detect-register-intent.test.js
const test = require('node:test');
const assert = require('node:assert');
const { detectRegisterIntent, looksLikeFinanceConfirmation } = require('./detect-register-intent');

// ── O caso real que quebrou (Matheus 07/06): LLM fabricou "Entrada registrada" sem marker ──
test('caso Matheus: lança entrada com valor → income high-confidence', () => {
  const r = detectRegisterIntent('E outra coisa, lança aí 300,00 como entrada, show no dom costela');
  assert.ok(r, 'deve detectar registro');
  assert.strictEqual(r.type, 'income');
  assert.strictEqual(r.amount, 300);
  assert.strictEqual(r.confidence, 'high');
  assert.match(r.description, /show/i);
});

// ── Tipo por verbo de ação ──
test('gastei → expense', () => {
  const r = detectRegisterIntent('gastei 50 no mercado');
  assert.ok(r); assert.strictEqual(r.type, 'expense'); assert.strictEqual(r.amount, 50);
});
test('paguei → expense', () => {
  const r = detectRegisterIntent('paguei 120 de luz');
  assert.ok(r); assert.strictEqual(r.type, 'expense'); assert.strictEqual(r.amount, 120);
});
test('recebi → income', () => {
  const r = detectRegisterIntent('recebi 1.200,00 de comissão');
  assert.ok(r); assert.strictEqual(r.type, 'income'); assert.strictEqual(r.amount, 1200);
});
test('entrou/caiu → income', () => {
  assert.strictEqual(detectRegisterIntent('entrou 300 no nubank').type, 'income');
  assert.strictEqual(detectRegisterIntent('caiu 80 hoje').type, 'income');
});

// ── typeHint (texto fabricado) desambigua verbo neutro ──
test('verbo neutro + hint de receita do texto fabricado → income', () => {
  const r = detectRegisterIntent('lança aí 300 show no dom costela', { typeHint: '💰 Entrada registrada! Saldo NUBANK +R$ 2.258,03' });
  assert.ok(r); assert.strictEqual(r.type, 'income'); assert.strictEqual(r.amount, 300);
});

// ── Número brasileiro ──
test('R$ 1.234,56 → 1234.56', () => {
  assert.strictEqual(detectRegisterIntent('lança 1.234,56 de aluguel').amount, 1234.56);
});
test('300 reais → 300', () => {
  assert.strictEqual(detectRegisterIntent('anota 300 reais de show').amount, 300);
});

// ── BAIL: complexos demais p/ rede determinística (deixa o usuário refazer) ──
test('parcelado → null (complexo)', () => {
  assert.strictEqual(detectRegisterIntent('comprei tv 1200 em 10x no nubank'), null);
});
test('transferência → null', () => {
  assert.strictEqual(detectRegisterIntent('transferi 500 do nubank pro itau'), null);
});
test('múltiplos valores → null', () => {
  assert.strictEqual(detectRegisterIntent('gastei 50 no mercado e 30 na farmacia'), null);
});

// ── NÃO é registro: queries / conversa ──
test('pergunta de saldo → null', () => {
  assert.strictEqual(detectRegisterIntent('qual meu saldo no nubank?'), null);
});
test('quanto gastei → null', () => {
  assert.strictEqual(detectRegisterIntent('quanto gastei esse mes?'), null);
});
test('extrato → null', () => {
  assert.strictEqual(detectRegisterIntent('me manda o extrato do nubank'), null);
});
test('sem valor → null', () => {
  assert.strictEqual(detectRegisterIntent('lança um show pra mim'), null);
});
test('conversa sem verbo de registro → null', () => {
  assert.strictEqual(detectRegisterIntent('e aí, tudo certo com as 300 pessoas?'), null);
});
test('vazio/nulo → null', () => {
  assert.strictEqual(detectRegisterIntent(''), null);
  assert.strictEqual(detectRegisterIntent(null), null);
});

// ── Endurecimento adversarial (workflow 6-agentes, 145 casos) ──
test('pergunta com "?" → null (não registra)', () => {
  assert.strictEqual(detectRegisterIntent('já paguei o aluguel de 1200 esse mês?'), null);
  assert.strictEqual(detectRegisterIntent('recebi 300, certo?'), null);
  assert.strictEqual(detectRegisterIntent('entrou os 250 da comissao hoje?'), null);
  assert.strictEqual(detectRegisterIntent('tem certeza que paguei os 200 do cartao?'), null);
});
test('incerteza/recall sem "?" → null', () => {
  assert.strictEqual(detectRegisterIntent('comprei algo de 90 reais e nao lembro o que'), null);
  assert.strictEqual(detectRegisterIntent('acho que gastei uns 80 com isso'), null);
});
test('quantidade não é dinheiro → null', () => {
  assert.strictEqual(detectRegisterIntent('preciso comprar 2 cordas de nylon pro aluno'), null);
  assert.strictEqual(detectRegisterIntent('recebi 3 alunos novos essa semana pra avaliar'), null);
  assert.strictEqual(detectRegisterIntent('entrou 2 caras atrasados no meio da aula'), null);
});
test('multi-item com valores IGUAIS → null', () => {
  assert.strictEqual(detectRegisterIntent('gastei 40 no uber e mais 40 no almoco'), null);
  assert.strictEqual(detectRegisterIntent('recebi 200 do cliente e paguei 200 de comissao'), null);
});
test('gorjeta/cachê/me deram → income (léxico do Matheus)', () => {
  assert.strictEqual(detectRegisterIntent('me deram 100 de gorjeta, registra ai').type, 'income');
  assert.strictEqual(detectRegisterIntent('caiu o cachê de 800').type, 'income');
});
test('data dd/mm não conta como 2º valor', () => {
  const r = detectRegisterIntent('recebi 1500 no dia 05/06');
  assert.ok(r); assert.strictEqual(r.type, 'income'); assert.strictEqual(r.amount, 1500);
});
test('typeHint "recebimento" → income (receb\\w*)', () => {
  const r = detectRegisterIntent('lança 75 do show', { typeHint: 'recebimento confirmado' });
  assert.ok(r); assert.strictEqual(r.type, 'income'); assert.strictEqual(r.amount, 75);
});
test('verbo de gasto + substantivo "entrada" (ingresso) → expense, não bail', () => {
  const r = detectRegisterIntent('comprei 50 de entrada pro show');
  assert.ok(r); assert.strictEqual(r.type, 'expense'); assert.strictEqual(r.amount, 50);
});

// ── Round 2 adversarial: recall/agregado, parcelado coloquial, quantidade-antes ──
test('"né" no meio (desabafo) → null', () => {
  assert.strictEqual(detectRegisterIntent('gastei demais né, uns 1000'), null);
});
test('recall "lembra que paguei... mês passado" → null', () => {
  assert.strictEqual(detectRegisterIntent('lembra que paguei 800 de luz mês passado'), null);
});
test('"conferir os 300 que paguei" (auditar) → null', () => {
  assert.strictEqual(detectRegisterIntent('conferir os 300 que paguei'), null);
});
test('agregado do mês → null', () => {
  assert.strictEqual(detectRegisterIntent('recebi 1500 esse mês inteiro somando tudo'), null);
  assert.strictEqual(detectRegisterIntent('no mês passado gastei tipo 2000 no total'), null);
});
test('parcelado coloquial (carnê/prestações) → null', () => {
  assert.strictEqual(detectRegisterIntent('comprei tv 1200 no carnê'), null);
  assert.strictEqual(detectRegisterIntent('comprei celular 1500 em suaves prestações'), null);
});
test('"carne" (comida) NÃO é parcelado → registra', () => {
  const r = detectRegisterIntent('gastei 50 de carne no mercado');
  assert.ok(r); assert.strictEqual(r.amount, 50); assert.strictEqual(r.type, 'expense');
});
test('quantidade ANTES do número (turma/nota/aulas) → null', () => {
  assert.strictEqual(detectRegisterIntent('anota a nota 8 do aluno na planilha'), null);
  assert.strictEqual(detectRegisterIntent('lança o resultado do treino na turma 2'), null);
  assert.strictEqual(detectRegisterIntent('adiciona o João na turma das 8'), null);
  assert.strictEqual(detectRegisterIntent('me deu uma ideia pra 2 aulas novas'), null);
  assert.strictEqual(detectRegisterIntent('anota 50 cópias da apostila pra imprimir'), null);
});
test('"dia 50 reais" (dia>31) não engole o 2º valor → null', () => {
  assert.strictEqual(detectRegisterIntent('paguei 100 dia 50 reais'), null);
});
test('"no total" não vira conta fantasma', () => {
  // mesmo que passasse, account_name não pode ser "total"
  const r = detectRegisterIntent('lança 90 no total geral');
  if (r && r.account_name) assert.notStrictEqual(r.account_name, 'total');
});

// ── Round 3 adversarial: sufixo k/mil, gírias de caixa, que-clause, negação ──
test('sufixo "k"/"mil" = milhar (gíria WhatsApp)', () => {
  assert.strictEqual(detectRegisterIntent('paguei 1k no aluguel').amount, 1000);
  assert.strictEqual(detectRegisterIntent('recebi 1,5k de freela').amount, 1500);
  assert.strictEqual(detectRegisterIntent('lança 200 mil de entrada').amount, 200000);
});
test('"que <verbo>" NÃO mata registro válido', () => {
  assert.strictEqual(detectRegisterIntent('registra 90 que ganhei').type, 'income');
  assert.strictEqual(detectRegisterIntent('lança 90 que recebi do aluno').amount, 90);
});
test('"certo" como filler de gíria → registra', () => {
  const r = detectRegisterIntent('gastei 200 conto no rolê certo');
  assert.ok(r); assert.strictEqual(r.amount, 200); assert.strictEqual(r.type, 'expense');
});
test('gírias de caixa: pingou/embolsei/desembolsei', () => {
  assert.strictEqual(detectRegisterIntent('pingou 400 na conta agora').type, 'income');
  assert.strictEqual(detectRegisterIntent('embolsei 600 do show').type, 'income');
  assert.strictEqual(detectRegisterIntent('desembolsei 320 na farmácia').type, 'expense');
});
test('venda com quantidade + preço ("3 ingressos por 150")', () => {
  const r = detectRegisterIntent('vendi 3 ingressos por 150');
  assert.ok(r); assert.strictEqual(r.amount, 150); assert.strictEqual(r.type, 'income');
});
test('recebimento de ITENS (não dinheiro) → null', () => {
  assert.strictEqual(detectRegisterIntent('recebi os 40 cadernos de partitura que pedi'), null);
  assert.strictEqual(detectRegisterIntent('me deu uma ideia de gravar 4 vídeos pro instagram'), null);
});
test('"N feira" (dia da semana) → null', () => {
  assert.strictEqual(detectRegisterIntent('anota aí que o ensaio mudou pra 4 feira'), null);
});

// ── Assinatura de confirmação FABRICADA ──
test('looksLike: "registrado" NEGADO (fala do usuário) → false', () => {
  assert.strictEqual(looksLikeFinanceConfirmation('paguei R$ 100 e ainda não foi registrado nada'), false);
});
test('confirmação fabricada (Entrada registrada + Saldo R$) casa', () => {
  assert.strictEqual(looksLikeFinanceConfirmation('💰 *Entrada registrada!*\n🎤 Show — Dom Costela\n💼 Saldo NUBANK: +R$ 2.258,03'), true);
});
test('confirmação real do engine (Receita registrada) também casa (gating é externo)', () => {
  assert.strictEqual(looksLikeFinanceConfirmation('💰 *Receita registrada!*\n💼 Saldo NUBANK: *+R$ 2.258,03*'), true);
});
test('conversa normal sobre dinheiro NÃO casa', () => {
  assert.strictEqual(looksLikeFinanceConfirmation('beleza! e quanto você gastou no show?'), false);
  assert.strictEqual(looksLikeFinanceConfirmation('seu saldo no nubank é R$ 1.958,03'), false); // sem "registrada"
  assert.strictEqual(looksLikeFinanceConfirmation('você registrou bastante coisa hoje'), false); // "registrou" ≠ registrad[ao]
});
