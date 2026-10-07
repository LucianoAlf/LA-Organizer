'use strict';
// pix-dm.js — PIX automático no 1:1 (Ana Paula, DM, 05/10 19:08–19:11 BRT).
//
// O CASO. "Tiveram alguns cadastros de Pix tom. Se puder atualizar a lista pra mim, vou te dizendo
// quem já foi" -> o TOM escreveu DE CABEÇA uma lista numerada de 10 nomes (as filhas da pauta que
// apareciam no contexto do prompt), sem fonte. "3 - crédito recorrente já cadastrado / 8 - Pix
// recorrente já cadastrado" -> TASK_UPDATE complete nas filhas da pauta do GRUPO: fechou as duas,
// mas SEM o marcador PIX_CADASTRO (a reconferência de 7 dias do ritual não sabia de nada) e o 3 era
// CARTÃO, não PIX. "3 tá ok / 8 tá ok" -> "Não achei nenhuma tarefa aberta… no teu nome".
//
// RAIZ: o 1:1 não tinha a lista do PIX nem o caminho do "cadastrei". Agora, igual ao grupo:
//   LISTA   — o LLM emite o MESMO <<LISTA_PIX>> do grupo; o CÓDIGO lê a MESMA fonte
//             (pix-consulta-fontes, mesma conta da lista do grupo) e escreve a lista NUMERADA.
//             Padrão = a PAUTA do dia do grupo; a unidade inteira só com "lista completa".
//             O número -> cliente fica guardado (pix-dm-numeracao.js) pra resposta seguinte.
//   AVISO   — "8 já cadastrado", "o 3 e o 8 já foram", "cadastrei <nome> no automático": o código
//             resolve o número contra a lista que ele MESMO mandou, relê a fonte e registra pelo
//             MESMO caminho do grupo (pix-cadastro-grupo.registrarCadastroInformado: marcador
//             PIX_CADASTRO primeiro, depois a baixa da filha pendente da pauta, se houver).
//             CARTÃO não é PIX cadastrado: a lista lê o Emusys, então a resposta é "atualiza a
//             forma de pagamento lá" — nada é registrado. "Anotei" só sai quando o código gravou.
// Mesmo padrão de deps injetáveis do resto do PIX: nenhum teste toca Supabase nem LA Report.

const pura = require('./pix-consulta');
const fontes = require('./pix-consulta-fontes');
const situ = require('./situacao-aluno');
const { detectarCadastroInformado } = require('../lib/pix-cadastro-informado');
const { stripReplyScaffold } = require('../events/detect-approval-reply');
const cadastro = require('./pix-cadastro-grupo');
const numeracao = require('./pix-dm-numeracao');

const ORDEM_UNIDADES = ['campo grande', 'recreio', 'barra'].map((a) => situ.resolverUnidade(a));
const JANELA_LISTA_MS = 24 * 3600 * 1000;
const RE_CARTAO = /cart[aã]o/i;

function _norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// GATE BARATO do 1:1: sem o assunto na fala, nenhuma leitura e nenhum bloco no prompt.
function falaDePix(texto) {
  const t = _norm(stripReplyScaffold(String(texto || '')).userText);
  return /\bpix\b|\bautomatico\b|\bmigracao\b/.test(t);
}

// ── LEITURA DA RESPOSTA POR NÚMERO (puro) ──────────────────────────────────────────────────────
// Conservador de propósito (mesma régua do "cadastrei" do grupo): baixa errada é pior que deixar
// o LLM perguntar. Só vira aviso quando: há palavra de FEITO, nenhuma negação/dúvida/pergunta,
// nenhum horário/data (o número seria ambíguo), todo número cabe na lista e a fala é curta.
const RE_FEITO = /\bcadastrad[oa]s?\b|\bok\b|\bfoi\b|\bforam\b|\bfeito\b|\bmigro(u|ram)\b|\bmigrad[oa]s?\b|\bpronto\b|\bresolvid[oa]s?\b|✅/;
const RE_DUVIDA = /\?|\bnao\b|\bnunca\b|\bainda\b|\bfalta\b|\bfaltou\b|\bacho\b|\btalvez\b|\bparece\b|\bvou\b|\bdepois\b|\bamanha\b|\bpendente\b|\bsera\b/;
const RE_HORA_DATA = /\d{1,2}\s*[:h]\s*\d{2}|\d{1,2}\/\d{1,2}/;
const RE_NUMERO = /(?:^|[\s,;(])(?:o |a |n[o°º]\.?\s?|numero\s)?(\d{1,3})(?=$|[\s\-–—:.,;)])/g;
const TETO_PALAVRAS = 40;

