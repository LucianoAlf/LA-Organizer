'use strict';
// pix-relatorio-feito-esperando.test.js — relatório de segunda com "o que já foi feito" e "o que está
// esperando" (Alf, 28/09). Sem isso o 9% parecia "ninguém fez nada":
//  • ⏳ 26 CADASTRADOS pela equipe esperando o banco fazer a 1ª cobrança — é trabalho FEITO que só
//    conta como migrado depois da cobrança.
//  • 💳 cliente com CARTÃO RECORRENTE cadastrado no Emusys mas que pagou a última mensalidade por PIX
//    (CG avisou: "estão como pix no sistema mas mudaram pra crédito recorrente"). Medido em 28/09:
//    50 nas três unidades. A fonte põe todos na fila do Pix avulso — ruído. Não dá pra afirmar que
//    já estão no cartão (parte pagou cartão e voltou pro PIX), então a linha diz CONFERIR.
// O "faltam", o percentual e a primeira linha de ritmo NÃO mudam: só ficam explicados.
const { test } = require('node:test');
const assert = require('node:assert');
const p = require('./pix-migracao');

const L = (o) => ({ pagador_chave: `k-${o.pagador_nome}`, alunos: [], matriculas: [1], categoria: 'migrar', fatia: 'pix_avulso', forma_ultima_mensalidade: 'Pix', cobranca_automatica_cadastrada: null, ...o });
const semInterruptor = (fn) => {
  const antes = process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  delete process.env.TOM_PIX_BLOQUEIO_EMUSYS;
  try { return fn(); } finally { if (antes !== undefined) process.env.TOM_PIX_BLOQUEIO_EMUSYS = antes; }
};

test('💳 cartaoCadastradoPagandoPix: cartão recorrente cadastrado + última mensalidade fora do cartão', () => semInterruptor(() => {
  assert.strictEqual(p.cartaoCadastradoPagandoPix(L({ pagador_nome: 'A', cobranca_automatica_cadastrada: 'Cartão de Crédito' })), true);
  // cartão cadastrado e última no cartão = cartão falhando (outra fatia), não é este caso
  assert.strictEqual(p.cartaoCadastradoPagandoPix(L({ pagador_nome: 'B', fatia: 'cartao_com_falha', cobranca_automatica_cadastrada: 'Cartão de Crédito', forma_ultima_mensalidade: 'Cartão de Crédito' })), false);
  assert.strictEqual(p.cartaoCadastradoPagandoPix(L({ pagador_nome: 'C' })), false, 'sem cobrança automática');
  assert.strictEqual(p.cartaoCadastradoPagandoPix(L({ pagador_nome: 'D', cobranca_automatica_cadastrada: 'Pix Automático' })), false);
  assert.strictEqual(p.cartaoCadastradoPagandoPix(L({ pagador_nome: 'E', categoria: 'ja_migrou', cobranca_automatica_cadastrada: 'Cartão de Crédito' })), false, 'só quem ainda está na fila');
  // 🔒 tem precedência: não conta duas vezes
  assert.strictEqual(p.cartaoCadastradoPagandoPix(L({ pagador_nome: 'F', matriculas: [1, 2], cobranca_automatica_cadastrada: 'Cartão de Crédito' })), false);
  assert.strictEqual(p.cartaoCadastradoPagandoPix(null), false);
}));

test('dadosDaUnidadeParaRelatorio conta os 💳', () => semInterruptor(() => {
  const d = p.dadosDaUnidadeParaRelatorio([
    L({ pagador_nome: 'A', cobranca_automatica_cadastrada: 'Cartão de Crédito' }),
    L({ pagador_nome: 'B' }),
    L({ pagador_nome: 'C', categoria: 'autorizacao_pendente', fatia: null }),
    L({ pagador_nome: 'D', categoria: 'ja_migrou', fatia: null, migrou_em: '2026-09-01' }),
  ], { nome: 'Barra', hojeYmd: '2026-09-28' });
  assert.deepStrictEqual([d.total, d.migrados, d.pendentesAutorizacao, d.cartaoCadastrado], [4, 1, 1, 1]);
}));

