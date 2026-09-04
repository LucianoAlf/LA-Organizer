'use strict';
// Ritual da pauta de anamnese. Orquestra e mais nada: quem decide é src/services/anamnese-pauta
// (puro) e src/services/anamnese-pauta-repo (banco). Aqui só busca, decide o dia, monta o
// pacote e devolve o relatório do que aconteceu — falha fechada em cada ponto que pode mentir.
// Ver docs/superpowers/specs/2026-09-03-pauta-de-anamnese-design.md.

const situ = require('../services/situacao-aluno');
const pura = require('../services/anamnese-pauta');
const repoPadrao = require('../services/anamnese-pauta-repo');

// O pico medido em 03/09 foi 80 (Campo Grande, terça), 759 alunos sem anamnese nas três
// unidades no total. 120 não é pra caber no normal — é pra GRITAR se a base ou a conta mudar.
// Doze filhas de quarenta e três é pior que zero (o time confia na lista e 31 passam batido);
// acima do teto o raciocínio é o mesmo, só que na ponta de cima.
const TETO_FILHAS = 120;

// `hoje` chega em "YYYY-MM-DD", já no dia certo em BRT (é o formato de nowSaoPaulo().ymd).
// Quebramos a string em dígitos e construímos a data em UTC EXPLÍCITO com Date.UTC + getUTCDay.
// NUNCA `new Date(hoje).getDay()`: essa forma faz o motor ler "YYYY-MM-DD" como MEIA-NOITE UTC
// e depois devolver o dia da semana em hora LOCAL DO PROCESSO. Numa VPS rodando em UTC os dois
// coincidem por sorte; no dia em que alguém setar TZ=America/Sao_Paulo, aquela mesma meia-noite
// UTC vira 21h do dia ANTERIOR e a pauta inteira sai um dia adiantada — em silêncio, sem
// exception nenhuma pra avisar (known issue desta casa: LOCALYMD-UTC-SHIFT). getUTCDay() sobre
// Date.UTC() nunca lê hora local, então é imune ao fuso do processo que roda o código.
function _diaSemanaBrt(hoje) {
  const [y, m, d] = String(hoje || '').split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Título do CONTAINER da pauta do dia. Ponto ÚNICO de verdade: é chamado tanto pra CONSULTAR se
// já existe (guarda de duplicata, abaixo) quanto pra CRIAR. Se cada lado montasse o texto
// inline, os dois poderiam divergir por um espaço ou um emoji e a guarda ficaria cega pro
// próprio container — o bug de duplicata a cada retry do cron voltaria calado.
function _tituloDoContainer(hoje) {
  const [, mesStr, diaStr] = String(hoje || '').split('-');
  return `📋 Anamnese — quem tem aula hoje · ${diaStr}/${mesStr}`;
}

// Já existe container da pauta pra este (groupId, hoje)? Por quê isto existe: createTaskGroup
// (task-groups.js) insere linha a linha SEM transação. Com 43-80 filhas, um insert que falhe no
// meio deixa mãe + filhas 1..N-1 JÁ COMMITADAS e a função lança — esse throw, sem esta guarda,
// subiria até o catch genérico do dispatcher, que loga e NÃO grava marcador (o insert do
// marcador vem depois desta chamada). O cron de 5 min bate de novo, não acha marcador, e monta
// tudo outra vez: meio-container antigo + container inteiro novo no painel da unidade. A spec
// quer a retentativa — bloqueá-la seria errado. O que tem que mudar é a retentativa SER segura:
// por isso checamos aqui antes de criar de novo, e não desfazemos containers antigos.
async function _pacoteJaExiste(supabase, { groupId, hoje, titulo }) {
  const { data, error } = await supabase.from('tasks').select('id')
    .eq('assigned_group_id', groupId).eq('due_date', hoje)
    .eq('is_group', true).eq('title', titulo).limit(1);
  if (error) return { existe: null, erro: error.message };
  return { existe: (data || []).length > 0, erro: null };
}

async function montarPautaDaUnidade({ supabase, laReport, unidadeId, groupId, criadoPor, hoje, deps = {} }) {
  const repo = deps.repo || repoPadrao;
  const pacoteExiste = deps.pacoteExiste || _pacoteJaExiste;
  const criarPacote = deps.criarPacote
    || ((arg) => require('../services/task-groups').createTaskGroup(arg));

  const diaSemana = _diaSemanaBrt(hoje);
  // Guarda barata (apontada na revisão da Task 2): diaDaAula() devolve `null` pra aula sem dia
  // reconhecível no texto do resumo. Se diaSemana chegasse `null`/`NaN` em pautaDoDia, a
  // comparação `diaDaAula(a) === diaSemana` casaria (null === null) com QUALQUER aula torta e
  // inflaria a pauta com gente que não tem aula nenhuma hoje. Falha fechada em vez de confiar
  // cegamente que _diaSemanaBrt sempre devolve um inteiro 0–6. Checada ANTES de tudo: um `hoje`
  // torto não deveria nem chegar perto de montar título ou consultar duplicata.
  if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
    return { criou: false, total: 0, escalados: 0, motivo: `dia da semana inválido para hoje="${hoje}"`, itens: [] };
  }

  // FALHA-FECHADA #0 (retentativa segura): container pra este (groupId, hoje) já existe? Checa
  // ANTES da RPC do LA Report (que leva 6-8s, ver situacao-aluno.js) — barato, e evita bater a
  // consulta lenta de novo num retry cujo resultado vai ser descartado de qualquer jeito.
  const titulo = _tituloDoContainer(hoje);
  const checagem = await pacoteExiste(supabase, { groupId, hoje, titulo });
  if (checagem.erro) {
    // Não dá pra afirmar que NÃO existe container quando a leitura falhou — "não sei" nunca
    // pode virar "não tem", ou criaríamos um duplicado no escuro. Sensor próprio: este motivo
    // nunca é igual ao de "já existe" (abaixo) nem ao de erro de RPC.
    return {
      criou: false, total: 0, escalados: 0, itens: [],
      motivo: `não consegui checar se a pauta já existe: ${checagem.erro}`,
    };
  }
  if (checagem.existe) {
    // Sensor próprio: "não criei porque já tinha" tem que ser TEXTUALMENTE diferente de "não
    // criei porque falhou" (RPC, teto, escrita) — senão quem lê o resultado não distingue os
    // casos, que é exatamente o problema que motivou esta rodada de correção.
    return { criou: false, total: 0, escalados: 0, motivo: 'pauta já montada hoje', itens: [] };
  }

  // Sempre checar `error`: consulta com coluna errada devolve {data:null,error} e viraria
  // "zero linhas" silencioso (já custou dois diagnósticos errados nesta casa em 03/09).
  const { data, error } = await laReport.rpc('get_situacao_alunos_v1',
    { p_unidade_id: unidadeId, p_apenas_pendentes: false });
  if (error) {
    // FALHA-FECHADA #1: RPC não respondeu → não cria NADA. Motivo tem sensor próprio (menciona
    // a consulta/o erro) pra nunca sair idêntico ao motivo de "pauta vazia por saúde".
    return { criou: false, total: 0, escalados: 0, motivo: `consulta do LA Report falhou: ${error.message}`, itens: [] };
  }

  // Fonte ÚNICA de "sem anamnese" — se a pauta reimplementasse o filtro, um dia o card diria
  // 225 e a pauta 231, e ninguém confiaria em nenhum dos dois.
  const semAnamnese = situ.filtrarPorRecorte(data || [], 'anamnese');
  const itens = pura.pautaDoDia(semAnamnese, diaSemana);
  if (!itens.length) {
    // Pauta vazia por SAÚDE (ninguém sem anamnese tem aula hoje) — motivo null, nunca uma
    // string de erro. É o sensor que distingue "zero por falha" de "zero por saúde".
    return { criou: false, total: 0, escalados: 0, motivo: null, itens: [] };
  }

  if (itens.length > TETO_FILHAS) {
    // FALHA-FECHADA #2: acima do teto de sanidade → não cria NADA. `total` carrega o tamanho
    // real (útil pra diagnosticar), mas `motivo` menciona "teto" — sensor próprio, nunca
    // idêntico ao motivo de erro de RPC nem ao de pauta vazia (que é null).
    return {
      criou: false, total: itens.length, escalados: 0, itens: [],
      motivo: `teto de sanidade: ${itens.length} alunos (máximo ${TETO_FILHAS}) — não montei a pauta`,
    };
  }

  // Falhas de HISTÓRICO (antes de registrar a aparição de hoje) decidem quem escala.
  // `mapa` pode vir `null` quando a leitura falhar — repassamos pro puro exatamente como veio:
  // separarPorDegrau já trata `null` como "ninguém escala" (nunca escalar no escuro). Trocar
  // por `new Map()` aqui anularia essa trava e faria a casa escalar gente sem prova de falha.
  const mapa = await repo.contarFalhas(supabase, { unidadeId, pessoas: itens.map((i) => i.pessoa.pessoa_chave) });
  const { pauta, escalados } = pura.separarPorDegrau(itens, mapa);

  // Chamada que ESCREVE não pode explodir pra fora: um throw aqui subiria até o catch genérico
  // do dispatcher, que loga e não grava marcador (o insert do marcador vem DEPOIS desta
  // chamada) — o cron de 5 min bateria de novo, cairia na guarda de duplicata acima (que ainda
  // não veria nada criado, pois nada foi) e tentaria tudo de novo. Isso já é seguro por causa da
  // guarda #0; mesmo assim devolvemos o motivo real em vez de deixar a exception subir crua e
  // quebrar o contrato de retorno documentado ({criou,total,escalados,motivo,itens}).
  try {
    await repo.registrarAparicoes(supabase, {
      unidadeId, dia: hoje, pessoas: itens.map((i) => i.pessoa.pessoa_chave),
    });
  } catch (e) {
    return {
      criou: false, total: pauta.length, escalados: escalados.length, itens: [],
      motivo: `falha ao registrar aparições de hoje: ${(e && e.message) || String(e)}`,
    };
  }

  try {
    // createTaskGroup (task-groups.js:62-93) insere linha a linha, SEM transação — com 43-80
    // filhas, um insert que falhe no meio deixa mãe+filhas parciais já commitadas e lança. A
    // guarda #0 no topo desta função é quem torna o PRÓXIMO retry seguro (não duplica o
    // meio-container órfão que este catch não desfaz e não tenta desfazer); consertar a criação
    // em si pra ser atômica é cirurgia de outro dia em task-groups.js — fora do escopo aqui.
    await criarPacote({
      supabase, groupId, createdBy: criadoPor,
      input: {
        title: titulo,
        recurrence: null,
        groupDueDate: hoje,
        subtasks: pauta.map((i) => ({ title: pura.tituloDaFilha(i, i.falhas), dueDate: hoje })),
      },
    });
  } catch (e) {
    return {
      criou: false, total: pauta.length, escalados: escalados.length, itens: [],
      motivo: `falha ao criar o pacote de tarefas: ${(e && e.message) || String(e)}`,
    };
  }

  return {
    criou: true, total: pauta.length, escalados: escalados.length, motivo: null,
    itens: pauta, escaladosItens: escalados,
  };
}

