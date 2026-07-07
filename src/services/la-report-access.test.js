'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkAccess } = require('./la-report-access');

const mk = (over) => ({ id: 'x', full_name: 'X', unit: 'all', role: 'collaborator', function_role: null, pedagogical_role: null, ...over });

// Inventário liberado a TODO colaborador LOGADO, sem filtro de unidade (decisão Alf 07/07:
// "todo mundo que tem credencial vê o inventário; anon não"). unitFilter=null → vê todas as unidades.
// Corrige o gap dos managers de unidade (Jereh) SEM precisar mapear slug→UUID: ninguém filtra.
test('inventario: qualquer LOGADO vê tudo (allowed=true, unitFilter=null)', () => {
  const perfis = [
    mk({ role: 'manager', unit: 'campo_grande' }),          // Jereh
    mk({ function_role: 'ops_tecnicas' }),                   // Rafinha
    mk({ role: 'collaborator', unit: 'barra', function_role: 'professor' }),
    mk({ role: 'collaborator', unit: 'recreio' }),           // sem role especial
    mk({ role: 'director' }),
  ];
  for (const c of perfis) {
    const r = checkAccess(c, 'inventario');
    assert.strictEqual(r.allowed, true, `${c.role}/${c.function_role} deveria ver o inventario`);
    assert.strictEqual(r.unitFilter, null, 'inventario NÃO filtra por unidade');
  }
});

test('inventario: ANON (não logado, sem collaborator) é BARRADO', () => {
  assert.strictEqual(checkAccess(null, 'inventario').allowed, false);
});

// Rede anti-regressão: liberar o inventário NÃO pode ter aberto dado sensível/restrito.
test('REGRESSÃO: dado restrito segue fechado (faturamento = só director/backoffice_fin)', () => {
  assert.strictEqual(checkAccess(mk({ function_role: 'professor' }), 'faturamento').allowed, false);
  assert.strictEqual(checkAccess(mk({ role: 'manager', unit: 'campo_grande' }), 'faturamento').allowed, false);
  assert.strictEqual(checkAccess(mk({ role: 'director' }), 'faturamento').allowed, true);
});
