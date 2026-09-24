'use strict';
// PERGUNTA-NAO-E-FALHA — teste de contrato sobre o engine.
//
// Medido em 07/09 sobre 60 dias de marker_logs: dos 55 `TASK_UPDATE rejected all_failed:N`,
// **39 (71%, 16 pessoas) eram PERGUNTA de confirmação em lote**, 11 tinham `fails: []` e
// só **1** era alvo não encontrado. O TASK_UPDATE não rejeita 11% — rejeita ~2%.
//
// O dano não é cosmético: `docs/ops/ESCADA-GOVERNANCA.md` manda o agente cruzar achado aberto
// com `marker_logs result='rejected'` em ±20 min. Turno saudável virava achado, e achado falso
// come rodada de um teto de duas correções por dia. O engine já dizia, em comentário:
// "o auditor leu pergunta como mentira (caso Jhonatan 02/09)".
//
// Em 03/09 (9ffb9a7a) alguém gravou uma linha `skipped awaiting_confirm` AO LADO da `rejected`.
// Medido: **zero consumidores** em src/, scripts/ e docs/ops/, e **zero linhas** no banco em
// 60 dias. Log que ninguém lê, do lado de uma mentira que todo mundo lê.
//
// ESCOPO, e ele é medido — não é preguiça. Só as portas onde o defeito EXISTE foram tratadas:
//   TASK_UPDATE   39 de 55 rejeições eram pergunta  → corrigida
//   EVENT_UPDATE  já tinha a bandeira e não a usava → corrigida
//   HABIT_ACTION   2 de 12                          → fora: não há conceito de confirmação
//                                                     nesse handler, e 2 casos não justificam
//                                                     inventar um
//   EVENT_CREATE  16 rejeições, ZERO com raw        → não dá para avaliar (gap registrado)
//   PREFS_UPDATE / PERSONAL_LIST_ACTION  0          → sem evidência
//
// O engine é grande demais para teste de unidade (applyTaskActions precisa de supabase), então
// isto é contrato — o mesmo padrão de confirmacao-le-a-fala.test.js. E ele checa a DERIVAÇÃO,
// não a presença da palavra: procurar só pelo identificador foi exatamente o erro que me fez
// reprovar dois call sites CORRETOS nesta mesma casa, hoje de manhã.

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const FONTE = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
const DECIDE = /const result = okCount > 0 \? 'executed' : ([^;]+);/g;

// Para cada decisão de veredito, qual marcador ela grava logo abaixo.
function sitios() {
  DECIDE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = DECIDE.exec(FONTE)) !== null) {
    const depois = FONTE.slice(m.index, m.index + 600);
    const mk = depois.match(/logMarker\([^,]+,\s*'([A-Z_]+)'/);
    out.push({ ramoFalso: m[1].trim(), marcador: mk ? mk[1] : '(desconhecido)' });
  }
  return out;
}

// As portas onde o defeito foi MEDIDO. Mudar esta lista exige medição nova.
const PORTAS_CORRIGIDAS = ['TASK_UPDATE', 'EVENT_UPDATE'];

test('as portas medidas consultam a bandeira de pergunta antes de dizer "rejected"', () => {
  const faltando = sitios()
    .filter((s) => PORTAS_CORRIGIDAS.includes(s.marcador))
    .filter((s) => !/awaitingConfirm/i.test(s.ramoFalso));
  assert.deepStrictEqual(faltando, [],
    'porta medida voltou a gravar rejected sem perguntar se o turno foi PERGUNTA:\n'
    + faltando.map((s) => '  ' + s.marcador + ': ' + s.ramoFalso).join('\n'));
});

test('as duas portas corrigidas continuam existindo (o teste nao pode virar no-op)', () => {
  const achadas = sitios().filter((s) => PORTAS_CORRIGIDAS.includes(s.marcador)).map((s) => s.marcador);
  for (const p of PORTAS_CORRIGIDAS) {
    assert.ok(achadas.includes(p), `nao achei mais o site de ${p} — o contrato ficou vazio`);
  }
});

test('CENSO: um site novo obriga a decidir, em vez de passar calado', () => {
  // 6 em 07/09: TASK_UPDATE, PREFS_UPDATE, HABIT_ACTION, PERSONAL_LIST_ACTION,
  // EVENT_CREATE, EVENT_UPDATE. Se virar 7, alguem tem que medir a porta nova e
  // decidir — guard por caminho de codigo vira queijo suico (antipadrao 13.1 do manual).
  assert.strictEqual(sitios().length, 6,
    'mudou a quantidade de sites que decidem veredito por okCount. Meça a porta nova '
    + '(quantas das rejeições dela são pergunta?) e ou corrija, ou registre por que não.');
});

test('o veredito NUNCA rebaixa um turno que executou', () => {
  DECIDE.lastIndex = 0;
  let m;
  while ((m = DECIDE.exec(FONTE)) !== null) {
    assert.match(m[0], /okCount > 0 \? 'executed' :/,
      'executed tem que seguir amarrado a okCount > 0, sem condicional no meio');
  }
});