// ── FECHAMENTO DO RECADO DO DIA (filhas + container) ────────────────────────────────────────
// Correção 1/5 (Alf, 04/09): o plano original só previa gravar em anamnese_pauta — perdeu dois
// passos da spec (4.3). A pauta do dia é DESCARTÁVEL por desenho — quem persiste é a RPC, via
// anamnese_pauta acima. As filhas na tela são só o RECADO do dia; sem fechar, cada unidade
// acumula 43-80 tarefas ABERTAS por dia, pra sempre (em uma semana, ~950 nos três painéis).
// O NOME no título não é chave (uma unidade tem dezenas de "Maria") — por isso o fechamento por
// nome é cauteloso (nunca marca `done` sem certeza) e a VERDADE da escada mora em
// anamnese_pauta, com pessoa_chave, não aqui. Ninguém deveria "consertar" isto depois achando
// que dá pra confiar no nome como chave.

// Tira acento por FAIXA DE CÓDIGO (0x0300-0x036f = marcas de combinação Unicode), não por
// classe de regex com caractere literal — caractere de combinação colado numa regex é frágil
// atravessando qualquer transporte de texto (o mesmo tipo de corrupção descrita pra heredoc).
function _normalizarNome(s) {
  return String(s || '').normalize('NFD')
    .split('').filter((ch) => { const c = ch.codePointAt(0); return c < 0x0300 || c > 0x036f; }).join('')
    .toLowerCase().trim();
}

