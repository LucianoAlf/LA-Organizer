'use strict';

// Prova de reversão do CTX-WINDOW-SORTPOS-BLIND (Rafinha, 26/08 12:48 BRT).
// Linhas reais da query de contexto (tasks work, assigned_to Rafinha, lte due_date next7days,
// ordenadas como o SQL entregava: sort_position → due_date → remind_at).
const { test } = require('node:test');
const assert = require('node:assert');
const { orderByDueDate } = require('./context-task-order');

const JANELA = 8; // o mesmo slice(0,8) do renderTaskList em src/prompts/system.js

const LINHAS_REAIS = [
  { title: '3 adaptador p10/P2', due_date: '2026-08-31', sort_position: 0 },
  { title: '1 Fone', due_date: '2026-08-31', sort_position: 1 },
  { title: '2 Cabos tipo c', due_date: '2026-08-31', sort_position: 2 },
  { title: '2 Mouse Gamer', due_date: '2026-08-31', sort_position: 3 },
  { title: 'Mini Mec ( colocar no lugar )', due_date: '2026-08-31', sort_position: 4 },
  { title: '1 Tela Philips ( colocar no lugar )', due_date: '2026-08-31', sort_position: 5 },
  { title: 'Buscar impressoras em São Cristóvão', due_date: '2026-08-26', sort_position: null },
  { title: 'Consertar caixa de contrabaixo — Estúdio LA Campo Grande', due_date: '2026-08-26', sort_position: null },
  { title: 'Buscar controlador dimmer de iluminação — Estrada do Monteiro', due_date: '2026-08-26', sort_position: null },
  { title: 'Ir ao Recreio à noite', due_date: '2026-08-26', sort_position: null },
  { title: 'Charles led', due_date: '2026-08-27', sort_position: null },
  { title: 'Carlinho eletricista', due_date: '2026-08-27', sort_position: null },
  { title: 'Léo marcenaria', due_date: '2026-08-27', sort_position: null },
  { title: 'Rafael câmeras — telefone VoIP, câmeras e roteador internet', due_date: '2026-08-28', sort_position: null },
  { title: 'Falar com Valcilio ar condicionado', due_date: '2026-08-28', sort_position: null },
  { title: 'Comprar materiais pedagógicos — Mercado Livre', due_date: '2026-08-31', sort_position: null },
  { title: 'Comprar 2 estantes de piano', due_date: '2026-09-01', sort_position: null },
];

const QUINTA = ['Charles led', 'Carlinho eletricista', 'Léo marcenaria'];

test('caso Rafinha: as 3 tarefas de quinta 27/08 entram na janela do contexto', () => {
  const visiveis = orderByDueDate(LINHAS_REAIS).slice(0, JANELA).map(t => t.title);
  for (const t of QUINTA) {
    assert.ok(visiveis.includes(t), `"${t}" (due 27/08) ficou fora da janela — o TOM responde "não vejo nada cadastrado"`);
  }
});

test('prazo manda: nada que vence depois entra na frente de quem vence antes', () => {
  const datas = orderByDueDate(LINHAS_REAIS).map(t => t.due_date);
  for (let i = 1; i < datas.length; i++) {
    assert.ok(datas[i] >= datas[i - 1], `ordem quebrada em ${i}: ${datas[i - 1]} veio antes de ${datas[i]}`);
  }
});

test('ordem manual do PWA sobrevive DENTRO do mesmo dia', () => {
  const mesmoDia = orderByDueDate(LINHAS_REAIS)
    .filter(t => t.due_date === '2026-08-31' && t.sort_position !== null)
    .map(t => t.sort_position);
  assert.deepStrictEqual(mesmoDia, [0, 1, 2, 3, 4, 5], 'sort_position deveria ser desempate estável dentro do dia');
});

test('tarefa sem prazo vai pro fim, não pra frente de quem tem data', () => {
  const semPrazo = { title: 'sem prazo', due_date: null };
  const out = orderByDueDate([semPrazo, { title: 'hoje', due_date: '2026-08-26' }]);
  assert.strictEqual(out[0].title, 'hoje');
});

test('não muta o array recebido', () => {
  const entrada = [{ due_date: '2026-09-01' }, { due_date: '2026-08-26' }];
  orderByDueDate(entrada);
  assert.strictEqual(entrada[0].due_date, '2026-09-01');
});
