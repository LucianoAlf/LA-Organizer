'use strict';
// group-memory.js — o TOM guarda o que o GRUPO conversou.
//
// Por que existe: a memória semântica do TOM (collaborator_memory + Dream das 3h) sempre teve
// sujeito PESSOA. O Dream JÁ percorre os grupos no mesmo laço, mas só chama o auditor — ele
// julga o grupo e não guarda nada dele. Esta é a metade que faltava.
//
// Fatia 1: só ESCREVE. Nada aqui entra no prompt — ler é a Fatia 2, depois de o Alf conferir
// o que foi guardado.

const { prepararCandidatas, defaultsPorTipo, looksLikeMemory } = require('./agent-memory');

const JANELA_HORAS = 24;   // grupo de trabalho conversa todo dia (o 1:1 usa 7d por outro motivo)
const TETO_POR_NOITE = 8;  // grupo movimentado não pode afogar a memória em uma noite
const EVIDENCE_MAX = 200;
// `context` é "situação temporária". Quando a LLM esquece o decay_at, o backstop entra: sem ele
// um context nasce ATIVO e SEM validade — ou seja, vira verdade permanente do grupo, que é
// exatamente o que a coluna existe pra impedir. 30 dias é folgado o bastante pra não perder
// contexto real (os 4 contexts vivos em 04/09 pediam de 8 a 29 dias) e curto pra não eternizar.
const DECAY_PADRAO_CONTEXT_DIAS = 30;

