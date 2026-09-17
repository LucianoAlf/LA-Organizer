'use strict';
// pix-cadastro-grupo.js — Tarefa 7 do plano de migração PIX: atalho determinístico no chat de
// GRUPO da unidade. Quando alguém do time escreve algo como "cadastrei a Ana Lima no pix
// automático" (src/lib/pix-cadastro-informado.js reconhece a fala), este módulo dá baixa na
// filha da pauta do PIX que casa com aquele pagador — SE, e só se, achar exatamente UMA
// candidata com chave estável gravada em pix_pauta_vinculo —, grava o marcador PIX_CADASTRO
// (que alimenta a reconferência de 7 dias no ritual, src/rituals/pix-migracao.js) e devolve o
// texto pronto. Chamado por src/services/group-chat-engine.js (processGroupChatMessage), ANTES
// de qualquer chamada ao LLM.
//
// Mesmo padrão de deps injetáveis do ritual irmão (src/rituals/pix-migracao.js): nenhum teste
// deste arquivo toca o Supabase real. Toda LEITURA que falhar (erro do Supabase, ou a própria
// chamada lançando) faz este módulo NÃO interceptar — devolve `{ tratou: false }`, com um
// console.warn, e o turno segue pro fluxo normal (LLM). Uma resposta sem escrita ("não está na
// pauta de hoje", "achei mais de um") não é falha: conta como tratado.
//
// I5 (revisão final): grupo SEM pacote PIX aberto não tem pauta do PIX — o atalho NÃO intercepta
// (`tratou: false`) e o LLM atende normalmente. Antes respondia "não achei na pauta do PIX" em
// qualquer grupo onde alguém falasse "cadastrei fulano no automático".
//
// M3 (revisão final) — ORDEM DE ESCRITA: grava o marcador PIX_CADASTRO ANTES de fechar a filha.
// Marcador falhou -> não fecha a filha e responde "Não consegui registrar agora" (tratou). Marcador
// gravou mas a baixa da filha falhou -> mesma resposta. Nesse segundo caso o marcador sozinho NÃO
// tira o cliente do lote: a filha continua `pending`, e o ritual (src/rituals/pix-migracao.js)
// carrega toda filha pendente cujo cliente segue em migrar/autorizacao_pendente na fonte,
// informado ou não — o marcador só impede que ele entre como NOVO num lote. A equipe repete o
// aviso e a baixa acontece; nada fica prometido sem ter sido feito.
//
// Filha sem `pagador_chave` (vínculo nunca gravado, ou a gravação falhou na pauta) NÃO é
// candidata a baixa — sem chave não há como reconferir em 7 dias se a fonte confirmou. Trata
// como se a filha não existisse (mesmo caminho de "0 candidatas").

const {
  detectarCadastroInformado, normalizarNome,
  textoCadastroInformado, textoCadastroNaoAchado, textoCadastroNaoRegistrado, textoCadastroAmbiguo,
} = require('../lib/pix-cadastro-informado');
const { PREFIXO_CONTAINER } = require('../rituals/pix-migracao');

// Extrai o nome do pagador do TÍTULO da filha — mesmo formato de tituloDaFilha
// (services/pix-migracao.js): "PIX automático — <pagador>" ou "PIX automático — <pagador>
// (<alunos>)". Só serve pra exibição/matching, nunca como chave — a chave estável é
// pagador_chave, vinda de pix_pauta_vinculo.
function _pagadorDoTitulo(title) {
  const m = /^PIX automático — (.+?)(?:\s\(.*\))?$/.exec(String(title || ''));
  return (m ? m[1] : String(title || '')).trim();
}

// FIX ROUND 1 (Important, achado da revisão — REVOGA o "contém" do brief §C): substring pegava
// "ana" dentro de "Mariana Costa"/"Joana"/"Diana" — com uma única filha pendente, isso dava
// baixa no pagador ERRADO. Casa por PALAVRA INTEIRA agora: toda palavra do nome falado precisa
// ser IGUAL a alguma palavra do nome do pagador (depois de tirar conectores dos dois lados).
// "Ana" casa com "Ana Lima" e "Maria Ana Souza", nunca com "Mariana Costa". "Ana Lima" casa com
// "Ana Paula Lima" (as duas palavras faladas estão lá, mesmo com "Paula" no meio).
const CONECTORES = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);

function _palavrasDoNome(nomeNormalizado) {
  return nomeNormalizado.split(' ').filter((p) => p && !CONECTORES.has(p));
}

function _casaPorPalavraInteira(nomeFalado, nomePagador) {
  const palavrasFaladas = _palavrasDoNome(normalizarNome(nomeFalado));
  if (!palavrasFaladas.length) return false;
  const palavrasPagador = new Set(_palavrasDoNome(normalizarNome(nomePagador)));
  return palavrasFaladas.every((p) => palavrasPagador.has(p));
}