// -> [{ numero, forma: 'pix' | 'cartao' | null }] | null
function lerRespostaPorNumero(texto, { tamanho } = {}) {
  const t = _norm(stripReplyScaffold(String(texto || '')).userText).trim();
  if (!t || !(tamanho > 0)) return null;
  if (t.split(/\s+/).length > TETO_PALAVRAS) return null;
  if (!RE_FEITO.test(t) || RE_DUVIDA.test(t) || RE_HORA_DATA.test(t)) return null;
  const achados = [];
  for (const m of t.matchAll(RE_NUMERO)) achados.push({ numero: Number(m[1]), ini: m.index });
  if (!achados.length) return null;
  const out = [];
  for (let i = 0; i < achados.length; i++) {
    const { numero, ini } = achados[i];
    if (!(numero >= 1 && numero <= tamanho)) return null;
    const trecho = t.slice(ini, i + 1 < achados.length ? achados[i + 1].ini : t.length);
    const forma = /\bcredito\b|\bcartao\b/.test(trecho) ? 'cartao' : /\bpix\b|\bautomatico\b/.test(trecho) ? 'pix' : null;
    if (!out.some((o) => o.numero === numero)) out.push({ numero, forma });
  }
  return out;
}

// Gate barato do turno (engine, antes do LLM): só paga I/O quando a fala TEM forma de aviso —
// número + palavra de feito, ou o "cadastrei <nome> no automático" do grupo.
function talvezAvisoDePix(texto) {
  const u = stripReplyScaffold(String(texto || '')).userText;
  if (detectarCadastroInformado(u)) return true;
  const t = _norm(u);
  return /\d/.test(t) && RE_FEITO.test(t);
}

// ── BLOCO DO PROMPT ───────────────────────────────────────────────────────────────────────────
function blocoPixDM({ porUnidade = [] } = {}) {
  const L = ['## 💠 PIX AUTOMÁTICO NO 1:1 — fonte: LA Report, a MESMA lista dos grupos'];
  for (const u of porUnidade) L.push(pura.blocoDeNumeros(u));
  L.push('REGRAS:');
  L.push('- Pediram a lista / os nomes / "atualiza a lista" do PIX? Escreva UMA linha curta de abertura e emita <<LISTA_PIX>>{"alvo":"pix","unidade":"campo grande|recreio|barra"}<<END>> (unidade só se a pessoa disser; os mesmos alvos do grupo: "pix", "pix_avulso", "cheque", "cartao_cadastrado", "ja_migrou"…). Com "pix", o sistema manda a PAUTA do dia do grupo da pessoa; a unidade inteira só se ela pedir a "lista completa" — quem decide é o sistema, pela fala dela. A lista sai NUMERADA, da fonte. NUNCA escreva os nomes você mesmo — nem a partir das tarefas "PIX automático — …" que aparecem no seu contexto.');
  L.push('- Quem já foi a pessoa diz pelo NÚMERO da lista ou com "cadastrei <nome> no automático" — quem registra é o SISTEMA. NUNCA emita TASK_UPDATE em tarefa "PIX automático — …" e nunca diga que marcou/anotou/fechou alguém do PIX por conta própria.');
  L.push('- Cartão recorrente (crédito) NÃO é PIX automático: a lista lê o Emusys, então a forma de pagamento tem que ser atualizada LÁ; quando a cobrança passar no cartão, a pessoa sai da lista sozinha.');
  return L.join('\n');
}

// ── A LISTA NUMERADA ──────────────────────────────────────────────────────────────────────────
// PADRÃO DO 1:1 = A PAUTA DO DIA (coordenação 07/10). "Atualiza a lista" (Ana, 05/10) é a pauta do
// PIX do grupo dela — as filhas pendentes do pacote aberto pelo ritual, a MESMA que o grupo recebe
// e a MESMA que o "cadastrei" do grupo lê (pix-cadastro-grupo.filhasPixDoGrupo). A unidade inteira
// só quando a pessoa pede "lista completa/toda/inteira" (ou nomeia um recorte: cheque, 💳…) — e aí
// em PARTES do tamanho das do grupo, com a numeração contínua entre as partes.
function _rpcPadrao(laReport) {
  return (unidadeId) => laReport.rpc('get_pix_migracao_v1', { p_unidade_id: unidadeId, p_fatia: null });
}
function _depsDaUnidade(deps, laReport, unidadeId) {
  const rpc = deps.rpcPixDaUnidade || _rpcPadrao(laReport);
  return { ...deps, rpcPix: () => rpc(unidadeId) };
}

