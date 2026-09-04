'use strict';
// group-memory.js — o TOM guarda o que o GRUPO conversou.
//
// Por que existe: a memória semântica do TOM (collaborator_memory + Dream das 3h) sempre teve
// sujeito PESSOA. O Dream JÁ percorre os grupos no mesmo laço, mas só chama o auditor — ele
// julga o grupo e não guarda nada dele. Esta é a metade que faltava.
//
// Fatia 1: só ESCREVE. Nada aqui entra no prompt — ler é a Fatia 2, depois de o Alf conferir
// o que foi guardado.

const { prepararCandidatas, looksLikeMemory } = require('./agent-memory');

// ── ESCOPO: O QUE É DO GRUPO E O QUE É DO TOM ──────────────────────────────────────────────
// MEDIDO em 04/09: a regra "chame a pessoa pelo nome, não com @" estava aprovada e ativa como
// `lesson` em ADM CG e, com outra redação, em Administração Recreio — e ia nascer uma TERCEIRA
// na Barra naquela noite. O dono ensinava a mesma coisa em cada grupo porque `group_memory` só
// tem `group_id` e `carregarMemoriasDoGrupo` lia só o grupo corrente.
//
// A distinção que resolve: uma lição sobre COMO O TOM SE COMPORTA (como fala, como trata as
// pessoas, o que nunca faz) vale em todo lugar — ele é uma pessoa só. Uma memória de CONTEXTO
// LOCAL ("o Arthur cuida da matrícula na Barra") é do grupo por natureza.
//
// QUEM PROMOVE É A PESSOA, NUNCA A LLM (ver `pediuPraTodosOsGrupos`): um erro de classificação
// da LLM contaminaria todos os grupos de uma vez, e esse é o dano que não pode existir.
// O default é 'group', então o dia em que a migration subir nada muda de comportamento.
const ESCOPO_GRUPO = 'group';
const ESCOPO_TOM = 'tom';

// A coluna `scope` chega por migration, e a migration é escrita de schema em produção — ou
// seja, o código sobe ANTES dela. Sem esta volta atrás, toda consulta que cita `scope` erraria
// 42703, o reader devolveria null e TODO grupo perderia a memória de uma vez só por deploy.
function colunaScopeAusente(error) {
  if (!error) return false;
  if (error.code === '42703') return true;
  const msg = String(error.message || '');
  return /scope/i.test(msg) && /does not exist|n[aã]o existe/i.test(msg);
}

// Ausência de `scope` lê como local — que é exatamente o default da migration. Assim a mesma
// função serve antes e depois de a coluna existir.
function ehGlobal(m) { return !!m && m.scope === ESCOPO_TOM; }

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

