'use strict';
// PAUTA NO 1:1 — caso Mayra (ADM CG, 30/09 08:32 BRT): "Tom, me manda a lista de anamneses
// pendentes de hoje" -> "Só essas duas por enquanto 👍", com a pauta do grupo listando 36.
// O que este arquivo trava:
//   1. o número do 1:1 É o número da pauta (mesma fonte, mesma conta — teste de PARIDADE contra
//      montarPautaDaUnidade, a montagem real das 06:00);
//   2. a lista sai organizada (título → resumo → seções → itens) e escrita pelo CÓDIGO;
//   3. o prompt proíbe contar anamnese/contrato por tarefa, e as filhas saem do recorte do 1:1.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const dm = require('./pauta-dm');
const pura = require('./anamnese-pauta');
const { pendenciasDoDia, montarPautaDaUnidade } = require('../rituals/anamnese-pauta');

const CG = '2ec861f6-023f-4d7b-9927-3960ad8c2a92';
const BARRA = '368d47f5-2d88-4475-bc14-ba084a9a348e';
const RECREIO = '95553e96-971b-4590-a6eb-0201d013c14d';
const HOJE = '2026-09-30';

beforeEach(() => dm._limparCache());

// ── fonte fake no formato do LA Report: rpc(get_situacao_alunos_v1) + aulas_emusys + aula_alunos_emusys
// 36 alunos com aula hoje SEM anamnese (como a pauta real de CG em 30/09), 10 com aula hoje e
// anamnese em dia, 50 sem anamnese e SEM aula hoje (entram no total da unidade, não na pauta).
function montarFonte() {
  const pessoas = [];
  const aulas = [];
  const vinculos = [];
  let aid = 1000;
  const horas = ['13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
  const push = ({ nome, preenchida, comAula, contrato = 'assinado' }) => {
    const alunoId = aid++;
    pessoas.push({
      pessoa_chave: `k${alunoId}`, nome, aluno_ids_locais: [alunoId], anamnese_preenchida: preenchida,
      contrato_assinatura_status: contrato, contrato_dado_fresco: true,
    });
    if (comAula) {
      const h = horas[alunoId % horas.length];
      const [hh, mm] = h.split(':').map(Number);
      const iso = new Date(Date.UTC(2026, 8, 30, hh + 3, mm)).toISOString(); // BRT -> UTC
      aulas.push({ id: `a${alunoId}`, data_hora_inicio: iso, curso_nome: 'Teclado T' });
      vinculos.push({ aula_emusys_id: `a${alunoId}`, aluno_id: alunoId });
    }
  };
  for (let i = 0; i < 36; i++) push({ nome: `Aluno Pendente ${String(i).padStart(2, '0')}`, preenchida: false, comAula: true, contrato: i < 3 ? 'nao_assinado' : 'assinado' });
  for (let i = 0; i < 10; i++) push({ nome: `Aluno Em Dia ${i}`, preenchida: true, comAula: true });
  for (let i = 0; i < 50; i++) push({ nome: `Aluno Sem Aula ${i}`, preenchida: false, comAula: false });
  return { pessoas, aulas, vinculos };
}

function fakeLaReport(fonte, { erroRpc = null } = {}) {
  const chamadas = { rpc: 0 };
  const from = (tabela) => {
    const f = {};
    const q = {
      select() { return q; }, eq(k, v) { f[k] = v; return q; }, gte() { return q; }, lte() { return q; },
      in(k, v) { f[k] = v; return q; },
      then(res, rej) {
        const data = tabela === 'aulas_emusys'
          ? fonte.aulas
          : fonte.vinculos.filter((v) => (f.aula_emusys_id || []).includes(v.aula_emusys_id));
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return q;
  };
  return {
    chamadas,
    from,
    rpc: async () => { chamadas.rpc++; return erroRpc ? { data: null, error: { message: erroRpc } } : { data: fonte.pessoas, error: null }; },
  };
}

// ── 1. PARIDADE: o número do 1:1 é o número da pauta ─────────────────────────────────────────
test('paridade: pendenciasDoDia (1:1) conta EXATAMENTE o que montarPautaDaUnidade (06:00) cria', async () => {
  const fonte = montarFonte();
  let filhasCriadas = null;
  const montagem = await montarPautaDaUnidade({
    supabase: {}, laReport: fakeLaReport(fonte), unidadeId: CG, groupId: 'g', criadoPor: 'c', hoje: HOJE,
    deps: {
      pacoteExiste: async () => ({ existe: false }),
      repo: { contarFalhas: async () => new Map(), registrarAparicoes: async () => ({ erro: null }) },
      criarPacote: async ({ input }) => { filhasCriadas = input.subtasks.length; },
    },
  });
  const r = await pendenciasDoDia({ laReport: fakeLaReport(fonte), unidadeId: CG, hoje: HOJE });
  assert.strictEqual(montagem.total, 36);
  assert.strictEqual(filhasCriadas, 36);
  assert.strictEqual(r.anamnese.length, montagem.total, 'o 1:1 tem que dizer o MESMO número da pauta do grupo');
  assert.deepStrictEqual(r.anamnese.map((i) => i.pessoa.nome).sort(), montagem.itens.map((i) => i.pessoa.nome).sort());
  assert.strictEqual(r.contrato.length, 3);
  assert.deepStrictEqual(r.totalUnidade, { anamnese: 86, contrato: 3, alunos: 96 });
});

test('fonte fora: null + motivo, NUNCA lista vazia (zero por falha ≠ zero por saúde)', async () => {
  const r = await pendenciasDoDia({ laReport: fakeLaReport(montarFonte(), { erroRpc: 'statement timeout' }), unidadeId: CG, hoje: HOJE });
  assert.strictEqual(r.anamnese, null);
  assert.match(r.motivo, /statement timeout/);
});

// ── 2. gate e unidades ────────────────────────────────────────────────────────────────────────
test('gate: a fala real da Mayra abre; conversa comum não custa leitura', () => {
  assert.strictEqual(dm.falaDeAnamneseOuContrato('Tom, me manda a lista de anamneses pendentes de hoje'), true);
  assert.strictEqual(dm.falaDeAnamneseOuContrato('quantos contratos faltam assinar no recreio?'), true);
  assert.strictEqual(dm.falaDeAnamneseOuContrato('qual a pauta de hoje?'), true);
  assert.strictEqual(dm.falaDeAnamneseOuContrato('tom, fala pra Krissya que eu liguei e ele não me atendeu'), false);
});

test('unidade do cadastro: campo_grande/barra/recreio mapeiam; all e null não', () => {
  assert.strictEqual(dm.unidadeDoCadastro('campo_grande'), CG);
  assert.strictEqual(dm.unidadeDoCadastro('barra'), BARRA);
  assert.strictEqual(dm.unidadeDoCadastro('recreio'), RECREIO);
  assert.strictEqual(dm.unidadeDoCadastro('all'), null);
  assert.strictEqual(dm.unidadeDoCadastro(null), null);
});

function fakeSupabase({ grupos = [] }) {
  return {
    from(t) {
      const f = {};
      const q = {
        select() { return q; }, eq(k, v) { f[k] = v; return q; }, not() { return q; },
        in(k, v) { f[k] = v; return q; },
        then(res, rej) {
          const data = t === 'work_group_members'
            ? grupos.map((g) => ({ group_id: g.id }))
            : grupos.filter((g) => (f.id || []).includes(g.id) && g.la_report_unidade_id).map((g) => ({ la_report_unidade_id: g.la_report_unidade_id }));
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

test('unidades: membro do ADM CG -> Campo Grande (o mesmo vínculo que o grupo usa)', async () => {
  const sb = fakeSupabase({ grupos: [{ id: 'g-cg', la_report_unidade_id: CG }, { id: 'g-sem', la_report_unidade_id: null }] });
  assert.deepStrictEqual(await dm.unidadesDoColaborador({ supabase: sb, collab: { id: 'mayra', unit: 'campo_grande' } }), [CG]);
});

test('unidades: no bom dia só grupos; quando PERGUNTA, o cadastro também vale', async () => {
  const sb = fakeSupabase({ grupos: [] });
  const prof = { id: 'p', unit: 'barra' };
  assert.deepStrictEqual(await dm.unidadesDoColaborador({ supabase: sb, collab: prof }), []);
  assert.deepStrictEqual(await dm.unidadesDoColaborador({ supabase: sb, collab: prof, incluirCadastro: true }), [BARRA]);
});

// ── 3. prompt: número certo e proibição de contar tarefa ─────────────────────────────────────
test('bloco do prompt: 36 de hoje, total da unidade rotulado, e a regra de nunca contar tarefa', async () => {
  const u = await dm.lerPautaDaUnidade({ laReport: fakeLaReport(montarFonte()), unidadeId: CG, hoje: HOJE });
  const b = dm.blocoDaPautaDM({ porUnidade: [u], hoje: HOJE, ritual: true });
  assert.match(b, /Campo Grande: 36 alunos com aula hoje ainda sem anamnese · 3 alunos sem contrato assinado/);
  assert.match(b, /NÃO é a pauta de hoje: 86 sem anamnese/);
  assert.match(b, /NUNCA conte tarefas "HH:MM Anamnese/);
  assert.match(b, /No bom dia: UMA linha por unidade/);
  assert.doesNotMatch(b, /<<SITUACAO_ALUNO>>/, 'no bom dia não se oferece marcador');
});

test('bloco do prompt: unidade que não leu diz que não leu — sem número', () => {
  const b = dm.blocoDaPautaDM({ porUnidade: [{ unidadeNome: 'Barra', anamnese: null, motivo: 'timeout' }], hoje: HOJE });
  assert.match(b, /Barra: NÃO CONSEGUI LER/);
  assert.match(b, /<<SITUACAO_ALUNO>>\{"recorte"/, 'fora do ritual, ensina o marcador da lista');
});

// ── 4. a lista: organizada e escrita pelo código ─────────────────────────────────────────────
test('lista: título → resumo → seções → itens, com os 36 nomes', async () => {
  const u = await dm.lerPautaDaUnidade({ laReport: fakeLaReport(montarFonte()), unidadeId: CG, hoje: HOJE });
  const txt = dm.renderPautaDM({ ...u, hoje: HOJE, recorte: 'anamnese' });
  const linhas = txt.split('\n');
  assert.strictEqual(linhas[0], '🗓️ *Pauta de hoje — Campo Grande (30/09)*');
  assert.strictEqual(linhas[1], 'Com aula hoje: 36 alunos sem anamnese');
  assert.strictEqual(linhas[2], '');
  assert.strictEqual(linhas[3], '📋 *Anamnese* (36)');
  for (let i = 0; i < 36; i++) assert.match(txt, new RegExp(`Aluno Pendente ${String(i).padStart(2, '0')}`));
  assert.doesNotMatch(txt, /Em Dia|Sem Aula/);
  assert.match(txt, /\*13:00\* — /, 'arrumado por horário, igual à pauta do grupo');
  assert.doesNotMatch(txt, /Contrato/, 'pediu só anamnese');
});

test('marcador <<SITUACAO_ALUNO>> no 1:1: a lista entra no lugar do marcador', async () => {
  const reply = 'Aqui a pauta de hoje do CG 👇\n\n<<SITUACAO_ALUNO>>{"recorte":"anamnese","hoje":true,"unidade":"campo grande"}<<END>>';
  const r = await dm.atenderMarkersPautaDM({ reply, laReport: fakeLaReport(montarFonte()), unidadeIds: [CG], hoje: HOJE });
  assert.strictEqual(r.atendidos, 1);
  assert.match(r.reply, /^Aqui a pauta de hoje do CG 👇\n\n🗓️ \*Pauta de hoje — Campo Grande/);
  assert.match(r.reply, /Com aula hoje: 36 alunos sem anamnese/);
  assert.doesNotMatch(r.reply, /<<|>>/);
});

test('marcador: número do prompt e lista saem da MESMA foto (1 leitura só no turno)', async () => {
  const lr = fakeLaReport(montarFonte());
  await dm.lerPautaDasUnidades({ laReport: lr, unidadeIds: [CG], hoje: HOJE });
  await dm.atenderMarkersPautaDM({ reply: '<<SITUACAO_ALUNO>>{"recorte":"tudo"}<<END>>', laReport: lr, unidadeIds: [CG], hoje: HOJE });
  assert.strictEqual(lr.chamadas.rpc, 1);
});

test('marcador: fonte fora vira frase honesta, nunca número nem marcador cru', async () => {
  const r = await dm.atenderMarkersPautaDM({ reply: '<<SITUACAO_ALUNO>>{"recorte":"anamnese","hoje":true}<<END>>', laReport: fakeLaReport(montarFonte(), { erroRpc: 'timeout' }), unidadeIds: [CG], hoje: HOJE });
  assert.strictEqual(r.falhas, 1);
  assert.match(r.reply, /Não consegui ler a fonte agora/);
  assert.doesNotMatch(r.reply, /\d+ alunos/);
});

test('marcador: recorte que o 1:1 não atende (ficha) vira linha honesta', async () => {
  const r = await dm.atenderMarkersPautaDM({ reply: '<<SITUACAO_ALUNO>>{"recorte":"foto"}<<END>>', laReport: fakeLaReport(montarFonte()), unidadeIds: [CG], hoje: HOJE });
  assert.match(r.reply, /no grupo da unidade/);
});

test('sem marcador: nada muda e nada é lido', async () => {
  const lr = fakeLaReport(montarFonte());
  const r = await dm.atenderMarkersPautaDM({ reply: 'Oi, Mayra!', laReport: lr, unidadeIds: [CG], hoje: HOJE });
  assert.strictEqual(r.reply, 'Oi, Mayra!');
  assert.strictEqual(lr.chamadas.rpc, 0);
});

// ── 5. as filhas saem do recorte de tarefas do 1:1 ───────────────────────────────────────────
test('ehFilhaDaPauta: títulos REAIS de 30/09 (ADM CG) são filha; container e tarefa comum não', () => {
  assert.strictEqual(pura.ehFilhaDaPauta({ parent_task_id: 'p', title: '16:00 Anamnese — João Bernardes de Castro (Musicalização Infantil T) ⚠️ 4ª semana sem preencher — mande o link da anamnese' }), true);
  assert.strictEqual(pura.ehFilhaDaPauta({ parent_task_id: 'p', title: '20:00 Anamnese — Maicon Viana Mário (Teclado T) ⚠️ 4ª semana sem preencher — mande o link da anamnese' }), true);
  assert.strictEqual(pura.ehFilhaDaPauta({ parent_task_id: 'p', title: pura.tituloDaFilha({ pessoa: { nome: 'Ana' }, hora: '09:00', curso: null }, 0) }), true);
  assert.strictEqual(pura.ehFilhaDaPauta({ parent_task_id: null, title: '16:00 Anamnese — João' }), false);
  assert.strictEqual(pura.ehFilhaDaPauta({ parent_task_id: 'p', title: 'Cobrar PIX automático — Fulano' }), false);
});
