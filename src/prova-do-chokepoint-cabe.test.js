'use strict';
// Contrato: a prova ORIGINAL que as portas de honestidade guardam em marker_logs chega INTEIRA.
//
// Caso real — Clayton, 26/09 09:01:19 e 09:02:32 BRT. Ele pediu LEITURA ("detalha pra mim essas
// duas pendências", "me passa o nome dos alunos") e as duas respostas saíram com
// "_⚠️ Na real não consegui registrar isso agora_" colado no fim, com parágrafo apagado. O
// health-check de 27/09 acusou os dois disparos (`%CHOKEPOINT%` 2×). Para saber QUAL linha o
// chokepoint acusou, o único lugar é o raw_excerpt — e nos dois ele para exatamente no caractere
// 500, antes da linha acusada ("E lembra que o recado da Fefê dizia "). Não dá pra provar nem
// refutar o guard.
//
// A intenção já existia: o commit 958bfd9d (10/09) subiu o corte das duas portas para 800 —
// "a prova estava cortada exatamente no trecho que importa" — com `String(reply).slice(0, 800)`.
// Só que o logMarker corta de novo em `rawLimit = 500` por padrão, e nenhuma das duas chamadas
// passava o limite. Medido em 27/09: das 47 linhas de CHOKEPOINT desde 21/08, a maior tem 500
// chars. O 800 nunca valeu.
//
// Censo derivado do fonte (não lista à mão — escada 24/09): toda chamada de logMarker cujo `raw` é
// um `_orig*` declarado com `.slice(0, N)` tem que passar um rawLimit >= N.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');

function limitePadrao() {
  const m = ENGINE_SRC.match(/async function logMarker\([^)]*\{\s*rawLimit\s*=\s*(\d+)\s*\}/);
  assert.ok(m, 'assinatura de logMarker com rawLimit default não encontrada');
  return Number(m[1]);
}

function censo() {
  const chamadas = [];
  const re = /logMarker\(([^;]*?),\s*(_orig\w+)\s*(?:,\s*\{\s*rawLimit\s*:\s*(\d+)\s*\})?\s*\)/g;
  let m;
  while ((m = re.exec(ENGINE_SRC))) {
    const nome = m[2];
    const decl = ENGINE_SRC.match(new RegExp(`const\\s+${nome}\\s*=\\s*[^;]*?\\.slice\\(0,\\s*(\\d+)\\)`));
    if (!decl) continue; // _orig sem slice explícito: fora do escopo deste contrato
    chamadas.push({
      nome,
      corte: Number(decl[1]),
      rawLimit: m[3] ? Number(m[3]) : null,
      linha: ENGINE_SRC.slice(0, m.index).split('\n').length,
    });
  }
  return chamadas;
}

test('censo acha as portas que guardam prova original com corte explícito', () => {
  const c = censo();
  // Controle contra o neutro: se o regex parar de casar, o teste de baixo passaria vazio.
  assert.ok(c.length >= 2, `esperava >=2 chamadas (_origPd, _origHon); achei ${c.length}`);
  const nomes = c.map(x => x.nome);
  assert.ok(nomes.includes('_origPd'), 'porta de promessa vazia fora do censo');
  assert.ok(nomes.includes('_origHon'), 'chokepoint fora do censo');
});

test('a prova original não é cortada de novo pelo default do logMarker', () => {
  const padrao = limitePadrao();
  const cortadas = censo()
    .map(x => ({ ...x, efetivo: x.rawLimit == null ? padrao : x.rawLimit }))
    .filter(x => x.efetivo < x.corte);
  assert.deepStrictEqual(
    cortadas.map(x => `${x.nome} (linha ${x.linha}): slice ${x.corte}, grava ${x.efetivo}`),
    [],
  );
});
