'use strict';
// pix-consulta-fontes.js — leitura das fontes do LA Report para a consulta de lista/número nos
// grupos, e a orquestração do turno. Par de src/services/pix-consulta.js (que é puro).
//
// Fontes (as MESMAS da pauta diária — nada muda no LA Report):
//   get_pix_migracao_v1(p_unidade_id, p_fatia=null)  -> todas as categorias e fatias da unidade
//   get_situacao_alunos_v1(p_unidade_id, p_apenas_pendentes=false) -> anamnese e contrato
// Toda consulta passa por `consultaComRetry` (uma oscilação não pode virar "não sei"), e `error`
// é SEMPRE checado: RPC com parâmetro errado devolve {data:null,error} e viraria "zero clientes"
// silencioso — a unidade pareceria vazia em vez de a fonte estar quebrada.
//
// PRIVACIDADE: o item da lista só carrega `pagador` e `alunos`. Telefone, CPF, e-mail, valor e id
// de fatura nunca saem daqui (um teste prende as chaves do objeto).

const pura = require('./pix-consulta');
const { ordenarPorPrioridade, fatiaDoCliente, FATIAS, bloqueadoNoEmusys, nomeComMarca, LEGENDA_BLOQUEIO, MARCA_BLOQUEIO } = require('./pix-migracao');
const { filtrarPorRecorte, nomeDaUnidade, resolverUnidade } = require('./situacao-aluno');
const { consultaComRetry } = require('../lib/consulta-com-retry');

// Categorias que a fonte devolve hoje (medidas em 17/09 nas três unidades). Categoria NOVA que a
// fonte um dia mandar não some: cai em `outras` — melhor um número que ninguém sabe nomear do que
// um cliente invisível.
const CATEGORIAS = ['migrar', 'autorizacao_pendente', 'ja_migrou', 'aguardando_cobranca',
  'nao_mexe', 'inadimplente', 'nao_pagante', 'excecao'];
const NA_PAUTA = (l) => !!l && (l.categoria === 'migrar' || l.categoria === 'autorizacao_pendente');
const FAMILIA_ALUNO = new Set(['anamnese', 'contrato']);

// C4: ordem fixa de exibição quando nem o grupo nem a fala amarram uma unidade — Campo Grande,
// Recreio, Barra (decisão do dono, 17/09). Ids saem de resolverUnidade (situacao-aluno.js):
// fonte única, nenhum UUID duplicado neste arquivo.
const ORDEM_UNIDADES = ['campo grande', 'recreio', 'barra'].map((apelido) => resolverUnidade(apelido));

function _rpcs({ laReport, unidadeId, deps }) {
  const retry = deps.retry || ((c) => consultaComRetry(c, { esperaMs: deps.esperaMs, sleep: deps.sleep }));
  const rpcPix = deps.rpcPix || (() => laReport.rpc('get_pix_migracao_v1', { p_unidade_id: unidadeId, p_fatia: null }));
  const rpcSituacao = deps.rpcSituacao || (() => laReport.rpc('get_situacao_alunos_v1', { p_unidade_id: unidadeId, p_apenas_pendentes: false }));
  return { retry, rpcPix, rpcSituacao };
}

// FATIA SÓ DO QUE ESTÁ NA PAUTA. `fatiaDoCliente` manda toda linha de fatia nula pra
// `sem_historico` — e na fonte real a fatia só vem preenchida em `migrar` (no Recreio de hoje são
// 215 linhas de ja_migrou/nao_mexe/inadimplente com fatia nula). Contar fatia sobre a fonte
// inteira transformaria essas 215 em "sem histórico" e a equipe cobraria gente que não deve nada.
function _contarPix(linhas) {
  const todas = linhas || [];
  const naPauta = todas.filter(NA_PAUTA);
  const porCategoria = new Map();
  for (const l of todas) { const c = (l && l.categoria) || 'outras'; porCategoria.set(c, (porCategoria.get(c) || 0) + 1); }
  const fatias = {};
  for (const f of FATIAS) fatias[f] = 0;
  for (const l of naPauta) { const f = fatiaDoCliente(l); fatias[f] = (fatias[f] || 0) + 1; }
  let outras = 0;
  for (const [c, n] of porCategoria) if (!CATEGORIAS.includes(c)) outras += n;
  const out = { total: todas.length, faltam: naPauta.length, fatias, outras, bloqueado_emusys: naPauta.filter(bloqueadoNoEmusys).length };
  for (const c of CATEGORIAS) out[c] = porCategoria.get(c) || 0;
  return out;
}