// ── QUEM ENTRA SOZINHO, QUEM ESPERA O OK ───────────────────────────────────────────────────
// MEDIDO em 04/09 (35 linhas em `group_memory`): 23 estavam ATIVAS sem ninguém ter olhado —
// 14 `fact`, 4 `context`, 3 `preference`, 2 `decision`. Só `lesson` nascia inativa.
//
// Gateei `fact` e `preference`, e a razão de cada um é medida, não estética:
//  - `preference` já tinha CONTRABANDEADO uma regra de comportamento pro prompt: a linha "Tom é
//    acionado apenas quando chamado pelo nome" (grupo Sucesso do Aluno) é a MESMA regra que
//    existe como `lesson` APROVADA em outros dois grupos — só que essa entrou sozinha, sem
//    ninguém aprovar. O tipo muda; o efeito no comportamento do TOM, não.
//  - `fact` é onde a confabulação de 04/09 ia parar (o TOM inventando por que ficou mudo) e é o
//    tipo com mais linhas ativas sem revisão: 14 de 15.
// `decision` e `context` seguem entrando sozinhos: `decision` é registro datado do que o time
// combinou (2 linhas em três dias) e `context` morre em 30 dias pelo backstop acima. Gatear os
// quatro só encheria a fila — e fila que ninguém dá conta de aprovar também mata o aprendizado.
//
// VOLUME medido antes de decidir: numa noite normal (04/09) nasceram 4 fact + 0 preference em
// SEIS grupos; em 02/09, 2. A fila cresce ~2-4 itens por noite no total, menos de um por grupo.
// (03/09 teve 12, mas foi a noite que varreu o acervo inteiro pela primeira vez.)
//
// Isto vale só pro que NASCER: nenhuma das 23 linhas já ativas é tocada. Reversível numa linha.
//
// Fica aqui, e não em `agent-memory.defaultsPorTipo`, de propósito: aquele módulo serve também o
// sujeito PESSOA (`collaborator_memory`), que NÃO tem fila de aprovação. Gatear lá criaria
// memória inaprovável no outro sujeito — o buraco negro que esta mesma fatia evitou em 04/09.
const TIPOS_QUE_ESPERAM_APROVACAO = new Set(['lesson', 'fact', 'preference']);
function defaultsPorTipoDoGrupo(memoryType) {
  return { is_active: !TIPOS_QUE_ESPERAM_APROVACAO.has(memoryType) };
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

  // As GLOBAIS entram no "o que já está guardado". Sem isso o grupo reaprende toda noite uma
  // regra que já vale pra ele — foi assim que a mesma regra do vocativo nasceu em dois grupos.
  // MEDIDO, e é honesto dizer: o dedup determinístico (`looksLikeMemory`, Jaccard >= 0.6) NÃO
  // pega paráfrase — as duas cópias reais da regra do vocativo dão `false` entre si. Quem de
  // fato segura a re-criação é o prompt do extrator, que recebe esta lista e é mandado não
  // repetir. Por isso a linha vale: o ganho está no `jaSei`, não no filtro.
  let { data: exist, error: errExist } = await supabase.from('group_memory')
    .select('content, memory_type, importance, scope')
    .or(`group_id.eq.${group.id},scope.eq.${ESCOPO_TOM}`).eq('is_active', true);
  if (errExist && colunaScopeAusente(errExist)) {
    ({ data: exist } = await supabase.from('group_memory')
      .select('content, memory_type, importance').eq('group_id', group.id).eq('is_active', true));
  }
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
      is_active: defaultsPorTipoDoGrupo(c.memory_type).is_active,
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

// Teto PRÓPRIO pro bloco de comportamento: essas linhas entram no prompt de TODO grupo. Sem um
// teto separado, um acúmulo de regras globais comeria o espaço da memória local de todos os
// grupos de uma vez.
const TETO_BLOCO_TOM = 1200;

// SEM DATA, de propósito. "03/09 — chame a pessoa pelo nome" lê como evento daquele dia; regra
// de comportamento não tem data, ela vale enquanto ninguém desaprovar. É a mesma doença de
// datar o que não tem data que fez o buffer velho gravar "hoje é 06/08" como permanente.
function montarBlocoComportamento(memorias, { agora = new Date(), teto = TETO_BLOCO_TOM } = {}) {
  const vivas = (memorias || []).filter((m) => ehGlobal(m) && memoriaViva(m, agora));
  if (!vivas.length) return null;
  const linhas = [];
  let tam = 0;
  for (const m of ordenarMemorias(vivas)) {
    const l = `• ${String(m.content || '').trim()}`;
    if (tam + l.length + 1 > teto) break; // corta pelo MENOS importante, que ja esta no fim
    linhas.push(l);
    tam += l.length + 1;
  }
  return linhas.length ? linhas.join('\n') : null;
}

function escolherMemoria({ memorias, bufferAntigo, agora = new Date(), minimo = MINIMO_PRA_TROCAR } = {}) {
  const vivas = (memorias || []).filter((m) => memoriaViva(m, agora));
  const locais = vivas.filter((m) => !ehGlobal(m));
  const globais = vivas.filter(ehGlobal);

  // O PISO conta só as LOCAIS. Ele responde "este grupo já tem memória PRÓPRIA suficiente pra
  // aposentar o resumo rolante?" — e uma regra de comportamento do TOM não diz nada sobre isso.
  // Se as globais contassem, um grupo novo largaria o buffer no dia em que a migration subisse.
  const bloco = locais.length >= minimo ? montarBlocoMemoria(locais, { agora }) : null;

  // As globais saem SEPARADAS e SEMPRE, nos dois caminhos. Se elas só viessem de carona no
  // bloco local, o grupo QUIETO — o que mais precisa da regra, porque nunca a aprendeu — seria
  // justamente o único a não recebê-la.
  const comportamento = montarBlocoComportamento(globais, { agora });

  return bloco
    ? { texto: bloco, fonte: 'group_memory', vivas: locais.length, globais: globais.length, comportamento }
    : { texto: bufferAntigo || null, fonte: 'buffer', vivas: locais.length, globais: globais.length, comportamento };
}

const COLUNAS_DE_LEITURA = 'memory_type, content, importance, occurred_on, decay_at, is_active';

async function carregarMemoriasDoGrupo(supabase, groupId) {
  // A memória DESTE grupo mais as regras que valem em TODOS. É a linha que faz a lição
  // atravessar: o que foi aprovado "pra todos os grupos" chega aqui sem ninguém reensinar.
  let { data, error } = await supabase.from('group_memory')
    .select(`${COLUNAS_DE_LEITURA}, scope`)
    .or(`group_id.eq.${groupId},scope.eq.${ESCOPO_TOM}`).eq('is_active', true)
    .order('occurred_on', { ascending: false }).limit(60);

  if (error && colunaScopeAusente(error)) {
    // Migration ainda não aplicada. Volta à consulta de antes: o grupo segue com a memória dele
    // e ninguém perde nada — o deploy do código não pode derrubar a memória de todo mundo.
    console.warn('[GroupMemory] coluna scope ausente — lendo so a memoria local (falta aplicar a migration do escopo)');
    ({ data, error } = await supabase.from('group_memory')
      .select(COLUNAS_DE_LEITURA)
      .eq('group_id', groupId).eq('is_active', true)
      .order('occurred_on', { ascending: false }).limit(60));
  }
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

// ── FATIA 3: APROVAR OU DESCARTAR O QUE ESTA ESPERANDO ────────────────────────────────────
// A fila deixou de ser so de `lesson`. MEDIDO em 04/09: `listarLicoesPendentes` filtrava
// `.eq('memory_type','lesson')`, entao gatear qualquer outro tipo criava memoria que NINGUEM
// conseguia aprovar — gate sem fila e buraco negro, pior que o estado de antes. Fila primeiro,
// gate junto: as duas coisas sobem no mesmo commit, de proposito.
const ROTULO_DO_TIPO = {
  lesson: 'lição', fact: 'fato', preference: 'preferência', decision: 'decisão', context: 'contexto',
};

// Ordem DETERMINISTICA: a pessoa responde por numero ("aprova a 1 e a 3") e o numero precisa
// significar a mesma coisa entre o card e o comando. `lesson` primeiro porque e o que ela quer
// ver antes — mas card e comando usam ESTE MESMO comparador, senao ela aprova outra coisa.
// Depois occurred_on desc, id como desempate — nunca created_at, que empata em lote (as 22
// memorias de 03/09 nasceram no mesmo segundo).
function ordenarPendentes(pendentes) {
  const peso = (m) => (m && m.memory_type === 'lesson' ? 0 : 1);
  return [...(pendentes || [])].sort((a, b) => {
    const pt = peso(a) - peso(b);
    if (pt !== 0) return pt;
    const d = String(b.occurred_on || '').localeCompare(String(a.occurred_on || ''));
    return d !== 0 ? d : String(a.id || '').localeCompare(String(b.id || ''));
  });
}

// Sem `.eq('memory_type', ...)`: a fila e "tudo que nasceu inativo e ninguem decidiu ainda".
// Se um tipo novo passar a ser gateado amanha, ele aparece aqui sem ninguem lembrar de mexer.
async function listarMemoriasPendentes(supabase, groupId) {
  const { data, error } = await supabase.from('group_memory')
    .select('id, content, memory_type, occurred_on, importance, evidence')
    .eq('group_id', groupId)
    .eq('is_active', false).is('approved_at', null).limit(20);
  if (error) { console.error(`[GroupMemory] listar pendentes falhou grupo=${groupId}: ${error.message}`); return null; }
  return ordenarPendentes(data || []);
}

// ── A PROMOCAO E DA PESSOA, NUNCA DA LLM ──────────────────────────────────────────────────
// O marker traz o escopo, mas ele SOZINHO nao promove: a frase de quem pediu tem que dizer, em
// portugues, que e pra todos os grupos. Se a LLM alucinar `escopo:"tom"` num pedido comum, isto
// barra — erro dela contaminaria TODO grupo de uma vez, e esse e o dano que nao pode existir.
// Conferencia em CODIGO, nao no prompt: instrucao se burla, corte deterministico nao.
function pediuPraTodosOsGrupos(texto) {
  const t = normalizarFala(texto); // ja tira acento, minusculiza e colapsa espaco
  if (!t) return false;
  return /\btodos os grupos\b/.test(t)
    || /\btodos grupos\b/.test(t)
    || /\btodo grupo\b/.test(t)
    || /\bqualquer grupo\b/.test(t)
    || /\bem todos\b/.test(t)
    || /\bpra todos\b/.test(t)
    || /\bpara todos\b/.test(t)
    || /\bem todo lugar\b/.test(t);
}

// A DECISAO fica gravada nos dois casos. Descartada tambem recebe approved_at — senao ela volta
// pra fila de pendentes amanha e a pessoa e obrigada a dizer nao pra sempre.
async function decidirMemorias(supabase, { pendentes, numeros, acao, escopo = ESCOPO_GRUPO }) {
  const lista = ordenarPendentes(pendentes);
  const pedidos = [...new Set((numeros || []).map((n) => Number(n)).filter((n) => Number.isInteger(n)))];
  const validos = pedidos.filter((n) => n >= 1 && n <= lista.length);
  const foraDaLista = pedidos.filter((n) => !validos.includes(n));
  const alvos = validos.map((n) => lista[n - 1]);
  const agora = new Date().toISOString();
  const feitos = [];
  // So APROVAR promove. Descartar e ato local: desligar aqui nao pode desligar em todo lugar.
  const promover = acao === 'aprovar' && escopo === ESCOPO_TOM;
  let escopoAplicado = promover ? ESCOPO_TOM : ESCOPO_GRUPO;

  for (const l of alvos) {
    const patch = { is_active: acao === 'aprovar', approved_at: agora };
    let error = null;
    if (promover) {
      ({ error } = await supabase.from('group_memory').update({ ...patch, scope: ESCOPO_TOM }).eq('id', l.id));
      if (error && colunaScopeAusente(error)) {
        // Antes da migration "pra todos os grupos" nao tem como ser honrado. Aprovar SO AQUI e
        // melhor que nao aprovar nada — mas quem pediu "pra todos" PRECISA ler que nao foi pra
        // todos. Sucesso silencioso aqui seria mentira sobre o alcance de uma regra.
        console.warn('[GroupMemory] promocao pedida sem a coluna scope — aprovando so no grupo');
        escopoAplicado = ESCOPO_GRUPO;
        ({ error } = await supabase.from('group_memory').update(patch).eq('id', l.id));
      }
    } else {
      ({ error } = await supabase.from('group_memory').update(patch).eq('id', l.id));
    }
    // Erro de update NAO pode virar sucesso silencioso: quem le o card precisa ver o que de fato
    // mudou, nao o que eu pedi pra mudar.
    if (error) console.error(`[GroupMemory] decidir memoria ${l.id} falhou: ${error.message}`);
    else feitos.push(l);
  }
  return { feitos, foraDaLista, total: lista.length, escopo, escopoAplicado };
}

function renderMemoriasPendentes(pendentes, { grupoNome } = {}) {
  const lista = ordenarPendentes(pendentes);
  if (!lista.length) return `<h3>📚 ${esc(grupoNome || 'Este grupo')}</h3><p>Nenhuma memória esperando aprovação.</p>`;
  const itens = lista.map((l, i) => {
    const d = String(l.occurred_on || '').slice(0, 10).split('-');
    const data = d.length === 3 ? `${d[2]}/${d[1]}` : '';
    // O TIPO na etiqueta porque a fila deixou de ser homogenea: aprovar uma "lição" e aprovar um
    // "fato" tem peso diferente, e quem decide precisa ver qual dos dois esta olhando.
    const rotulo = ROTULO_DO_TIPO[l.memory_type] || '';
    const etiqueta = [rotulo, data].filter(Boolean).join(' · ');
    return `<li><b>${i + 1}.</b> ${esc(String(l.content || '').trim())}${etiqueta ? ` <i>(${etiqueta})</i>` : ''}</li>`;
  }).join('');
  const soLicoes = lista.every((l) => !l.memory_type || l.memory_type === 'lesson');
  const plural = soLicoes
    ? (lista.length === 1 ? 'lição aprendida esperando' : 'lições aprendidas esperando')
    : (lista.length === 1 ? 'memória esperando' : 'memórias esperando');
  return `<h3>📚 ${esc(grupoNome || 'Este grupo')}</h3>`
    + `<p><b>${lista.length}</b> ${plural} seu ok — só passam a valer depois que alguém aprovar:</p>`
    + `<ul>${itens}</ul>`
    // O verbo da promocao mora no card: sem ele ninguem descobre que da pra aprovar pra todo
    // lugar, e a regra continua sendo reensinada grupo a grupo.
    + '<p><i>Responda "aprova a 1 e a 3" ou "descarta a 2". Se a regra vale em qualquer grupo — '
    + 'jeito de falar, como tratar as pessoas — diga "aprova a 1 pra todos os grupos".</i></p>';
}

function renderDecisao({ feitos, foraDaLista, acao, escopoAplicado, motivo } = {}) {
  const verbo = acao === 'aprovar' ? 'Aprovada' : 'Descartada';
  const verboP = acao === 'aprovar' ? 'Aprovadas' : 'Descartadas';
  if (!feitos.length) {
    return `<p>Não consegui aplicar nada${foraDaLista.length ? ` — ${foraDaLista.join(', ')} não está na lista` : ''}.</p>`;
  }
  const itens = feitos.map((l) => `<li>${esc(String(l.content || '').trim())}</li>`).join('');
  const sobra = foraDaLista.length ? `<p><i>Ignorei ${foraDaLista.join(', ')} — fora da lista.</i></p>` : '';
  // O ALCANCE se declara. Nem "promovi" calado, nem "nao promovi" calado: quem pediu pra todos
  // os grupos tem que ler, no card, se foi pra todos ou so pra este.
  let alcance = '';
  if (escopoAplicado === ESCOPO_TOM) {
    alcance = '<p><b>Passa a valer em todos os grupos</b> — não precisa ensinar de novo em cada um.</p>';
  } else if (motivo === 'sem_frase') {
    alcance = '<p><i>Vale só neste grupo. Pra valer em todos os grupos, peça com todas as letras: '
      + '"aprova a 1 pra todos os grupos".</i></p>';
  } else if (motivo === 'sem_coluna') {
    alcance = '<p><i>Aprovei só neste grupo: a promoção pra todos os grupos ainda não está no banco '
      + '(falta aplicar a migration do escopo).</i></p>';
  }
  // Mostra o TEXTO do que foi decidido, nao o numero: se a numeracao tiver escorregado, a pessoa
  // ve na hora que aprovou outra coisa.
  return `<p>${feitos.length === 1 ? verbo : `${verboP} (${feitos.length})`}:</p><ul>${itens}</ul>${alcance}${sobra}`;
}

module.exports = {
  montarHistorico, extrairMemoriaDeGrupo, consolidateGroupMemoryFor, deveConsolidarGrupo,
  materialDeConsolidacao, origemDaEvidencia, prazoPadrao, DECAY_PADRAO_CONTEXT_DIAS,
  ordenarPendentes, listarMemoriasPendentes, decidirMemorias, renderMemoriasPendentes, renderDecisao,
  defaultsPorTipoDoGrupo, TIPOS_QUE_ESPERAM_APROVACAO, ROTULO_DO_TIPO,
  JANELA_HORAS, TETO_POR_NOITE,
  TETO_BLOCO, MINIMO_PRA_TROCAR, memoriaViva, ordenarMemorias, linhaDeMemoria,
  montarBlocoMemoria, escolherMemoria, carregarMemoriasDoGrupo,
  ESCOPO_GRUPO, ESCOPO_TOM, ehGlobal, colunaScopeAusente, montarBlocoComportamento,
  pediuPraTodosOsGrupos, TETO_BLOCO_TOM,
};
