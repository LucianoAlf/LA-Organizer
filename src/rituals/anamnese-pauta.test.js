'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { montarPautaDaUnidade, TETO_FILHAS } = require('./anamnese-pauta');

const aluno = (nome, hora, temAnamnese) => ({
  nome, pessoa_chave: 'pk-' + nome, classificacao: 'LA',
  aulas_resumo: [`Canto — Segunda-feira ${hora}`],
  anamnese_preenchida: !!temAnamnese, cadastro_faltando: temAnamnese ? [] : ['anamnese'],
});

function deps({ rpcErro = null, alunos = [], falhas = new Map(), criar = null } = {}) {
  const criadas = [];
  return {
    criadas,
    laReport: { rpc: async () => ({ data: rpcErro ? null : alunos, error: rpcErro }) },
    repo: {
      registrarAparicoes: async () => ({ gravadas: alunos.length, erro: null }),
      contarFalhas: async () => falhas,
    },
    criarPacote: criar || (async (arg) => { criadas.push(arg); return { groupId: 'g-mae', childIds: [] }; }),
  };
}

// SEGUNDA-FEIRA = 2026-09-07
const SEGUNDA = '2026-09-07';

test('monta a pauta com quem tem aula hoje e está sem anamnese', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false), aluno('Bia', '08:00', false), aluno('Cid', '10:00', true)] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, true);
  assert.strictEqual(r.total, 2, 'Cid já tem anamnese e fica de fora');
  const arg = d.criadas[0];
  assert.deepStrictEqual(arg.input.subtasks.map((s) => s.title.slice(0, 5)), ['08:00', '09:00'],
    'ordenado por horário');
});

// Meio pacote é pior que zero: o time confia na lista e quem faltar passa batido.
test('RPC falha → NÃO cria nada e diz o motivo', async () => {
  const d = deps({ rpcErro: { message: 'timeout' } });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /timeout|consulta/i);
  assert.strictEqual(d.criadas.length, 0);
});

test('acima do teto de sanidade NÃO cria e avisa', async () => {
  const muitos = Array.from({ length: TETO_FILHAS + 1 }, (_, i) => aluno('A' + i, '09:00', false));
  const d = deps({ alunos: muitos });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.match(r.motivo, /teto/i);
  assert.strictEqual(d.criadas.length, 0);
});

test('pauta vazia não cria pacote', async () => {
  const d = deps({ alunos: [aluno('Cid', '10:00', true)] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(d.criadas.length, 0);
});

test('quem já falhou 2x sai da pauta e vira escalada', async () => {
  const d = deps({
    alunos: [aluno('Ana', '09:00', false), aluno('Cid', '10:00', false)],
    falhas: new Map([['pk-Cid', 2]]),
  });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.total, 1, 'só a Ana na pauta do dia');
  assert.strictEqual(r.escalados, 1);
});

test('erro ao ler a escada não escala ninguém', async () => {
  const d = deps({ alunos: [aluno('Cid', '10:00', false)], falhas: null });
  d.repo.contarFalhas = async () => null;
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: SEGUNDA, deps: d,
  });
  assert.strictEqual(r.escalados, 0, 'sem histórico confiável, ninguém é escalado');
  assert.strictEqual(r.total, 1);
});

// ── A ARMADILHA DO DIA DA SEMANA (LOCALYMD-UTC-SHIFT) ──────────────────────────────────────
// `hoje` chega em BRT já como "YYYY-MM-DD". Se o ritual derivar o dia da semana com
// `new Date(hoje).getDay()`, a string é lida como meia-noite UTC e o `.getDay()` devolve o dia
// em hora LOCAL do processo. Numa VPS rodando em UTC isso "acerta por sorte"; sob
// TZ=America/Sao_Paulo a mesma meia-noite UTC vira 21h do dia ANTERIOR e a pauta inteira sai
// no dia errado, em silêncio — é exatamente por isso que forçamos o TZ aqui: prova que o
// resultado NÃO depende do fuso do processo que roda o código.
test('dia da semana continua correto mesmo com o processo em America/Sao_Paulo', async () => {
  const tzOriginal = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    const d = deps({ alunos: [aluno('Ana', '09:00', false)] });
    const r = await montarPautaDaUnidade({
      supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
      hoje: SEGUNDA, deps: d,
    });
    assert.strictEqual(r.criou, true);
    assert.strictEqual(r.total, 1, '2026-09-07 é segunda-feira; a aula de segunda tem que bater mesmo sob TZ BRT');
  } finally {
    process.env.TZ = tzOriginal;
  }
});

// Segundo ponto de dados pra não ser coincidência de segunda-feira especificamente
// (2026-09-09 é quarta-feira — dois dias depois de 2026-09-07).
test('dia da semana bate também pra quarta-feira, não só segunda', async () => {
  const QUARTA = '2026-09-09';
  const alunoQuarta = {
    nome: 'Deb', pessoa_chave: 'pk-Deb', classificacao: 'LA',
    aulas_resumo: ['Canto — Quarta-feira 09:00'],
    anamnese_preenchida: false, cadastro_faltando: ['anamnese'],
  };
  const d = deps({ alunos: [alunoQuarta] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: QUARTA, deps: d,
  });
  assert.strictEqual(r.criou, true);
  assert.strictEqual(r.total, 1, 'quarta-feira 2026-09-09 tem que bater com aula de quarta-feira');
});

test('hoje malformado não derruba a pauta silenciosamente (diaSemana inválido é falha-fechada)', async () => {
  const d = deps({ alunos: [aluno('Ana', '09:00', false)] });
  const r = await montarPautaDaUnidade({
    supabase: {}, laReport: d.laReport, unidadeId: 'u1', groupId: 'grp', criadoPor: 'c1',
    hoje: '', deps: d,
  });
  assert.strictEqual(r.criou, false);
  assert.strictEqual(d.criadas.length, 0);
});
