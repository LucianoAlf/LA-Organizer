'use strict';
// FOLGA-DND-ROUTING (audit 18/08, Dai — TOM cobrou em dia de folga).
//
// A infra de silêncio existe (do_not_disturb_until + quiet-hours; 14 pontos do dispatcher já
// respeitam). Mas uma folga DECLARADA na conversa ("hoje tô de folga") nunca virava DND: o
// router (pickSkill priority 1.5) só rota pra `pausa-temporaria` em pedido EXPLÍCITO de pausa
// ("agora não", "tô em aula"), e a própria skill exclui "tô ocupado/cansado hoje" como estado
// emocional. Resultado: o TOM respondia "dia de folga merecida" só em prosa, sem emitir marker,
// e à noite os rituais (fechamento, planejar semana) cobravam na folga.
//
// Fix: folga DE HOJE, declarada pelo próprio colaborador, rota pra `pausa-temporaria` (que
// ensina o DND até o fim do dia). Guards: NÃO rota folga FUTURA ("amanhã é folga"), NEGADA
// ("não tô de folga") nem de TERCEIRO ("folga do Rafinha"), nem estado emocional ("tô cansado").

const test = require('node:test');
const assert = require('node:assert');
const { pickSkill } = require('./system');

const DAI = { id: '4c5796ca-dea0-40ea-9d96-3b1fd3929bb7', full_name: 'Dai', role: 'collaborator' };

// POSITIVOS — folga de hoje, primeira pessoa → pausa-temporaria (carrega o ensino de DND).
for (const msg of [
  'Oi Tom, hoje eu estou de folga',
  'tô de folga hoje, avisa se precisar',
  'hoje é minha folga',
  'Dia de folga hoje, Tom 🙌',
  'Oi Tom, hoje eu estou de folga, mas amanhã eu vou passar tudinho pra você',  // folga HOJE + "amanhã" solto (caso real Dai 08/10)
  'Hoje é domingo tô de folga',                                                 // folga HOJE + dia-da-semana solto (caso real)
  'Não fiz porque hoje foi minha folga, tom',                                   // folga de hoje (passado no mesmo dia)
]) {
  test(`folga de hoje roteia pra pausa-temporaria: "${msg.slice(0, 30)}"`, async () => {
    const skill = await pickSkill(DAI, msg, []);
    assert.strictEqual(skill && skill.name, 'pausa-temporaria');
  });
}

// NEGATIVOS (anti-overfit) — não pode roubar pra pausa-temporaria.
for (const msg of [
  'amanhã é minha folga',                 // futuro
  'minha folga é só semana que vem',      // futuro
  'não tô de folga hoje não',             // negação
  'tô cansado hoje',                      // estado emocional (exclusão que já existia)
  'a folga do Rafinha é hoje',            // terceiro
]) {
  test(`NÃO roteia pra pausa-temporaria: "${msg.slice(0, 30)}"`, async () => {
    const skill = await pickSkill(DAI, msg, []);
    assert.notStrictEqual(skill && skill.name, 'pausa-temporaria');
  });
}