function _dadoMaisNovo(linhas) {
  let maior = null;
  for (const l of linhas || []) {
    const v = l && l.dado_atualizado_em;
    if (v && (!maior || String(v) > String(maior))) maior = v;
  }
  return maior;
}

// YYYY-MM-DD do instante em horário de Brasília — o "hoje" do time, não o UTC do processo.
function _ymdBrt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);
}

// numerosDaUnidade -> { pix, anamnese, contrato, dadoEm, dadoDeHoje, motivo }
// Fonte que falhou vira `null` no seu pedaço + uma causa em `motivo`. NUNCA um zero: zero por
// falha sai idêntico a zero por saúde, e é assim que um laudo vira mentira.
async function numerosDaUnidade({ laReport, unidadeId, unidadeNome, hoje, deps = {} }) {
  const { retry, rpcPix, rpcSituacao } = _rpcs({ laReport, unidadeId, deps });
  const [rp, rs] = await Promise.all([retry(rpcPix), retry(rpcSituacao)]);

  const motivos = [];
  let pix = null;
  let dadoEm = null;
  if (rp && rp.error) {
    motivos.push(`PIX: ${rp.error.message}`);
  } else {
    const linhas = (rp && rp.data) || [];
    pix = _contarPix(linhas);
    dadoEm = _dadoMaisNovo(linhas);
  }

  let anamnese = null;
  let contrato = null;
  if (rs && rs.error) {
    motivos.push(`situação dos alunos: ${rs.error.message}`);
  } else {
    const pessoas = (rs && rs.data) || [];
    anamnese = { pendentes: filtrarPorRecorte(pessoas, 'anamnese').length, base: pessoas.length };
    contrato = { pendentes: filtrarPorRecorte(pessoas, 'contrato').length, base: pessoas.length };
  }

  const ymd = dadoEm ? _ymdBrt(dadoEm) : null;
  return {
    unidadeNome, pix, anamnese, contrato, dadoEm,
    dadoDeHoje: ymd && hoje ? ymd === String(hoje) : null,
    motivo: motivos.length ? motivos.join(' · ') : null,
  };
}

// C2 (fix round 1): ANTES, um pedido de anamnese/contrato (ou o alvo 'tudo') era servido com dado
// do PIX e título do PIX — os alunos de verdade sumiam calados, que é o defeito original com
// outra roupa. Agora cada família lê a SUA fonte.
// O item traz o RESPONSÁVEL na frente (é quem a escola cobra) e o aluno ao lado; aluno sem
// responsável cadastrado aparece com o próprio nome nos dois lugares — some ninguém.
async function _itensDeAluno({ retry, rpcSituacao, recorte }) {
  const r = await retry(rpcSituacao);
  if (r && r.error) throw new Error(`get_situacao_alunos_v1: ${r.error.message}`);
  return filtrarPorRecorte((r && r.data) || [], recorte)
    .map((p) => ({ pagador: p.responsavel_nome || p.nome, alunos: [p.nome] }))
    .sort((a, b) => String(a.pagador).localeCompare(String(b.pagador), 'pt-BR'));
}