test('applyTaskActions devolve a bandeira (senao ela nao atravessa a fronteira)', () => {
  assert.match(FONTE, /return \{[^}]*awaitingConfirm: _perguntouConfirmacao[^}]*\};/);
  assert.match(FONTE, /let _perguntouConfirmacao = false;/);
  assert.match(FONTE, /_perguntouConfirmacao = true;/);
});

test('o chamador que GRAVA o marker recebe a bandeira no destructure', () => {
  // Ha duas chamadas com parsedTask.actions: o fail-safe do staged reschedule (que loga
  // inline) e a principal. A principal e a que destrutura failMessages — e a que importa.
  const principal = FONTE.match(/const \{[^}]*failMessages[^}]*\} = await applyTaskActions\(collab, parsedTask\.actions[^)]*\);/);
  assert.ok(principal, 'nao achei a chamada principal de applyTaskActions');
  assert.match(principal[0], /awaitingConfirm/,
    'sem isso a bandeira morre no retorno e o veredito volta a mentir');
});

test('o motivo tambem conta a verdade, nao so o result', () => {
  assert.match(FONTE, /awaiting_confirm:\$\{failCount\}/);
});

test('a linha companheira de 03/09 nao voltou (um turno, um registro)', () => {
  assert.ok(
    !/logMarker\(collaborator\.id, 'TASK_UPDATE', 'skipped',\s*`awaiting_confirm/.test(FONTE),
    'duas linhas para o mesmo turno dobram a contagem — e ninguem lia a segunda',
  );
});

// ---------------------------------------------------------------------------
// O LADO PRODUTOR. Tudo acima checa o CHAMADOR — que le a bandeira e grava o
// veredito. Ele esta certo desde 07/09 e nunca mais mentiu sozinho. Quem mente
// e quem PERGUNTA sem levantar a bandeira: o chamador recebe false e escreve
// `rejected all_failed`, com toda a razao, sobre um turno saudavel.
//
// 23/09 18:08:14 BRT, Jessica: o TOM avisou "amanha esta marcado: *Rose
// quentinhas*", ela respondeu por reply-quote "Marcar como realizado", e o
// guard de data futura perguntou "esta marcado pra 24/09 (ainda nao chegou).
// Confirma que ja foi feito mesmo assim?". Pergunta perfeita, gravada como
// recusa. A mesma porta ja tinha disparado em 14/09 20:52.
//
// A varredura de 07/09 enumerou as portas A MAO e envelheceu — e a forma ja
// repetiu: PERSONAL_LIST_ACTION parseado inline ficou fora da varredura de
// 10/09, e a 5a familia de executor (closing.items) nasceu fora do enumerador
// em 15/09. Por isso aqui o censo e DERIVADO da fonte, nao escrito a mao.
const CORPO = (() => {
  const ini = FONTE.indexOf('async function applyTaskActions(');
  const fim = FONTE.indexOf('awaitingConfirm: _perguntouConfirmacao', ini);
  return { ini, fim, texto: FONTE.slice(ini, fim) };
})();

// Cada openIntent de kind 'confirmation' e uma PERGUNTA ao usuario. A janela de
// cada um vai ate o proximo (ou 2500 chars, o que vier antes): e nela que a
// bandeira tem que subir.
function perguntasQueAbremIntent() {
  const re = /openIntent\(\s*collaborator\.id,\s*'confirmation'/g;
  const pos = [];
  let m;
  while ((m = re.exec(CORPO.texto)) !== null) pos.push(m.index);
  return pos.map((p, i) => {
    const limite = Math.min(i + 1 < pos.length ? pos[i + 1] : CORPO.texto.length, p + 2500);
    const janela = CORPO.texto.slice(p, limite);
    return {
      linha: FONTE.slice(0, CORPO.ini + p).split('\n').length,
      levanta: /_perguntouConfirmacao\s*=\s*true/.test(janela),
    };
  });
}

test('o corpo de applyTaskActions foi localizado (senao o contrato vira no-op)', () => {
  assert.ok(CORPO.ini > 0 && CORPO.fim > CORPO.ini, 'nao achei applyTaskActions ou o return da bandeira');
});

test('toda pergunta de confirmacao levanta a bandeira antes de sair do ramo', () => {
  const mudas = perguntasQueAbremIntent().filter((s) => !s.levanta);
  assert.deepStrictEqual(mudas.map((s) => s.linha), [],
    'openIntent de confirmacao que nao levanta _perguntouConfirmacao: o turno PERGUNTOU '
    + 'e vai ser gravado como all_failed (linhas: ' + mudas.map((s) => s.linha).join(', ') + ')');
});

test('CENSO das perguntas: uma porta nova obriga a decidir', () => {
  // 3 em 24/09: A2 batch-complete, data futura, cascata de serie antiga.
  // O dup-bypass (~6139) fica de fora de proposito: e kind 'task_creation' com
  // question_text null — persiste rascunho, nao pergunta nada.
  assert.strictEqual(perguntasQueAbremIntent().length, 3,
    'mudou a quantidade de perguntas de confirmacao em applyTaskActions. A porta nova '
    + 'tem que levantar a bandeira, ou o turno dela vai ser gravado como recusa.');
});