const RE_COMPLETA = /\blista (completa|inteira|toda)\b|\btoda a lista\b|\b(completa|inteira)\b|\btod[oa]s os (clientes|nomes|alunos)\b/;
function pedeListaCompleta(texto) {
  return RE_COMPLETA.test(_norm(stripReplyScaffold(String(texto || '')).userText));
}

// Grupos da pessoa amarrados a uma unidade (é neles que o ritual abre a pauta do PIX).
async function _gruposPixPadrao(supabase, { collaboratorId, unidadeIds }) {
  const { data: mem, error } = await supabase.from('work_group_members').select('group_id').eq('collaborator_id', collaboratorId);
  if (error) throw new Error(`gruposPix (membros): ${error.message}`);
  if (!(mem || []).length) return [];
  const { data: gs, error: e2 } = await supabase.from('work_groups').select('id, la_report_unidade_id')
    .in('id', mem.map((m) => m.group_id)).eq('active', true).not('la_report_unidade_id', 'is', null);
  if (e2) throw new Error(`gruposPix (grupos): ${e2.message}`);
  return (gs || []).filter((g) => unidadeIds.includes(g.la_report_unidade_id)).map((g) => ({ groupId: g.id, unidadeId: g.la_report_unidade_id }));
}

// "PIX automático — Pagador (A, B)" -> { pagador, alunos } — o formato de tituloDaFilha.
function _itemDaFilha(f) {
  const pagador = cadastro._pagadorDoTitulo(f.title);
  const m = /\(([^()]*)\)\s*$/.exec(String(f.title || ''));
  return { pagador, alunos: m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [], chave: f.pagador_chave || null };
}

const RODAPE_NUMERO = '_Me responde com o número de quem já foi (ex.: "8 já cadastrado no PIX") que eu registro._';
const RODAPE_SEM_NUMERO = '_Não consegui guardar a numeração desta lista — pra me dizer quem já foi, usa "cadastrei <nome> no automático"._';
const RODAPE_PAUTA = '_Essa é a pauta aberta do teu grupo. Pra unidade inteira, me pede a "lista completa"._';
const RE_MARKER = /<<LISTA_PIX>>([\s\S]*?)<<END>>/gi;

