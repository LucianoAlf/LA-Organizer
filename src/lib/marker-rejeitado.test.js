'use strict';
// Marker rejeitado no PARSER = nada persistiu. A fala não pode afirmar que persistiu.
//
// HABIT-UPDATE-SILENT-LIE (Bianca 09/08 08:30 e 08:31). Ela pediu pra tirar o lembrete das 6h
// do hábito "Tomar remédios". O LLM emitiu {"action":"update", ...} — ação que NÃO existe no
// engine nem na skill (create/log/query_progress/delete) — o parser rejeitou com schema_invalid,
// e o TOM respondeu "Beleza, Bianca! Hábito continua, só sem o toque das 6h." O lembrete segue
// tocando às 6h e do outro lado ficou a certeza de que tinha sido removido.
//
// A raiz não é o hábito: dos 21 ramos `malformed` do engine, 13 dropavam o marker e deixavam a
// fala passar intacta. TASK_UPDATE e EVENT_CREATE já faziam a coisa certa desde a Sprint 21.5 —
// o guard existia e nunca foi propagado. Este módulo é esse guard, num lugar só.

const test = require('node:test');
const assert = require('node:assert');
const { honestidadeDeMarkerRejeitado } = require('./marker-rejeitado');

// ── PROVA DE REVERSÃO ────────────────────────────────────────────────────────────────────────
test('caso Bianca: afirmação de estado não sobrevive a marker rejeitado', () => {
  const falaReal = 'Beleza, Bianca! Hábito continua, só sem o toque das 6h.';
  const r = honestidadeDeMarkerRejeitado(falaReal, { oQue: 'o hábito' });
  assert.equal(r.rebaixou, true);
  assert.ok(!/só sem o toque das 6h/.test(r.texto), `a mentira sobreviveu: ${r.texto}`);
  assert.match(r.texto, /não consegui|problema técnico/i);
});

// O gate padrão (hasOptimisticConfirm) NÃO pega a fala da Bianca — ela não tem ✅ nem
// "criado/registrado/salvei". Só o detector FRACO pega. Se este módulo usasse o gate padrão,
// passaria nos testes e deixaria o caso de origem exatamente como estava.
// Aqui o fraco é seguro porque o ramo é binário: marker rejeitado = ZERO persistido.
test('o gate é o FRACO — senão o caso que originou o fix continua passando', () => {
  const { hasOptimisticConfirm } = require('./optimistic-confirm');
  const fala = 'Beleza, Bianca! Hábito continua, só sem o toque das 6h.';
  assert.equal(hasOptimisticConfirm(fala), false, 'premissa mudou: revisar o gate deste módulo');
  assert.equal(honestidadeDeMarkerRejeitado(fala).rebaixou, true);
});

test('confirmação explícita também é rebaixada', () => {
  const r = honestidadeDeMarkerRejeitado('✅ Pronto! Anotei seu hábito de academia às 6h.');
  assert.equal(r.rebaixou, true);
  assert.ok(!/✅/.test(r.texto), `emoji de sucesso sobreviveu: ${r.texto}`);
});

// ── QUANDO NÃO AGIR ──────────────────────────────────────────────────────────────────────────
// Pergunta não é promessa. O TOM perguntando "quer tirar o lembrete?" e o marker caindo não
// produz mentira nenhuma — anexar aviso aqui só assustaria quem não foi enganado.
test('pergunta passa intacta — não há o que rebaixar', () => {
  const t = 'Entendi: quer tirar o lembrete das 6h de *Tomar remédios*, certo?';
  const r = honestidadeDeMarkerRejeitado(t);
  assert.equal(r.rebaixou, false);
  assert.equal(r.texto, t);
});

test('texto neutro passa intacto', () => {
  const t = 'Seus hábitos de hoje: Academia (06:00) e Ler (21:00).';
  const r = honestidadeDeMarkerRejeitado(t);
  assert.equal(r.rebaixou, false);
  assert.equal(r.texto, t);
});

test('vazio não vira aviso órfão', () => {
  for (const v of ['', null, undefined, '   ']) {
    const r = honestidadeDeMarkerRejeitado(v);
    assert.equal(r.rebaixou, false);
    assert.equal(r.texto.trim(), '');
  }
});

// Dois markers rejeitados no mesmo turno (acontece: o LLM erra o formato uma vez e repete).
// Sem isto o usuário levaria o mesmo aviso duas vezes na mesma mensagem.
test('não duplica o aviso quando roda duas vezes no mesmo texto', () => {
  const um = honestidadeDeMarkerRejeitado('✅ Criei o hábito!');
  const dois = honestidadeDeMarkerRejeitado(um.texto);
  assert.equal(dois.rebaixou, false);
  assert.equal(dois.texto, um.texto);
});

// ── A FALA ───────────────────────────────────────────────────────────────────────────────────
// Forma copiada do aviso que JÁ está em produção no EVENT_CREATE desde a Sprint 21.5.1 — não é
// voz nova, é a mesma voz num lugar só. O que TOM diz é território do Alf; isto é infraestrutura.
test('quando sobra só o aviso, ele é uma mensagem inteira e legível', () => {
  const r = honestidadeDeMarkerRejeitado('Beleza! Feito.', { oQue: 'o hábito' });
  assert.ok(r.texto.trim().length > 20);
  assert.match(r.texto, /o hábito/);
  assert.doesNotMatch(r.texto, /undefined|null|\[object/);
});

test('sem oQue o aviso continua completo', () => {
  const r = honestidadeDeMarkerRejeitado('✅ Pronto!');
  assert.doesNotMatch(r.texto, /undefined|null|\s{3,}/);
  assert.match(r.texto, /me (pede|passa) de novo|tenta de novo/i);
});

// O texto útil que veio antes da promessa não pode ser jogado fora junto.
test('preserva a parte informativa e derruba só a linha que mente', () => {
  const t = 'Seus hábitos hoje: Academia e Ler.\n✅ Pronto, tirei o lembrete das 6h.';
  const r = honestidadeDeMarkerRejeitado(t);
  assert.match(r.texto, /Academia e Ler/);
  assert.ok(!/tirei o lembrete/.test(r.texto));
});