// Título da filha (pura.tituloDaFilha): "HH:MM Anamnese — Nome" + opcional " (Curso)" e/ou
// " ⚠️ 2ª semana...". Corta no primeiro dos dois marcadores, o que vier antes — sobra só o nome.
function _extrairNomeDaFilha(titulo) {
  const m = /^\d{1,2}:\d{2} Anamnese — (.+)$/.exec(String(titulo || ''));
  if (!m) return null; // formato inesperado — não arrisca adivinhar
  const resto = m[1];
  const marcas = [' (', ' ⚠'].map((marca) => resto.indexOf(marca)).filter((i) => i !== -1);
  const nome = marcas.length ? resto.slice(0, Math.min(...marcas)) : resto;
  return nome.trim() || null;
}

// nome normalizado → quantas pessoas daquele conjunto têm esse nome. Mesmo formato pros dois
// conjuntos que _decidirFechoDaFilha compara (sem-anamnese e universo completo).
function _mapaPorNome(pessoas) {
  const m = new Map();
  for (const p of (pessoas || [])) {
    const chave = _normalizarNome(p && p.nome);
    if (chave) m.set(chave, (m.get(chave) || 0) + 1);
  }
  return m;
}

// Decide o fecho de UMA filha. `semAnamnesePorNome` é o conjunto que decide o resultado;
// `todosPorNome` só existe pra distinguir "preencheu" (não está mais pendente, mas a pessoa
// existe na base de hoje) de "sem correspondência" (não achei esse nome em lugar nenhum — pode
// ser um bug de parsing do título; nunca vira `done` no escuro).
function _decidirFechoDaFilha(tituloFilha, semAnamnesePorNome, todosPorNome) {
  const nome = _extrairNomeDaFilha(tituloFilha);
  if (!nome) return { status: 'cancelled', notes: 'não consegui extrair o nome do título da filha' };
  const chave = _normalizarNome(nome);
  const pendentes = semAnamnesePorNome.get(chave) || 0;
  if (pendentes >= 2) {
    return { status: 'cancelled', notes: `nome ambíguo: ${pendentes} pessoas ainda sem anamnese com o nome "${nome}"` };
  }
  if (pendentes === 1) return { status: 'cancelled', notes: null }; // não preencheu — caminho normal
  const totais = todosPorNome.get(chave) || 0;
  if (totais >= 1) return { status: 'done', notes: null }; // não está mais entre os pendentes
  return { status: 'cancelled', notes: `sem correspondência: "${nome}" não encontrado na base de hoje` };
}