async function _itensDePix({ retry, rpcPix, alvo }) {
  const r = await retry(rpcPix);
  if (r && r.error) throw new Error(`get_pix_migracao_v1: ${r.error.message}`);
  const linhas = (r && r.data) || [];
  let escolhidas;
  if (alvo === 'ja_migrou') escolhidas = linhas.filter((l) => l && l.categoria === 'ja_migrou');
  else if (alvo === 'autorizacao_pendente') escolhidas = linhas.filter((l) => l && l.categoria === 'autorizacao_pendente');
  else if (FATIAS.includes(alvo)) escolhidas = linhas.filter((l) => NA_PAUTA(l) && fatiaDoCliente(l) === alvo);
  else escolhidas = linhas.filter(NA_PAUTA); // 'pix' e 'tudo': tudo o que falta migrar
  return ordenarPorPrioridade(escolhidas).map((l) => ({ pagador: nomeComMarca(l), alunos: l.alunos || [] }));
}

// itensDaLista -> [{ pagador, alunos }]  (LANÇA quando a fonte falha — ver o topo do arquivo)
async function itensDaLista({ laReport, unidadeId, alvo, deps = {} }) {
  const { retry, rpcPix, rpcSituacao } = _rpcs({ laReport, unidadeId, deps });
  if (FAMILIA_ALUNO.has(alvo)) return _itensDeAluno({ retry, rpcSituacao, recorte: alvo });
  return _itensDePix({ retry, rpcPix, alvo });
}

// blocosDaLista -> { blocos: [{ titulo, substantivo, itens }], falhas: [string] }
// 'tudo' manda PIX primeiro, depois anamnese, depois contrato — cada um com o seu título e a sua
// numeração de partes (quem monta as mensagens é pura.mensagensDeVariasListas).
// Uma fonte fora NÃO cala a outra: o que deu sai, e o que faltou vira aviso. Só quando NADA saiu
// é que lança (aí o grupo recebe a linha honesta de fonte fora).
async function blocosDaLista({ laReport, unidadeId, alvo, deps = {} }) {
  const { retry, rpcPix, rpcSituacao } = _rpcs({ laReport, unidadeId, deps });
  const pedidos = alvo === 'tudo'
    ? ['pix', 'anamnese', 'contrato']
    : [alvo];
  const blocos = [];
  const falhas = [];
  for (const p of pedidos) {
    try {
      const itens = FAMILIA_ALUNO.has(p)
        ? await _itensDeAluno({ retry, rpcSituacao, recorte: p })
        : await _itensDePix({ retry, rpcPix, alvo: p });
      blocos.push({ titulo: pura.tituloDoAlvo(p), substantivo: pura.substantivoDoAlvo(p), itens });
    } catch (e) {
      console.warn(`[PixConsulta] bloco ${p} unidade=${unidadeId}: ${e.message}`);
      falhas.push(`A lista de ${pura.tituloDoAlvo(p)} eu não consegui ler agora.`);
    }
  }
  if (!blocos.length) throw new Error(`nenhuma fonte respondeu (${falhas.length} falha(s))`);
  return { blocos, falhas };
}

// ── C4: as TRÊS unidades juntas (grupo sem unidade E fala sem unidade citada) ───────────────────
// Mesma leitura de sempre (numerosDaUnidade / blocosDaLista), uma vez por unidade, na ORDEM fixa
// de ORDEM_UNIDADES. `deps` é o MESMO objeto pras três chamadas: em produção (sem overrides) cada
// `laReport.rpc(...)` fecha sobre o `unidadeId` certo da iteração; em teste, quem quiser dado
// DIFERENTE por unidade injeta um `laReport.rpc` que olha `p_unidade_id`.
async function numerosDeTodasUnidades({ laReport, hoje, deps = {} }) {
  const porUnidade = [];
  for (const unidadeId of ORDEM_UNIDADES) {
    const unidadeNome = nomeDaUnidade(unidadeId);
    // eslint-disable-next-line no-await-in-loop -- ordem importa (CG, Recreio, Barra), igual ao resto do arquivo
    const n = await (deps.numerosDaUnidade || numerosDaUnidade)({ laReport, unidadeId, unidadeNome, hoje, deps });
    porUnidade.push({ ...n, unidadeNome });
  }
  return porUnidade;
}

