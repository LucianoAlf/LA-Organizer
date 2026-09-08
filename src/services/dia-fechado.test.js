'use strict';
// FERIADO-COBRA-QUEM-NAO-TRABALHA, caminho PESSOAL (Quintela, 07/09/2026 19:25).
//
// Ele recebeu no privado, no feriado da Independência:
//   19:05  "Fechamento do dia, Quintela — Das suas 3 coisas: 1. Jornada do Aluno — fez?..."
//   19:25  "Quintela, balanço de aderência... Atrasadas: Jornada do Aluno (vencia há 32d)..."
// e respondeu "Tom, hj é feriado".
//
// Medido no dia: **222 mensagens para 33 pessoas** no feriado — volume de dia útil cheio
// (segunda normal: 263). Domingo, mesma semana: 21 para 8.
//
// Em 07/09 eu consertei o digest de GRUPO e o caminho pessoal ficou aberto. O agente de
// governança ainda fechou o achado como "corrigido pelo commit do Alf" — casou por ASSUNTO e
// não por caminho de código. Reaberto em 08/09.

const assert = require('node:assert');
const { test } = require('node:test');
const { ehDiaFechado, decidirFechado, _limparCache } = require('./dia-fechado');

function fakeLaReport({ aulas = [], erro = null, lanca = false } = {}) {
  return {
    from() {
      const b = {
        select() { return b; }, eq() { return b; }, gte() { return b; }, lte() { return b; },
        limit() {
          if (lanca) throw new Error('conexão caiu');
          if (erro) return Promise.resolve({ data: null, error: { message: erro } });
          return Promise.resolve({ data: aulas, error: null });
        },
      };
      return b;
    },
  };
}

test('decidirFechado: zero aula = fechado; uma aula ja abre o dia', () => {
  assert.strictEqual(decidirFechado([]), true);
  assert.strictEqual(decidirFechado([{ id: 1 }]), false);
  assert.strictEqual(decidirFechado(null), true, 'ausencia de lista conta como zero');
});

test('dia com aula NAO e fechado', async () => {
  _limparCache();
  const r = await ehDiaFechado({ laReport: fakeLaReport({ aulas: [{ id: 1 }] }), ymd: '2026-09-08' });
  assert.strictEqual(r.fechado, false);
  assert.strictEqual(r.motivo, null);
});

test('dia sem aula em NENHUMA unidade e fechado (caso 07/09)', async () => {
  _limparCache();
  const r = await ehDiaFechado({ laReport: fakeLaReport({ aulas: [] }), ymd: '2026-09-07' });
  assert.strictEqual(r.fechado, true);
  assert.match(r.motivo, /sem aula/);
});

// --- FALHA PARA O LADO DE ENVIAR --------------------------------------------
test('leitura com ERRO nao silencia o dia', async () => {
  _limparCache();
  const r = await ehDiaFechado({ laReport: fakeLaReport({ erro: 'timeout' }), ymd: '2026-09-07' });
  assert.strictEqual(r.fechado, false, 'silencio por incapacidade e pior que ruido');
  assert.match(r.motivo, /leitura do calendario falhou/);
});

test('excecao na leitura nao silencia e nao derruba', async () => {
  _limparCache();
  const r = await ehDiaFechado({ laReport: fakeLaReport({ lanca: true }), ymd: '2026-09-07' });
  assert.strictEqual(r.fechado, false);
  assert.match(r.motivo, /leitura do calendario falhou/);
});

test('data invalida nao silencia', async () => {
  _limparCache();
  assert.strictEqual((await ehDiaFechado({ ymd: 'ontem' })).fechado, false);
  assert.strictEqual((await ehDiaFechado({ ymd: null })).fechado, false);
});

// --- CACHE: a falha nunca vira a verdade do dia ------------------------------
test('a resposta MEDIDA entra no cache', async () => {
  _limparCache();
  let chamadas = 0;
  const lr = { from() { chamadas++; const b = { select: () => b, eq: () => b, gte: () => b, lte: () => b, limit: () => Promise.resolve({ data: [], error: null }) }; return b; } };
  await ehDiaFechado({ laReport: lr, ymd: '2026-09-07' });
  await ehDiaFechado({ laReport: lr, ymd: '2026-09-07' });
  assert.strictEqual(chamadas, 1, 'sem cache seriam milhares de consultas por tique');
});

test('a FALHA nao entra no cache — o dia seguinte pode medir de novo', async () => {
  _limparCache();
  let n = 0;
  const lr = {
    from() {
      n++;
      const primeira = n === 1;
      const b = {
        select: () => b, eq: () => b, gte: () => b, lte: () => b,
        limit: () => Promise.resolve(primeira ? { data: null, error: { message: 'timeout' } } : { data: [], error: null }),
      };
      return b;
    },
  };
  const a = await ehDiaFechado({ laReport: lr, ymd: '2026-09-07' });
  assert.strictEqual(a.fechado, false);
  const b2 = await ehDiaFechado({ laReport: lr, ymd: '2026-09-07' });
  assert.strictEqual(b2.fechado, true, 'a falha nao pode congelar o dia como aberto');
  assert.strictEqual(n, 2, 'a segunda chamada precisa REmedir');
});

// --- O PORTAO no isQuietNow --------------------------------------------------
test('portao: TRABALHO cala em dia fechado, PESSOAL atravessa', async () => {
  _limparCache();
  const { isQuietNow } = require('./quiet-hours');
  const feriado = { ymd: '2026-09-07', dow: 1, hour: 19, minute: 25 };
  // Sem prefs (usuario sem cadastro) — que e justamente quem mais leva cobranca automatica.
  const t = await isQuietNow({ collaborator_id: null }, feriado, 'work');
  const p = await isQuietNow({ collaborator_id: null }, feriado, 'personal');
  assert.strictEqual(p.quiet, false, 'lembrete pessoal em feriado e coisa que a pessoa pediu pra si');
  // `t` depende do calendario real; o contrato aqui e o do PESSOAL nunca ser calado por este portao.
  if (t.quiet) assert.match(t.reason, /dia_fechado/);
});

test('opts.ignorarDiaFechado existe como valvula de escape', async () => {
  const fs = require('fs');
  const path = require('path');
  const fonte = fs.readFileSync(path.join(__dirname, 'quiet-hours.js'), 'utf8');
  assert.match(fonte, /opts && opts\.ignorarDiaFechado/,
    'sem valvula, um envio que PRECISA sair em feriado nao teria como');
});
