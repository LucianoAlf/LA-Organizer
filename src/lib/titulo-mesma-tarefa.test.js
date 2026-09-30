'use strict';
// TITULO-REESCRITO (29/09) — "é a mesma tarefa?" decidido por CONTEÚDO, não por substring nem por
// Jaro-Winkler de prefixo.
//
// Dois erros opostos, os dois com texto real:
//  - falso "mesma": 29/09 20:28 (Yuri) o dupguard (IntegrityCheck DUP_TASK score=1.00) barrou
//    "Follow Up Eventos Jordan (Gospel Session e Liverpool Day)" como duplicata de "Follow up L.A
//    Session com Jereh (ver se Alves gravou)". JW com prefixo "follow up " + boost de keyword
//    genérica ("Follow", "Session") = 1.00.
//  - falso "nova": a Krissya pediu "ver o vídeo da Vitória"; o TOM gravou "Ver o vídeo de registro
//    de visitas (postado pela Vitória no grupo)". Checagem de existência por ilike '%titulo%' não
//    reconhece o título reescrito → a próxima menção vira tarefa nova (duplicata).
const { test } = require('node:test');
const assert = require('node:assert');
const { mesmaTarefa, tokensDoTitulo, tarefasParecidas } = require('./titulo-mesma-tarefa');
const { PARES } = require('./titulo-mesma-tarefa.rotulado');

test('Jereh × Jordan (dupguard 29/09): DIFERENTES', () => {
  assert.strictEqual(mesmaTarefa('Follow up com Jereh', 'Follow up Eventos Jordan').mesma, false);
  assert.strictEqual(mesmaTarefa(
    'Follow Up Eventos Jordan (Gospel Session e Liverpool Day)',
    'Follow up L.A Session com Jereh (ver se Alves gravou)',
  ).mesma, false);
});

test('título reescrito pelo TOM (Vitória 29/09): MESMA', () => {
  const gravada = 'Ver o vídeo de registro de visitas (postado pela Vitória no grupo)';
  assert.strictEqual(mesmaTarefa('ver o vídeo da Vitória', gravada).mesma, true);
  assert.strictEqual(mesmaTarefa('Ver o vídeo de registro de visitas que a Vitória postou no grupo', gravada).mesma, true);
  // simétrica
  assert.strictEqual(mesmaTarefa(gravada, 'ver o vídeo da Vitória').mesma, true);
});

test('normalização: acento, caixa, pontuação, "L.A", ordinal, unidade grudada, plural e verbo', () => {
  const t = (s) => [...tokensDoTitulo(s)].sort();
  assert.deepStrictEqual(t('Follow up L.A Session com Jereh'), t('la session jereh'));
  assert.strictEqual(t('Follow up L.A Session com Jereh').length, 3); // follow/up/com fora
  assert.deepStrictEqual(t('Tomar remédio (3ª dose)'), t('tomar remedio 3 dose'));
  assert.deepStrictEqual(t('Trocar filtro de linha (20A)'), t('trocar filtro linha 20'));
  assert.deepStrictEqual(t('Receber violões'), t('receber violão'));
  assert.deepStrictEqual(t('que a Vitória postou'), t('postado pela Vitória'));
  assert.deepStrictEqual(t('registrar visitas'), t('registro de visita'));
});

test('um só token de conteúdo em comum não basta ("Ligar pro Norton" × "Falar com o Norton sobre X")', () => {
  assert.strictEqual(mesmaTarefa('Ligar pro Norton', 'Falar com o Norton sobre o contrato').mesma, false);
  // mas título idêntico (normalizado) é sempre a mesma
  assert.strictEqual(mesmaTarefa('Lembrete 360', 'lembrete 360').mesma, true);
});

test('negação muda a tarefa (replay de grupo 30/09: "Lead compareceu" × "Lead não compareceu")', () => {
  assert.strictEqual(mesmaTarefa('Lead compareceu', 'Lead não compareceu').mesma, false);
  assert.strictEqual(mesmaTarefa('Matricula Realizada', 'Matricula não Realizada').mesma, false);
  // negação dos DOIS lados não atrapalha
  assert.strictEqual(mesmaTarefa('Avisar que não vai ter aula de bateria', 'Avisar alunos que não vai ter aula de bateria').mesma, true);
});

test('entrada vazia/lixo não lança e não casa', () => {
  assert.strictEqual(mesmaTarefa('', 'Ver o vídeo').mesma, false);
  assert.strictEqual(mesmaTarefa(null, undefined).mesma, false);
  assert.deepStrictEqual(tarefasParecidas(null, 'x'), []);
});

test('tarefasParecidas: mantém o que o ilike achava E acrescenta o título reescrito', () => {
  const rows = [
    { id: '1', title: 'Ver o vídeo de registro de visitas (postado pela Vitória no grupo)' },
    { id: '2', title: 'Ligar pro lead da Ana — matrícula de bateria' },
    { id: '3', title: 'Follow up Eventos Jordan' },
  ];
  assert.deepStrictEqual(tarefasParecidas(rows, 'ver o vídeo da Vitória').map((r) => r.id), ['1']);
  assert.deepStrictEqual(tarefasParecidas(rows, 'Ligar pro lead').map((r) => r.id), ['2']); // trecho (ilike)
  assert.deepStrictEqual(tarefasParecidas(rows, 'Follow up com Jereh').map((r) => r.id), []);
});

// ── conjunto rotulado (títulos reais do banco/log) ────────────────────────────────────────
test('conjunto rotulado tem ≥ 20 pares e as duas classes', () => {
  assert.ok(PARES.length >= 20);
  assert.ok(PARES.some((p) => p.mesma) && PARES.some((p) => !p.mesma));
});

test('precisão 100%: nenhum par DIFERENTE do conjunto é dado como mesma', () => {
  const falsos = PARES.filter((p) => !p.mesma && mesmaTarefa(p.a, p.b).mesma);
  assert.deepStrictEqual(falsos.map((p) => `${p.a} ~ ${p.b}`), []);
});

test('recall: todo par MESMA casa, exceto os sinônimos declarados (limite honesto do método)', () => {
  const perdidos = PARES.filter((p) => p.mesma && !p.limite && !mesmaTarefa(p.a, p.b).mesma);
  assert.deepStrictEqual(perdidos.map((p) => `${p.a} ~ ${p.b}`), []);
  const limites = PARES.filter((p) => p.limite);
  assert.ok(limites.length <= 3, 'limite declarado deve ser exceção');
});

// ── contrato de fonte: o dupguard da criação usa a regra nova ─────────────────────────────
const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: detectDuplicateSemanticTask decide o "probable" por mesmaTarefa (não por JW+keyword)', () => {
  const ini = ENG.indexOf('async function detectDuplicateSemanticTask(');
  assert.ok(ini > 0);
  const corpo = ENG.slice(ini, ENG.indexOf('\n}\n', ini));
  assert.match(corpo, /let isDupProbable = _mt\.mesma;/);
  assert.match(corpo, /mesmaTarefa\(candidate\.title, task\.title\)/);
  assert.doesNotMatch(corpo, /isDupProbable = \(score >= 0\.95/);
  // janela de 30 dias: as mais recentes primeiro (antes: limit 50 sem ordem, amostra arbitrária)
  assert.match(corpo, /\.order\('created_at', \{ ascending: false \}\)/);
});
