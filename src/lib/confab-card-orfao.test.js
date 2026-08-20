'use strict';
// CONFAB-CARD-ORFAO (Rafinha 28/07 20:07:39 BRT, finding 391bb609, severidade alta).
//
// O TOM mandou, numa mensagem só:
//
//   E criei a visita do Valcílio também:
//   📅 *Visita Valcílio — ar condicionado · Campo Grande*
//   🗓️ Amanhã (29/07) · 10h–11h 🏢 Presencial
//
//   _não consegui registrar agora. Me passa de novo?_
//
//   Achei um compromisso parecido já criado: ... 1️⃣ 2️⃣ 3️⃣
//
// marker_logs do turno: EVENT_CREATE rejected (integrity_dup_event soft) e TASK_UPDATE
// rejected (all_failed:1) — okCount=0, nada persistiu.
//
// O fix do LEAD_CONNECTIVE (29/07) já mata a linha do verbo: "E criei ..." sai. Mas o
// sanitizador decide LINHA A LINHA, e a linha removida era a que ANUNCIAVA o bloco abaixo
// dela (termina em ':'). O card do evento fica órfão e vai pro WhatsApp como comprovante de
// uma coisa que não existe, colado no "não consegui registrar". Do ponto de vista de quem lê,
// o achado não mudou: a visita aparece criada e desmentida na mesma mensagem.
//
// Regra: em outcome 'failed' (nada persistiu), a linha otimista que termina em ':' leva junto
// o bloco contíguo que ela introduz, até a primeira linha em branco. Só em 'failed' — em
// 'partial' o bloco pode listar justamente os itens que deram certo (PETERSON-INTEGRITY-
// HIDES-OKCOUNT). Sem os dois pontos, nada é levado junto.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub-key';

const { test } = require('node:test');
const assert = require('node:assert');

const { sanitizeOptimisticConfirm } = require('./optimistic-confirm');
const { buildIntegrityReply } = require('./integrity-reply');

// Literal exato de conversation_history (outbound, 2026-07-28 23:07:39Z).
const CLEAN_TEXT = [
  'E criei a visita do Valcílio também:',
  '📅 *Visita Valcílio — ar condicionado · Campo Grande*',
  '🗓️ Amanhã (29/07) · 10h–11h 🏢 Presencial',
  '',
  '_não consegui registrar agora. Me passa de novo?_',
].join('\n');

const DUP_Q = [
  'Achei um compromisso parecido já criado:',
  '_"Rafael câmeras — Campo Grande"_',
  '',
  'Qual o caso? Responde com o **número**:',
  '',
  '1️⃣ É o *mesmo compromisso* — atualizo o existente',
  '2️⃣ É *outro compromisso* — crio novo',
  '3️⃣ Cancela, vou reformular',
].join('\n');

test('caso Valcílio: com okCount=0 o card do evento não sobrevive à afirmação removida', () => {
  const out = buildIntegrityReply(CLEAN_TEXT, DUP_Q, 0, {
    sing: 'evento já registrado', plur: 'eventos já registrados',
  });

  assert.ok(!/criei/i.test(out), `verbo de criação sobreviveu:\n${out}`);
  assert.ok(!/Visita Valcílio/.test(out), `card do evento sobreviveu:\n${out}`);
  assert.ok(!/Amanhã \(29\/07\)/.test(out), `linha de data do card sobreviveu:\n${out}`);

  // O que PRECISA continuar de pé: a honestidade e o menu de duplicidade.
  assert.match(out, /não consegui registrar agora/);
  assert.match(out, /Achei um compromisso parecido já criado/);
  assert.match(out, /3️⃣ Cancela, vou reformular/);
});

test('outcome partial preserva o bloco — pode listar o que deu certo', () => {
  const out = sanitizeOptimisticConfirm(CLEAN_TEXT, 'partial');
  assert.ok(/Visita Valcílio/.test(out), `partial não pode comer o bloco:\n${out}`);
});

test('linha otimista SEM dois-pontos não leva a linha seguinte', () => {
  const txt = 'Criei a visita.\nA reunião do Alf continua de pé às 15h.';
  const out = sanitizeOptimisticConfirm(txt, 'failed');
  assert.ok(!/Criei a visita/.test(out), `claim sobreviveu:\n${out}`);
  assert.match(out, /reunião do Alf continua de pé/, `linha vizinha inocente foi comida:\n${out}`);
});

test('bloco introduzido para na linha em branco', () => {
  const txt = ['✅ Registrei tudo:', '• item A', '• item B', '', 'Te cobro amanhã.'].join('\n');
  const out = sanitizeOptimisticConfirm(txt, 'failed');
  assert.ok(!/item A/.test(out), `bloco ficou órfão:\n${out}`);
  assert.match(out, /Te cobro amanhã/, `parou tarde demais:\n${out}`);
});
