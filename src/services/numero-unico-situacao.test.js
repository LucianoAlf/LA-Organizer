'use strict';
// numero-unico-situacao.test.js — UM NÚMERO SÓ pra mesma pergunta (Barra, 30/09).
//
// O CASO: "quem está sem contrato?" dava 41 no card <<SITUACAO_ALUNO>> e 56 na lista do grupo. O
// recorte era o mesmo (filtrarPorRecorte); a BASE não: o card lia get_situacao_alunos_v1 com
// p_apenas_pendentes=true, e o LA Report filtra isso pelo array `pendencias` (cadastro), que não
// conhece assinatura de contrato — quem tinha o contrato como única pendência sumia do card
// (Barra 15, Campo Grande 18). Agora todo caminho lê a base inteira por rpcBaseDeAlunos.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const situ = require('./situacao-aluno');
const f = require('./pix-consulta-fontes');

// Linha no formato real. `pendencias` é o que o filtro da RPC olha — e contrato não entra nele.
const P = (nome, o = {}) => ({
  pessoa_chave: `k-${nome}`, nome, classificacao: 'EMLA', responsavel_nome: nome, pendencias: [],
  anamnese_preenchida: true, contrato_assinatura_status: 'assinado', contrato_dado_fresco: true,
  tem_foto: true, tem_telefone: true, tem_instagram: true, comunidade_status: 'na_comunidade', ...o,
});
const BASE = [
  P('So Contrato A', { contrato_assinatura_status: 'nao_assinado' }),                       // pendencias [] -> o filtro da RPC tira
  P('So Contrato B', { classificacao: 'LAMK', contrato_assinatura_status: 'sem_contrato' }), // idem
  P('Contrato e Foto', { contrato_assinatura_status: 'nao_assinado', tem_foto: false, pendencias: ['foto'] }),
  P('So Anamnese', { anamnese_preenchida: false, pendencias: ['anamnese'] }),
  P('Tudo Certo'),
];

// Imita o LA Report: p_apenas_pendentes=true devolve só quem tem `pendencias` não vazio.
function laReportFalso() {
  const chamadas = [];
  return {
    chamadas,
    rpc: async (nome, params) => {
      chamadas.push({ nome, params });
      if (nome !== 'get_situacao_alunos_v1') return { data: [], error: null };
      const data = params.p_apenas_pendentes ? BASE.filter((p) => (p.pendencias || []).length) : BASE;
      return { data, error: null };
    },
  };
}

async function numeroDoCard(client, recorte) {
  const { data } = await situ.consultarComCache({ tipo: 'lista', unidadeId: 'u-num', client });
  const pessoas = situ.filtrarPorRecorte(data || [], recorte);
  const html = situ.renderLista({ recorte, pessoas, total: pessoas.length, unidadeNome: 'Barra' });
  const m = html.match(/<b>(\d+)<\/b> sem /);
  return m ? Number(m[1]) : 0;
}

for (const [recorte, esperado] of [['contrato', 3], ['anamnese', 1]]) {
  test(`${recorte}: card, lista do grupo e números do prompt dão o MESMO número (${esperado})`, async () => {
    situ._limparCache();
    const client = laReportFalso();
    const card = await numeroDoCard(client, recorte);
    const n = await f.numerosDaUnidade({ laReport: client, unidadeId: 'u-num', unidadeNome: 'Barra', hoje: '2026-09-30', deps: { retry: (c) => c() } });
    const lista = await f.mensagensDaListaPix({ laReport: client, unidadeId: 'u-num', unidadeNome: 'Barra', alvos: [recorte], deps: { retry: (c) => c() } });
    assert.deepStrictEqual({ card, prompt: n[recorte].pendentes, lista: lista.total }, { card: esperado, prompt: esperado, lista: esperado });
    for (const c of client.chamadas.filter((x) => x.nome === 'get_situacao_alunos_v1')) {
      assert.strictEqual(c.params.p_apenas_pendentes, false, 'ninguém pode pedir a base já filtrada pela RPC');
    }
  });
}

test('card e ficha dividem a MESMA foto da base (uma leitura só)', async () => {
  situ._limparCache();
  const client = laReportFalso();
  await situ.consultarComCache({ tipo: 'lista', unidadeId: 'u-foto', client, agora: 0 });
  await situ.consultarComCache({ tipo: 'ficha', unidadeId: 'u-foto', client, agora: 1000 });
  assert.strictEqual(client.chamadas.length, 1);
});

// ÂNCORA: a leitura da base mora num lugar só. Chamar a RPC por fora de rpcBaseDeAlunos é o
// caminho de volta pro 41 × 56 (alguém esquece o parâmetro, ou põe `true`).
test('âncora: get_situacao_alunos_v1 só é chamada dentro de situacao-aluno.rpcBaseDeAlunos', () => {
  const raiz = path.join(__dirname, '..');
  const achados = [];
  const varrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') varrer(p); continue; }
      if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue;
      fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        if (/^\s*\/\//.test(l)) return;
        if (/['"`]get_situacao_alunos_v1['"`]\s*,/.test(l)) achados.push(`${path.relative(raiz, p)}:${i + 1}`);
      });
    }
  };
  varrer(raiz);
  assert.strictEqual(achados.length, 1, `chamadas diretas: ${achados.join(' ')}`);
  assert.match(achados[0], /^services[\\/]situacao-aluno\.js:/);
  assert.match(situ.rpcBaseDeAlunos.toString(), /p_apenas_pendentes: false/);
});