// -> { reply, extras: [mensagens seguintes], atendidos, falhas, itens }
async function atenderMarkersListaPixDM({ reply, laReport, supabase, unidadeIds = [], collaboratorId, textoDoUsuario = '', deps = {} }) {
  const texto = String(reply == null ? '' : reply);
  const brutos = Array.from(texto.matchAll(RE_MARKER)).map((m) => m[1]);
  if (!brutos.length) return { reply: texto, extras: [], atendidos: 0, falhas: 0, itens: [] };
  const salvar = deps.salvarNumeracao || ((arg) => numeracao.salvarNumeracao({ supabase, ...arg }));
  const gruposPix = deps.gruposPix || ((arg) => _gruposPixPadrao(supabase, arg));
  const filhasDoGrupo = deps.filhasPixDoGrupo || ((arg) => cadastro.filhasPixDoGrupo(supabase, arg));

  let p = {};
  try { p = JSON.parse(String(brutos[0]).trim()) || {}; } catch (_) { p = {}; }
  // No 1:1 este marcador é só do PIX: anamnese/contrato têm o <<SITUACAO_ALUNO>>; "tudo" = "pix".
  let alvos = pura.alvosDoMarker(p.alvo).map((a) => (a === 'tudo' ? 'pix' : a)).filter((a) => a !== 'anamnese' && a !== 'contrato');
  if (!alvos.length) alvos = ['pix'];
  const citada = situ.resolverUnidade(p.unidade);
  const unidades = citada ? [citada] : (unidadeIds.length ? unidadeIds : ORDEM_UNIDADES);
  // Recorte nomeado (cheque, 💳, já migraram…) é pedido explícito; "pix" sozinho é a pauta do dia.
  const pauta = alvos.length === 1 && alvos[0] === 'pix' && !pedeListaCompleta(textoDoUsuario);

  const blocos = [];
  const itens = [];
  const avisos = [];
  const semPauta = [];
  let falhas = 0;
  const numerar = (b) => b.itens.map((it) => {
    const n = itens.length + 1;
    itens.push({ n, chave: it.chave || null, nome: it.pagador });
    return { pagador: it.pagador, alunos: it.alunos, secao: it.secao, numero: n };
  });

  let grupos = [];
  if (pauta) {
    try { grupos = await gruposPix({ collaboratorId, unidadeIds: unidades }); } catch (e) {
      falhas++;
      console.warn(`[PixDM] grupos da pessoa: ${e.message}`);
      avisos.push('Não consegui ler a pauta dos teus grupos agora — me pede de novo daqui a pouco.');
    }
  }
  for (const unidadeId of unidades) {
    const unidadeNome = situ.nomeDaUnidade(unidadeId);
    const dU = _depsDaUnidade(deps, laReport, unidadeId);
    if (pauta) {
      const gs = grupos.filter((g) => g.unidadeId === unidadeId);
      try {
        const filhas = [];
        const datas = [];
        for (const g of gs) {
          // eslint-disable-next-line no-await-in-loop
          const r = await filhasDoGrupo({ groupId: g.groupId });
          if (!r || !(r.pacotes > 0)) continue;
          for (const d of r.datas || []) if (!datas.includes(d)) datas.push(d);
          for (const f of r.filhas || []) if (!filhas.some((x) => x.title === f.title)) filhas.push(f);
        }
        if (!filhas.length) { semPauta.push(unidadeNome); continue; }
        // eslint-disable-next-line no-await-in-loop
        const b = await fontes.blocoDaPauta({ laReport, unidadeId, pauta: filhas.map(_itemDaFilha), deps: dU });
        const quando = datas.length ? `pauta de ${datas.join(', ')}` : 'pauta aberta';
        blocos.push({ titulo: `PIX automático — ${quando} — ${unidadeNome}`, substantivo: 'clientes', itens: numerar(b), resumo: b.resumo });
      } catch (e) {
        falhas++;
        console.warn(`[PixDM] pauta unidade=${unidadeNome}: ${e.message}`);
        avisos.push(`A pauta de ${unidadeNome} eu não consegui ler agora — me pede de novo daqui a pouco.`);
      }
      continue;
    }
    for (const alvo of alvos) {
      try {
        // eslint-disable-next-line no-await-in-loop -- ordem importa (CG, Recreio, Barra)
        const b = await fontes.blocoNumeravel({ laReport, unidadeId, alvo, deps: dU });
        blocos.push({ titulo: `${pura.tituloDoAlvo(alvo)} — ${unidadeNome}`, substantivo: 'clientes', itens: numerar(b), resumo: b.resumo });
      } catch (e) {
        falhas++;
        console.warn(`[PixDM] lista ${alvo} unidade=${unidadeNome}: ${e.message}`);
        avisos.push(`A lista de ${unidadeNome} eu não consegui ler agora — me pede de novo daqui a pouco.`);
      }
    }
  }

  let msgs;
  if (!blocos.length) {
    msgs = [semPauta.length && !falhas
      ? `Hoje não tem pauta do PIX aberta no teu grupo (${semPauta.join(', ')}). Se quiser a unidade inteira, me pede a "lista completa" que eu mando numerada.`
      : 'Não consegui ler a lista do PIX agora — me pede de novo daqui a pouco. Não vou te mandar nome que eu não medi.'];
    if (semPauta.length && falhas) msgs[0] += `\n_${avisos.join(' ')}_`;
  } else {
    if (semPauta.length) avisos.push(`Sem pauta do PIX aberta hoje em: ${semPauta.join(', ')}.`);
    // Mesmo tamanho de parte do grupo (pura.LIMITE_POR_MENSAGEM); o teto do 1:1 é folgado pra a
    // numeração guardada nunca ter número que a pessoa não viu (ver o filtro logo abaixo).
    msgs = pura.mensagensDeVariasListas({ unidadeNome: null, blocos, avisos, tetoMensagens: 20 });
    const vistos = new Set();
    for (const m of msgs) for (const x of m.matchAll(/\n {3}(\d+)\. /g)) vistos.add(Number(x[1]));
    const guardados = itens.filter((i) => vistos.has(i.n));
    if (guardados.length) {
      const ok = await salvar({ collaboratorId, itens: guardados });
      msgs[msgs.length - 1] += `\n\n${ok ? RODAPE_NUMERO : RODAPE_SEM_NUMERO}`;
    }
    if (pauta) msgs[msgs.length - 1] += `\n${RODAPE_PAUTA}`;
  }
  let primeiro = true;
  const out = texto.replace(RE_MARKER, () => {
    if (!primeiro) return '';
    primeiro = false;
    return `\n\n${msgs[0]}\n\n`;
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { reply: out, extras: msgs.slice(1), atendidos: brutos.length, falhas, itens };
}

// ── O AVISO DE QUEM JÁ FOI (antes do LLM) ─────────────────────────────────────────────────────
// -> null (não é comigo) | { linhas: [texto], gravou: bool }
async function resolverPixDoTurno({ supabase, laReport, collaboratorId, text, unidadeIds = [], deps = {} }) {
  const carregar = deps.carregarNumeracao || ((arg) => numeracao.carregarNumeracao({ supabase, ...arg }));
  const agora = deps.agora || Date.now;

  // 1) Por número, contra a última lista que o TOM mandou NESTE 1:1.
  let pedidos = null;
  let mapa = null;
  const userText = stripReplyScaffold(String(text || '')).userText;
  if (/\d/.test(userText)) {
    try {
      mapa = await carregar({ collaboratorId, desdeIso: new Date(agora() - JANELA_LISTA_MS).toISOString() });
    } catch (e) {
      console.warn(`[PixDM] última lista não leu: ${e.message}`);
      mapa = null;
    }
    if (mapa && mapa.length) {
      const lidos = lerRespostaPorNumero(text, { tamanho: mapa.length });
      if (lidos) pedidos = lidos.map((l) => ({ ...mapa.find((m) => m.n === l.numero), forma: l.forma }));
    }
  }
  // 2) Pelo nome — a MESMA fala que o grupo reconhece.
  let porNome = null;
  if (!pedidos) {
    const det = detectarCadastroInformado(userText);
    if (!det) return null;
    porNome = det.nome;
  }

  // Relê a fonte: o que a pessoa diz é confrontado com o que o Emusys mostra AGORA.
  const unidades = pedidos
    ? [...new Set(pedidos.filter((p) => p.chave).map((p) => String(p.chave).split(':')[0]))]
    : (unidadeIds.length ? unidadeIds : ORDEM_UNIDADES);
  const linhasFonte = [];
  for (const unidadeId of unidades) {
    try {
      // eslint-disable-next-line no-await-in-loop
      linhasFonte.push(...await fontes.linhasDaUnidade({ laReport, unidadeId, deps: _depsDaUnidade(deps, laReport, unidadeId) }));
    } catch (e) {
      console.warn(`[PixDM] fonte fora (${unidadeId}): ${e.message}`);
      return { linhas: ['Não consegui ler a lista do PIX agora pra conferir — não registrei nada. Me manda de novo daqui a pouco.'], gravou: false };
    }
  }

  if (porNome) {
    const cand = linhasFonte.filter((l) => cadastro._casaPorPalavraInteira(porNome, l.pagador_nome));
    if (!cand.length) return { linhas: [`*${porNome}* não está na lista do PIX das tuas unidades. Se já cadastrou, o Emusys confirma e sai da lista sozinho.`], gravou: false };
    if (cand.length > 1) return { linhas: [`Achei mais de um parecido: ${cand.map((l) => l.pagador_nome).join(' · ')}. Qual deles?`], gravou: false };
    pedidos = [{ n: null, chave: cand[0].pagador_chave, nome: cand[0].pagador_nome, forma: 'pix' }];
  }

  const porChave = new Map(linhasFonte.map((l) => [l.pagador_chave, l]));
  const linhas = [];
  let gravou = false;
  for (const p of pedidos) {
    const rotulo = p.n ? `${p.n}. ${p.nome}` : p.nome;
    if (!p.chave) { linhas.push(`• ${rotulo} — esse item da pauta não tem o vínculo com o Emusys, não consigo registrar pelo número: me manda "cadastrei ${p.nome} no automático".`); continue; }
    const l = porChave.get(p.chave);
    if (!l) { linhas.push(`• ${rotulo} — já saiu da lista do Emusys, nada a fazer.`); continue; }
    if (l.categoria === 'ja_migrou') { linhas.push(`• ${rotulo} — já aparece como migrado pro PIX automático no Emusys ✅, nada a fazer.`); continue; }
    if (l.categoria === 'autorizacao_pendente') { linhas.push(`• ${rotulo} — já está cadastrado no PIX automático no Emusys, esperando a 1ª cobrança. Nada a fazer.`); continue; }
    if (l.categoria !== 'migrar') { linhas.push(`• ${rotulo} — não está na lista de quem falta migrar, nada a fazer.`); continue; }
    const cartao = p.forma === 'cartao' || (p.forma == null && RE_CARTAO.test(String(l.cobranca_automatica_cadastrada || '')));
    if (cartao) {
      linhas.push(`• ${rotulo} — cartão recorrente não é PIX automático: a lista lê o Emusys, então atualiza a forma de pagamento lá (cartão recorrente). Quando a cobrança passar no cartão, sai da lista sozinho. Aqui não registrei nada.`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await cadastro.registrarCadastroInformado({ supabase, collaboratorId, pagadorChave: p.chave, deps });
    if (r.ok) {
      gravou = true;
      linhas.push(`• ${rotulo} — ✅ anotei no PIX automático: sai da pauta e confiro no Emusys; se em 7 dias não aparecer lá, volta pra lista.`);
    } else {
      linhas.push(`• ${rotulo} — não consegui registrar agora, tenta de novo daqui a pouco.`);
    }
  }
  return { linhas, gravou };
}

// Hint pro LLM: ele só abre a mensagem; o resultado item a item o CÓDIGO anexa (nunca o LLM).
function hintDoResultado() {
  return '### 💠 PIX — O SISTEMA JÁ TRATOU ESTA MENSAGEM\nA pessoa disse quem já foi do PIX automático e o SISTEMA já conferiu na fonte e registrou o que dava. O resultado item a item vai ANEXADO automaticamente depois da sua fala. Escreva SÓ uma linha curta e calorosa de abertura (ex.: "Conferi aqui 👇"). NÃO diga você mesmo quem foi marcado/anotado/fechado, NÃO emita TASK_UPDATE nem nenhum marcador pra esses clientes.';
}

// ── A REDE: tarefa da pauta do PIX nunca se fecha pelo TASK_UPDATE do 1:1 ───────────────────────
// Foi o que aconteceu em 05/10: a filha fechou sem o marcador PIX_CADASTRO (e o 3 era cartão). A
// baixa do PIX tem dono: registrarCadastroInformado. Ações 'complete' com título "PIX automático —"
// saem do marcador; o resto do marcador fica intacto.
const RE_TASK_UPDATE = /<<TASK_UPDATE>>\s*([\s\S]*?)\s*<<END>>/gi;
const _ehConclusaoDePix = (a) => a && String(a.action || '').toLowerCase() === 'complete' && /^\s*PIX automático —/i.test(String(a.title || ''));
function tirarConclusaoDePix(reply) {
  const texto = String(reply == null ? '' : reply);
  let tirados = 0;
  const out = texto.replace(RE_TASK_UPDATE, (bloco, json) => {
    let j;
    try { j = JSON.parse(json); } catch (_) { return bloco; }
    const lista = Array.isArray(j) ? j : (j && Array.isArray(j.actions) ? j.actions : null);
    if (!lista) return bloco;
    const fica = lista.filter((a) => !_ehConclusaoDePix(a));
    if (fica.length === lista.length) return bloco;
    tirados += lista.length - fica.length;
    if (!fica.length) return '';
    return `<<TASK_UPDATE>>${JSON.stringify(Array.isArray(j) ? fica : { ...j, actions: fica })}<<END>>`;
  });
  return { reply: tirados ? out.replace(/\n{3,}/g, '\n\n').trim() : texto, tirados };
}

module.exports = {
  MARCADOR_LISTA: numeracao.MARCADOR_LISTA, falaDePix, talvezAvisoDePix, lerRespostaPorNumero, pedeListaCompleta, blocoPixDM, atenderMarkersListaPixDM,
  resolverPixDoTurno, hintDoResultado, tirarConclusaoDePix,
};
