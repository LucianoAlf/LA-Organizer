'use strict';
// pix-painel.js — dados do painel "PIX automático" na área do grupo do LA-Organizer (Alf, 28/09).
//
// O PEDIDO: o Arthur (Barra) queria ver "o nome desses 53" do relatório de segunda. Além do TOM
// responder no grupo, a equipe ganha um painel com resumo, quem já foi, quem falta (por forma de
// pagamento), busca e a contagem regressiva pra meta de 31/10.
//
// FONTE ÚNICA: as mesmas regras da mensagem do grupo (pix-consulta-fontes._lerPix) e do relatório
// de segunda (pix-migracao.dadosDaUnidadeParaRelatorio) — o painel nunca mostra 43 onde a mensagem
// diz 41. O teste de paridade trava isso.
//
// PRIVACIDADE: da fonte saem só nome do responsável, nomes dos alunos e a data da migração. Nada
// de telefone, valor ou chave interna — e só pra quem pode ver o grupo (podeVerGrupo, a mesma
// regra de web/src/lib/workGroupAccess.ts), conferida pelo LOGIN da pessoa, não pelo segredo que
// vai no bundle do navegador.
const {
  FATIAS, ROTULO, META_YMD, fatiaDoCliente, ordenarPorPrioridade, bloqueadoNoEmusys, dadosDaUnidadeParaRelatorio,
} = require('./pix-migracao');

const NA_PAUTA = (l) => !!l && (l.categoria === 'migrar' || l.categoria === 'autorizacao_pendente');
const SECAO_BLOQUEIO = 'bloqueio_emusys';
const _chave = (l) => (bloqueadoNoEmusys(l) ? SECAO_BLOQUEIO : fatiaDoCliente(l));
const _cliente = (l) => ({ nome: String(l.pagador_nome || ''), alunos: Array.isArray(l.alunos) ? l.alunos.map(String) : [] });

function _secao(chave) {
  if (chave === SECAO_BLOQUEIO) {
    return { chave, emoji: '🔒', nome: 'Aguardando o Emusys', nota: '2+ cursos ou família — o Emusys ainda só liga o PIX automático a uma fatura' };
  }
  const r = ROTULO[chave] || ROTULO.sem_historico;
  return { chave, emoji: r.emoji, nome: r.nome, nota: chave === 'autorizacao_pendente' ? 'já cadastrados, o banco ainda não cobrou — resolver primeiro' : null };
}

function montarPainel(linhasBrutas, { unidadeNome } = {}) {
  const linhas = Array.isArray(linhasBrutas) ? linhasBrutas.filter(Boolean) : [];
  const d = dadosDaUnidadeParaRelatorio(linhas, { nome: unidadeNome || '', hojeYmd: '1970-01-08' });
  const faltando = ordenarPorPrioridade(linhas.filter(NA_PAUTA));
  const porChave = new Map();
  for (const l of faltando) {
    const k = _chave(l);
    if (!porChave.has(k)) porChave.set(k, { ..._secao(k), n: 0, clientes: [] });
    const s = porChave.get(k);
    s.n += 1;
    s.clientes.push(_cliente(l));
  }
  // Mesma conta da pauta das 9h (que conta a forma COM os 🔒 dentro): a seção diz quantos da forma
  // estão no 🔒 — "Pix avulso 10" + "mais 6 em 🔒" = os 16 da pauta.
  const presosPorForma = new Map();
  for (const l of faltando) if (bloqueadoNoEmusys(l)) presosPorForma.set(fatiaDoCliente(l), (presosPorForma.get(fatiaDoCliente(l)) || 0) + 1);
  for (const s of porChave.values()) {
    const presos = s.chave === SECAO_BLOQUEIO ? 0 : presosPorForma.get(s.chave) || 0;
    s.presos = presos;
    if (presos) s.nota = [s.nota, `mais ${presos} em 🔒 Aguardando o Emusys`].filter(Boolean).join(' · ');
  }
  const jaMigraram = ordenarPorPrioridade(linhas.filter((l) => l.categoria === 'ja_migrou'))
    .map((l) => ({ ..._cliente(l), migrouEm: l.migrou_em || null }));
  const datas = linhas.map((l) => l.dado_atualizado_em).filter(Boolean).sort();
  return {
    unidade: unidadeNome || null,
    metaYmd: META_YMD,
    total: d.total,
    migrados: d.migrados,
    faltam: d.total - d.migrados,
    aguardandoEmusys: d.aguardandoEmusys,
    cadastradosSemCobranca: d.pendentesAutorizacao,
    dadoEm: datas.length ? datas[datas.length - 1] : null,
    faltamSecoes: [...porChave.values()],
    jaMigraram,
  };
}

// Mesma regra de web/src/lib/workGroupAccess.ts (Alf 06/07, caso Rose): só o diretor vê todos;
// qualquer outro papel só vê grupo em que é membro, líder ou criador.
function podeVerGrupo({ collab, group, souMembro }) {
  if (!collab || !group) return false;
  if (collab.role === 'director') return true;
  return !!souMembro || group.leader_id === collab.id || group.created_by === collab.id;
}

// Orquestração da rota GET /internal/pix-painel?group_id= (quem liga no Express é internal-api.js).
// -> { status, body }
async function atenderPainel({ token, groupId, deps }) {
  if (!token) return { status: 401, body: { ok: false, error: 'no_auth' } };
  const user = await deps.usuarioDoToken(token).catch(() => null);
  if (!user || !user.email) return { status: 401, body: { ok: false, error: 'invalid_token' } };
  const collab = await deps.colaboradorPorEmail(user.email);
  if (!collab) return { status: 403, body: { ok: false, error: 'no_collaborator' } };
  if (!groupId) return { status: 400, body: { ok: false, error: 'group_id_obrigatorio' } };
  const group = await deps.grupo(groupId);
  if (!group) return { status: 404, body: { ok: false, error: 'grupo_nao_encontrado' } };
  const membro = await deps.souMembro(groupId, collab.id);
  if (!podeVerGrupo({ collab, group, souMembro: membro })) return { status: 403, body: { ok: false, error: 'sem_acesso_ao_grupo' } };
  if (!group.la_report_unidade_id) return { status: 404, body: { ok: false, error: 'grupo_sem_unidade' } };
  let linhas;
  try {
    linhas = await deps.lerFonte(group.la_report_unidade_id);
  } catch (e) {
    console.warn(`[PixPainel] fonte fora grupo=${groupId}: ${e.message}`);
    return { status: 502, body: { ok: false, error: 'fonte_fora' } };
  }
  const { nomeDaUnidade } = require('./situacao-aluno');
  return { status: 200, body: { ok: true, data: montarPainel(linhas, { unidadeNome: nomeDaUnidade(group.la_report_unidade_id) }) } };
}

module.exports = { montarPainel, podeVerGrupo, atenderPainel, FATIAS };
