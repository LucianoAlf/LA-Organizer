'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { nomesReferidos, resolverReferencia, pistaDeReferencia } = require('./referencia-a-fala');

// Fabi 20/06 (edba1c46): as falas reais do TOM na rajada, em segundos antes do "essa da Gabi" (14:51:12).
const AGORA = Date.parse('2026-06-20T14:51:12Z');
const fala = (s, content) => ({ direction: 'outbound', content, created_at: new Date(AGORA - s * 1000).toISOString() });
const RECENTES = [
  fala(213, '⚠️ *Verificar com o Yuri como anda a mensagem automática de boas-vindas* está marcado pra *22/06* (ainda não chegou).'),
  fala(77, 'Fabi, sim — essa cobrança apareceu pra você como visão do time. Mas a tarefa é da *Gabi*, não sua: *Enviar e Verificar Respostas de Renovação (Ago)*, atrasada 1 dia.'),
  { direction: 'inbound', content: 'sim, duas ja foram concluidas', created_at: new Date(AGORA - 76000).toISOString() },
  fala(59, 'Você quer que eu feche 2 tarefas (*Verificar com o Yuri como anda a mensagem automática de boas-vindas*, *Verificar com o Hugo pendência do LAReport*)? Não vi você citar elas na mensagem.'),
  fala(25, 'Beleza, Fabi — combinado então. Vou considerar esse fechamento de lote confirmado por aqui.'),
  fala(1, 'Fabi, quais delas você quer que eu dê baixa? Você diz a do *Yuri*, a do *Hugo*, ou alguma dessas sem prazo que estão abertas?'),
];

test('Fabi: "essa da Gabi que não entendi" → a tarefa da Gabi que o TOM citou há 1 min', () => {
  assert.deepStrictEqual(nomesReferidos('essa da Gabi que não entendi'), ['Gabi']);
  assert.deepStrictEqual(resolverReferencia('Gabi', RECENTES, AGORA), { titulo: 'Enviar e Verificar Respostas de Renovação (Ago)', minutos: 1 });
  const p = pistaDeReferencia('essa da Gabi que não entendi', RECENTES, AGORA);
  assert.match(p, /"da Gabi" = \*Enviar e Verificar Respostas de Renovação \(Ago\)\*/);
  assert.match(p, /Não diga que não tem registro/);
});

test('"a do Hugo" acha o título que contém o nome (a fala mais recente só tinha *Hugo* solto)', () => {
  assert.strictEqual(resolverReferencia('Hugo', RECENTES, AGORA).titulo, 'Verificar com o Hugo pendência do LAReport');
});

test('nome que o TOM não citou, fala antiga (> 15 min) ou mensagem da pessoa → nada', () => {
  assert.strictEqual(pistaDeReferencia('e a do Pedro?', RECENTES, AGORA), '');
  assert.strictEqual(pistaDeReferencia('essa da Gabi que não entendi', RECENTES, AGORA + 20 * 60000), '');
  assert.strictEqual(resolverReferencia('Gabi', RECENTES.filter((m) => m.direction === 'inbound'), AGORA), null);
});

test('fala longa não é referência curta; minúscula depois de "da" não é nome', () => {
  assert.deepStrictEqual(nomesReferidos('olha, sobre aquela coisa da Gabi que você falou lá atrás eu queria entender melhor o prazo'), []);
  assert.deepStrictEqual(nomesReferidos('a da tarefa de ontem'), []);
});

test('duas falas com tarefas diferentes da Gabi → vale a mais recente', () => {
  const r = [fala(600, 'A da *Gabi*: *Ligar pro fornecedor de pele*'), fala(30, 'A da *Gabi*: *Enviar relatório da semana*')];
  assert.strictEqual(resolverReferencia('Gabi', r, AGORA).titulo, 'Enviar relatório da semana');
});

test('dois títulos com o nome na mesma fala → não escolhe (ambíguo)', () => {
  const r = [fala(30, '*Ligar pra Gabi sobre renovação* e *Cobrar a Gabi do relatório mensal*')];
  assert.strictEqual(resolverReferencia('Gabi', r, AGORA), null);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: ancora a referência antes de montar as mensagens do modelo', () => {
  const i = ENG.indexOf('const _refPista = pistaDeReferencia(');
  assert.ok(i > 0 && i < ENG.indexOf('  const msgs = formatMessages(ctx.recentMessages, text);'));
  assert.match(ENG, /if \(_refPista\) \{ text = `\$\{text\}\$\{_refPista\}`;/);
});