const U = (o) => ({ nome: 'X', total: 0, migrados: 0, migradosNaSemana: 0, pendentesAutorizacao: 0, aguardandoEmusys: 0, cartaoCadastrado: 0, ...o });
const REAL = [
  U({ nome: 'Recreio', total: 94, migrados: 10, pendentesAutorizacao: 9, aguardandoEmusys: 26, cartaoCadastrado: 24 }),
  U({ nome: 'Barra', total: 53, migrados: 10, pendentesAutorizacao: 6, aguardandoEmusys: 10, cartaoCadastrado: 12 }),
  U({ nome: 'Campo Grande', total: 239, migrados: 14, migradosNaSemana: 1, pendentesAutorizacao: 11, aguardandoEmusys: 42, cartaoCadastrado: 14 }),
];

test('relatório: bloco "✅ Feito pela equipe" soma migrados + cadastrados aguardando a 1ª cobrança', () => {
  const t = p.relatorioSemanal({ unidades: REAL, periodoBr: '21 a 27/09', hojeYmd: '2026-09-28' });
  assert.match(t, /\n\n\*✅ Feito pela equipe: 60 \(16%\)\*\n• 34 já migraram — o banco já cobrou no automático\n• ⏳ 26 cadastrados, aguardando a 1ª cobrança do banco — contam como migrados depois dela\n/);
});
test('relatório: bloco "⏸️ Esperando" com 🔒 e 💳 (conferir no Emusys)', () => {
  const t = p.relatorioSemanal({ unidades: REAL, periodoBr: '21 a 27/09', hojeYmd: '2026-09-28' });
  assert.match(t, /\n\n\*⏸️ Esperando\*\n• 🔒 78 aguardando o Emusys — 2\+ cursos ou família: ele só liga o PIX automático a uma fatura\n• 💳 50 com cartão recorrente cadastrado, mas pagaram por PIX — conferir no Emusys: se já estão no cartão, saem da lista quando a cobrança passar\n/);
});
test('relatório: ritmo igual ao de antes + a linha do que a equipe consegue fazer sem 🔒 e 💳', () => {
  const t = p.relatorioSemanal({ unidades: REAL, periodoBr: '21 a 27/09', hojeYmd: '2026-09-28' });
  assert.match(t, /\n\n🎯 Ritmo: faltam 5 semanas e 352 clientes → 71 por semana\.\nSem os 🔒 e 💳: faltam 224 clientes → 45 por semana\./);
  assert.match(t, /Geral\s+▓+░*\s+9%\s+\(34 de 386\)/, 'o percentual continua o de migrados de fato');
});
test('relatório: cada unidade mostra os próprios 🔒, 💳 e ⏳', () => {
  const t = p.relatorioSemanal({ unidades: REAL, periodoBr: '21 a 27/09', hojeYmd: '2026-09-28' });
  assert.match(t, /Recreio .*\(10\/94\) — 0 nesta semana · 🔒 26 · 💳 24 · ⏳ 9/);
});
test('relatório: sem 💳 não aparece linha de cartão nem o 💳 no ritmo', () => {
  const t = p.relatorioSemanal({ unidades: REAL.map((u) => ({ ...u, cartaoCadastrado: 0 })), periodoBr: '21 a 27/09', hojeYmd: '2026-09-28' });
  assert.ok(!/💳/.test(t), t);
  assert.match(t, /Sem os 🔒: faltam 274 clientes/);
});
test('relatório: nenhum nome, telefone ou valor', () => {
  const t = p.relatorioSemanal({ unidades: REAL, periodoBr: '21 a 27/09', hojeYmd: '2026-09-28' });
  assert.ok(!/R\$|\d{10,}/.test(t));
});
