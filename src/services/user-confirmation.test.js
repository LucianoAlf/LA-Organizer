const { test } = require('node:test');
const assert = require('node:assert');
const { detectUserConfirmation } = require('./user-confirmation');

// ── CONFIRM-SHORTYES-S-UNRECOGNIZED (Clayton 09/07) — o FIX ──────────────────
// Clayton respondeu "S" à confirmação de fechamento em lote; YES_RE só cobria
// "sim"/"sm" → null → batch_complete determinístico não disparava → LOOP.
test('FIX: "s" / "ss" / "S" / "sss" → yes', () => {
  assert.strictEqual(detectUserConfirmation('s'), 'yes');
  assert.strictEqual(detectUserConfirmation('ss'), 'yes');
  assert.strictEqual(detectUserConfirmation('S'), 'yes');
  assert.strictEqual(detectUserConfirmation('sss'), 'yes');
  assert.strictEqual(detectUserConfirmation('S.'), 'yes');
});

test('FIX não vaza: palavra começada por s NÃO vira yes', () => {
  assert.strictEqual(detectUserConfirmation('saldo do nubank'), null);
  assert.strictEqual(detectUserConfirmation('sei lá'), null);
  assert.strictEqual(detectUserConfirmation('sexta'), null);
});

// ── zero-regressão: afirmativas curtas históricas ───────────────────────────
test('afirmativas curtas seguem yes', () => {
  for (const s of ['sim', 'ok', 'okay', 'pode', 'cria', 'manda ver', 'fechou',
                    'beleza', 'blz', 'isso', 'claro', 'bora', 'perfeito',
                    'confirmo', 'confirma', '👍']) {
    assert.strictEqual(detectUserConfirmation(s), 'yes', `"${s}" deveria ser yes`);
  }
});

// BUG-IRMÃO do Clayton (CONFIRM-SHORTYES-TA-ACCENT-BOUNDARY, 10/07): "tá" isolado dava
// null — o token YES_RE `t[áa]\b` não casa porque `\b` em JS é ASCII e "á" não é word-char
// (lição audit 28/06). Fix: `t[áa](?=$|[\s.,!?;:)])` casa "tá" antes de fim/espaço/pontuação,
// sem vazar pra "tabela"/"tarde" (letra depois → lookahead falha).
test('FIX bug-irmão "tá": tá/Tá/tá./tá! /tá certo → yes', () => {
  for (const s of ['tá', 'Tá', 'tá.', 'tá!', 'ta', 'tá certo']) {
    assert.strictEqual(detectUserConfirmation(s), 'yes', `"${s}" deveria ser yes`);
  }
});
test('FIX "tá" não vaza: palavra começada por ta/tá NÃO vira yes', () => {
  for (const s of ['tabela', 'tarde', 'tanto faz', 'tainha', 'tá bom mas amanhã eu vejo isso']) {
    assert.strictEqual(detectUserConfirmation(s), null, `"${s}" NÃO deveria ser yes`);
  }
});

// ── zero-regressão: negativas ───────────────────────────────────────────────
test('negativas seguem no', () => {
  for (const s of ['não', 'nao', 'cancela', 'esquece', 'deixa pra lá',
                   'desconsidera', 'ainda não']) {
    assert.strictEqual(detectUserConfirmation(s), 'no', `"${s}" deveria ser no`);
  }
});

// ── zero-regressão: BATCH-CONFIRM-LONGPHRASE (Daiana 22/06) ──────────────────
test('frase afirmativa longa (≤12) sem ressalva → yes', () => {
  assert.strictEqual(detectUserConfirmation('Sim, por favor. Pode fechar as 6 tarefas'), 'yes');
});
test('ressalva/negação na frase longa → null', () => {
  assert.strictEqual(detectUserConfirmation('sim mas isso fica pra amanhã por favor'), null);
});

// ── zero-regressão: F5/ALVO-FUTURO (Ana 09/06) — >4 palavras começando por "não" ─
test('negação longa de CONTEÚDO não confirma nem nega às cegas → null', () => {
  assert.strictEqual(detectUserConfirmation('não foi a ADM, foi a de hoje, de governança'), null);
});

// ── zero-regressão: GUARD-CONFIRM-LOOP / allowDone (Matheus/Rose) ────────────
test('allowDone: vocabulário de conclusão confirma; sem allowDone não', () => {
  assert.strictEqual(detectUserConfirmation('feito', { allowDone: true }), 'yes');
  assert.strictEqual(detectUserConfirmation('já foi feito', { allowDone: true }), 'yes');
  assert.strictEqual(detectUserConfirmation('conclui as 3 que já fiz', { allowDone: true }), 'yes');
  assert.strictEqual(detectUserConfirmation('feito'), null); // sem allowDone → não auto-confirma
});
test('allowDone: HESITA (correção) não confirma', () => {
  assert.strictEqual(detectUserConfirmation('Conclui.. esqueci de colocar aqui', { allowDone: true }), null);
});

// ── defensivo ───────────────────────────────────────────────────────────────
test('defensivo: não-string / vazio / longo demais → null', () => {
  assert.strictEqual(detectUserConfirmation(null), null);
  assert.strictEqual(detectUserConfirmation(''), null);
  assert.strictEqual(detectUserConfirmation('x'.repeat(201)), null);
});
