'use strict';
// A MENSAGEM DE DIA INTEIRO (06/09) — Barra e Campo Grande.
//
// O time das duas unidades pediu UMA mensagem por dia em vez do lembrete de hora em hora
// (Barra 09:00, Campo Grande 13:00). O Recreio ficou como estava.
//
// A armadilha: o lembrete normal fala da hora SEGUINTE, e a recuperacao cobre "do comeco do dia
// ate as X". Uma mensagem unica as 09:00 com qualquer um dos dois cobriria so ate as 10:00 e
// deixaria a tarde inteira invisivel — o mesmo defeito de 04/09, quando 25 aulas por semana nao
// apareciam em lembrete nenhum. Por isso esta funcao nao recebe hora: ela cobre o DIA.
//
// A forma e a que o dono aprovou em 04/09 pra mensagem da manha: bloco por pendencia, dentro do
// bloco uma linha por horario, nomes separados por ponto. "Nao pode vir dentro do mesmo bolo."
const { test } = require('node:test');
const assert = require('node:assert');
const { lembreteDoDiaInteiro } = require('./anamnese-pauta');

const it = (nome, hora, pendencias) => ({ pessoa: { nome }, hora, curso: 'Teclado', pendencias });

test('dia inteiro: dois blocos, cada um agrupado por horario', () => {
  const m = lembreteDoDiaInteiro({
    unidadeNome: 'Barra',
    itens: [
      it('Ana Souza', '09:00', ['anamnese']),
      it('Gabriela da Silva', '09:00', ['anamnese']),
      it('Bento Ramos', '14:00', ['contrato']),
    ],
  });
  assert.strictEqual(m,
    '⏰ *Hoje na Barra — quem ainda está pendente*\n'
    + '\n'
    + '📋 *Anamnese*\n'
    + '🕘 *09:00* — Ana Souza · Gabriela da Silva\n'
    + '\n'
    + '✍️ *Contrato*\n'
    + '🕑 *14:00* — Bento Ramos');
});

test('dia inteiro: quem tem as DUAS pendencias aparece nos dois blocos', () => {
  const m = lembreteDoDiaInteiro({
    unidadeNome: 'Barra',
    itens: [it('Clara Nunes', '10:00', ['anamnese', 'contrato'])],
  });
  assert.match(m, /📋 \*Anamnese\*\n🕙 \*10:00\* — Clara Nunes/);
  assert.match(m, /✍️ \*Contrato\*\n🕙 \*10:00\* — Clara Nunes/);
});

test('dia inteiro: bloco sem ninguem NAO aparece', () => {
  const m = lembreteDoDiaInteiro({
    unidadeNome: 'Campo Grande',
    itens: [it('Ana', '13:00', ['contrato'])],
  });
  assert.doesNotMatch(m, /Anamnese/);
  assert.match(m, /✍️ \*Contrato\*/);
});

test('dia inteiro: a preposicao segue a unidade — no Campo Grande, no Recreio, na Barra', () => {
  const um = (u) => lembreteDoDiaInteiro({ unidadeNome: u, itens: [it('Ana', '13:00', ['anamnese'])] });
  assert.match(um('Campo Grande'), /Hoje no Campo Grande — quem ainda está pendente/);
  assert.match(um('Recreio'), /Hoje no Recreio — quem ainda está pendente/);
  assert.match(um('Barra'), /Hoje na Barra — quem ainda está pendente/);
});

test('dia inteiro: sem ninguem pendente devolve null — silencio, nao cabecalho sozinho', () => {
  assert.strictEqual(lembreteDoDiaInteiro({ unidadeNome: 'Barra', itens: [] }), null);
  assert.strictEqual(lembreteDoDiaInteiro({ unidadeNome: 'Barra', itens: [it('Ana', '09:00', [])] }), null);
});

test('dia inteiro: item sem hora nao vira linha torta', () => {
  const m = lembreteDoDiaInteiro({
    unidadeNome: 'Barra',
    itens: [it('Ana', '09:00', ['anamnese']), { pessoa: { nome: 'Sem hora' }, pendencias: ['anamnese'] }],
  });
  assert.doesNotMatch(m, /undefined|--:--/);
  assert.match(m, /🕘 \*09:00\* — Ana/);
});
