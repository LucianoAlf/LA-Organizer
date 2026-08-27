'use strict';

// Prova de reversão do CTX-WINDOW-SORTPOS-BLIND (Rafinha, 26/08 12:48 BRT).
// Linhas reais da query de contexto (tasks work, assigned_to Rafinha, lte due_date next7days,
// ordenadas como o SQL entregava: sort_position → due_date → remind_at).
const { test } = require('node:test');
const assert = require('node:assert');
const { orderByDueDate, selecionarJanela, HORIZONTE_DIAS } = require('./context-task-order');

const JANELA = 8; // o teto ANTIGO do renderTaskList — mantido aqui como prova histórica

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

// ─────────────────────────────────────────────────────────────────────────────
// CTX-WINDOW-TETO-CEGO (27/08) — o fix de 26/08 arrumou a ORDEM, mas o teto fixo de 8 continuou.
// Medido em produção: 8 dos 23 colaboradores têm mais de 8 abertas; a maior fila tem 132. Quem
// perguntasse por uma data além das 8 deadlines mais próximas ouvia "não vejo nada" — falso-
// negativo que NENHUM guard de honestidade pega, porque o LLM nunca viu o dado.
// ─────────────────────────────────────────────────────────────────────────────
const HOJE = '2026-08-27';
const dias = (n) => { const d = new Date(HOJE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mk = (due, title = 'T', description = '') => ({ id: 'x', title, description, due_date: due });

test('DADO REAL: com o teto de 8, o 17º item do Rafinha ficava invisível; com a janela, não fica', () => {
  const antes = orderByDueDate(LINHAS_REAIS).slice(0, JANELA);
  assert.strictEqual(antes.length, 8, 'o teto antigo entregava 8 de 17');
  const { mostradas, ocultas } = selecionarJanela(LINHAS_REAIS, { hoje: '2026-08-26' });
  assert.strictEqual(mostradas.length, LINHAS_REAIS.length, 'as 17 cabem na janela de 14 dias');
  assert.strictEqual(ocultas, 0);
});

test('CASO RAFINHA continua verde pela janela nova (não só pelo slice)', () => {
  const titulos = selecionarJanela(LINHAS_REAIS, { hoje: '2026-08-26' }).mostradas.map((t) => t.title);
  for (const t of QUINTA) assert.ok(titulos.includes(t), `"${t}" ficou fora da janela`);
});

test('40 tarefas dentro do horizonte: nenhuma fica de fora (o teto de 8 cortava 32)', () => {
  const arr = [...Array(40)].map((_, i) => mk(dias(i % 14), `t${i}`));
  const { mostradas, ocultas } = selecionarJanela(arr, { hoje: HOJE });
  assert.strictEqual(mostradas.length, 40);
  assert.strictEqual(ocultas, 0);
});

test('atrasada NUNCA é cortada — é o que mais dói', () => {
  const arr = [...Array(30)].map((_, i) => mk(dias(i % 14), `t${i}`)).concat([mk(dias(-30), 'atrasadona')]);
  assert.strictEqual(selecionarJanela(arr, { hoje: HOJE }).mostradas[0].title, 'atrasadona');
});

test('fora do horizonte entra só se sobrar espaço — e o que sobra é CONTADO, nunca some', () => {
  const arr = [mk(dias(1), 'perto')].concat([...Array(60)].map((_, i) => mk(dias(200 + i), `longe${i}`)));
  const { mostradas, ocultas } = selecionarJanela(arr, { hoje: HOJE, maxItens: 10 });
  assert.strictEqual(mostradas[0].title, 'perto');
  assert.strictEqual(mostradas.length, 10);
  assert.strictEqual(mostradas.length + ocultas, arr.length);
});

test('teto por CARACTERES protege o prompt mesmo com tudo dentro do horizonte', () => {
  const gorda = () => mk(dias(2), 'T'.repeat(200), 'D'.repeat(400));
  const { mostradas, ocultas } = selecionarJanela([...Array(200)].map(gorda), { hoje: HOJE, maxChars: 5000 });
  assert.ok(mostradas.length > 0 && mostradas.length < 200, 'corta, mas sempre entrega alguma coisa');
  assert.strictEqual(mostradas.length + ocultas, 200);
});

test('sem-prazo é enchimento: nunca na frente de quem tem prazo', () => {
  const { mostradas } = selecionarJanela([mk(null, 'sem1'), mk(null, 'sem2'), mk(dias(3), 'com')], { hoje: HOJE });
  assert.strictEqual(mostradas[0].title, 'com');
});

test('lista vazia/lixo não quebra; HORIZONTE_DIAS é contrato', () => {
  assert.deepStrictEqual(selecionarJanela([], { hoje: HOJE }), { mostradas: [], ocultas: 0 });
  assert.deepStrictEqual(selecionarJanela(null, { hoje: HOJE }), { mostradas: [], ocultas: 0 });
  assert.strictEqual(HORIZONTE_DIAS, 14);
});