// Mesma query da guarda de duplicata da manhã (_pacoteJaExiste, MESMO título — nunca reconstruir
// a string), mas devolvendo o id: a noite precisa achar a linha pra fechar, não só saber se existe.
async function _acharContainerParaFechar(sb, { groupId, hoje, titulo }) {
  const { data, error } = await sb.from('tasks').select('id')
    .eq('assigned_group_id', groupId).eq('due_date', hoje)
    .eq('is_group', true).eq('title', titulo).limit(1);
  if (error) return { containerId: null, erro: error.message };
  return { containerId: (data && data[0] && data[0].id) || null, erro: null };
}

async function _listarFilhasPendentes(sb, { containerId }) {
  const { data, error } = await sb.from('tasks').select('id, title')
    .eq('parent_task_id', containerId).eq('status', 'pending');
  if (error) return { filhas: null, erro: error.message }; // null: NÃO é "zero filhas pendentes"
  return { filhas: data || [], erro: null };
}

async function _fecharFilha(sb, { id, status, notes }) {
  const payload = { status };
  if (status === 'done') payload.completed_at = new Date().toISOString();
  if (notes) payload.notes = notes;
  // .select('id') no fim pelo mesmo motivo de gravarResultado (Task 1): o PostgREST devolve
  // error:null quando o UPDATE não casa NENHUMA linha — sem isto, diria "fechei" sem ter fechado.
  const { data, error } = await sb.from('tasks').update(payload).eq('id', id).select('id');
  if (error) { console.error(`[Pauta] fecharFilha falhou id=${id}: ${error.message}`); return false; }
  if (!(data || []).length) { console.error(`[Pauta] fecharFilha não achou a filha id=${id}`); return false; }
  return true;
}

