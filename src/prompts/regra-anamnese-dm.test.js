'use strict';
// DM-ANAMNESE-CONTA-TAREFA (Mayra 30/09): o TOM nunca responde quantidade de anamnese/contrato
// contando TAREFA. Três travas, uma por camada:
//   1. o prompt do 1:1 diz isso no bloco de grupos (onde a amostra de filhas tentava);
//   2. as filhas da pauta nem chegam ao recorte de tarefas do 1:1 (system.js);
//   3. o engine injeta a PAUTA DE HOJE da fonte e atende o <<SITUACAO_ALUNO>> antes do catch-all,
//      no chat e no bom dia; a rede da meta-narração roda nos dois caminhos.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildContext, REGRA_ANAMNESE_NAO_E_TAREFA } = require('./system');

const vazio = { personal: [], work: [] };
function ctxComGrupo(myGroupTasks = []) {
  return buildContext({ full_name: 'Mayra', id: 'm' }, {}, vazio, [], 0, [], [], [], [], [], [], [], [], [], [], [], null, [], [], [], null, [], [], [],
    { groups: [{ id: 'g', name: 'ADM CG', leader_id: null, members: [] }], myGroupTasks, parentTitleById: new Map() }, []);
}

test('prompt do 1:1: o bloco de grupos proíbe contar anamnese/contrato por tarefa', () => {
  const txt = ctxComGrupo();
  assert.ok(txt.includes(REGRA_ANAMNESE_NAO_E_TAREFA));
  assert.match(REGRA_ANAMNESE_NAO_E_TAREFA, /NUNCA conte pelas tarefas/);
  assert.match(REGRA_ANAMNESE_NAO_E_TAREFA, /PAUTA DE HOJE/);
});

const SRC_SYSTEM = fs.readFileSync(path.join(__dirname, 'system.js'), 'utf8');
const SRC_ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

test('recorte de tarefas de grupo do 1:1 tira as filhas da pauta antes do corte de 12', () => {
  assert.match(SRC_SYSTEM, /\.filter\(\(t\) => !ehFilhaDaPauta\(t\)\)\.slice\(0, 12\)/);
});

test('engine: números da pauta injetados no chat (gate) e no bom dia (ritual)', () => {
  assert.match(SRC_ENGINE, /falaDeAnamneseOuContrato\(text\)/);
  assert.match(SRC_ENGINE, /blocoDaPautaDM\(\{ porUnidade: _porUnidade, hoje: _hojePauta \}\)/);
  assert.match(SRC_ENGINE, /blocoDaPautaDM\(\{ porUnidade: _porBrief, hoje: _hojeBriefP, ritual: true \}\)/);
});

test('engine: <<SITUACAO_ALUNO>> é atendido ANTES do catch-all que apaga marcador desconhecido', () => {
  const iMarcador = SRC_ENGINE.indexOf('atenderMarkersPautaDM({ reply, laReport: _lrcSit');
  const iCatchAll = SRC_ENGINE.indexOf("UNKNOWN_MARKER_STRIPPED — names=");
  assert.ok(iMarcador > 0 && iCatchAll > 0 && iMarcador < iCatchAll);
});

test('engine: a rede da meta-narração roda no chat E no ritual', () => {
  const n = (SRC_ENGINE.match(/stripMetaNarracao\(/g) || []).length;
  assert.ok(n >= 2, `esperava 2 chamadas, achei ${n}`);
});