function ymdEmSaoPaulo(date) {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function montarHistorico(mensagens) {
  return (mensagens || [])
    .map((m) => {
      const texto = String((m && m.content) || '').trim();
      if (!texto) return null;
      const quem = m.role === 'tom' ? 'TOM' : ((m.sender && (m.sender.full_name || m.sender.preferred_name)) || 'alguém');
      return `${quem}: ${texto}`;
    })
    .filter(Boolean)
    .join('\n');
}

// ── AUTO-RELATO DO TOM NÃO É EVIDÊNCIA ─────────────────────────────────────────────────────
// POR QUÊ (04/09, grupo da Barra): o TOM disse no grupo que "não processou a mensagem da Krissya
// por ter pego o 'Tom' do Alf primeiro". Medido no banco: a mensagem dela é 11:15:34 e o "Tom" do
// Alf é 11:35:12 — 19min38s DEPOIS. A raiz real era outra (a mensagem dela entrou com sender_id
// NULL e o watcher abortou em silêncio). Ou seja: o TOM inventou uma causa pra própria falha, essa
// prosa entrou no "Resumo da sessão" (role='tom', kind='report') e esta rotina, que lê o histórico
// do grupo, ia transformar a invenção em `fact` — que nasce is_active=true, sem aprovação nenhuma.
//
// Havia duas saídas: (a) tirar o material do prato do extrator, ou (b) pedir no prompt que ele
// não transforme auto-diagnóstico em fato. Escolhi (a), e o motivo é a taxa de burla: (b) é uma
// frase num prompt que já diz "NÃO invente" — e foi justamente inventando que chegamos aqui. Um
// filtro em código não depende de a LLM obedecer, não some quando alguém reescreve o prompt e não
// varia por provider. Corte determinístico ganha de instrução toda vez.
//
// O corte tem DUAS camadas porque a mentira apareceu em dois lugares:
//   1) o card `kind='report'` (o "Resumo da sessão") sai do material — é saída DERIVADA do TOM,
//      não conversa. Consolidar o resumo do TOM fecha um laço em si mesmo: resumo → memória →
//      prompt → próximo resumo (a mesma doença de DATE-SELF-POISONING).
//   2) a fala solta `kind='text'` FICA (o extrator precisa do fio da conversa), mas nenhuma
//      candidata pode nascer com `evidence` que só existe na boca do TOM. O prompt já obriga a
//      evidência a ser "o trecho LITERAL da conversa que originou" — então dá pra conferir a
//      procedência em código, depois da extração.
// `lesson` escapa do corte de propósito: ela nasce inativa e vai pra fila de aprovação. Hipótese
// do TOM sobre o TOM pode virar PROPOSTA pra um humano julgar — o que não pode é virar verdade.
const KINDS_DERIVADOS_DO_TOM = new Set(['report']);

function materialDeConsolidacao(mensagens) {
  return (mensagens || []).filter((m) => !(m && m.role === 'tom' && KINDS_DERIVADOS_DO_TOM.has(m.kind)));
}

// Normaliza pra comparar procedência: o report vem em HTML e a fala vem com emoji e acento.
function normalizarFala(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Casamento por CONTINÊNCIA primeiro (evidência é citação literal), similaridade só de reserva —
// looksLikeMemory é a mesma régua já usada pra deduplicar memória, então não nasce outra régua.
function falaCasaComEvidencia(evidenciaNorm, conteudo) {
  const linha = normalizarFala(conteudo);
  if (!linha || !evidenciaNorm) return false;
  if (linha.includes(evidenciaNorm) || evidenciaNorm.includes(linha)) return true;
  return looksLikeMemory(evidenciaNorm, linha);
}

// POLARIDADE PROPOSITAL: se ALGUMA pessoa disse aquilo, é testemunho e passa — mesmo que o TOM
// tenha repetido depois (ele quase sempre repete: ecoa o pedido ao confirmar). Só cai a candidata
// cuja evidência SÓ existe na fala do TOM. Falso positivo aqui custaria memória boa de gente real;
// falso negativo custa uma memória a menos. Evidência que não casa com nada segue como está —
// endurecer isso é outra conversa (e outro risco), não a desta correção.
function origemDaEvidencia(evidence, mensagens) {
  const ev = normalizarFala(evidence);
  if (!ev) return 'desconhecida';
  const lista = mensagens || [];
  if (lista.some((m) => m && m.role !== 'tom' && falaCasaComEvidencia(ev, m.content))) return 'humano';
  if (lista.some((m) => m && m.role === 'tom' && falaCasaComEvidencia(ev, m.content))) return 'tom';
  return 'desconhecida';
}

async function extrairMemoriaDeGrupo({ groupName, historyText, existentes, chat }) {
  const jaSei = (existentes || []).slice(0, 30)
    .map((m) => `[${m.memory_type}/${m.importance}] ${m.content}`).join('\n') || '(nada ainda)';

  const sys = `Você extrai memória durável do grupo de trabalho "${groupName}".
Recebe a conversa do dia e o que já está guardado. Identifique até 5 itens NOVOS que valham a pena lembrar daqui a meses.

Tipos (use exatamente um):
- fact: dado concreto e duradouro do grupo (quem faz o quê, como funciona)
- decision: decisão tomada pelo time
- lesson: padrão/combinado de como agir (vira REGRA — só use quando o time corrigiu ou combinou algo)
- preference: forma de trabalhar do grupo
- context: situação temporária (SEMPRE defina decay_at)

Importance: critical | high | normal | low

REGRAS:
- NÃO invente. Se o dia não teve nada digno, devolva [].
- NUNCA guarde senha, token, chave ou credencial.
- Cada item traz "evidence": o trecho LITERAL da conversa que originou. Sem trecho, não é memória.
- Não repita o que já está guardado.
- NÃO transforme um pedido feito A alguém em responsabilidade PERMANENTE dessa pessoa.
  "Fulana, quando você fizer X, faz Y" é instrução daquele momento — o combinado vale para o
  grupo, não vira o papel dela. Só atribua dono se a conversa disser que é regra ("daqui pra
  frente quem faz é a fulana"). Na dúvida, escreva o combinado SEM dono.

O que já está guardado:
${jaSei}

Saída OBRIGATÓRIA: array JSON puro, sem texto antes ou depois. Vazio se nada digno:
[{"memory_type":"decision","content":"...","importance":"high","evidence":"...","decay_at":null}]`;

  const raw = await chat(sys, [{ role: 'user', content: historyText }]);
  const texto = (raw && typeof raw === 'object') ? (raw.text != null ? raw.text : JSON.stringify(raw)) : raw;
  if (!texto) return [];
  try {
    const m = String(texto).match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : texto);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return []; // prosa em vez de JSON = nada extraído (nunca inventar)
  }
}

// Backstop de validade: só `context` ganha prazo automático. `fact`/`decision`/`preference` são
// registro durável por definição — dar prazo a eles seria inventar política, não corrigir bug.
function prazoPadrao(memoryType, agora) {
  if (memoryType !== 'context') return null;
  return new Date(agora.getTime() + DECAY_PADRAO_CONTEXT_DIAS * 86400000).toISOString();
}

async function consolidateGroupMemoryFor({ supabase, group, chat, getEmbedding, agora = new Date() }) {
  const desde = new Date(agora.getTime() - JANELA_HORAS * 3600 * 1000).toISOString();
  const out = { mensagens: 0, candidatas: 0, salvas: 0, descartadas: null, erro: null };

  // `kind` entra no SELECT porque é ele que separa a CONVERSA do card derivado do próprio TOM.
  const { data: msgs } = await supabase.from('group_chat_messages')
    .select('role, kind, content, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
    .eq('group_id', group.id).gte('created_at', desde).order('created_at', { ascending: true });

  const mensagens = msgs || [];
  out.mensagens = mensagens.length;
  if (!mensagens.length) return out; // PISO: grupo parado não gasta LLM

  // Camada 1 do corte: o "Resumo da sessão" do TOM não é material de memória (ver bloco acima).
  const historyText = montarHistorico(materialDeConsolidacao(mensagens));
  if (!historyText) return out;

  const { data: exist } = await supabase.from('group_memory')
    .select('content, memory_type, importance').eq('group_id', group.id).eq('is_active', true);
  const existentes = exist || [];

  let candidatas = [];
  try {
    candidatas = await extrairMemoriaDeGrupo({ groupName: group.name, historyText, existentes, chat });
  } catch (e) {
    // O extrator quebrou. Zero por FALHA não pode ser indistinguível de zero por dia tranquilo
    // — foi o que cegou a auditoria de 29/08 a 01/09. Quem chama registra este erro.
    out.erro = e.message;
    return out;
  }
  out.candidatas = candidatas.length;

  // Camada 2 do corte: candidata cuja evidência SÓ existe na boca do TOM não é memória — é o
  // sistema se citando. Roda ANTES do prepararCandidatas pra não gastar o teto da noite com
  // auto-relato, e confere contra `mensagens` INTEIRO (inclusive os reports) — assim, mesmo que
  // a LLM cite um resumo que nem foi mandado pra ela, o descarte pega.
  let autoRelato = 0;
  const semAutoRelato = [];
  for (const c of candidatas) {
    if (c && c.memory_type !== 'lesson' && origemDaEvidencia(c.evidence, mensagens) === 'tom') {
      autoRelato++;
      continue;
    }
    semAutoRelato.push(c);
  }

  const { aceitas, descartadas } = prepararCandidatas(semAutoRelato, existentes, { teto: TETO_POR_NOITE });
  // Descarte CONTADO: zero por "nada digno" e zero por "o TOM só falava de si" precisam ser
  // distinguíveis na auditoria — foi a cegueira de 29/08 a 01/09 em outra fatia deste mesmo arquivo.
  out.descartadas = { ...descartadas, autoRelato };

  const diaRodada = ymdEmSaoPaulo(agora);
  const ultima = mensagens[mensagens.length - 1];
  const diaConversa = ymdEmSaoPaulo(new Date((ultima && ultima.created_at) || agora));

  for (const c of aceitas) {
    let embedding = null;
    try { embedding = await getEmbedding(c.content); }
    catch (e) { console.warn('[GroupMemory] embedding err (grava sem):', e.message); }

    const { error } = await supabase.from('group_memory').insert({
      group_id: group.id,
      memory_type: c.memory_type,
      content: c.content,
      importance: c.importance || 'normal',
      decay_at: c.decay_at || prazoPadrao(c.memory_type, agora),
      occurred_on: diaConversa,
      evidence: c.evidence ? String(c.evidence).slice(0, EVIDENCE_MAX) : null,
      source: `dream:${diaRodada}`,
      is_active: defaultsPorTipo(c.memory_type).is_active,
      approved_at: null,
      ...(embedding ? { embedding } : {}),
    });
    if (error) { out.erro = error.message; console.error('[GroupMemory] insert err:', error.message); }
    else out.salvas++;
  }
  return out;
}

// Idempotência: o Dream pode ser re-disparado no mesmo dia (force, restart). O piso de
// mensagens já está dentro do consolidador; aqui é só o "já rodou hoje".
function deveConsolidarGrupo({ jaRodouHoje }) {
  return !jaRodouHoje;
}

// ── LEITURA (fatia 2) ─────────────────────────────────────────────────────────────────────
// Teto em caracteres porque o bloco entra em TODO prompt do grupo. O buffer velho tinha 3000;
// aqui cabe menos texto e informa mais, porque sao fatos separados em vez de resumo colado.
const TETO_BLOCO = 2500;
// Menos que isso, o bloco novo diria menos que o resumo velho. A troca e por GRUPO.
const MINIMO_PRA_TROCAR = 3;
const PESO_IMPORTANCIA = { high: 0, normal: 1, low: 2 };

// Memoria vencida (decay_at no passado) ou desativada nao entra. `context` nasce com prazo — foi
// pra isso que a coluna existe: "5 contratos agendados pra semana de 08-11/09" nao pode virar
// verdade permanente do grupo.
function memoriaViva(m, agora) {
  if (!m || m.is_active === false) return false;
  if (m.decay_at && new Date(m.decay_at).getTime() <= agora.getTime()) return false;
  return !!String(m.content || '').trim();
}

function ordenarMemorias(memorias) {
  return [...(memorias || [])].sort((a, b) => {
    const pa = PESO_IMPORTANCIA[a.importance] != null ? PESO_IMPORTANCIA[a.importance] : 1;
    const pb = PESO_IMPORTANCIA[b.importance] != null ? PESO_IMPORTANCIA[b.importance] : 1;
    if (pa !== pb) return pa - pb;
    return String(b.occurred_on || '').localeCompare(String(a.occurred_on || ''));
  });
}

// A DATA na linha nao e enfeite: sem ela, "contrato do Kaique nao sai" vira verdade sem prazo e
// o TOM repete em novembro. O buffer velho ja fez isso ("hoje e 06/08" gravado como permanente).
function linhaDeMemoria(m) {
  const d = String(m.occurred_on || '').slice(0, 10).split('-');
  const data = d.length === 3 ? `${d[2]}/${d[1]}` : null;
  const texto = String(m.content || '').trim();
  return data ? `${data} — ${texto}` : texto;
}

function montarBlocoMemoria(memorias, { agora = new Date(), teto = TETO_BLOCO } = {}) {
  const vivas = (memorias || []).filter((m) => memoriaViva(m, agora));
  if (!vivas.length) return null;
  const linhas = [];
  let tam = 0;
  for (const m of ordenarMemorias(vivas)) {
    const l = linhaDeMemoria(m);
    if (tam + l.length + 1 > teto) break; // corta pelo MENOS importante, que ja esta no fim
    linhas.push(l);
    tam += l.length + 1;
  }
  return linhas.length ? linhas.join('\n') : null;
}

function escolherMemoria({ memorias, bufferAntigo, agora = new Date(), minimo = MINIMO_PRA_TROCAR } = {}) {
  const vivas = (memorias || []).filter((m) => memoriaViva(m, agora));
  if (vivas.length < minimo) {
    return { texto: bufferAntigo || null, fonte: 'buffer', vivas: vivas.length };
  }
  const bloco = montarBlocoMemoria(vivas, { agora });
  return bloco
    ? { texto: bloco, fonte: 'group_memory', vivas: vivas.length }
    : { texto: bufferAntigo || null, fonte: 'buffer', vivas: vivas.length };
}

async function carregarMemoriasDoGrupo(supabase, groupId) {
  const { data, error } = await supabase.from('group_memory')
    .select('memory_type, content, importance, occurred_on, decay_at, is_active')
    .eq('group_id', groupId).eq('is_active', true)
    .order('occurred_on', { ascending: false }).limit(60);
  // Falha de leitura NAO pode virar "grupo sem memoria" em silencio: devolve null (nao []) pra
  // o chamador cair no buffer velho sabendo por que.
  if (error) { console.error(`[GroupMemory] leitura falhou grupo=${groupId}: ${error.message}`); return null; }
  return data || [];
}


// HTML do card: o conteudo vem de texto que a LLM extraiu de conversa real.
function esc(x) {
  return String(x == null ? '' : x)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── FATIA 3: APROVAR OU DESCARTAR LICAO ───────────────────────────────────────────────────
// Ordem DETERMINISTICA: a pessoa responde por numero ("aprova a 1 e a 3") e o numero precisa
// significar a mesma coisa entre o card e o comando. occurred_on desc, id como desempate — nunca
// created_at, que empata em lote (as 22 memorias de 03/09 nasceram no mesmo segundo).
function ordenarLicoes(licoes) {
  return [...(licoes || [])].sort((a, b) => {
    const d = String(b.occurred_on || '').localeCompare(String(a.occurred_on || ''));
    return d !== 0 ? d : String(a.id || '').localeCompare(String(b.id || ''));
  });
}

async function listarLicoesPendentes(supabase, groupId) {
  const { data, error } = await supabase.from('group_memory')
    .select('id, content, occurred_on, importance, evidence')
    .eq('group_id', groupId).eq('memory_type', 'lesson')
    .eq('is_active', false).is('approved_at', null).limit(20);
  if (error) { console.error(`[GroupMemory] listar licoes falhou grupo=${groupId}: ${error.message}`); return null; }
  return ordenarLicoes(data || []);
}

// A DECISAO fica gravada nos dois casos. Descartada tambem recebe approved_at — senao ela volta
// pra fila de pendentes amanha e a pessoa e obrigada a dizer nao pra sempre.
async function decidirLicoes(supabase, { licoes, numeros, acao }) {
  const lista = ordenarLicoes(licoes);
  const pedidos = [...new Set((numeros || []).map((n) => Number(n)).filter((n) => Number.isInteger(n)))];
  const validos = pedidos.filter((n) => n >= 1 && n <= lista.length);
  const foraDaLista = pedidos.filter((n) => !validos.includes(n));
  const alvos = validos.map((n) => lista[n - 1]);
  const agora = new Date().toISOString();
  const feitos = [];
  for (const l of alvos) {
    const { error } = await supabase.from('group_memory')
      .update({ is_active: acao === 'aprovar', approved_at: agora }).eq('id', l.id);
    // Erro de update NAO pode virar sucesso silencioso: quem le o card precisa ver o que de fato
    // mudou, nao o que eu pedi pra mudar.
    if (error) console.error(`[GroupMemory] decidir licao ${l.id} falhou: ${error.message}`);
    else feitos.push(l);
  }
  return { feitos, foraDaLista, total: lista.length };
}

function renderLicoesPendentes(licoes, { grupoNome } = {}) {
  const lista = ordenarLicoes(licoes);
  if (!lista.length) return `<h3>📚 ${esc(grupoNome || 'Este grupo')}</h3><p>Nenhuma lição esperando aprovação.</p>`;
  const itens = lista.map((l, i) => {
    const d = String(l.occurred_on || '').slice(0, 10).split('-');
    const data = d.length === 3 ? `${d[2]}/${d[1]}` : '';
    return `<li><b>${i + 1}.</b> ${esc(String(l.content || '').trim())}${data ? ` <i>(${data})</i>` : ''}</li>`;
  }).join('');
  const plural = lista.length === 1 ? 'lição aprendida esperando' : 'lições aprendidas esperando';
  return `<h3>📚 ${esc(grupoNome || 'Este grupo')}</h3>`
    + `<p><b>${lista.length}</b> ${plural} seu ok — só passam a valer depois que alguém aprovar:</p>`
    + `<ul>${itens}</ul>`
    + '<p><i>Responda "aprova a 1 e a 3" ou "descarta a 2".</i></p>';
}

function renderDecisao({ feitos, foraDaLista, acao }) {
  const verbo = acao === 'aprovar' ? 'Aprovada' : 'Descartada';
  const verboP = acao === 'aprovar' ? 'Aprovadas' : 'Descartadas';
  if (!feitos.length) {
    return `<p>Não consegui aplicar nada${foraDaLista.length ? ` — ${foraDaLista.join(', ')} não está na lista` : ''}.</p>`;
  }
  const itens = feitos.map((l) => `<li>${esc(String(l.content || '').trim())}</li>`).join('');
  const sobra = foraDaLista.length ? `<p><i>Ignorei ${foraDaLista.join(', ')} — fora da lista.</i></p>` : '';
  // Mostra o TEXTO do que foi decidido, nao o numero: se a numeracao tiver escorregado, a pessoa
  // ve na hora que aprovou outra coisa.
  return `<p>${feitos.length === 1 ? verbo : `${verboP} (${feitos.length})`}:</p><ul>${itens}</ul>${sobra}`;
}

module.exports = {
  montarHistorico, extrairMemoriaDeGrupo, consolidateGroupMemoryFor, deveConsolidarGrupo,
  materialDeConsolidacao, origemDaEvidencia, prazoPadrao, DECAY_PADRAO_CONTEXT_DIAS,
  ordenarLicoes, listarLicoesPendentes, decidirLicoes, renderLicoesPendentes, renderDecisao,
  JANELA_HORAS, TETO_POR_NOITE,
  TETO_BLOCO, MINIMO_PRA_TROCAR, memoriaViva, ordenarMemorias, linhaDeMemoria,
  montarBlocoMemoria, escolherMemoria, carregarMemoriasDoGrupo,
};
