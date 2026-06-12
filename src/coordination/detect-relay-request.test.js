'use strict';

const assert = require('assert');
const { detectExplicitRelayRequest } = require('./detect-relay-request');

let pass = 0, fail = 0;
function check(label, text, shouldFire) {
  const r = detectExplicitRelayRequest(text);
  const fired = !!r;
  if (fired === shouldFire) { pass++; }
  else { fail++; console.error(`FAIL: ${label} → esperado fire=${shouldFire}, veio=${fired}`, r); }
}

// --- DEVE casar (relay explícito — strings reais dos incidentes 11/06) ---
check('Daiana relay', 'Tom, avise ao Clayton que já criei o lembrete das 14h no app sobre o 360', true);
check('Fefê relay stuck', 'Avisa o Clayton que ja fiz o lembrete ☺️', true);
check('Fefê relay recovery', 'Tom, avisa o Clayton que o rapaz veio consertar a porta.', true);
check('Daiana 2o relay', 'Diga ao Clayton que já criei o lembrete diário', true);
check('fala pro', 'fala pro João que vou chegar atrasado', true);
check('manda avisar', 'manda avisar a Anne que a reunião mudou', true);
check('comunica', 'comunica o Pedro que o show foi cancelado', true);
check('sem artigo capitalizado', 'avisa Clayton que terminei', true);

// --- NÃO deve casar (respostas cruas, perguntas, fragmentos) ---
check('resposta Feito', 'Feito', false);
check('resposta RSVP', 'Não, irei entregar no dia 30/06', false);
check('numero', '2', false);
check('pergunta avisar', 'Conseguiu avisar ao Clayton?', false); // falta "que <conteúdo>"
check('fragmento resposta', 'já criei o lembrete', false);
check('fala que sim', 'fala que sim', false);          // sem destinatário entre verbo e que
check('avisar que recebi', 'pode avisar que recebi', false); // sem destinatário
check('scaffold pronome', 'O Clayton me pediu pra te avisar quando configurar', false); // "te" é stop

console.log(`\n[detect-relay-request] ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
