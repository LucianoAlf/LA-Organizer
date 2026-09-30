'use strict';
// META-NARRACAO — textos REAIS de conversation_history (1:1). O primeiro e o vazamento da Kailane
// (29/09 19:05 BRT, bc4a0a6d); os de "passa intacto" sao saidas reais do mesmo dia e do replay de
// 30 dias que NAO podem ser tocadas (o replay de 30 dias mudaria exatamente 1 de 5.104 saidas).
const { test } = require('node:test');
const assert = require('node:assert');
const { stripMetaNarracao, motivoDaMetaNarracao } = require('./meta-narracao');

const KAILANE_VAZOU = 'Kailane quer que eu avise a Krissya + dê retorno da tarefa, sem concluir (o lead não atendeu). Vou marcar a tarefa como concluída com nota (já que a ação da Kailane foi feita — ligou), mas primeiro preciso confirmar o envio do recado à Krissya.\n\nVou fechar a tarefa com a devolutiva (ligou, não atendeu) e mandar o aviso pra Krissya — confirma?';

test('Kailane 29/09: o paragrafo de planejamento em 3a pessoa sai, a pergunta de verdade fica', () => {
  const r = stripMetaNarracao(KAILANE_VAZOU, { nomes: ['Kailane'] });
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.reply, 'Vou fechar a tarefa com a devolutiva (ligou, não atendeu) e mandar o aviso pra Krissya — confirma?');
  assert.strictEqual(r.removidos[0].motivo, 'terceira_pessoa');
  assert.doesNotMatch(r.reply, /Kailane quer/);
});

test('o nome e o do DESTINATARIO: o mesmo texto mandado pra outra pessoa nao e narracao dela', () => {
  // "Kailane quer que eu…" mandado pra Krissya seria um recado (estranho, mas nao e o TOM
  // pensando alto sobre quem le). A regra so vale pro nome de quem recebe.
  const r = stripMetaNarracao(KAILANE_VAZOU, { nomes: ['Krissya'] });
  assert.strictEqual(r.fired, false);
});

// Os três abaixo são SINTÉTICOS (formas previstas; o replay de 30 dias não teve nenhuma).
test('"o usuário quer…" e "the user…" no comeco do paragrafo saem', () => {
  const r = stripMetaNarracao('O usuário quer mover a reunião pra sexta. Vou emitir o update.\n\nFechado, movi pra sexta 15h ✅', { nomes: ['Mayra'] });
  assert.strictEqual(r.reply, 'Fechado, movi pra sexta 15h ✅');
  assert.strictEqual(r.removidos[0].motivo, 'usuario_sujeito');
  assert.strictEqual(motivoDaMetaNarracao('The user wants the list.'), 'usuario_sujeito');
});

test('"Vou emitir…" (plano de mecanismo) sai', () => {
  assert.strictEqual(motivoDaMetaNarracao('Vou emitir o marcador de conclusão e depois confirmo.'), 'plano_de_mecanismo');
});

test('negrito/emoji na frente nao esconde a narracao', () => {
  assert.strictEqual(motivoDaMetaNarracao('*Kailane pediu pra eu avisar a Krissya.*', { nomes: ['Kailane'] }), 'terceira_pessoa');
});

test('texto INTEIRO de narracao vira vazio (quem chama cai no fallback honesto)', () => {
  const r = stripMetaNarracao('Kailane quer que eu avise a Krissya. Vou marcar a tarefa.', { nomes: ['Kailane'] });
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.reply, '');
});

// ── PASSA INTACTO: saidas reais que o guard NAO pode tocar ────────────────────────────────────
const INTACTOS = [
  // relay (o nome em 3a pessoa e de OUTRA pessoa) — Kailane 29/09 19:24
  ['Kailane', 'Oi, Kailane 👋\n\nO Krissya pediu pra eu te repassar (literalmente):\n\n"o que ela quer, é só chamar o uber"'],
  // confirmação que cita a pessoa pelo nome (vocativo)
  ['Kailane', 'Oi, Kailane, mensagem cortada — o que você ia dizer? 😊'],
  // promessa na 2a pessoa — "Vou marcar" sem narrar ninguem (a 1a é real, Kailane 29/09 19:12; a 2a, sintética)
  ['Kailane', 'Aviso o Krissya? Confirma?'],
  ['Mayra', 'Vou marcar pra amanhã às 9h, beleza?'],
  // briefing real da Mayra 30/09 08:02
  ['Mayra', 'Bom dia, Mayra 👽\n\n*PESSOAL · hoje:*\n📭 Nada marcado.\n\n----------\n\n*TRABALHO · hoje:*\n📭 Nada marcado direto pra você, mas tem pendência dos grupos: 10 PIX automático atrasados (ADM CG) e 2 anamneses de hoje (João Bernardes 16h, Maicon Viana 20h).\n\n🎯 Vale começar pelo PIX, tá represado há dias. Bora?'],
  // laudo de governança (fala "o usuário" no MEIO da frase — é relato, nao pensamento)
  ['Luciano', '*Dudu* (1):\n  • 🟠 [cobrança indevida] TOM enviou briefing de trabalho num sábado em que o usuário não trabalha, gerando acionamentos indevidos no dia de folga'],
  // (sintético) fala sobre OUTRA pessoa a um líder, sem plano em 1a pessoa
  ['Jereh', 'Jereh, a Mayra pediu reagendamento da reunião pra quinta.'],
  // PRÉVIA DE RECADO mostrada a quem pediu (o nome dela em 3a pessoa, SEM plano do TOM) — reais,
  // 03/08 (dca782a4, pra Anne) e 29/08 (8b318dc1, pro Rafinha). É o que a exigência de plano em
  // 1a pessoa protege: começam com o nome + verbo de pedido e não são pensamento.
  ['Anne', 'Jhonatan de CG, certo. Aviso ele assim:\n\n*"Anne pede pra você ver disponibilidade de aula experimental de bateria — filho da Pâmela (amiga dela), 10 anos. Melhores dias: terça ou quinta."*\n\nMando essa mensagem pro Jhonatan? Confirma?'],
  ['Rafinha', 'Mando pro Alf assim?\n\n_"Rafinha precisa de aprovação pra comprar 3 abafadores pra escola da Barra — situação urgente. Pode?"_\n\nConfirma?'],
];

for (const [nome, texto] of INTACTOS) {
  test(`intacto: ${texto.slice(0, 50).replace(/\n/g, ' ')}`, () => {
    const r = stripMetaNarracao(texto, { nomes: [nome] });
    assert.strictEqual(r.fired, false);
    assert.strictEqual(r.reply, texto);
  });
}

test('nome curto (< 3 letras) nao vira gatilho', () => {
  assert.strictEqual(motivoDaMetaNarracao('Al quer que eu mande.', { nomes: ['Al'] }), null);
});