async function _fecharContainer(sb, { containerId }) {
  const { data, error } = await sb.from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', containerId).select('id');
  if (error) { console.error(`[Pauta] fecharContainer falhou id=${containerId}: ${error.message}`); return false; }
  if (!(data || []).length) { console.error(`[Pauta] fecharContainer não achou o container id=${containerId}`); return false; }
  return true;
}

// Passada da NOITE: lê a fonte de novo, carimba o resultado de cada aluno que entrou na pauta
// de hoje em anamnese_pauta (a VERDADE da escada), e fecha o RECADO do dia nos painéis de
// tarefa (filhas viram done/cancelled, container vira done). Os contadores preencheu/
// naoPreencheu/semVerificacao refletem o que REALMENTE entrou no banco, nunca a intenção:
// gravarResultado (Task 1) devolve `false` quando o UPDATE não casa NENHUMA linha, mesmo sem
// erro do banco — foi corrigido assim bem por isso, pra não mentir sucesso. Se contássemos a
// tentativa em vez da escrita, o relatório da noite viraria ficção. `filhasFechadasComoFeitas`/
// `filhasFechadasComoNaoFeitas`/`containerFechado` são os contadores do FECHAMENTO do recado —
// `motivo` continua sendo o sensor único de por que algo NÃO aconteceu.
async function fecharPautaDaUnidade({ supabase, laReport, unidadeId, groupId, hoje, deps = {} }) {
  const repo = deps.repo || repoPadrao;
  const semFechamento = { filhasFechadasComoFeitas: 0, filhasFechadasComoNaoFeitas: 0, containerFechado: false };

  const pessoas = await repo.pessoasDoDia(supabase, { unidadeId, dia: hoje });
  if (pessoas === null) {
    // Sensor próprio: falhar ao LER quem entrou na pauta de hoje é diferente de "não tinha
    // pauta hoje" (abaixo, motivo null) — senão o mesmo "zero linhas silencioso" que já custou
    // dois diagnósticos errados nesta casa (03/09) volta agora do lado da passada da noite.
    return {
      fechou: false, preencheu: 0, naoPreencheu: 0, semVerificacao: 0,
      motivo: 'não consegui ler quem entrou na pauta de hoje', ...semFechamento,
    };
  }
  if (!pessoas.length) {
    // Ninguém entrou na pauta hoje — saúde, não falha. Motivo null é o mesmo sensor de "zero
    // por saúde" usado no resto deste arquivo.
    return { fechou: false, preencheu: 0, naoPreencheu: 0, semVerificacao: 0, motivo: null, ...semFechamento };
  }

  // Divergência entre o que esta passada TENTOU gravar e o que REALMENTE entrou no banco não
  // pode ser engolida: se algum UPDATE não casar linha nenhuma, isso sai no motivo em vez de
  // desaparecer dentro de um contador que finge sucesso. `avisos` recebe também qualquer
  // problema do fechamento do recado (abaixo) — um único sensor pra tudo que não é o feliz.
  const avisos = [];
  const falhasGravacao = [];
  async function gravar(pessoaChave, resultado) {
    const ok = await repo.gravarResultado(supabase, { unidadeId, dia: hoje, pessoaChave, resultado });
    if (!ok) falhasGravacao.push(pessoaChave);
    return ok;
  }
  function motivoFinal(base) {
    const partes = [...(base ? [base] : []), ...avisos];
    if (falhasGravacao.length) {
      partes.push(`${falhasGravacao.length} gravação(ões) não confirmada(s) no banco: ${falhasGravacao.join(', ')}`);
    }
    return partes.length ? partes.join('; ') : null;
  }

  // Sempre checar `error`: consulta com coluna errada devolve {data:null,error} e viraria "zero
  // linhas" silencioso.
  const { data, error } = await laReport.rpc('get_situacao_alunos_v1',
    { p_unidade_id: unidadeId, p_apenas_pendentes: false });

  // Dia que a NOSSA infra derrubou não conta contra o aluno: senão a 3ª aparição da escada
  // chega por culpa nossa e a equipe cobra quem já tinha preenchido. FALHA-FECHADA: sem fonte
  // não dá pra dizer quem preencheu, então NADA se fecha — fechar no escuro marcaria
  // `cancelled` em quem preencheu. O container fica aberto e o dia seguinte tenta de novo.
  if (error) {
    let semVerificacao = 0;
    for (const pk of pessoas) {
      if (await gravar(pk, 'sem_verificacao')) semVerificacao++;
    }
    return {
      fechou: true, preencheu: 0, naoPreencheu: 0, semVerificacao,
      motivo: motivoFinal(`consulta do LA Report falhou no fechamento: ${error.message} — container fica aberto pra tentar de novo amanhã`),
      ...semFechamento,
    };
  }

  const porChave = new Map((data || []).map((p) => [p.pessoa_chave, p]));
  let preencheu = 0; let naoPreencheu = 0; let semVerificacao = 0;
  for (const pk of pessoas) {
    const p = porChave.get(pk);
    let resultado;
    if (!p) { resultado = 'sem_verificacao'; }                              // saiu da base ativa
    else if (!situ.filtrarPorRecorte([p], 'anamnese').length) { resultado = 'preencheu'; }
    else { resultado = 'nao_preencheu'; }
    if (await gravar(pk, resultado)) {
      if (resultado === 'sem_verificacao') semVerificacao++;
      else if (resultado === 'preencheu') preencheu++;
      else naoPreencheu++;
    }
  }

  // Fecha o RECADO do dia: filhas viram done/cancelled, container vira done. Envolto em
  // try/catch pra uma falha aqui nunca derrubar o que já foi gravado em anamnese_pauta acima —
  // a verdade da escada já está segura; só o painel de tarefas fica pendente de retry.
  const acharContainer = deps.acharContainer || _acharContainerParaFechar;
  const listarFilhasPendentes = deps.listarFilhasPendentes || _listarFilhasPendentes;
  const fecharFilha = deps.fecharFilha || _fecharFilha;
  const fecharContainer = deps.fecharContainer || _fecharContainer;

  let filhasFechadasComoFeitas = 0;
  let filhasFechadasComoNaoFeitas = 0;
  let containerFechado = false;
  try {
    const titulo = _tituloDoContainer(hoje);
    const { containerId, erro: erroContainer } = await acharContainer(supabase, { groupId, hoje, titulo });
    if (erroContainer) {
      avisos.push(`não consegui achar o container pra fechar: ${erroContainer}`);
    } else if (!containerId) {
      avisos.push('não achei o container da pauta de hoje pra fechar');
    } else {
      const { filhas, erro: erroFilhas } = await listarFilhasPendentes(supabase, { containerId });
      if (erroFilhas) {
        avisos.push(`não consegui ler as filhas pendentes: ${erroFilhas}`);
      } else {
        const semAnamnesePorNome = _mapaPorNome(situ.filtrarPorRecorte(data || [], 'anamnese'));
        const todosPorNome = _mapaPorNome(data || []);
        for (const filha of filhas) {
          const decisao = _decidirFechoDaFilha(filha.title, semAnamnesePorNome, todosPorNome);
          const ok = await fecharFilha(supabase, { id: filha.id, status: decisao.status, notes: decisao.notes });
          if (ok) { if (decisao.status === 'done') filhasFechadasComoFeitas++; else filhasFechadasComoNaoFeitas++; }
        }
        containerFechado = !!(await fecharContainer(supabase, { containerId }));
        if (!containerFechado) avisos.push('fechei as filhas mas não consegui fechar o container');
      }
    }
  } catch (e) {
    avisos.push(`falha ao fechar o recado do dia: ${(e && e.message) || String(e)}`);
  }

  return {
    fechou: true, preencheu, naoPreencheu, semVerificacao, motivo: motivoFinal(null),
    filhasFechadasComoFeitas, filhasFechadasComoNaoFeitas, containerFechado,
  };
}

module.exports = { montarPautaDaUnidade, fecharPautaDaUnidade, TETO_FILHAS };