// deps.filhasPix({ groupId }) -> { pacotes, filhas: [{ id, title, pagador_chave }] }
// Mesma regra do ritual (src/rituals/pix-migracao.js, _containersPixPadrao): pacotes 'pending'
// do grupo cujo título começa com PREFIXO_CONTAINER (`pacotes` = quantos), filhas 'pending' de
// cada um, com o pagador_chave já resolvido via pix_pauta_vinculo (null se nunca foi gravado).
// Lança em erro do Supabase — quem chama decide (aqui: não intercepta).
async function _filhasPixPadrao(sb, { groupId }) {
  const { data: containers, error } = await sb.from('tasks').select('id, title')
    .eq('assigned_group_id', groupId).eq('is_group', true).eq('status', 'pending')
    .like('title', `${PREFIXO_CONTAINER}%`);
  if (error) throw new Error(`filhasPix (containers): ${error.message}`);
  const filhas = [];
  for (const cont of containers || []) {
    const { data: fs, error: erroFilhas } = await sb.from('tasks').select('id, title')
      .eq('parent_task_id', cont.id).eq('status', 'pending');
    if (erroFilhas) throw new Error(`filhasPix (filhas de ${cont.id}): ${erroFilhas.message}`);
    const ids = (fs || []).map((f) => f.id);
    let porTask = new Map();
    if (ids.length) {
      const { data: vinculos, error: erroVinculo } = await sb.from('pix_pauta_vinculo')
        .select('task_id, pagador_chave').in('task_id', ids);
      if (erroVinculo) throw new Error(`filhasPix (vínculo de ${cont.id}): ${erroVinculo.message}`);
      porTask = new Map((vinculos || []).map((v) => [v.task_id, v.pagador_chave]));
    }
    for (const f of fs || []) filhas.push({ id: f.id, title: f.title, pagador_chave: porTask.get(f.id) || null });
  }
  return { pacotes: (containers || []).length, filhas };
}

// Só fecha se ainda está 'pending' (evita corrida com quem já fechou por fora). Nunca lança —
// erro de escrita vira `false`.
async function _fecharFilhaPadrao(sb, id) {
  const { data, error } = await sb.from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'pending').select('id');
  if (error) { console.error(`[PixCadastroGrupo] fecharFilha falhou id=${id}: ${error.message}`); return false; }
  if (!(data || []).length) { console.error(`[PixCadastroGrupo] fecharFilha não achou id=${id} pending`); return false; }
  return true;
}

// Nunca lança — erro de escrita vira `false`. Roda ANTES da baixa da filha (M3): sem marcador, a
// baixa não acontece (a reconferência de 7 dias depende dele).
async function _gravarMarcadorPadrao(sb, { collaboratorId, pagadorChave }) {
  const { error } = await sb.from('marker_logs').insert({
    collaborator_id: collaboratorId, marker_type: 'PIX_CADASTRO', result: 'executed',
    reason: `informado:${pagadorChave}`,
  });
  if (error) { console.error(`[PixCadastroGrupo] marker_logs insert falhou: ${error.message}`); return false; }
  return true;
}

async function tratarCadastroInformadoNoGrupo({
  supabase, groupId, senderCollabId, text, deps = {},
}) {
  const detectado = detectarCadastroInformado(text);
  if (!detectado) return { tratou: false };

  const filhasPix = deps.filhasPix || ((arg) => _filhasPixPadrao(supabase, arg));
  const fecharFilha = deps.fecharFilha || ((id) => _fecharFilhaPadrao(supabase, id));
  const gravarMarcador = deps.gravarMarcador || ((arg) => _gravarMarcadorPadrao(supabase, arg));

  let pauta;
  try {
    pauta = await filhasPix({ groupId });
  } catch (e) {
    console.warn(`[PixCadastroGrupo] busca de filhas falhou, não intercepto: ${e.message}`);
    return { tratou: false };
  }
  // I5: sem pacote PIX aberto neste grupo, não há pauta do PIX aqui — segue o fluxo normal.
  if (!pauta || !(pauta.pacotes > 0)) return { tratou: false };
  const filhas = pauta.filhas || [];

  const candidatas = filhas
    .filter((f) => f.pagador_chave) // sem vínculo não pode ser baixada — sem chave pra reconferir
    .filter((f) => _casaPorPalavraInteira(detectado.nome, _pagadorDoTitulo(f.title)));

  if (candidatas.length === 0) {
    return { tratou: true, texto: textoCadastroNaoAchado(detectado.nome) };
  }
  if (candidatas.length > 1) {
    return { tratou: true, texto: textoCadastroAmbiguo(candidatas.map((f) => _pagadorDoTitulo(f.title))) };
  }

  const [filha] = candidatas;
  // M3: marcador PRIMEIRO. Lançar conta como falha (nunca derruba o turno).
  let marcou = false;
  try {
    marcou = await gravarMarcador({ collaboratorId: senderCollabId, pagadorChave: filha.pagador_chave });
  } catch (e) {
    console.error(`[PixCadastroGrupo] gravarMarcador lançou (id=${filha.id}): ${(e && e.message) || String(e)}`);
    marcou = false;
  }
  if (!marcou) {
    console.warn(`[PixCadastroGrupo] marcador não gravou (id=${filha.id}) — não dou baixa`);
    return { tratou: true, texto: textoCadastroNaoRegistrado() };
  }
  const fechou = await fecharFilha(filha.id);
  if (!fechou) {
    // O marcador ficou, mas a filha continua pendente — o ritual a carrega (ver o topo do arquivo).
    console.warn(`[PixCadastroGrupo] marcador gravou mas a baixa falhou (id=${filha.id})`);
    return { tratou: true, texto: textoCadastroNaoRegistrado() };
  }
  return { tratou: true, texto: textoCadastroInformado(_pagadorDoTitulo(filha.title)) };
}

module.exports = { tratarCadastroInformadoNoGrupo, _pagadorDoTitulo };
