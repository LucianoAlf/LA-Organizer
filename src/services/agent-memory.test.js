'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  looksLikeMemory, pareceCredencial, defaultsPorTipo, prepararCandidatas,
} = require('./agent-memory');

// looksLikeMemory saiu do engine.js VERBATIM — estes testes congelam o comportamento
// que o caminho 1:1 já dependia, pra extração não mudar nada por acidente.
test('looksLikeMemory: mesma ideia com outras palavras de ligação casa', () => {
  assert.strictEqual(looksLikeMemory('prefere reuniões curtas de manhã', 'prefere reunioes curtas manha'), true);
});
test('looksLikeMemory: assuntos diferentes não casam', () => {
  assert.strictEqual(looksLikeMemory('mora em Campo Grande', 'toca violão desde 2019'), false);
});
test('looksLikeMemory: vazio nunca casa', () => {
  assert.strictEqual(looksLikeMemory('', 'qualquer coisa'), false);
});

// Memória entra em prompt. Credencial não pode virar memória — vira ficha com campo secreto.
test('pareceCredencial pega senha/token/api key', () => {
  for (const t of ['a senha do Zoho é 1234', 'token de acesso do sistema', 'API key da integração', 'guardar credencial nova']) {
    assert.strictEqual(pareceCredencial(t), true, t);
  }
});
test('pareceCredencial NÃO pega conversa normal', () => {
  for (const t of ['contrato do Kaique não sai', 'a Daiana faz a matrícula', 'reunião toda segunda']) {
    assert.strictEqual(pareceCredencial(t), false, t);
  }
});

// O gate do Alf: lição vira REGRA de comportamento, então nasce desligada.
test('lesson nasce inativa; os outros tipos nascem ativos', () => {
  assert.strictEqual(defaultsPorTipo('lesson').is_active, false);
  for (const t of ['fact', 'decision', 'context', 'preference']) {
    assert.strictEqual(defaultsPorTipo(t).is_active, true, t);
  }
});

test('prepararCandidatas descarta duplicata, credencial e inválida, e respeita o teto', () => {
  const candidatas = [
    { memory_type: 'fact', content: 'a Daiana faz as matrículas', importance: 'normal' },
    { memory_type: 'fact', content: 'A DAIANA FAZ AS MATRICULAS', importance: 'high' },
    { memory_type: 'fact', content: 'a senha do Zoho mudou', importance: 'high' },
    { memory_type: 'invalido', content: 'tipo que não existe', importance: 'normal' },
    { memory_type: 'decision', content: 'sem conteúdo válido', importance: 'normal' },
  ];
  const r = prepararCandidatas(candidatas, ['a daiana faz as matriculas'], { teto: 8 });
  assert.strictEqual(r.descartadas.duplicata, 2, 'a existente e a repetida entre si');
  assert.strictEqual(r.descartadas.credencial, 1);
  assert.strictEqual(r.descartadas.invalida, 1);
  assert.deepStrictEqual(r.aceitas.map((c) => c.content), ['sem conteúdo válido']);
});

// ATENÇÃO à fixture: as 12 frases precisam ser DE VERDADE sobre assuntos diferentes. A
// primeira versão deste teste usava "assunto distinto numero N", que normaliza para o MESMO
// conjunto de palavras ({assunto, distinto, numero} — o índice tem menos de 4 chars e é
// descartado): as 11 seguintes caíam como duplicata e o teto nunca era exercitado.
test('prepararCandidatas corta no teto e conta o corte', () => {
  const assuntos = [
    'o grupo cuida das matriculas novas',
    'contratos ficam com a coordenacao',
    'anamnese entra pelo tablet da recepcao',
    'instagram do aluno vai no cadastro',
    'boletos seguem para o financeiro',
    'reuniao semanal acontece na segunda',
    'professores enviam presenca ate sexta',
    'eventos internos passam pela diretoria',
    'faturas fecham no dia cinco',
    'cheques guardados dentro do cofre',
    'repasses ocorrem toda quarta',
    'inventario roda no fim do mes',
  ];
  const muitas = assuntos.map((content) => ({ memory_type: 'fact', content, importance: 'normal' }));
  const r = prepararCandidatas(muitas, [], { teto: 8 });
  assert.strictEqual(r.descartadas.duplicata, 0, 'a fixture precisa ter assuntos REALMENTE distintos');
  assert.strictEqual(r.aceitas.length, 8);
  assert.strictEqual(r.descartadas.teto, 4);
});

test('anti-vacuidade: lista vazia devolve vazio sem inventar', () => {
  const r = prepararCandidatas([], [], { teto: 8 });
  assert.deepStrictEqual(r.aceitas, []);
});
