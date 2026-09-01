// Trava: o auditor confere o BANCO antes de acusar confabulacao. Ver confab-refuta-banco.js.
const { test } = require('node:test');
const assert = require('node:assert');
const { refutarPeloBanco, titulosCitados } = require('./confab-refuta-banco');

const NL = String.fromCharCode(10);
const EV_REAL = 'USUARIO: sim' + NL + 'TOM: Conclui: *Ligar para Salome*, *Ligar para Patricia*, *Ligar para Viviane*.';
const TRES_DONE = [
  { title: 'Ligar para Salome', status: 'done' },
  { title: 'Ligar para Patricia', status: 'done' },
  { title: 'Ligar para Viviane', status: 'done' },
];

// CASO REAL (finding bb00609d, severidade ALTA, 31/08 22:11). As tres tarefas estavam done
// desde 20:26:33 -- 1h45 ANTES da fala. O auditor acusou confabulacao porque nao havia marker
// NAQUELE TURNO. Reafirmar escrita passada nao e mentira.
test('refuta quando TODOS os itens citados estao no estado afirmado', () => {
  const r = refutarPeloBanco({ evidencia: EV_REAL, tarefas: TRES_DONE });
  assert.strictEqual(r.refuta, true, r.motivo);
  assert.strictEqual(r.titulos.length, 3);
});

// O freio nao pode reabrir: uma mentira de verdade tem que sobreviver.
test('CONTROLE: 1 item fora do estado mantem o achado INTEIRO', () => {
  const tarefas = [TRES_DONE[0], TRES_DONE[1], { title: 'Ligar para Viviane', status: 'pending' }];
  const r = refutarPeloBanco({ evidencia: EV_REAL, tarefas });
  assert.strictEqual(r.refuta, false);
  assert.ok(r.motivo.includes('status=pending'), r.motivo);
});
test('CONTROLE: item citado que NAO existe no banco mantem o achado', () => {
  const r = refutarPeloBanco({ evidencia: EV_REAL, tarefas: TRES_DONE.slice(0, 2) });
  assert.strictEqual(r.refuta, false);
  assert.ok(r.motivo.includes('nao existe'), r.motivo);
});
test('CONTROLE: banco vazio nunca refuta', () => {
  assert.strictEqual(refutarPeloBanco({ evidencia: EV_REAL, tarefas: [] }).refuta, false);
});
test('CONTROLE: fala sem titulo em negrito nunca refuta', () => {
  const r = refutarPeloBanco({ evidencia: 'TOM: ja registrei tudo aqui!', tarefas: TRES_DONE });
  assert.strictEqual(r.refuta, false);
});

// O piso de 3 caracteres existe pra nao casar asterisco solto de formatacao.
test('titulosCitados pega negrito, ignora repetido e descarta bloco curto demais', () => {
  assert.deepStrictEqual(titulosCitados('a *Cabos* b *Pilhas* c *Cabos*'), ['Cabos', 'Pilhas']);
  assert.deepStrictEqual(titulosCitados('nota *ok* aqui'), []);
});
test('quando a fala NAO afirma conclusao, existir ja basta', () => {
  const ev = 'TOM: anotei *Comprar cabos* aqui.';
  const r = refutarPeloBanco({ evidencia: ev, tarefas: [{ title: 'Comprar cabos', status: 'pending' }] });
  assert.strictEqual(r.refuta, true, r.motivo);
});
