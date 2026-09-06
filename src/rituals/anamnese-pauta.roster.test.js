'use strict';
// O LEITOR DO CALENDARIO (06/09/2026). Monta o roster do dia a partir das MESMAS tabelas que
// alimentam a Agenda do LA Report: aulas_emusys (a aula, com data/hora/curso/cancelada) e
// aula_alunos_emusys (quem esta ligado a ela).
//
// A distincao que este arquivo existe pra travar: `roster` VAZIO ("hoje nao tem aula") e coisa
// diferente de `roster` NULO com motivo ("nao consegui ler o calendario"). Os dois produzem pauta
// vazia, e so o segundo pode calar o TOM sem ele dizer por que.
const { test } = require('node:test');
const assert = require('node:assert');
const { rosterDoDia } = require('./anamnese-pauta');

// Fake encadeavel no formato do postgrest: .from().select().eq().gte().lte().in()
function fakeLaReport({ aulas = [], vinculos = [], erroAulas = null, erroVinculos = null, explode = null }) {
  const pedidos = [];
  const alvo = (tabela) => {
    const q = {
      _tabela: tabela, _filtros: {},
      select() { return q; },
      eq(k, v) { q._filtros[k] = v; return q; },
      gte(k, v) { q._filtros[`gte_${k}`] = v; return q; },
      lte(k, v) { q._filtros[`lte_${k}`] = v; return q; },
      in(k, v) { q._filtros[`in_${k}`] = v; return q; },
      then(res, rej) {
        pedidos.push({ tabela, filtros: { ...q._filtros } });
        if (explode === tabela) return Promise.reject(new Error('rede caiu')).then(res, rej);
        if (tabela === 'aulas_emusys') {
          return Promise.resolve(erroAulas ? { data: null, error: { message: erroAulas } } : { data: aulas, error: null }).then(res, rej);
        }
        return Promise.resolve(erroVinculos ? { data: null, error: { message: erroVinculos } } : { data: vinculos, error: null }).then(res, rej);
      },
    };
    return q;
  };
  return { from: (t) => alvo(t), pedidos };
}

const AULA = (id, iso, curso) => ({ id, data_hora_inicio: iso, curso_nome: curso });

test('roster: monta aluno -> hora em BRT, com o curso da aula', async () => {
  const lr = fakeLaReport({
    aulas: [AULA(1, '2026-09-08T12:00:00+00:00', 'Canto')],   // 09:00 BRT
    vinculos: [{ aula_emusys_id: 1, aluno_id: 42 }],
  });
  const r = await rosterDoDia({ laReport: lr, unidadeId: 'u1', hoje: '2026-09-08' });
  assert.strictEqual(r.motivo, null);
  assert.deepStrictEqual(r.roster.get(42), { hora: '09:00', curso: 'Canto' });
});

test('roster: dia sem aula devolve Map VAZIO e motivo null — nao e falha', async () => {
  const lr = fakeLaReport({ aulas: [] });
  const r = await rosterDoDia({ laReport: lr, unidadeId: 'u1', hoje: '2026-09-07' });
  assert.strictEqual(r.motivo, null);
  assert.strictEqual(r.roster.size, 0);
  assert.strictEqual(lr.pedidos.length, 1, 'sem aula nao precisa da segunda consulta');
});

test('roster: aula cancelada nao entra — o filtro vai na consulta', async () => {
  const lr = fakeLaReport({ aulas: [], vinculos: [] });
  await rosterDoDia({ laReport: lr, unidadeId: 'u1', hoje: '2026-09-08' });
  assert.strictEqual(lr.pedidos[0].filtros.cancelada, false);
  assert.strictEqual(lr.pedidos[0].filtros.unidade_id, 'u1');
});

test('roster: quem tem duas aulas no dia fica com a MAIS CEDO', async () => {
  const lr = fakeLaReport({
    aulas: [AULA(1, '2026-09-08T22:00:00+00:00', 'Bateria'), AULA(2, '2026-09-08T12:00:00+00:00', 'Canto')],
    vinculos: [{ aula_emusys_id: 1, aluno_id: 7 }, { aula_emusys_id: 2, aluno_id: 7 }],
  });
  const r = await rosterDoDia({ laReport: lr, unidadeId: 'u1', hoje: '2026-09-08' });
  assert.deepStrictEqual(r.roster.get(7), { hora: '09:00', curso: 'Canto' });
});

test('roster: erro na leitura das aulas devolve motivo e roster NULO', async () => {
  const lr = fakeLaReport({ erroAulas: 'timeout' });
  const r = await rosterDoDia({ laReport: lr, unidadeId: 'u1', hoje: '2026-09-08' });
  assert.strictEqual(r.roster, null);
  assert.match(r.motivo, /calendário|calendario/i);
  assert.match(r.motivo, /timeout/);
});

test('roster: erro na leitura dos vinculos tambem NAO vira dia vazio', async () => {
  const lr = fakeLaReport({ aulas: [AULA(1, '2026-09-08T12:00:00+00:00', 'Canto')], erroVinculos: 'boom' });
  const r = await rosterDoDia({ laReport: lr, unidadeId: 'u1', hoje: '2026-09-08' });
  assert.strictEqual(r.roster, null);
  assert.match(r.motivo, /boom/);
});

test('roster: excecao de rede vira motivo, nao sobe', async () => {
  const lr = fakeLaReport({ explode: 'aulas_emusys' });
  const r = await rosterDoDia({ laReport: lr, unidadeId: 'u1', hoje: '2026-09-08' });
  assert.strictEqual(r.roster, null);
  assert.match(r.motivo, /rede caiu/);
});

test('roster: data torta nao consulta nada e diz por que', async () => {
  const lr = fakeLaReport({});
  const r = await rosterDoDia({ laReport: lr, unidadeId: 'u1', hoje: '8/9/2026' });
  assert.strictEqual(r.roster, null);
  assert.match(r.motivo, /data/i);
  assert.strictEqual(lr.pedidos.length, 0);
});