// Uma unidade fora não cala as outras — mesmo espírito de blocosDaLista com 'tudo': o que deu
// sai, o que faltou vira aviso na última mensagem. Só lança se NENHUMA unidade respondeu.
async function blocosDeTodasUnidades({ laReport, alvo, deps = {} }) {
  const blocos = [];
  const falhas = [];
  for (const unidadeId of ORDEM_UNIDADES) {
    const unidadeNome = nomeDaUnidade(unidadeId);
    try {
      // eslint-disable-next-line no-await-in-loop -- ordem importa (CG, Recreio, Barra)
      const { blocos: bs } = await (deps.blocosDaLista || blocosDaLista)({ laReport, unidadeId, alvo, deps });
      for (const b of bs) blocos.push({ ...b, titulo: `${b.titulo} — ${unidadeNome}` });
    } catch (e) {
      console.warn(`[PixConsulta] bloco ${alvo} unidade=${unidadeNome}: ${e.message}`);
      falhas.push(`A lista de ${pura.tituloDoAlvo(alvo)} de ${unidadeNome} eu não consegui ler agora.`);
    }
  }
  if (!blocos.length) throw new Error(`nenhuma fonte respondeu em nenhuma unidade (${falhas.length} falha(s))`);
  return { blocos, falhas };
}

// ── LISTA PRONTA PRA POSTAR (pedido por palavra E marcador <<LISTA_PIX>>) ──────────────────────
// Um lugar só monta as mensagens de lista: o interceptador (atenderPedidoNoGrupo) e o marcador do
// LLM (atenderMarkersListaPix) postam EXATAMENTE a mesma coisa. Com unidade: os blocos dela, e o
// nome da unidade vai no título. Sem unidade: as três (blocosDeTodasUnidades já assina cada
// título). Várias formas no mesmo pedido ("pix avulso e cheque") dividem o MESMO teto de
// mensagens. Uma forma que falhou vira aviso; só lança quando NADA saiu (aí quem chama diz a
// verdade — lista vazia com cara de "ninguém falta" nunca).
// -> { msgs: [texto], total }
async function mensagensDaListaPix({ laReport, unidadeId, unidadeNome, alvos, deps = {} }) {
  const blocos = [];
  const falhas = [];
  let ultimoErro = null;
  for (const alvo of (alvos && alvos.length ? alvos : ['pix'])) {
    try {
      // eslint-disable-next-line no-await-in-loop -- ordem importa: as formas saem na ordem pedida
      const r = unidadeId
        ? await (deps.blocosDaLista || blocosDaLista)({ laReport, unidadeId, alvo, deps })
        : await (deps.blocosDeTodasUnidades || blocosDeTodasUnidades)({ laReport, alvo, deps });
      blocos.push(...r.blocos);
      falhas.push(...(r.falhas || []));
    } catch (e) {
      ultimoErro = e;
      falhas.push(`A lista de ${pura.tituloDoAlvo(alvo)} eu não consegui ler agora.`);
    }
  }
  if (!blocos.length) throw ultimoErro || new Error('nenhuma fonte respondeu');
  // 🔒 no nome = aguardando o Emusys (ver pix-migracao.bloqueadoNoEmusys): a legenda vai no rodapé
  // só quando alguém da lista leva a marca — quem lê não precisa adivinhar o que o cadeado quer dizer.
  const temMarca = blocos.some((b) => (b.itens || []).some((it) => String(it.pagador).endsWith(` ${MARCA_BLOQUEIO}`)));
  if (temMarca) falhas.push(LEGENDA_BLOQUEIO);
  const msgs = pura.mensagensDeVariasListas({ unidadeNome: unidadeId ? unidadeNome : null, blocos, avisos: falhas });
  const total = blocos.reduce((s, b) => s + (b.itens || []).length, 0);
  return { msgs, total };
}

