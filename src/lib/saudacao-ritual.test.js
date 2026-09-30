// SAUDACAO-NOME-ERRADO (Peterson 29/09 19:04 BRT): o fechamento dele abriu com
// "Alf, fechamento. 😬" — o modelo copiou o nome do EXEMPLO da skill rituais-diarios.
// O nome do destinatário agora é do CÓDIGO: marcador {NOME} + pós-checagem na saudação.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aplicarNomeDoDestinatario, saudacaoAlheia, secaoDoDestinatario, nomesDoColaborador, nomesDeTerceiros,
} = require('./saudacao-ritual');

// Texto REAL enviado ao Peterson em 29/09 22:04 UTC (conversation_history 25a0e81f).
const REAL_PETERSON = `Alf, fechamento. 😬

Das 3 de hoje, essas 3 tão atrasadas há mais de 50 dias e nenhuma andou a semana toda:

1. 🔴 *SEO da loja* — fez?
2. 🔴 *Fazer post no Instagram da escola* — fez?
3. 🔴 *Preencher o LA Educa* — fez?

Me diz quais fez. Pode ser: "1 e 2" ou "fiz tudo" ou "nenhuma".`;

const PETERSON = { id: 'p', full_name: 'Peterson', preferred_name: null, aliases: null };
const ALF = { id: 'a', full_name: 'Luciano Alf', preferred_name: 'Alf', aliases: null };
const VITORIA = { id: 'v1', full_name: 'Vitoria' };
const TODOS = [PETERSON, ALF,
  { id: 'j', full_name: 'Juliana', preferred_name: 'Juliana' },
  VITORIA, { id: 'v2', full_name: 'Vitoria Andrade' },
  { id: 'q', full_name: '[QA] Replay 01' }];

function ctxPara(dest, nome) {
  return { nome: nome || dest.full_name.split(' ')[0],
    nomesDoDestinatario: nomesDoColaborador(dest), outrosNomes: nomesDeTerceiros(TODOS, dest) };
}

test('texto real do Peterson: detecta a saudação endereçada ao Alf', () => {
  assert.deepEqual(saudacaoAlheia(REAL_PETERSON, ctxPara(PETERSON)), ['Alf']);
});

test('texto real do Peterson: pós-checagem reescreve a saudação para Peterson, corpo intacto', () => {
  const r = aplicarNomeDoDestinatario(REAL_PETERSON, ctxPara(PETERSON));
  assert.ok(r.texto.startsWith('Peterson, fechamento. 😬\n'));
  assert.deepEqual(r.trocas, [{ de: 'Alf', para: 'Peterson' }]);
  assert.equal(r.texto.split('\n').slice(1).join('\n'), REAL_PETERSON.split('\n').slice(1).join('\n'));
  assert.deepEqual(saudacaoAlheia(r.texto, ctxPara(PETERSON)), []);
});

test('marcador {NOME} é preenchido pelo código', () => {
  const r = aplicarNomeDoDestinatario('Fechamento do dia, {NOME} 👽\n\n1. x — fez?', ctxPara(PETERSON));
  assert.equal(r.texto, 'Fechamento do dia, Peterson 👽\n\n1. x — fez?');
  const r2 = aplicarNomeDoDestinatario('{{NOME}}, 8h. 😬', ctxPara(PETERSON));
  assert.equal(r2.texto, 'Peterson, 8h. 😬');
});

test('variantes de saudação da skill (todas com "Alf") são reescritas', () => {
  for (const [ab, esperado] of [
    ['Fechamento do dia, Alf 👽', 'Fechamento do dia, Peterson 👽'],
    ['E aí, Alf, como foi o dia? 👽', 'E aí, Peterson, como foi o dia? 👽'],
    ['Bom dia, Alf 👽', 'Bom dia, Peterson 👽'],
    ['Alf, 8h. 😬', 'Peterson, 8h. 😬'],
    ['Boa noite, *Juliana*!', 'Boa noite, *Peterson*!'],
    ['Oi Alf!', 'Oi Peterson!'],
  ]) {
    assert.equal(aplicarNomeDoDestinatario(`${ab}\n\ncorpo`, ctxPara(PETERSON)).texto, `${esperado}\n\ncorpo`, ab);
  }
});

test('o próprio Alf continua sendo chamado de Alf (nome dele não é "alheio")', () => {
  const r = aplicarNomeDoDestinatario('Alf, fechamento. 😬\n\ncorpo', ctxPara(ALF, 'Alf'));
  assert.equal(r.texto, 'Alf, fechamento. 😬\n\ncorpo');
  assert.deepEqual(r.trocas, []);
});

test('menção a terceiro fora do vocativo NÃO é tocada (nem na abertura, nem no corpo)', () => {
  const t = 'Peterson, o Alf pediu o SEO. 😬\n\n1. *Enviar pro Alf* — fez?\nAlf, se precisar, avisa.';
  const r = aplicarNomeDoDestinatario(t, ctxPara(PETERSON));
  assert.equal(r.texto, t);
  assert.deepEqual(r.trocas, []);
});

test('nome que é prefixo de outro não casa (Alf ≠ Alfredo); homônimo parcial do destinatário é permitido', () => {
  assert.equal(aplicarNomeDoDestinatario('Alfredo, oi', ctxPara(PETERSON)).texto, 'Alfredo, oi');
  assert.deepEqual(saudacaoAlheia('Vitoria, fechamento.', ctxPara(VITORIA)), []);
});

test('lista de terceiros: sempre inclui "Alf" (nome dos exemplos da skill), ignora [QA] e o destinatário', () => {
  const outros = nomesDeTerceiros(TODOS, PETERSON);
  assert.ok(outros.includes('Alf'));
  assert.ok(outros.includes('Juliana'));
  assert.ok(!outros.includes('Peterson'));
  assert.ok(!outros.some((n) => n.includes('QA') || n === 'Replay'));
  assert.ok(nomesDeTerceiros([], PETERSON).includes('Alf'));
  assert.ok(!nomesDeTerceiros(TODOS, ALF).includes('Alf'));
});

test('seção do prompt nomeia o destinatário, proíbe outros nomes e pede o marcador', () => {
  const s = secaoDoDestinatario('Peterson');
  assert.match(s, /Peterson/);
  assert.match(s, /\{NOME\}/);
  assert.match(s, /NUNCA/);
  assert.match(s, /Alf/); // cita o nome dos exemplos como proibido
});

test('FIAÇÃO: sendRitual injeta a seção do destinatário e passa a pós-checagem ANTES de enviar', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
  const ini = src.indexOf('async function sendRitual(');
  const corpo = src.slice(ini, src.indexOf('\nfunction ritualToDirective', ini));
  const iSecao = corpo.indexOf('secaoDoDestinatario(');
  const iChat = corpo.indexOf('ai.chat(systemPrompt');
  const iFix = corpo.indexOf('aplicarNomeDoDestinatario(');
  const iEnvio = corpo.indexOf('whatsapp.sendMessage(collab.phone, finalText)');
  const iLog = corpo.indexOf("logConversation(collab.id, 'outbound', finalText)");
  assert.ok(iSecao > 0 && iSecao < iChat, 'seção do destinatário tem que entrar no prompt antes do ai.chat');
  assert.ok(iFix > iChat && iFix < iEnvio && iEnvio < iLog, 'pós-checagem tem que rodar entre o ai.chat e o envio/registro');
});
