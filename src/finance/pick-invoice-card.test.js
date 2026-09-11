'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pickInvoiceCard } = require('./pick-invoice-card');

// Cartões reais da Rose (o cenário do bug 14/07)
const ROSE = [
  { id: 'matheus', name: 'Cartão Itaú Matheus' },
  { id: 'rose', name: 'Cartão Itaú Rose' },
  { id: 'latam', name: 'Latam PASS' },
  { id: 'nubank', name: 'Cartão Nubank' },
];

test('BUG Rose: emissor "Itaú" casa 3 cartões → AMBÍGUO, nunca chuta o [0]', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: '', cards: ROSE });
  assert.strictEqual(r.status, 'ambiguous');
  assert.ok(r.candidates.length >= 2, 'Itaú Matheus + Itaú Rose (Latam PASS não tem "Itaú" no nome)');
});

test('BUG Rose: a FALA "essa fatura é do LATAM PASS" resolve pro Latam PASS (vence o emissor)', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'Tom, essa fatura é do cartão LATAM PASS de julho.', cards: ROSE });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'latam');
  assert.strictEqual(r.via, 'user');
});

test('emissor único casa 1 cartão → resolved', () => {
  const r = pickInvoiceCard({ emissor: 'Nubank', userText: '', cards: ROSE });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'nubank');
  assert.strictEqual(r.via, 'emissor');
});

test('card_id confirmado antes (desambiguação prévia) vence tudo', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: '', cards: ROSE, cardIdHint: 'rose' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'rose');
  assert.strictEqual(r.via, 'id');
});

test('emissor que não casa nenhum cartão → notfound (pergunta, não inventa)', () => {
  const r = pickInvoiceCard({ emissor: 'C6 Bank', userText: '', cards: ROSE });
  assert.strictEqual(r.status, 'notfound');
});

test('fala ambígua ("cartão Itaú") → ambíguo por fala, não chuta', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'é do cartão Itaú', cards: ROSE });
  assert.strictEqual(r.status, 'ambiguous');
});

test('lista de cartões vazia → notfound seguro', () => {
  assert.strictEqual(pickInvoiceCard({ emissor: 'Itaú', cards: [] }).status, 'notfound');
});

test('acento-insensível: "latam" minúsculo sem acento casa "Latam PASS"', () => {
  const r = pickInvoiceCard({ emissor: '', userText: 'poe na fatura do latam pass', cards: ROSE });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'latam');
});

// === Regressão Rose 16/07 01:57 (FIN-INVOICE-HINT-BEATS-USER-CORRECTION) ===
// O Intercept A abria a intent com findCard(emissor)[0] — um CHUTE gravado como card_id.
// A Rose corrigiu ("é o cartão LATAM PASS") e o hint chutado (Itaú Matheus) venceu a fala dela:
// 58 itens no cartão errado. A fala mais recente do usuário tem que vencer o hint.

test('BUG Rose 16/07: fala nomeia OUTRO cartão → vence o cardIdHint', () => {
  const r = pickInvoiceCard({
    emissor: 'Itaú',
    userText: 'Tom, é o cartão LATAM PASS. É para lançar somente o que falta. Lembra?',
    cards: ROSE,
    cardIdHint: 'matheus',
  });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'latam', 'a correção do usuário manda, não o hint chutado');
  assert.strictEqual(r.via, 'user');
});

test('não-regressão: "sim" (fala sem cartão) + hint → usa o hint', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'sim', cards: ROSE, cardIdHint: 'matheus' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'matheus');
  assert.strictEqual(r.via, 'id');
});

test('fala confirma o MESMO cartão do hint → resolved nele', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'sim, pode lançar no Latam PASS', cards: ROSE, cardIdHint: 'latam' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'latam');
});