// ── MARCADOR <<LISTA_PIX>> — o LLM entende a pergunta, o código escreve os nomes ───────────────
// O CASO (Barra, 17/09 15:40): "tom quais são os alunos pix que ainda não está no pix automático?"
// -> o TOM pediu planilha. O detector por palavra não reconhecia essa forma de pedir e o LLM não
// tinha como puxar a lista. Agora o LLM emite <<LISTA_PIX>>{"alvo":"pix_avulso","unidade":"..."}
// e esta função lê a fonte e devolve as mensagens prontas; o motor do grupo posta DEPOIS da fala.
// Unidade DITA no marcador vence a do grupo (lista do Recreio pedida no grupo da Barra); sem
// nenhuma das duas (grupo PIX AUTOMÁTICO L.A), vão as três. UM pedido de lista por turno: um
// segundo marcador vira pedido de "me pede a próxima", nunca rajada de 16 mensagens no grupo.
// -> { limpo, mensagens: [texto], actions: [{ kind, status, label, detail? }] }
const RE_MARKER_LISTA_PIX = /<<LISTA_PIX>>([\s\S]*?)<<END>>/gi;
async function atenderMarkersListaPix({ reply, laReport, grupoUnidadeId, deps = {} }) {
  const texto = String(reply == null ? '' : reply);
  const brutos = Array.from(texto.matchAll(RE_MARKER_LISTA_PIX)).map((m) => m[1]);
  if (!brutos.length) return { limpo: texto, mensagens: [], actions: [] };
  const limpo = texto.replace(RE_MARKER_LISTA_PIX, '').replace(/\n{3,}/g, '\n\n').trim();
  const mensagens = [];
  const actions = [];

  let p = {};
  try { p = JSON.parse(String(brutos[0]).trim()) || {}; } catch (_) { p = {}; }
  const alvos = pura.alvosDoMarker(p.alvo);
  const unidadeId = resolverUnidade(p.unidade) || grupoUnidadeId || null;
  const unidadeNome = unidadeId ? nomeDaUnidade(unidadeId) : null;
  const onde = unidadeNome || 'as três unidades';
  const rotulo = `Lista: ${alvos.map(pura.tituloDoAlvo).join(' + ')} — ${onde}`;
  try {
    const { msgs, total } = await (deps.mensagensDaListaPix || mensagensDaListaPix)({ laReport, unidadeId, unidadeNome, alvos, deps });
    mensagens.push(...msgs);
    actions.push({ kind: 'situacao', status: 'ok', label: rotulo });
    console.log(`[PixConsulta] marcador LISTA_PIX alvos=${alvos.join(',')} unidade=${unidadeId || 'TODAS'}: ${total} nomes em ${msgs.length} mensagem(ns)`);
  } catch (e) {
    console.warn(`[PixConsulta] marcador LISTA_PIX alvos=${alvos.join(',')} unidade=${unidadeId || 'TODAS'}: ${e.message}`);
    actions.push({ kind: 'situacao', status: 'fail', label: rotulo,
      detail: 'a fonte do LA Report não respondeu agora — me chama de novo daqui a pouco' });
  }
  if (brutos.length > 1) {
    actions.push({ kind: 'situacao', status: 'ask', label: 'Uma lista por vez',
      detail: 'mandei a primeira lista — me pede a próxima que eu puxo' });
  }
  return { limpo, mensagens, actions };
}

