'use strict';
// situacao-aluno.js — a situação operacional do aluno vinda do LA Report.
//
// ARQUITETURA (decisão do Alf, 02/09): NADA de regex pra rotear. A LLM INTERPRETA o que foi
// pedido e emite o marker; o CÓDIGO executa a RPC canônica e escreve os números. Mesmo padrão
// já provado do <<GROUP_REPORT>>: "você só dá UMA linha curta de abertura, o sistema monta com
// dados EXATOS do banco".
//
// POR QUE O RENDERIZADOR É QUEM LÊ, e não o prompt: as pegadinhas do contrato
// (`consultar-situacao-aluno-la`) viram CÓDIGO aqui. `na_comunidade_wa=null` sai como
// "não sei", nunca como "fora"; flag de anamnese sem registro sai com ressalva. Instrução se
// esquece; código não. O contrato continua sendo a skill compartilhada (TOM, Sol, Lia, app) —
// este arquivo é a implementação dela do lado do TOM.

// O módulo puro da pauta é folha (não requer nada) — dá pra importar aqui sem ciclo. O que se
// busca dele é UM valor: CONTRATO_NA_PAUTA, o interruptor da reversão do contrato. Ver a
// ressalva mais abaixo; a razão de não redigitar o booleano aqui está no comentário de lá.
const pura = require('./anamnese-pauta');

const RECORTES = ['resumo', 'anamnese', 'instagram', 'comunidade', 'contrato', 'foto', 'telefone'];

// Unidades do LA Report. Grupo de UMA unidade traz a dela amarrada (work_groups.la_report_unidade_id);
// grupo que ATRAVESSA unidades — o Sucesso do Aluno olha aluno das tres — recebe a unidade na
// fala e o TOM passa no marker. Sem nenhuma das duas, ele PERGUNTA: responder pela unidade
// errada e pior que nao responder.
const UNIDADES = {
  recreio: '95553e96-971b-4590-a6eb-0201d013c14d',
  barra: '368d47f5-2d88-4475-bc14-ba084a9a348e',
  'campo grande': '2ec861f6-023f-4d7b-9927-3960ad8c2a92',
  cg: '2ec861f6-023f-4d7b-9927-3960ad8c2a92',
  campogrande: '2ec861f6-023f-4d7b-9927-3960ad8c2a92',
};

// So os tres ids reais — 'cg'/'campogrande' sao apelidos do mesmo lugar e nao podem virar
// uma terceira consulta.
const UNIDADES_IDS = [...new Set(Object.values(UNIDADES))];

// Nome legivel a partir do id, pra dizer em QUAL unidade a pessoa esta.
const NOME_DA_UNIDADE = {
  '95553e96-971b-4590-a6eb-0201d013c14d': 'Recreio',
  '368d47f5-2d88-4475-bc14-ba084a9a348e': 'Barra',
  '2ec861f6-023f-4d7b-9927-3960ad8c2a92': 'Campo Grande',
};
function nomeDaUnidade(id) { return NOME_DA_UNIDADE[id] || null; }

function resolverUnidade(nome) {
  const s = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (UNIDADES[s]) return UNIDADES[s];
  // uuid direto tambem vale (quem ja sabe o id nao precisa do apelido)
  if (/^[0-9a-f-]{36}$/i.test(String(nome || '').trim())) return String(nome).trim();
  return null;
}
const PAGINA_INICIAL = 15;   // primeira entrega: cabe no WhatsApp e já dá pra começar
const PAGINA_SEGUINTE = 30;  // se insistirem, vai fatiando de 30 em 30

function normalizarRecorte(r) {
  const v = String(r || '').trim().toLowerCase();
  return RECORTES.includes(v) ? v : 'resumo';
}

// Crianças primeiro (pedido do Alf): LAMK é ≤11 anos — é quem a recepção resolve falando com o
// responsável na porta. Dentro da faixa, nome, pra a lista ser estável entre as fatias.
function ordenarPessoas(pessoas) {
  const peso = (p) => (String(p && p.classificacao).toUpperCase() === 'LAMK' ? 0 : 1);
  return [...(pessoas || [])].sort((a, b) => {
    const d = peso(a) - peso(b);
    if (d !== 0) return d;
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
  });
}

function fatiar(pessoas, pagina = 0) {
  const arr = pessoas || [];
  const p = Math.max(0, Number(pagina) || 0);
  const ini = p === 0 ? 0 : PAGINA_INICIAL + (p - 1) * PAGINA_SEGUINTE;
  const tam = p === 0 ? PAGINA_INICIAL : PAGINA_SEGUINTE;
  const itens = arr.slice(ini, ini + tam);
  const restam = Math.max(0, arr.length - (ini + itens.length));
  return { itens, restam, temMais: restam > 0, pagina: p };
}

