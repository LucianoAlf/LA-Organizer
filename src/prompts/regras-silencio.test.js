'use strict';
// Guarda de TEXTO das regras de silêncio no system prompt.
//
// Por que testar texto: as regras 17/17b/18 são a única coisa que liga a fala da pessoa
// ("domingo eu não trabalho") à preferência persistida. Se alguém apagar ou reescrever numa
// refatoração, NADA quebra — o TOM só volta a responder bonito e não gravar, e a falha reaparece
// como reclamação semanas depois. Foi exatamente o buraco da família C: TOM dizia "domingo é
// folga 🙌" pra Rose (01/08) e "Bom domingo!" pro Clayton (19/07), e `quiet_days_work` seguia [].
//
// Lê o ARQUIVO como texto de propósito: buildSystemPrompt() precisa de banco (supabase/client),
// e este teste tem que rodar no `node --test` local, sem env.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FONTE = fs.readFileSync(path.join(__dirname, 'system.js'), 'utf8');

test('regra 17 (pausa recorrente de dias) continua no prompt', () => {
  assert.match(FONTE, /17\.\s+\*\*Pausa RECORRENTE de DIAS/);
  assert.match(FONTE, /quiet_days_work/, 'a coluna por contexto tem que aparecer');
});

test('regra 17b (dia de folga dito de passagem) continua no prompt', () => {
  assert.match(FONTE, /17b\.\s+\*\*Dia de folga dito DE PASSAGEM/);
});

test('17b manda RESOLVER o pedido antes de oferecer — senão vira interrupção', () => {
  assert.match(FONTE, /primeiro resolva o que ela pediu/i);
});

test('17b limita a oferta a uma vez por conversa', () => {
  assert.match(FONTE, /uma vez por conversa/i);
  assert.match(FONTE, /não insista/i);
});

test('17b proíbe prometer silêncio sem o marker', () => {
  assert.match(FONTE, /sem ter emitido o marker/i);
});

test('17b carrega os dois casos reais que a criaram', () => {
  assert.match(FONTE, /Rose, 01\/08/);
  assert.match(FONTE, /Clayton, 19\/07/);
});

test('regra 18 (horário recorrente) não foi atropelada pela inserção', () => {
  assert.match(FONTE, /18\.\s+\*\*"Não me chama antes das Xh"/);
});
