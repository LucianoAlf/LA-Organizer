'use strict';
// CONTRATO: TODA chamada de detectUserConfirmation no engine le a FALA, nao o scaffold.
//
// O webhook prepende a mensagem CITADA do TOM a fala do usuario num reply-quote. Ate 07/09 o
// engine chamava detectUserConfirmation em QUATRO lugares e so UM tirava o prefixo — as outras
// tres mediam o texto com a pergunta do proprio TOM colada na frente, e o "Sim" da pessoa se
// perdia.
//
// Medido na populacao real (1.000 mensagens inbound com scaffold, 07/09): 193 delas (19,3%)
// mudam de veredito com o strip, TODAS na mesma direcao — 173 null->yes e 20 null->no, ZERO
// perdendo deteccao. Nao era falso positivo: era gente dizendo sim e nao, e o engine sem ouvir.
// Casos reais que estavam sendo engolidos: "Sim", "Confirmado", "Isso", "Ok tom", "Ainda nao",
// "Cancelar tarefa".
//
// Este teste e de CONTRATO, nao de comportamento: ele le o proprio engine.js e exige que cada
// call site esteja envolvido pelo strip. E o unico jeito de a QUINTA chamada nao nascer cega —
// comentario nao segura, e as tres irmas erradas viviam a 80 linhas uma da outra.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ENGINE = path.join(__dirname, 'engine.js');

// ⚠️ O PREDICADO CHECA DERIVACAO, NAO VOCABULARIO. A primeira versao deste teste procurava a
// palavra `stripReplyScaffold` NA LINHA da chamada — e reprovou dois call sites CORRETOS, que
// passam uma variavel ja limpa (`_confirmText = stripReplyScaffold(...)`). Predicado por palavra
// reprova quem esta certo e aprova papagaio; o que vale e de ONDE O VALOR VEIO.
test('toda chamada de detectUserConfirmation no engine le a FALA, nao o scaffold', () => {
  const texto = fs.readFileSync(ENGINE, 'utf8');
  const linhas = texto.split('\n');

  // Variaveis que comprovadamente nascem do strip, em qualquer ponto do arquivo.
  const limpas = new Set();
  const reAtrib = /(?:const|let|var)\s+(\w+)\s*=\s*stripReplyScaffold\(/g;
  for (const m of texto.matchAll(reAtrib)) limpas.add(m[1]);

  const reChamada = /detectUserConfirmation\(\s*([^,)]+)/;
  const cegas = [];
  let total = 0;
  linhas.forEach((l, i) => {
    const m = l.match(reChamada);
    if (!m) return;
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*')) return;
    if (/function\s+detectUserConfirmation/.test(l)) return;
    total += 1;
    const arg = m[1].trim();
    if (!(arg.includes('stripReplyScaffold') || limpas.has(arg))) {
      cegas.push(`${i + 1}: ${t.slice(0, 92)}`);
    }
  });

  assert.ok(total >= 6, `esperava pelo menos 6 call sites, achei ${total} — o teste perdeu o alvo`);
  assert.ok(limpas.size >= 1, 'nenhuma variavel derivada do strip — a regra ficou cega');
  assert.deepStrictEqual(cegas, [],
    'call site lendo o texto CRU (o scaffold engole o "Sim" da pessoa):\n  ' + cegas.join('\n  '));
});