// COMO O CONTRATO E MEDIDO (06/09/2026) ────────────────────────────────────────────────────
// Ate 05/09 o recorte media `!tem_data_contrato` — data DERIVADA da primeira aula, que nasce
// junto com a matricula e nao sabe nada sobre assinatura. Naquele dia o Emusys passou a
// informar tambem a assinatura MANUAL (antes so a eletronica voltava `true`), e o LA Report
// expos `contrato_assinatura_status` na RPC.
//
// Medido na RPC com a reconciliacao do dia, antes de trocar: o criterio velho apontava 79
// pessoas no Recreio, o certo aponta 7 — 72 acusacoes indevidas no primeiro dia. Na Barra ele
// errava pro outro lado, 90 contra 109 pendencias reais.
//
// DUAS TRAVAS, e as duas sao de HONESTIDADE, nao de performance:
//   1. So `nao_assinado` e `sem_contrato` entram. `nao_verificado` e `dispensado` NUNCA — dado
//      incompleto nao vira cobranca, e a precedencia da RPC ja garante que na duvida o estado
//      cai pro lado inconclusivo.
//   2. `contrato_dado_fresco === true` e obrigatorio. Sem a reconciliacao do dia, o TOM cala em
//      vez de chutar. Comparacao estrita de proposito: campo ausente nao cobra ninguem.
//
// O QUE ESTE CRITERIO AINDA NAO SABE: o `false` do Emusys nao separa "nunca foi enviado" de "a
// escola assinou e falta o aluno" (caso medido: Giovanna, matricula 1558 do Recreio, 05/09).
// Os dois sao pendencia real e podem ser cobrados — o que o TOM NAO pode e dizer qual dos dois
// e, nem afirmar que ninguem mandou o contrato.
const COBRAVEIS_DE_CONTRATO = new Set(['nao_assinado', 'sem_contrato']);

// O SENSOR DOS DOIS ZEROS (06/09). O portao de frescura acima faz `filtrarPorRecorte` devolver
// lista VAZIA quando a reconciliacao do dia nao rodou — o que protege contra cobrar sem conferir,
// e ao mesmo tempo cria o pior silencio desta casa: bloco de contrato vazio nao aparece na
// mensagem, e ausencia de bloco o time le como "hoje ninguem esta sem contrato". Zero por FALHA
// sai identico a zero por SAUDE.
// Este helper e o unico jeito de distinguir os dois de fora, e nao decide nada sozinho: quem
// monta a mensagem escolhe entre o bloco normal e o "nao consegui conferir".
// `null` pra lista vazia de proposito — sem gente nao da pra afirmar NEM negar que houve rodada,
// e devolver `false` ali faria a unidade sem alunos anunciar uma falha que nao existe.
function contratoConferidoHoje(pessoas) {
  const arr = pessoas || [];
  if (!arr.length) return null;
  return arr.some((p) => p && p.contrato_dado_fresco === true);
}

const PENDENCIA = {
  anamnese: (p) => !p.anamnese_preenchida,
  instagram: (p) => !p.tem_instagram && !p.instagram_nao_possui,
  contrato: (p) => COBRAVEIS_DE_CONTRATO.has(p.contrato_assinatura_status)
    && p.contrato_dado_fresco === true,
  foto: (p) => !p.tem_foto,
  telefone: (p) => !p.tem_telefone,
  comunidade: (p) => p.comunidade_status === 'fora_da_comunidade',
};

// PERIODO DE MATRICULA (Fabiola, 02/09: "dos matriculados em agosto, quantos sem foto?").
// A LLM traduz a fala em datas; o codigo filtra. Dois eixos, porque sao perguntas diferentes:
//   entrou_em            = quando a pessoa virou ALUNA DA ESCOLA (min das matriculas vivas)
//   matricula_recente_em = a matricula mais nova (2o curso conta)
// Default: entrou_em. "Aluno de agosto" quase sempre quer dizer quem CHEGOU em agosto — e o
// renderizador DIZ qual criterio usou, senao o numero vira opiniao.
const CAMPOS_PERIODO = { entrada: 'entrou_em', recente: 'matricula_recente_em' };

function filtrarPorPeriodo(pessoas, { de, ate, criterio = 'entrada' } = {}) {
  const campo = CAMPOS_PERIODO[criterio] || CAMPOS_PERIODO.entrada;
  const dISO = de ? String(de).slice(0, 10) : null;
  const aISO = ate ? String(ate).slice(0, 10) : null;
  if (!dISO && !aISO) return pessoas || [];
  return (pessoas || []).filter((p) => {
    const v = p && p[campo] ? String(p[campo]).slice(0, 10) : null;
    if (!v) return false; // sem data conhecida NAO entra num recorte de data
    if (dISO && v < dISO) return false;
    if (aISO && v > aISO) return false;
    return true;
  });
}