// ── ORQUESTRAÇÃO DO TURNO DO GRUPO ────────────────────────────────────────────────────────────
// Chamada por src/services/group-chat-engine.js, ANTES do LLM. Dois caminhos bem diferentes:
//   LISTA   -> INTERCEPTA: posta as mensagens prontas e o turno acaba (o LLM não é chamado; ele
//              reescreveria/resumiria 231 nomes, que é exatamente o que não pode acontecer).
//   NÚMEROS -> NÃO intercepta: devolve `numerosContext` pro prompt, e o TOM responde na voz dele,
//              com o número certo, seja qual for a forma de perguntar.
// O gate barato mora aqui: sem token de assunto na fala (C1/I4), nenhuma RPC é disparada.
//
// C4 (17/09): a unidade da CONSULTA continua saindo do GRUPO por padrão (`unidadeId`, resolvido
// em group-chat-engine.js a partir de `la_report_unidade_id` — isso NÃO muda, ver o ancora test).
// O que muda é o que acontece quando NÃO há unidade do grupo, ou quando a fala CITA outra unidade
// explicitamente: `unidadeCitada` (pura.detectarUnidade) VENCE a do grupo — permite "lista do
// recreio" dentro do grupo da Barra (dizendo qual unidade é), e dá capacidade PLENA ao grupo "PIX
// AUTOMÁTICO L.A." (sem unidade amarrada), que antes só sabia responder "me diz a unidade".
async function atenderPedidoNoGrupo({ laReport, unidadeId, unidadeNome, text, hoje, postar, deps = {} }) {
  const pedido = pura.detectarPedido(text);
  const nada = { tratou: false, ultimo: null, numerosContext: '' };

  const unidadeCitada = (deps.detectarUnidade || pura.detectarUnidade)(text);
  const efetivoId = unidadeCitada || unidadeId;
  const efetivoNome = unidadeCitada ? nomeDaUnidade(unidadeCitada) : unidadeNome;

  if (pedido && pedido.tipo === 'lista') {
    // Com unidade (do grupo ou citada): a lista dela. Sem nenhuma: as três, em sequência (Campo
    // Grande, Recreio, Barra), com o MESMO teto de mensagens do pedido inteiro. Quem monta é
    // mensagensDaListaPix — o mesmo caminho do marcador <<LISTA_PIX>>.
    let r;
    try {
      r = await (deps.mensagensDaListaPix || mensagensDaListaPix)({
        laReport, unidadeId: efetivoId || null, unidadeNome: efetivoNome, alvos: [pedido.alvo], deps,
      });
    } catch (e) {
      console.warn(`[PixConsulta] lista ${pedido.alvo} unidade=${efetivoId || 'TODAS'}: ${e.message}`);
      return { tratou: true, ultimo: await postar(pura.TEXTO_FONTE_FORA), numerosContext: '' };
    }
    let ultimo = null;
    for (const m of r.msgs) ultimo = await postar(m); // uma por vez, em ordem
    console.log(`[PixConsulta] lista ${pedido.alvo} unidade=${efetivoId || 'TODAS'}: ${r.total} nomes em ${r.msgs.length} mensagem(ns)`);
    return { tratou: true, ultimo, numerosContext: '' };
  }

  // GATE BARATO: sem token de assunto/quantidade na fala, nenhuma RPC é disparada — nem aqui, nem
  // no caminho das três unidades.
  if (!pedido && !pura.precisaDeNumeros(text)) return nada;
  if (!efetivoId) {
    // Nem o grupo nem a fala amarram uma unidade: as três + TOTAL — nunca mais "me diz a unidade".
    const porUnidade = await (deps.numerosDeTodasUnidades || numerosDeTodasUnidades)({ laReport, hoje, deps });
    return { tratou: false, ultimo: null, numerosContext: pura.blocoDeNumerosTodasUnidades({ unidades: porUnidade }) };
  }
  const n = await (deps.numerosDaUnidade || numerosDaUnidade)({ laReport, unidadeId: efetivoId, unidadeNome: efetivoNome, hoje, deps });
  return { tratou: false, ultimo: null, numerosContext: pura.blocoDeNumeros({ ...n, unidadeNome: efetivoNome }) };
}

module.exports = {
  numerosDaUnidade, itensDaLista, blocosDaLista, atenderPedidoNoGrupo,
  numerosDeTodasUnidades, blocosDeTodasUnidades,
  mensagensDaListaPix, atenderMarkersListaPix,
};
