'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resumir } = require('./jev-sombra-resumo');

const L = (o) => ({ ts: '2026-10-10T12:00:00Z', conf_gaveta: 0.99, conf_caixa: 0.99, ms: 700, custo: 0.00005, ...o });

test('resumo conta assunto, cobertura do pickSkill e pedidos que o TOM não marcou', () => {
  const r = resumir([
    L({ gaveta: 'tarefas', caixa: 'tarefa_criar', skill_pick: 'none', tom_marcador: '', tom_acionavel: true, fala: 'me lembra 10h' }),
    L({ gaveta: 'tarefas', caixa: 'tarefa_concluir', skill_pick: 'checklist-tarefas', tom_marcador: 'TASK_UPDATE', fala: 'feito o relatório' }),
    L({ gaveta: 'conversa', caixa: 'nenhuma', skill_pick: 'none', tom_marcador: '', fala: 'valeu' }),
    L({ gaveta: 'agenda', caixa: 'confirmacao_do_tom', caixa_jev: 'evento_concluir', skill_pick: 'none', tom_marcador: 'EVENT_UPDATE', fala: 'Fecha' }),
    { ts: '2026-10-10T12:00:00Z', erro: 'timeout' },
  ]);
  assert.match(r, /5 turnos · 1 sem resposta do Jev/);
  assert.match(r, /• tarefas: 2 .*pickSkill 1\/2 · TOM marcou 1\/2/);
  assert.match(r, /• conversa: 1 .*pickSkill 1\/1/);
  assert.match(r, /TOM sem marcador: 1/);
  assert.match(r, /ACTIONABLE_NO_MARKER do TOM: 1 · Jev deu ação de gravação em 1/);
  assert.doesNotMatch(r, /outro marcador · Jev evento_concluir/); // fala curta resolvida pela ação original do Jev
});