function rotuloPeriodo({ de, ate, criterio = 'entrada' } = {}) {
  if (!de && !ate) return '';
  const br = (d) => { const [a, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${a}`; };
  // "Ninguem sem foto QUE ENTRARAM..." nao concorda. "entre os que entraram" serve tanto pro
  // caso cheio ("12 sem contrato, entre os que entraram...") quanto pro vazio.
  const eixo = criterio === 'recente' ? 'entre os que fizeram matrícula nova' : 'entre os que entraram na escola';
  if (de && ate) return `${eixo} de ${br(de)} a ${br(ate)}`;
  if (de) return `${eixo} a partir de ${br(de)}`;
  return `${eixo} até ${br(ate)}`;
}

function filtrarPorRecorte(pessoas, recorte) {
  const f = PENDENCIA[normalizarRecorte(recorte)];
  return f ? (pessoas || []).filter(f) : (pessoas || []);
}

// ── FICHA DE UM ALUNO ─────────────────────────────────────────────────────────────────────
// Resolucao por NOME com a mesma regra anti-chute do checklist: exato unico ganha; parcial
// unico serve; 0 ou 2+ NAO escolhe — devolve os candidatos pra perguntar. Responder pela pessoa
// errada num grupo de trabalho e pior que perguntar de novo.
function _norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolverAluno(pessoas, termo) {
  const t = _norm(termo);
  if (!t || t.length < 2) return { erro: 'termo_curto' };
  const lista = pessoas || [];
  const exatos = lista.filter((p) => _norm(p.nome) === t);
  if (exatos.length === 1) return { pessoa: exatos[0] };
  const comeca = lista.filter((p) => _norm(p.nome).startsWith(t + ' ') || _norm(p.nome) === t);
  if (comeca.length === 1) return { pessoa: comeca[0] };
  const contem = lista.filter((p) => _norm(p.nome).includes(t));
  if (contem.length === 1) return { pessoa: contem[0] };
  if (contem.length === 0) return { erro: 'nao_achei' };
  return { erro: 'ambiguo', candidatos: contem.slice(0, TETO_CANDIDATOS), total: contem.length };
}

// "Na escola desde ..." — o tempo de casa e a pergunta que o time faz, nao a data crua.
function tempoDeCasa(desde, hoje = new Date()) {
  if (!desde) return null;
  const d = new Date(String(desde).slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  let meses = (hoje.getUTCFullYear() - d.getUTCFullYear()) * 12 + (hoje.getUTCMonth() - d.getUTCMonth());
  if (hoje.getUTCDate() < d.getUTCDate()) meses -= 1;
  if (meses < 0) return null;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  if (anos && resto) return `${anos} ano${anos > 1 ? 's' : ''} e ${resto} ${resto > 1 ? 'meses' : 'mês'}`;
  if (anos) return `${anos} ano${anos > 1 ? 's' : ''}`;
  if (resto) return `${resto} ${resto > 1 ? 'meses' : 'mês'}`;
  return 'menos de um mês';
}

// Quem assina o numero e a UNIDADE consultada, nao o grupo que perguntou. Num grupo de uma
// unidade so da no mesmo; num grupo que atravessa as tres, e a diferenca entre "92 alunos sem
// contrato na Barra" e "92 alunos sem contrato" — que soa como a escola inteira.
// Nomes que aparecem como PROFESSOR de alguma turma, tirados do proprio conjunto consultado —
// nao ha lista de professores separada, e o dado ja vem em professores[] de cada matricula.
// O que a RPC devolve em cadastro_faltando sao nomes de COLUNA. Ninguem no grupo fala
// "data_inicio_contrato".
const ROTULO_PENDENCIA = {
  instagram: 'Instagram',
  data_inicio_contrato: 'data de início do contrato',
  foto: 'foto',
  telefone: 'telefone',
};

function rotuloPendencia(token) {
  const t = String(token || '').trim();
  if (ROTULO_PENDENCIA[t]) return ROTULO_PENDENCIA[t];
  // Token novo: humaniza em vez de esconder. Pendencia que some calada e pior que mal escrita.
  return t.replace(/_/g, ' ').trim() || t;
}

// responsavel_nome cai pro nome do PROPRIO aluno em 64% das criancas. Quando repete, nao ha
// responsavel identificado — e dizer o nome da crianca ali manda convidar a pessoa errada.
function responsavelDistinto(p) {
  if (!p || !p.responsavel_nome) return null;
  return _norm(p.responsavel_nome) === _norm(p.nome) ? null : p.responsavel_nome;
}

function conjuntoDeProfessores(pessoas) {
  const s = new Set();
  (pessoas || []).forEach((p) => (p.professores || []).forEach((n) => { if (n) s.add(_norm(n)); }));
  return s;
}

function tambemDaAula(nome, professores) {
  return !!(professores && professores.size && professores.has(_norm(nome)));
}

function cabecalhoDe({ unidadeNome, grupoNome } = {}) {
  return esc(unidadeNome || grupoNome || 'a unidade');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ROTULO = {
  // 'contrato' mede ASSINATURA desde 06/09 (ver COMO O CONTRATO E MEDIDO, la em cima). O rotulo
  // veio junto: enquanto o criterio era a data, dizer 'nao assinado' seria inventar um fato a
  // partir de campo vazio — agora e o contrario, dizer 'sem data' esconde o fato que a fonte
  // afirma. O vazio depende deste rotulo tanto quanto a lista cheia: 'Ninguem sem contrato
  // assinado' e uma frase que agora a gente PODE assinar embaixo.
  anamnese: 'sem anamnese', instagram: 'sem Instagram', contrato: 'sem contrato assinado',
  foto: 'sem foto', telefone: 'sem telefone', comunidade: 'fora da comunidade',
};

// ── A RESSALVA DO CONTRATO (04/09) ─────────────────────────────────────────────────────────
// ⚠️ RESOLVIDO EM 06/09: o recorte NAO mede mais `tem_data_contrato` (ver o bloco COMO O
// CONTRATO E MEDIDO, acima), e com CONTRATO_NA_PAUTA ligado esta ressalva nunca renderiza —
// `ressalvaDeContrato()` devolve string vazia. Ela fica aqui como rede da reversao. Se
// alguem desligar o interruptor de novo, REESCREVA o texto antes: ele fala de data, e o
// criterio hoje fala de assinatura. Aviso que mente e pior que aviso nenhum.
//
// [historico] O recorte 'contrato' media `tem_data_contrato`, que vem de `data_inicio_contrato` — campo
// DERIVADO da data da primeira aula. Ele existe desde a criação da matrícula e não sabe nada
// sobre assinatura. O Emusys tem o campo certo (`contrato_atual.contrato_assinado`), mas ele
// ainda não chega ao LA Report. Em 04/09 as mensagens que o TOM manda por conta própria foram
// revertidas por causa disso (9aec4e0c) — só que o recorte continuou respondendo a QUEM
// PERGUNTA, e o dono tinha acabado de dizer nos três grupos "me peça a lista de contrato que eu
// mando ela inteira". A porta ficou aberta: o TOM pararia de oferecer o número errado e diria o
// mesmo número errado no segundo seguinte.
//
// POR QUE NÃO BLOQUEAR A RESPOSTA. Quem está sem data de contrato É uma pendência real — só não
// é a que a pessoa tem na cabeça ao pedir "a lista de contrato". Recusar apagaria informação
// boa; o que não pode é o número sair com uma etiqueta que a pessoa vai ler como "não assinou".
//
// ELA MORRE COM O MESMO INTERRUPTOR DA PAUTA, de propósito. Se fosse um `false` próprio daqui,
// no dia em que alguém religasse a pauta (com o booleano certo já na RPC) o TOM passaria a dar
// o número CERTO com um aviso dizendo que ele é duvidoso — e um aviso que mente é pior que
// nenhum. Um botão só: pura.CONTRATO_NA_PAUTA, em services/anamnese-pauta.js, lido em tempo de
// chamada (não copiado pra uma const daqui, senão religar exigiria mexer neste arquivo também).
const RESSALVA_CONTRATO = '<p>⚠️ <b>Sem data de contrato</b> <i>não é o mesmo que não ter assinado: essa data já nasce com a matrícula e não diz nada sobre assinatura.</i></p>';

function ressalvaDeContrato() {
  return pura.CONTRATO_NA_PAUTA ? '' : RESSALVA_CONTRATO;
}

// A LINHA DA COMUNIDADE é o coração da honestidade desta tela. Só existe "fora da comunidade"
// quando a captura é fresca; qualquer outro estado é NÃO SEI, dito com todas as letras.
function linhaComunidade(c) {
  const com = c || {};
  const naoSei = (com.sem_captura || 0) + (com.captura_desatualizada || 0) + (com.sem_grupo_configurado || 0);
  const partes = [];
  if (com.na_comunidade) partes.push(`${com.na_comunidade} na comunidade`);
  if (com.fora_da_comunidade) partes.push(`<b>${com.fora_da_comunidade} fora da comunidade</b>`);
  if (naoSei) partes.push(`${naoSei} <i>não sei (sem captura recente do grupo)</i>`);
  if (!partes.length) return null;
  return `📱 <b>Comunidade WhatsApp</b>: ${partes.join(' · ')}`;
}

function renderResumo(resumo, opts = {}) {
  const r = resumo || {};
  const pend = r.pendentes || {};
  // A UNIDADE vence o nome do grupo: o numero e dela. Ver cabecalhoDe().
  const nome = cabecalhoDe(opts);
  const linhas = [];
  linhas.push(`<h3>👥 Situação dos alunos — ${nome}</h3>`);
  linhas.push(`<p><b>${r.total_pessoas || 0} alunos ativos</b> (pessoas, não matrículas).</p>`);

  const itens = [];
  for (const [chave, rotulo] of [['anamnese', 'sem anamnese'], ['instagram', 'sem Instagram'],
    // NAO e a mesma pendencia do recorte 'contrato': aqui o numero vem de
    // pend.data_inicio_contrato (o campo de CADASTRO), e o recorte mede assinatura. Dois numeros
    // diferentes com o mesmo nome fazem o time achar que um dos dois esta errado.
    ['data_inicio_contrato', 'sem data de início do contrato'], ['foto', 'sem foto'], ['telefone', 'sem telefone']]) {
    const n = pend[chave];
    if (n) itens.push(`<li><b>${n}</b> ${rotulo}</li>`);
  }
  if (itens.length) linhas.push(`<p>📋 <b>Cadastro</b></p><ul>${itens.join('')}</ul>`);
  else linhas.push('<p>📋 <b>Cadastro</b>: tudo em dia.</p>');
  // A mesma ressalva de renderLista/renderFicha, na terceira porta: o resumo também imprime
  // "92 sem data de contrato", e é a mesma frase lida como "não assinaram". Cola logo depois do
  // bloco de Cadastro — junto do número, não no rodapé — e reusa ressalvaDeContrato() (mesmo
  // pura.CONTRATO_NA_PAUTA, lido em tempo de chamada): nenhuma frase nova, nenhum botão novo.
  if (pend.data_inicio_contrato) {
    const av = ressalvaDeContrato();
    if (av) linhas.push(av);
  }

  const com = linhaComunidade(r.comunidade);
  if (com) linhas.push(`<p>${com}</p>`);

  const versao = esc(r.regra_versao || 'desconhecida');
  const quando = r.medido_em ? ` · medido ${esc(String(r.medido_em).slice(0, 16).replace('T', ' '))}` : '';
  linhas.push(`<p><i>fonte: LA Report, regra ${versao}${quando}</i></p>`);
  return linhas.join('\n');
}

function renderLista({ recorte, pessoas, total, pagina = 0, grupoNome, unidadeNome, periodo, professores } = {}) {
  const rec = normalizarRecorte(recorte);
  const rotulo = ROTULO[rec] || 'com pendência';
  const nome = cabecalhoDe({ grupoNome, unidadeNome });
  // A ressalva do contrato (ver acima) acompanha TODA saída deste recorte. Se ela só saísse na
  // primeira página, "manda os próximos 30" devolveria o número limpo — e a porta continuaria
  // aberta pelo caminho que a equipe mais usa.
  const ressalvaRecorte = rec === 'contrato' ? ressalvaDeContrato() : '';
  if (!total || !(pessoas || []).length) {
    const per = periodo ? ` ${rotuloPeriodo(periodo)}` : '';
    // O VAZIO é o caso mais perigoso: "Ninguém sem data de contrato" se lê como "todo mundo
    // assinou", que é uma afirmação que ninguém mediu. A ressalva vale aqui mais que nos outros.
    return `<h3>👥 ${nome}</h3><p>Ninguém ${rotulo}${esc(per)}.</p>${ressalvaRecorte}`;
  }
  const { itens, restam } = fatiar(ordenarPessoas(pessoas), pagina);
  const li = itens.map((p) => {
    const ehCrianca = String(p.classificacao).toUpperCase() === 'LAMK';
    const faixa = ehCrianca ? '🧒' : '🎓';
    const ressalva = p.anamnese_flag_sem_registro
      ? ' <i>(marcada como preenchida, mas sem registro hoje — conferir)</i>' : '';
    // Na comunidade, quem entra no grupo é o RESPONSÁVEL — então é o nome dele que serve pra
    // agir. Só nesse recorte e só nas crianças: em anamnese ou foto o nome do aluno basta.
    const quem = responsavelDistinto(p);
    const resp = (rec === 'comunidade' && ehCrianca)
      ? (quem ? ` <i>— resp. ${esc(quem)}</i>` : ' <i>— sem responsável identificado no cadastro</i>')
      : '';
    // Quem tambem da aula na escola sai marcado: sem isso, o nome de um professor numa lista
    // de pendencia parece erro da base e alguem vai gastar meia hora conferindo (Alf, 02/09).
    const daAula = tambemDaAula(p.nome, professores) ? ' <i>(também dá aula aqui)</i>' : '';
    return `<li>${faixa} ${esc(p.nome)}${resp}${daAula}${ressalva}</li>`;
  }).join('');
  // COMUNIDADE + CRIANÇA: a criança não entra em grupo de WhatsApp, o responsável entra. O dado
  // já considera isso (a RPC casa telefone do aluno, do responsável e dos contatos), mas quem lê
  // a lista precisa saber COM QUEM falar — senão sai convidando a pessoa errada.
  const temCrianca = itens.some((p) => String(p.classificacao).toUpperCase() === 'LAMK');
  const nota = (rec === 'comunidade' && temCrianca)
    ? '<p><i>Nas crianças (🧒) quem precisa entrar é o responsável — o convite vai pra ele, não pra ela.</i></p>'
    : '';
  const per = periodo ? ` <i>(${esc(rotuloPeriodo(periodo))})</i>` : '';
  // A dica de ordem so serve se houver crianca na fatia E mais de um nome: com um adulto
  // sozinho, "Começando pelas crianças" nao explica ordem nenhuma — e so barulho.
  const dicaOrdem = (temCrianca && itens.length > 1) ? '. Começando pelas crianças:' : ':';
  const cabeca = pagina === 0
    ? `<p><b>${total}</b> ${rotulo}${per}${dicaOrdem}</p>${nota}`
    : `<p>Continuando — <b>${total}</b> ${rotulo}${per}:</p>${nota}`;
  // O convite tem que caber no que SOBROU. Com 5 restando, "mando os próximos 30" e depois
  // vêm 5 faz o número parecer inventado — e o número é a coisa que eles mais olham.
  // (Fabíola, Sucesso do Aluno, 02/09: sobravam 5 e ele ofereceu 30.)
  const proximos = Math.min(restam, PAGINA_SEGUINTE);
  const rodape = restam
    ? `<p>…e mais <b>${restam}</b>. Quer que eu mande ${proximos === 1 ? 'o último' : `os próximos ${proximos}`}?</p>`
    : '';
  // A ressalva entra ENTRE a linha do número e os nomes: é onde o olho passa obrigatoriamente
  // depois de ler a contagem. No rodapé, embaixo de 15 nomes, ela vira nota de rodapé — e nota
  // de rodapé não é ressalva, é álibi.
  return `<h3>👥 ${nome}</h3>${cabeca}${ressalvaRecorte}<ul>${li}</ul>${rodape}`;
}

// ── CACHE CURTO + RETRY ────────────────────────────────────────────────────────────────────
// MEDIDO em 02/09: a RPC leva 6–8s e o corte do PostgREST fica em ~8s — ela vive NO LIMITE, e
// 1 de 7 chamadas voltou `statement timeout`. Sem isto o TOM falha de forma aleatória na frente
// do time. O cache também torna a paginação de graça (a 2ª página não repaga 7s).
// Servir dado de minutos atrás é honesto porque o card SEMPRE mostra quando foi medido.
// TTL POR TIPO, e a razão é diferente em cada um (revisto em 02/09 depois que a RPC ficou 7x
// mais rápida — CG de 7,8s para ~1s):
//   resumo (o NÚMERO) → 60s. Só junta rajada de perguntas seguidas. O número anda durante o
//     dia: as anamneses do Recreio foram de 91 pra 104 em um mutirão. Cache longo aqui faria o
//     TOM repetir número velho enquanto o time trabalha.
//   lista (os NOMES) → 10 min, e agora por CONSISTÊNCIA, não por performance: a paginação
//     precisa de uma foto estável, senão a página 2 pula ou repete nome que mudou no meio.
const TTL_MS = 10 * 60 * 1000;
// 'ficha' e a base INTEIRA (inclusive quem esta com tudo em ordem); 'lista' e so quem tem
// pendencia. Perguntar do aluno certinho e o caso mais comum — se ele nao estivesse na base
// consultada, o TOM responderia "nao achei" sobre alguem que existe.
const TTL_POR_TIPO = { resumo: 60 * 1000, lista: TTL_MS, ficha: TTL_MS };
const _cache = new Map();

function _chave(tipo, unidadeId) { return `${tipo}:${unidadeId}`; }

function ttlDoTipo(tipo) {
  return TTL_POR_TIPO[tipo] != null ? TTL_POR_TIPO[tipo] : TTL_MS;
}

async function consultarComCache({ tipo, unidadeId, client, agora = Date.now(), ttlMs = null }) {
  if (ttlMs == null) ttlMs = ttlDoTipo(tipo);
  const k = _chave(tipo, unidadeId);
  const hit = _cache.get(k);
  if (hit && (agora - hit.em) < ttlMs) return { data: hit.data, doCache: true, idadeMs: agora - hit.em };

  const chamar = () => (tipo === 'resumo'
    ? client.rpc('get_situacao_alunos_resumo_v1', { p_unidade_id: unidadeId })
    : client.rpc('get_situacao_alunos_v1', { p_unidade_id: unidadeId, p_apenas_pendentes: tipo !== 'ficha' }));

  let { data, error } = await chamar();
  if (error) {
    // Uma tentativa a mais: o timeout é de borda, não de doença. Duas falhas seguidas é falha
    // de verdade e tem que ser DITA — número de aluno inventado é pior que não responder.
    ({ data, error } = await chamar());
  }
  if (error) {
    if (hit) return { data: hit.data, doCache: true, idadeMs: agora - hit.em, degradado: error.message };
    throw new Error(error.message);
  }
  _cache.set(k, { data, em: agora });
  return { data, doCache: false, idadeMs: 0 };
}

function _limparCache() { _cache.clear(); }

// Monta a ficha. Cada linha so aparece quando ha o que dizer, e o "nao sei" e dito com todas as
// letras — comunidade sem captura fresca e presenca de confianca baixa nao viram afirmacao.
function renderFicha(p, { grupoNome, hoje = new Date(), professores } = {}) {
  if (!p) return null;
  const L = [];
  const faixa = String(p.classificacao).toUpperCase() === 'LAMK' ? '🧒' : '🎓';
  L.push(`<h3>${faixa} ${esc(p.nome)}</h3>`);

  const aulas = (p.aulas_resumo || []).filter(Boolean);
  const profs = (p.professores || []).filter(Boolean);
  if (aulas.length) L.push(`<p>🎵 ${aulas.map(esc).join(' · ')}</p>`);
  else if ((p.cursos || []).length) L.push(`<p>🎵 ${(p.cursos || []).map(esc).join(' · ')}</p>`);
  if (profs.length) L.push(`<p>👩‍🏫 ${profs.length > 1 ? 'Professores' : 'Professor(a)'}: ${profs.map(esc).join(', ')}</p>`);

  const tempo = tempoDeCasa(p.entrou_em, hoje);
  if (tempo) L.push(`<p>📅 Na escola há <b>${esc(tempo)}</b>${p.entrou_em ? ` <i>(desde ${esc(String(p.entrou_em).slice(0, 10).split('-').reverse().join('/'))})</i>` : ''}</p>`);

  if (String(p.classificacao).toUpperCase() === 'LAMK') {
    const quem = responsavelDistinto(p);
    L.push(quem
      ? `<p>👤 Responsável: ${esc(quem)}</p>`
      : '<p>👤 Responsável: <i>não identificado no cadastro</i></p>');
  }

  const falta = (p.cadastro_faltando || []).filter(Boolean);
  L.push(falta.length
    ? `<p>📋 Cadastro: falta <b>${falta.map((t) => esc(rotuloPendencia(t))).join(', ')}</b></p>`
    : '<p>📋 Cadastro completo ✅</p>');
  // A ressalva do contrato cola na linha que ela explica, e só quando essa linha FALA de
  // contrato. O gatilho é o token renderizado, não `tem_data_contrato`: assim a ressalva
  // aparece exatamente quando a ficha afirma alguma coisa sobre contrato, e some junto com a
  // afirmação. Casa por substring de propósito — a RPC já mandou 'contrato' e
  // 'data_inicio_contrato' em momentos diferentes, e uma ressalva que depende de soletrar o
  // nome da coluna certa é uma ressalva que um dia falta.
  const ressalvaFicha = falta.some((t) => /contrato/i.test(String(t))) ? ressalvaDeContrato() : '';
  if (ressalvaFicha) L.push(ressalvaFicha);

  if (p.anamnese_flag_sem_registro) L.push('<p>🧠 Anamnese: marcada como preenchida, mas <b>sem registro hoje</b> — vale conferir</p>');
  else if (p.anamnese_preenchida) L.push(`<p>🧠 Anamnese preenchida ✅${p.anamnese_em ? ` <i>(${esc(String(p.anamnese_em).slice(0, 10).split('-').reverse().join('/'))})</i>` : ''}</p>`);
  else L.push('<p>🧠 Anamnese: <b>falta</b></p>');

  const com = linhaComunidadePessoa(p);
  if (com) L.push(`<p>${com}</p>`);

  if (p.presenca_confianca === 'baixa') {
    L.push('<p>📈 Presença: <i>não dá pra afirmar — a chamada tem pouco registro confirmado</i></p>');
  } else if (p.presenca_taxa_geral != null) {
    L.push(`<p>📈 Presença: <b>${Math.round(Number(p.presenca_taxa_geral) * 100)}%</b>${desdeAUltimaAula(p.dias_desde_ultima_aula)}</p>`);
  }

  if (p.inadimplente) {
    const n = Number(p.faturas_vencidas_abertas || 0);
    L.push(`<p>💰 <b>${n > 1 ? `${n} faturas vencidas` : '1 fatura vencida'}</b> em aberto</p>`);
  }
  if (p.em_aviso_previo) L.push('<p>🚪 <b>Em aviso prévio</b></p>');
  else if (p.contrato_vencido) L.push('<p>📄 <b>Contrato vencido</b></p>');
  else if (p.proxima_renovacao_em) L.push(`<p>📄 Renova em ${esc(String(p.proxima_renovacao_em).slice(0, 10).split('-').reverse().join('/'))}${p.vence_em_30d ? ' <b>(nos próximos 30 dias)</b>' : ''}</p>`);

  if (tambemDaAula(p.nome, professores)) {
    L.push('<p>🧑‍🏫 <i>Esse nome também aparece como professor de turma aqui — é aluno e dá aula.</i></p>');
  }
  const uni = p._unidade_id ? nomeDaUnidade(p._unidade_id) : null;
  L.push(`<p><i>fonte: LA Report${uni ? ` · ${esc(uni)}` : ''}, regra ${esc(p.regra_versao || 'desconhecida')}</i></p>`);
  return L.join('\n');
}

function desdeAUltimaAula(dias) {
  if (dias == null) return '';
  const d = Number(dias);
  if (d <= 0) return ' · teve aula hoje';
  if (d === 1) return ' · última aula ontem';
  return ` · última aula há ${d} dias`;
}

// Mesma trava da lista: sem captura fresca, "não sei" — nunca "está fora".
function linhaComunidadePessoa(p) {
  if (p.comunidade_status === 'na_comunidade') return '📱 Está na comunidade do WhatsApp ✅';
  if (p.comunidade_status === 'fora_da_comunidade') {
    const r = (String(p.classificacao).toUpperCase() === 'LAMK') ? responsavelDistinto(p) : null;
    const quem = r ? ` — quem precisa entrar é ${esc(r)}` : '';
    return `📱 <b>Fora da comunidade</b>${quem}`;
  }
  return '📱 Comunidade: <i>não sei (sem captura recente do grupo)</i>';
}

const TETO_CANDIDATOS = 8;

// Consulta as unidades pedidas em paralelo e devolve todo mundo com _unidade_id marcado. Uma
// unidade que falhar NAO derruba a busca — mas o chamador precisa SABER que ela ficou de fora,
// senao "nao achei" pode ser "nao procurei ali". Zero por falha nao pode parecer zero por saude.
async function buscarAlunoNasUnidades({ unidadeIds, client, consultar = consultarComCache }) {
  const alvos = (unidadeIds || []).filter(Boolean);
  const resultados = await Promise.all(alvos.map(async (id) => {
    try {
      const { data } = await consultar({ tipo: 'ficha', unidadeId: id, client });
      return { id, pessoas: (data || []).map((p) => ({ ...p, _unidade_id: id })) };
    } catch (e) { return { id, erro: e.message }; }
  }));
  return {
    pessoas: resultados.flatMap((r) => r.pessoas || []),
    falharam: resultados.filter((r) => r.erro).map((r) => r.id),
  };
}

function renderAmbiguo(candidatos, termo, total = null) {
  const quantos = total != null ? total : (candidatos || []).length;
  if (quantos > TETO_CANDIDATOS) {
    return `<p>Tem <b>${quantos} alunos</b> com "<b>${esc(termo)}</b>" no nome — mostrar oito ia dar a impressão errada. Me diz o sobrenome?</p>`;
  }
  const nomes = (candidatos || []).map((p) => {
    const u = p._unidade_id ? nomeDaUnidade(p._unidade_id) : null;
    return `<li>${esc(p.nome)}${u ? ` <i>(${esc(u)})</i>` : ''}</li>`;
  }).join('');
  return `<p>Achei mais de um com "<b>${esc(termo)}</b>":</p><ul>${nomes}</ul><p>Qual deles?</p>`;
}

module.exports = {
  RECORTES, PAGINA_INICIAL, PAGINA_SEGUINTE, TTL_MS, TTL_POR_TIPO, ttlDoTipo, UNIDADES, resolverUnidade,
  UNIDADES_IDS, nomeDaUnidade, buscarAlunoNasUnidades, conjuntoDeProfessores, tambemDaAula,
  rotuloPendencia, responsavelDistinto,
  resolverAluno, tempoDeCasa, renderFicha, renderAmbiguo,
  normalizarRecorte, ordenarPessoas, fatiar, filtrarPorRecorte, filtrarPorPeriodo, rotuloPeriodo,
  contratoConferidoHoje,
  renderResumo, renderLista, linhaComunidade,
  // Exportada pro TESTE poder travar o texto byte a byte sem redigitá-lo: duas cópias da mesma
  // frase é como uma delas envelhece calada.
  RESSALVA_CONTRATO,
  consultarComCache, _limparCache,
};
