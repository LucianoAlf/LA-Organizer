// Teste do util media-context (MEDIA-IMG-CONTEXT-LOST). Roda com: node media-context.test.js
const assert = require('assert');
const { extractMediaAnalysis, renderRecentMediaBlock } = require('./media-context');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log(`  ✓ ${name}`); }

// --- extractMediaAnalysis ---

// Caso Rose 11/06 03:33: content real começa com o marker de imagem + legenda + análise.
t('extrai análise de imagem (caso Rose)', () => {
  const content = `[O usuário ACABOU DE ENVIAR uma imagem agora — primeira vez vendo este arquivo. Análise automática:]
Legenda enviada pelo usuário: "tom, desses lançamentos, quais não estão na fatura"
Fatura Cartão Itaú Matheus — Junho/2026
- SHOPEE Kab R$431,44
- PONTO CERTO R$437,61`;
  const r = extractMediaAnalysis(content);
  assert.strictEqual(r.media_type, 'image');
  assert.ok(r.media_extracted_text.includes('SHOPEE Kab'), 'deve conter a análise');
  assert.ok(r.media_extracted_text.includes('Legenda enviada'), 'mantém a legenda como contexto');
});

t('extrai vídeo e PDF', () => {
  assert.strictEqual(extractMediaAnalysis('[O usuário ACABOU DE ENVIAR um vídeo agora — primeira vez vendo este arquivo. Análise automática:]\nconteúdo').media_type, 'video');
  assert.strictEqual(extractMediaAnalysis('[O usuário ACABOU DE ENVIAR um PDF agora — primeira vez vendo este arquivo. Conteúdo extraído:]\ntexto').media_type, 'document');
});

t('marker dentro de buffer agregado: não engole a próxima mensagem', () => {
  const content = `[O usuário enviou 2 mensagens em rápida sequência...]

[mensagem 1/2]
[O usuário ACABOU DE ENVIAR uma imagem agora — primeira vez vendo este arquivo. Análise automática:]
Recibo de R$100

[mensagem 2/2]
e aí, quanto deu?`;
  const r = extractMediaAnalysis(content);
  assert.strictEqual(r.media_type, 'image');
  assert.ok(r.media_extracted_text.includes('Recibo de R$100'));
  assert.ok(!r.media_extracted_text.includes('quanto deu'), 'não deve incluir a msg 2/2');
});

t('texto puro retorna null', () => {
  assert.strictEqual(extractMediaAnalysis('adicionou a compra que eu pedi no cartão?'), null);
  assert.strictEqual(extractMediaAnalysis(''), null);
  assert.strictEqual(extractMediaAnalysis(null), null);
});

t('respeita o cap de 4000 chars', () => {
  const big = 'x'.repeat(9000);
  const r = extractMediaAnalysis(`[O usuário ACABOU DE ENVIAR uma imagem agora — Análise automática:]\n${big}`);
  assert.strictEqual(r.media_extracted_text.length, 4000);
});

// --- renderRecentMediaBlock ---

t('renderiza bloco com mídia e a regra anti "não recebi"', () => {
  const block = renderRecentMediaBlock([
    { media_type: 'image', media_extracted_text: 'Fatura Itaú — SHOPEE R$431', created_at: new Date(Date.now() - 5 * 60000).toISOString() },
  ]);
  assert.ok(block.includes('SHOPEE R$431'));
  assert.ok(/NUNCA diga "não recebi/.test(block));
  assert.ok(block.includes('imagem'));
});

t('sem mídia retorna string vazia', () => {
  assert.strictEqual(renderRecentMediaBlock([]), '');
  assert.strictEqual(renderRecentMediaBlock(null), '');
  assert.strictEqual(renderRecentMediaBlock([{ media_type: 'image', media_extracted_text: null }]), '');
});

console.log(`\n${pass} testes passaram.`);