// "cartão Itaú" NÃO nomeia cartão nenhum (nenhum se chama só "Itaú") — é fala genérica, cai no hint.
test('fala genérica ("cartão Itaú") não nomeia cartão → usa o hint', () => {
  const r = pickInvoiceCard({ emissor: 'Itaú', userText: 'é do cartão Itaú', cards: ROSE, cardIdHint: 'matheus' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'matheus');
  assert.strictEqual(r.via, 'id');
});

test('fala cita DOIS cartões e o hint é um deles → hint desempata', () => {
  const r = pickInvoiceCard({ emissor: '', userText: 'é do Itaú Matheus ou do Itaú Rose?', cards: ROSE, cardIdHint: 'matheus' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.card.id, 'matheus');
});

test('fala cita DOIS cartões e o hint não é nenhum → ambíguo (hint contraditado não vale)', () => {
  const r = pickInvoiceCard({ emissor: '', userText: 'é do Itaú Matheus ou do Itaú Rose?', cards: ROSE, cardIdHint: 'nubank' });
  assert.strictEqual(r.status, 'ambiguous');
  assert.strictEqual(r.candidates.length, 2);
});

// === Regressão Rose 16/07 21:27 (FIN-INVOICE-PREVIEW-PROMISED-BUT-COMMITTED) ===
// A msg de desambiguação promete: "Responde tipo *lança no X* que eu te mando a prévia pra
// conferir." Mas detectInvoiceReply("lança no X") == 'commit_financeiro' → lançava DIRETO,
// sem prévia. Ela escreveu exatamente o que o TOM mandou escrever e levou o lançamento na
// cara. Regra: ninguém confirma uma prévia que não viu — nomear cartão é DESAMBIGUAR.
const { shouldRestageCard } = require('./pick-invoice-card');

// Cartões reais da Rose no print de 16/07 21:26
const ROSE_MP = [
  { id: 'inter', name: 'Cartão Inter Matheus' },
  { id: 'matheus', name: 'Cartão Itaú Matheus' },
  { id: 'rose', name: 'Cartão Itaú Rose' },
  { id: 'mercpago', name: 'Cartão Mercado Pago' },
  { id: 'mp', name: 'Cartão MP Matheus' },
  { id: 'nubank', name: 'Cartão Nubank' },
  { id: 'latam', name: 'Latam PASS' },
];

test('BUG 21:27: "lança no X" com intent SEM cartão → re-estagia (prévia), não commita', () => {
  const pick = pickInvoiceCard({ userText: 'lança no Cartão MP Matheus', cards: ROSE_MP });
  assert.strictEqual(shouldRestageCard({ decision: 'commit_financeiro', pick, currentCardId: null }), true);
});

test('"sim" (não nomeia cartão) com prévia já vista → commita normalmente', () => {
  const pick = pickInvoiceCard({ userText: 'sim', cards: ROSE_MP, cardIdHint: 'mp' });
  assert.strictEqual(shouldRestageCard({ decision: 'commit_financeiro', pick, currentCardId: 'mp' }), false);
});

test('"lança no X" com a prévia DO X já na tela → commita (ele viu e confirmou)', () => {
  const pick = pickInvoiceCard({ userText: 'lança no Cartão MP Matheus', cards: ROSE_MP, cardIdHint: 'mp' });
  assert.strictEqual(shouldRestageCard({ decision: 'commit_financeiro', pick, currentCardId: 'mp' }), false);
});

test('viu prévia do Nubank e diz "lança no MP Matheus" → re-estagia no MP (troca de alvo)', () => {
  const pick = pickInvoiceCard({ userText: 'lança no Cartão MP Matheus', cards: ROSE_MP, cardIdHint: 'nubank' });
  assert.strictEqual(shouldRestageCard({ decision: 'commit_financeiro', pick, currentCardId: 'nubank' }), true);
});

test('cancel VENCE mesmo nomeando cartão ("cancela, era do Nubank")', () => {
  const pick = pickInvoiceCard({ userText: 'cancela, era do Cartão Nubank', cards: ROSE_MP });
  assert.strictEqual(shouldRestageCard({ decision: 'cancel', pick, currentCardId: null }), false);
});

test('commit_anotacoes VENCE (não vira re-estágio)', () => {
  const pick = pickInvoiceCard({ userText: 'salva nas anotações o Cartão Nubank', cards: ROSE_MP });
  assert.strictEqual(shouldRestageCard({ decision: 'commit_anotacoes', pick, currentCardId: null }), false);
});

test('fala sem cartão e sem decisão → nada a re-estagiar', () => {
  const pick = pickInvoiceCard({ userText: 'blz', cards: ROSE_MP });
  assert.strictEqual(shouldRestageCard({ decision: null, pick, currentCardId: null }), false);
});

// ── CARTAO-FATURA-TROCA-E-CITACAO (triagem 11/09 — 1df6f0af) ─────────────────────────────
// Os cartões da Rose como o TOM listou em 16/07 21:20 BRT (produção: "Mercado Pago Matheus",
// não "MP Matheus" como na fixture de cima).
const _ROSE_PROD = [
  { id: 'inter', name: 'Cartão Inter Matheus' },
  { id: 'itaum', name: 'Cartão Itaú Matheus' },
  { id: 'itaur', name: 'Cartão Itaú Rose' },
  { id: 'mp', name: 'Cartão Mercado Pago' },
  { id: 'mpm', name: 'Cartão Mercado Pago Matheus' },
  { id: 'nubank', name: 'Cartão Nubank' },
  { id: 'latam', name: 'Latam PASS' },
];
const _CITA_LISTA = '[O usuário está RESPONDENDO a esta mensagem anterior: "Os cartões que tenho cadastrados:\n\n💳 *Cartões:*\n• Cartão Inter Matheus\n• Cartão Itaú Matheus\n• Cartão Itaú Rose\n• Cartão Mercado Pago\n• Cartão Mercado Pago Matheus\n• Cartão Nubank\n• Latam PASS\n\nQual desses é o certo pra essas 5 compras?"]\n* Cartão Mercado Pago Matheus';
test('1df6f0af: resposta citando a lista resolve o cartão FALADO, não a lista citada', () => {
  const r = pickInvoiceCard({ userText: _CITA_LISTA, cards: _ROSE_PROD });
  assert.deepStrictEqual([r.status, r.card && r.card.id], ['resolved', 'mpm']);
});
test('1df6f0af: "Cartão Mercado Pago Matheus" vence "Cartão Mercado Pago"; o curto sozinho segue valendo', () => {
  assert.strictEqual(pickInvoiceCard({ userText: 'é o Cartão Mercado Pago Matheus', cards: _ROSE_PROD }).card.id, 'mpm');
  assert.strictEqual(pickInvoiceCard({ userText: 'no cartão mercado pago', cards: _ROSE_PROD }).card.id, 'mp');
});
test('1df6f0af: "lança no Cartão MP Matheus" com os nomes reais → Mercado Pago Matheus, re-estagia', () => {
  const pick = pickInvoiceCard({ userText: 'lança no Cartão MP Matheus', cards: _ROSE_PROD, cardIdHint: 'mp' });
  assert.deepStrictEqual([pick.status, pick.card && pick.card.id, pick.via], ['resolved', 'mpm', 'user']);
  assert.strictEqual(shouldRestageCard({ decision: 'commit_financeiro', pick, currentCardId: 'mp' }), true);
});
test('trocar_cartao nomeando o certo re-estagia; sem nomear, não', () => {
  const certo = pickInvoiceCard({ userText: 'não é esse, é o Cartão Mercado Pago Matheus', cards: _ROSE_PROD, cardIdHint: 'mp' });
  assert.strictEqual(shouldRestageCard({ decision: 'trocar_cartao', pick: certo, currentCardId: 'mp' }), true);
  const semNome = pickInvoiceCard({ userText: 'não é esse cartão', cards: _ROSE_PROD, cardIdHint: 'mp' });
  assert.strictEqual(shouldRestageCard({ decision: 'trocar_cartao', pick: semNome, currentCardId: 'mp' }), false);
});
const _ENG10 = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: trocar_cartao sem nome mantém a importação aberta e pergunta o cartão certo', () => {
  assert.match(_ENG10, /if \(_decision === 'trocar_cartao'\) \{[\s\S]{0,900}return; \/\/ intent segue aberta/);
});
