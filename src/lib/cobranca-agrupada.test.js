'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { textoCobrancaAgrupada, ordenarPorAtraso, LIMITE_COBRANCA_AGRUPADA } = require('./cobranca-agrupada');

// As SEIS cobranças reais que a Vitoria levou em 13 segundos (12/09 16:00 UTC), com os atrasos
// que estavam nas notificações: Lead Kids 4d, Lead Kids 3d, Lead LA 1d, Lead LA 4d, Lead Kids 1d, Lead LA 1d.
const VITORIA = [
  { id: '073b63de', title: 'Contato Lead Kids', dias: 4 },
  { id: '7febf0c0', title: 'Contato Lead Kids', dias: 3 },
  { id: '1f1a9403', title: 'Contato Lead LA', dias: 1 },
  { id: '18d3b2c4', title: 'Contato Lead LA', dias: 4 },
  { id: 'a99340df', title: 'Contato Lead Kids', dias: 1 },
  { id: 'fe51eb0d', title: 'Contato Lead LA', dias: 1 },
];

test('Vitoria: as 6 viram UMA mensagem, da mais antiga pra mais nova', () => {
  const t = textoCobrancaAgrupada(VITORIA);
  assert.match(t, /^🚨 \*6 tarefas atrasadas\* — da mais antiga pra mais nova:/);
  const linhas = t.split('\n').filter((l) => l.startsWith('•'));
  assert.strictEqual(linhas.length, 6);
  assert.strictEqual(linhas[0], '• *Contato Lead Kids* — 4 dias');
  assert.strictEqual(linhas[1], '• *Contato Lead LA* — 4 dias');
  assert.strictEqual(linhas[2], '• *Contato Lead Kids* — 3 dias');
  assert.match(t, /Me responde citando o nome da que você fechou/);
});

test('abaixo do limite não agrupa — o reply-quote continua ancorando por tarefa', () => {
  assert.strictEqual(textoCobrancaAgrupada(VITORIA.slice(0, 2)), '');
  assert.strictEqual(textoCobrancaAgrupada([]), '');
  assert.strictEqual(LIMITE_COBRANCA_AGRUPADA, 3);
  assert.notStrictEqual(textoCobrancaAgrupada(VITORIA.slice(0, 3)), '');
});

test('1 dia sai no singular', () => {
  const t = textoCobrancaAgrupada([{ title: 'A', dias: 1 }, { title: 'B', dias: 1 }, { title: 'C', dias: 2 }]);
  assert.match(t, /• \*C\* — 2 dias/);
  assert.match(t, /• \*A\* — 1 dia\n/);
});

test('lista longa não vira parede: 8 linhas + "e mais N"', () => {
  const muitas = Array.from({ length: 12 }, (_, i) => ({ title: `T${String(i).padStart(2, '0')}`, dias: 12 - i }));
  const t = textoCobrancaAgrupada(muitas);
  const linhas = t.split('\n').filter((l) => l.startsWith('•'));
  assert.strictEqual(linhas.length, 9);
  assert.strictEqual(linhas[8], '• _e mais 4_');
  assert.match(t, /^🚨 \*12 tarefas atrasadas\*/);
});

test('ordenação é estável no empate (pelo título) e não muda a lista original', () => {
  const orig = [{ title: 'B', dias: 2 }, { title: 'A', dias: 2 }];
  const ord = ordenarPorAtraso(orig);
  assert.deepStrictEqual(ord.map((x) => x.title), ['A', 'B']);
  assert.deepStrictEqual(orig.map((x) => x.title), ['B', 'A']);
});

const DISP = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'rituals', 'dispatcher.js'), 'utf8');
test('dispatcher: a cobrança sai depois da decisão, agrupada a partir de 3, e só marca "sent" quando saiu', () => {
  assert.match(DISP, /const _cobrancasPorPessoa = new Map\(\);/);
  assert.match(DISP, /if \(_fila\.itens\.length < LIMITE_COBRANCA_AGRUPADA\) \{/);
  assert.ok(DISP.includes('textoCobrancaAgrupada(_itens)'), 'o dispatcher precisa montar a mensagem agrupada');
  // O log de "sent" e o contador vivem no envio, não na decisão.
  const iEnvio = DISP.indexOf('for (const _fila of _cobrancasPorPessoa.values())');
  const iLog = DISP.indexOf("'alerta_atraso', 'sent', `task:");
  assert.ok(iEnvio > 0 && iLog > iEnvio, 'o log de enviado tem que ficar dentro do envio');
});
