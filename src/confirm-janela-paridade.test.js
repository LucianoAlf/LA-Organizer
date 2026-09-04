'use strict';
// Contrato: os executores DETERMINÍSTICOS estagiados aceitam a confirmação pelo menos enquanto o
// auto-resolve GENÉRICO a aceita. Sem essa paridade existe uma banda morta em que o "sim" do
// usuário é consumido por quem não tem os dados pra agir.
//
// Caso real — Vitoria, 03/09 21:40:50 BRT (achado 91922e36). Ela pediu "Reagenda pra amanhã pfvr!"
// e o TOM estagiou DUAS intents no mesmo segundo: reschedule_confirm com o payload concreto
// (3 actions, com os ids das tarefas) e a confirmation genérica, cujo payload é só
// {last_tom_reply,last_user_text}. Ela respondeu "Sim" 17m40s depois. O executor estagiado
// (engine.js, ramo reschedule_confirm) exigia janela de 15min e ficou de fora; o auto-resolve
// genérico (engine.js ~10330) usa 20min, aceitou, gravou resolution=confirmed
// ("auto-resolved on turn 2026-09-04T00:58:38.979Z") e — sem nenhum campo concreto no payload —
// mandou o turno pro LLM, que respondeu "Pô, não consegui pegar os dados certinho — me manda de
// novo quais tarefas quer reagendar pra amanhã?". A intent que tinha os 3 ids ficou resolution=null
// pra sempre. O "Sim" dela foi queimado pelo ramo que não podia agir.
//
// FRESH_WINDOW_MIN (utils/dates.js) se declara "janela ÚNICA de frescor pra confirmações curtas —
// mudar aqui muda em todos, fim das cópias de 20 espalhadas". Os ramos estagiados furavam isso com
// um 15 literal, e a diferença de 5 minutos é exatamente a banda morta.
//
// Escopo: só os ramos cujo gatilho é detectUserConfirmation (sim/isso pelado) — são os que o
// auto-resolve genérico sombreia. undo_launch e finance_source disparam por outro detector
// (detectUndoLaunch / matchSourceReply), não são sombreados por um "sim", e undo_launch APAGA
// transação — alargar a janela dele é decisão de produto, não conserto. Ficam de fora de propósito.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const { withinConfirmWindow, FRESH_WINDOW_MIN } = require('./utils/dates');
const { detectUserConfirmation } = require('./services/pending-intents');

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');

// Ramos estagiados que competem com o auto-resolve genérico pelo mesmo "sim".
const RAMOS_POR_SIM = ['reschedule_confirm', 'event_create_confirm'];

// Lê a janela que o ramo passa pro withinConfirmWindow. Aceita literal numérico ou a constante.
function janelaDoRamo(kind) {
  const alvo = `i.kind === '${kind}'`;
  const i = ENGINE_SRC.indexOf(alvo);
  assert.ok(i > 0, `ramo não encontrado no engine.js: ${kind}`);
  const linha = ENGINE_SRC.slice(ENGINE_SRC.lastIndexOf('\n', i) + 1, ENGINE_SRC.indexOf('\n', i));
  const m = linha.match(/withinConfirmWindow\(i\.asked_at,\s*([A-Za-z_$][\w$]*|\d+)\s*\)/);
  assert.ok(m, `withinConfirmWindow não encontrado na guarda do ramo ${kind}: ${linha.trim()}`);
  return /^\d+$/.test(m[1]) ? Number(m[1]) : FRESH_WINDOW_MIN;
}

// --- Fixtures do turno real (pending_intents + conversation_history, achado 91922e36) ---
const ASKED_AT = '2026-09-04T00:40:50.334761+00:00'; // reschedule_confirm estagiada
const SIM_AT = '2026-09-04T00:58:30.346495+00:00'; // inbound "Sim"

function comRelogioNoTurno(fn) {
  // A escada (03/09) já pagou por isto: withinConfirmWindow lê Date.now(). Achado do acervo
  // rodado sem pin do relógio devolve neutro e o neutro é indistinguível de veredito.
  const real = Date.now;
  Date.now = () => new Date(SIM_AT).getTime();
  try { return fn(); } finally { Date.now = real; }
}

test('o "Sim" da Vitoria é confirmação e chega dentro da janela genérica (controle)', () => {
  assert.strictEqual(detectUserConfirmation('Sim'), 'yes');
  comRelogioNoTurno(() => {
    // Controle: o auto-resolve genérico ACEITOU — é isso que queima o "sim".
    assert.strictEqual(withinConfirmWindow(ASKED_AT, FRESH_WINDOW_MIN), true);
    // Controle negativo: fora da janela genérica ninguém aceita, e aí não há banda morta.
    const velha = new Date(new Date(SIM_AT).getTime() - 45 * 60000).toISOString();
    assert.strictEqual(withinConfirmWindow(velha, FRESH_WINDOW_MIN), false);
  });
});

test('o executor estagiado alcança o turno real da Vitoria (17m40s)', () => {
  comRelogioNoTurno(() => {
    for (const kind of RAMOS_POR_SIM) {
      assert.strictEqual(
        withinConfirmWindow(ASKED_AT, janelaDoRamo(kind)),
        true,
        `${kind}: o "Sim" de 17m40s foi aceito pelo auto-resolve genérico e recusado aqui — `
        + 'a intent com os dados concretos nunca executa',
      );
    }
  });
});

test('não existe banda morta: quem o genérico aceita, o estagiado também aceita', () => {
  const base = new Date(SIM_AT).getTime();
  comRelogioNoTurno(() => {
    for (const kind of RAMOS_POR_SIM) {
      const janela = janelaDoRamo(kind);
      for (let seg = 0; seg <= FRESH_WINDOW_MIN * 60; seg += 20) {
        const askedAt = new Date(base - seg * 1000).toISOString();
        if (!withinConfirmWindow(askedAt, FRESH_WINDOW_MIN)) continue;
        assert.strictEqual(
          withinConfirmWindow(askedAt, janela),
          true,
          `${kind}: idade de ${(seg / 60).toFixed(2)}min cai na banda morta `
          + `(genérico=${FRESH_WINDOW_MIN}min aceita, ramo=${janela}min recusa)`,
        );
      }
    }
  });
});
