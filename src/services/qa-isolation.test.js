'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  ehQA, ehTelefoneQA, ehNomeQA,
  permiteGrupo, permiteDelegacao, contaNasMetricas, entraEmGovernanca,
} = require('./qa-isolation');

// Isolamento é guard TESTADO, não convenção — exigência do Alfredo. Nome `[QA]` é
// etiqueta; o que impede contaminação é cada fronteira ter decisão própria e prova.

const QA_TEL = '5500000000001';
const QA_OBJ = { full_name: '[QA] Replay 01', phone: QA_TEL };
const PESSOA = { full_name: 'Matheus Felipe', phone: '5521999998888' };

test('identifica QA pelo telefone na faixa reservada', () => {
  assert.equal(ehTelefoneQA(QA_TEL), true);
  assert.equal(ehTelefoneQA('5521999998888'), false);
});

test('identifica QA pelo nome', () => {
  assert.equal(ehNomeQA('[QA] Replay 01'), true);
  assert.equal(ehNomeQA('Matheus Felipe'), false);
});

test('DEFESA EM PROFUNDIDADE: uma fonte só já basta', () => {
  // renomearam o perfil por engano — o telefone ainda isola
  assert.equal(ehQA({ full_name: 'Perfil de testes', phone: QA_TEL }), true);
  // digitaram o telefone errado — o nome ainda isola
  assert.equal(ehQA({ full_name: '[QA] Replay 09', phone: '5521988887777' }), true);
});

test('formato do telefone não burla (máscara, +, sufixo do WhatsApp)', () => {
  for (const p of ['+55 00 00000-0001', '5500000000001@s.whatsapp.net', ' 5500000000001 ']) {
    assert.equal(ehTelefoneQA(p), true, p);
  }
});

test('entrada nula/estranha não vira QA por acidente', () => {
  for (const v of [null, undefined, '', 0, {}, [], { full_name: null, phone: null }]) {
    assert.equal(ehQA(v), false, JSON.stringify(v));
  }
});

// ---- Fronteira 1: grupo ----
test('QA NÃO entra em chat de grupo; pessoa real entra', () => {
  assert.equal(permiteGrupo(QA_OBJ), false);
  assert.equal(permiteGrupo(QA_TEL), false);
  assert.equal(permiteGrupo(PESSOA), true);
});

// ---- Fronteira 2: delegação ----
test('delegação cruzada é barrada nos DOIS sentidos', () => {
  assert.equal(permiteDelegacao(QA_OBJ, PESSOA), false, 'QA delegando pra pessoa real');
  assert.equal(permiteDelegacao(PESSOA, QA_OBJ), false, 'pessoa real delegando pra QA');
});

test('delegação entre iguais continua permitida', () => {
  assert.equal(permiteDelegacao(QA_OBJ, { full_name: '[QA] Replay 02', phone: '5500000000002' }), true);
  assert.equal(permiteDelegacao(PESSOA, { full_name: 'Rafinha', phone: '5521977776666' }), true);
});

// ---- Fronteira 3: métricas (a mais importante) ----
test('QA fora das métricas — senão o laboratório contamina o diagnóstico', () => {
  assert.equal(contaNasMetricas(QA_OBJ), false);
  assert.equal(contaNasMetricas(PESSOA), true);
});

// ---- Fronteira 4: governança ----
test('QA fora de governança e digest de liderança', () => {
  assert.equal(entraEmGovernanca(QA_OBJ), false);
  assert.equal(entraEmGovernanca(PESSOA), true);
});

test('as quatro fronteiras concordam sobre o mesmo alvo', () => {
  // divergir entre guards é como a regra do lembrete existir no snooze e faltar no
  // reagendamento — o mesmo alvo tem que ser tratado igual em todas as portas
  for (const alvo of [QA_OBJ, QA_TEL, '[QA] Replay 03']) {
    assert.equal(permiteGrupo(alvo), false);
    assert.equal(contaNasMetricas(alvo), false);
    assert.equal(entraEmGovernanca(alvo), false);
  }
  for (const alvo of [PESSOA, '5521999998888', 'Matheus Felipe']) {
    assert.equal(permiteGrupo(alvo), true);
    assert.equal(contaNasMetricas(alvo), true);
    assert.equal(entraEmGovernanca(alvo), true);
  }
});
