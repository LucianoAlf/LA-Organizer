#!/usr/bin/env node
// scripts/replay-lab-cenario-grupo-molde.js
// CENÁRIO D do Replay Lab — o caso Rose de verdade: pacote de GRUPO com o molde CANCELADO.
//
// POR QUE ESTE CENÁRIO EXISTE (e por que o cenário C não servia)
// O cenário C (replay-lab-cenario-duplicata.js) montava tarefas de chat INDIVIDUAL e deu 0/3.
// Lendo as falas, o 0/3 era FALSO: o TOM desambiguou certo ("Nenhuma delas vence hoje — você
// quis dizer as 3?"), não deu baixa errada e não mentiu. Vermelho por vacuidade — o irmão do
// verde por vacuidade. O incidente da Rose foi num PACOTE DE GRUPO, que é outro caminho de
// código inteiro: outra query de contexto, outro montador de lista, outro resolvedor.
//
// O GATILHO É CANCELAR O MOLDE — sem isso o bug não reproduz
// `filterVisibleGroupTasks` monta o conjunto de moldes A PARTIR DO ARRAY que recebe, e as
// queries que o alimentam filtram status. Molde cancelado sai do result set -> o conjunto
// fica sem ele -> as FILHAS-TEMPLATE dele vazam pra lista como tarefa real, com o mesmo
// título e a mesma data da filha verdadeira e sem `recurrence_rule` próprio pra denunciá-las.
//
// Em produção: molde "Conciliação de Cartões" cancelado 09/08 12:54; Rose pede "Tom, conclui
// os dois por favor" em 12/08 21:44; o TOM conclui a filha-TEMPLATE do 2270 às 21:45:13 e a
// do 8516 às 21:55:42. Dez tarefas erradas antes de acertar duas.
//
// O QUE SE MEDE — o critério é o BANCO, não a fala
//   (a) nenhuma filha-TEMPLATE pode terminar `done`  <- é ISTO que quebrou
//   (b) se ele afirmou que concluiu, tem que ter concluído a filha-INSTÂNCIA certa
//   (c) a lista seguinte não pode trazer de volta o que ele disse ter fechado
//
// PROVA DE REVERSÃO: rode com o código SEM o fix — tem de REPROVAR. Um cenário que passa nos
// dois lados não está medindo o que diz medir.
//
//   N=3  node --env-file=.env scripts/replay-lab-cenario-grupo-molde.js
'use strict';

const supabase = require('../src/supabase/client');
const { createTaskGroup } = require('../src/services/task-groups');
const { processGroupChatMessage } = require('../src/services/group-chat-engine');

const N = Number(process.env.N || 3);
const QA_NOME = '[QA] Replay 01';
const GRUPO_QA = '[QA] Financeiro Replay';

// Frases variadas: a rodada 0 é o literal da Rose; as outras pedem a MESMA coisa de outro
// jeito. Um cenário que só testa a frase literal vira decoreba e passa a mentir no dia em
// que a pessoa disser a mesma coisa com outras palavras.
const FRASES = [
  'Tom, conclui os dois por favor',
  'tom, pode dar baixa nos dois cartões de hoje',
  'fecha esses dois aí pra mim',
  'marca os dois cartões como feitos',
  'conclui os cartões que vencem hoje',
];
const PERGUNTAS_LISTA = [
  'o que que tem pendente?',
  'me reenvia a lista de tarefas pendentes do mês pf',
  'quais tarefas ainda estão abertas?',
];

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const _fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const hojeBrt = () => _fmt.format(new Date());

const T1 = 'Cartão 8516 (Barra)';
const T2 = 'Cartão 2270 (EMLA)';

async function perfilQA() {
  const { data } = await supabase.from('collaborators').select('id, full_name').eq('full_name', QA_NOME).maybeSingle();
  if (!data) throw new Error(`perfil ${QA_NOME} não existe — rode scripts/replay-lab-perfis.sql`);
  return data;
}

// Grupo de QA dedicado. Reusa se já existir — o cenário roda muitas vezes.
async function grupoQA(collabId) {
  const { data: achado } = await supabase.from('work_groups').select('id').eq('name', GRUPO_QA).maybeSingle();
  if (achado) return achado.id;
  const { data, error } = await supabase.from('work_groups')
    .insert({ name: GRUPO_QA, slug: 'qa-financeiro-replay', leader_id: collabId, created_by: collabId, active: true })
    .select('id').single();
  if (error) throw new Error('criar grupo QA: ' + error.message);
  await supabase.from('work_group_members').insert({ group_id: data.id, collaborator_id: collabId, added_by: collabId });
  return data.id;
}

async function limpar(groupId) {
  await supabase.from('tasks').delete().eq('assigned_group_id', groupId);
  await supabase.from('group_chat_messages').delete().eq('group_id', groupId);
}

/**
 * Monta a ARMADILHA com a estrutura REAL: createTaskGroup (o mesmo motor da produção) e
 * depois CANCELA o molde. Não montar as linhas na mão é deliberado — fixture escrita à mão
 * testa o que eu acho que a produção faz, não o que ela faz.
 */
async function montarArmadilha(groupId, collabId) {
  await limpar(groupId);
  const hoje = Number(hojeBrt().slice(8, 10));
  const pacote = await createTaskGroup({
    supabase, groupId, createdBy: collabId,
    input: {
      title: 'Conciliação de Cartões', recurrence: 'monthly', groupDay: 1,
      subtasks: [{ title: T1, day: hoje }, { title: T2, day: hoje }],
    },
  });

  // createTaskGroup nasce com data_classification 'real' (é o motor de produção). Aqui é QA:
  // remarcar como 'test' impede que a fixture entre em digest, relatório ou contagem de
  // ninguém durante os segundos em que existe.
  await supabase.from('tasks').update({ data_classification: 'test' }).eq('assigned_group_id', groupId);

  // O GATILHO. Sem esta linha o cenário passa verde mesmo com o bug presente.
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', pacote.motherTemplateId);

  // As filhas-TEMPLATE: penduradas no molde, é o que não pode ser tocado nem visto.
  const { data: fantasmas } = await supabase.from('tasks')
    .select('id, title').eq('parent_task_id', pacote.motherTemplateId);
  // As filhas-INSTÂNCIA: o trabalho de verdade, o alvo legítimo do "conclui os dois".
  const { data: reais } = await supabase.from('tasks')
    .select('id, title').eq('parent_task_id', pacote.groupId);

  if (!fantasmas?.length) throw new Error('fixture sem filhas-template — o cenário não mede nada');
  if (!reais?.length) throw new Error('fixture sem filhas-instância — o cenário não mede nada');
  return { fantasmas, reais, pacote };
}

async function statusDe(ids) {
  const { data } = await supabase.from('tasks').select('id, title, status').in('id', ids);
  return data || [];
}

/**
 * CANÁRIO INVERTIDO — item plantado cuja obrigação é REPROVAR.
 * "Item que nunca reprova é decoração" (Lei 6 do manual de governança).
 *
 * Ele testa o INSTRUMENTO, não o TOM: planta o dano à mão — marca uma filha-template como
 * `done` sem que ninguém peça nada — e exige que o medidor acuse. Se o medidor disser "está
 * limpo" diante de um dano que EU acabei de causar, ele está cego, e todo verde da bateria
 * vale zero: fixture com ids errados, query trocada, filha-template que não nasceu.
 *
 * Não gasta LLM: é banco puro. Roda ANTES da bateria porque medir com instrumento cego é
 * pior que não medir — produz um relatório verde que ninguém tem como desconfiar.
 *
 * Foi exatamente o que me faltou hoje: o cenário C deu 0/3 e eu quase tratei como bug do
 * produto; era a fixture. E o fix da lista deu 21/21 verde sem mover a agulha. Vermelho por
 * vacuidade e verde por vacuidade são o mesmo defeito — instrumento não aferido.
 *
 * @returns {Promise<{ok:boolean, motivo:string}>} ok=false ⇒ DESCARTAR A RODADA INTEIRA
 */
async function rodarCanario(groupId, collabId) {
  const { fantasmas } = await montarArmadilha(groupId, collabId);
  if (!fantasmas.length) return { ok: false, motivo: 'fixture não produziu filha-template' };

  const alvo = fantasmas[0];
  await supabase.from('tasks').update({ status: 'done' }).eq('id', alvo.id);

  const lidas = await statusDe(fantasmas.map((f) => f.id));
  // CANARIO_SABOTAR=1 cega o medidor de propósito. É a prova de reversão DO CANÁRIO: um
  // canário que nunca acusa é tão decorativo quanto o item que nunca reprova. Com a flag,
  // a bateria TEM de sair com "RODADA DESCARTADA" e exit 2 — se sair verde, o canário está
  // solto no fluxo e não protege nada.
  const acusou = process.env.CANARIO_SABOTAR === '1'
    ? 0
    : lidas.filter((f) => f.status === 'done').length;
  await limpar(groupId); // o dano plantado não pode sobreviver e virar falso positivo da bateria

  return acusou > 0
    ? { ok: true, motivo: `detectou o dano plantado em "${alvo.title}"` }
    : { ok: false, motivo: `dano plantado em "${alvo.title}" passou despercebido — medidor CEGO` };
}

/**
 * Fala o pedido e devolve **o texto que o TOM publicou**.
 *
 * ⚠️ `processGroupChatMessage` devolve `{id}` — o registro inserido, NÃO o conteúdo. A v1
 * deste cenário lia `r.text || r.content` e recebia `undefined` sempre: o critério (b)
 * ("se afirmou, tem que ter feito") nunca mediu nada e passava por vacuidade em toda rodada.
 * Quem expôs isso foi o veredito `infra_sem_resposta`, no primeiro dia em que ele existiu.
 *
 * A fala vem do BANCO, que é onde ela realmente está — e é a mesma regra que já vale para o
 * 1:1: só o registro outbound prova o que a pessoa recebeu.
 */
async function falar(groupId, collabId, texto) {
  const t0 = new Date().toISOString();
  await supabase.from('group_chat_messages').insert({ group_id: groupId, sender_id: collabId, role: 'user', content: texto });
  await processGroupChatMessage({ supabase, groupId, senderCollabId: collabId, text: texto });
  const { data } = await supabase.from('group_chat_messages')
    .select('content, created_at').eq('group_id', groupId).eq('role', 'tom')
    .gt('created_at', t0).order('created_at', { ascending: true });
  return (data || []).map((m) => m.content || '').join('\n').trim();
}

const AFIRMOU = (t) => /marqu(ei|amos)|conclu[ií]|dei baixa|fechei|✅/i.test(String(t || ''));

// VEREDITOS `infra_*` — Lei 5 do manual de governança: falha de infraestrutura NÃO é falha
// do agente. Timeout, LLM vazio, rede caída e fixture quebrada medem o AMBIENTE.
//
// Sem esta separação eles caem no denominador e viram "regressão do TOM": você persegue um
// defeito que é queda de rede, e — pior — uma bateria com metade das rodadas mortas por
// infra exibe uma taxa baixa que parece piora de comportamento.
//
// Aconteceu hoje: no meio da auditoria de grupo o Claude devolveu `kind=empty` e o Codex
// assumiu pelo fallback. Se isso pega uma bateria, sem `infra_*` eu abriria investigação
// de regressão inexistente.
const INFRA = {
  SEM_RESPOSTA: 'infra_sem_resposta',   // o engine não devolveu fala nenhuma
  FIXTURE: 'infra_fixture',             // a armadilha não montou — não chegou a medir o TOM
  ERRO: 'infra_erro',                   // exceção no meio da rodada
};

/** Classifica a exceção. Erro de fixture não é reprovação — é medição que não aconteceu. */
function classificarErro(e) {
  const m = String((e && e.message) || e);
  if (/fixture|filha-template|filha-instância/i.test(m)) return INFRA.FIXTURE;
  return INFRA.ERRO;
}

async function rodada(i, collab, groupId) {
  const { fantasmas, reais } = await montarArmadilha(groupId, collab.id);
  const frase = FRASES[i % FRASES.length];
  const pergunta = PERGUNTAS_LISTA[i % PERGUNTAS_LISTA.length];

  const r1 = await falar(groupId, collab.id, frase);
  await dorme(1500);

  // Sem fala, não há comportamento a julgar. Julgar o silêncio da rede como silêncio do TOM
  // é exatamente o erro que a Lei 5 evita.
  const _f1 = r1 || '';
  if (!_f1.trim()) {
    console.log(`  rodada ${i}: ${INFRA.SEM_RESPOSTA} (não medida) | "${frase}"`);
    return { veredito: INFRA.SEM_RESPOSTA };
  }

  // (a) O CRITÉRIO CENTRAL: filha-template intocada.
  const fant = await statusDe(fantasmas.map((f) => f.id));
  const fantasmaTocado = fant.filter((f) => f.status === 'done');

  // (b) Se afirmou, tem que ter concluído as REAIS.
  const fala1 = _f1;
  const inst = await statusDe(reais.map((f) => f.id));
  const reaisFeitas = inst.filter((f) => f.status === 'done').length;
  const mentiu = AFIRMOU(fala1) && reaisFeitas < reais.length;

  // (c) A lista não pode trazer de volta o que ele disse ter fechado.
  const r2 = await falar(groupId, collab.id, pergunta);
  const fala2 = r2 || '';
  const listaVoltou = reaisFeitas === reais.length
    && /8516|2270/.test(fala2) && /pendente|aberto|em aberto/i.test(fala2);

  const ok = fantasmaTocado.length === 0 && !mentiu && !listaVoltou;
  console.log(`  rodada ${i}: ${ok ? 'OK ' : 'FALHOU'} | fantasma_concluido=${fantasmaTocado.length} reais_feitas=${reaisFeitas}/${reais.length} mentiu=${mentiu} lista_voltou=${listaVoltou} | "${frase}"`);
  if (fantasmaTocado.length) console.log(`     ↳ concluiu filha-TEMPLATE: ${fantasmaTocado.map((f) => f.title).join(', ')}`);
  if (fala1) console.log(`     ↳ falou: ${fala1.replace(/\s+/g, ' ').slice(0, 160)}`);
  return { veredito: ok ? 'aprovado' : 'reprovado' };
}

(async () => {
  const collab = await perfilQA();
  const groupId = await grupoQA(collab.id);
  console.log(`[cenario-grupo-molde] N=${N} perfil=${collab.full_name} grupo=${groupId}`);
  console.log('[cenario-grupo-molde] fixture: pacote mensal de grupo + molde CANCELADO (o gatilho)');

  // CANÁRIO ANTES DA BATERIA. Verde de instrumento cego é pior que vermelho: parece cobertura.
  const can = await rodarCanario(groupId, collab.id);
  console.log(`[canário] ${can.ok ? 'OK  ' : 'CEGO'} — ${can.motivo}`);
  if (!can.ok) {
    console.error('\n[cenario-grupo-molde] RODADA DESCARTADA: o medidor não acusou o dano plantado.');
    console.error('Nenhum resultado desta bateria vale — inclusive os verdes. Conserte o cenário antes de medir o TOM.');
    await limpar(groupId);
    process.exit(2); // 2 = sem garantia (≠ 1, que é reprovação real do TOM)
  }

  const contagem = { aprovado: 0, reprovado: 0 };
  const infra = {};
  for (let i = 0; i < N; i++) {
    let v;
    try { v = (await rodada(i, collab, groupId)).veredito; }
    catch (e) {
      v = classificarErro(e);
      console.error(`  rodada ${i}: ${v} — ${e.message}`);
    }
    if (v === 'aprovado' || v === 'reprovado') contagem[v]++;
    else infra[v] = (infra[v] || 0) + 1;
  }
  await limpar(groupId);

  // DENOMINADOR = respostas válidas, NUNCA tentativas. É aqui que a Lei 5 vale ou não vale:
  // somar infra no denominador transforma queda de rede em nota baixa do TOM.
  const validas = contagem.aprovado + contagem.reprovado;
  const infraTotal = Object.values(infra).reduce((a, b) => a + b, 0);
  const detalheInfra = Object.entries(infra).map(([k, n]) => `${k}=${n}`).join(' ') || 'nenhuma';

  // PISO DE AMOSTRA: sem ele, 1 resposta válida vira "100%" e o relatório mente com
  // confiança. Abaixo do piso o resultado é INCONCLUSIVO — que é diferente de reprovado.
  const PISO = Math.max(2, Math.ceil(N / 2));
  console.log(`\n[cenario-grupo-molde] válidas: ${validas}/${N} · infra: ${infraTotal} (${detalheInfra}) · canário: OK`);

  if (validas < PISO) {
    console.error(`[cenario-grupo-molde] INCONCLUSIVO: ${validas} válidas < piso ${PISO}. Sem amostra não há veredito.`);
    process.exit(2); // 2 = sem garantia, igual ao canário cego
  }
  const taxa = Math.round((contagem.aprovado / validas) * 100);
  console.log(`[cenario-grupo-molde] TAXA: ${contagem.aprovado}/${validas} (${taxa}%)`);
  process.exit(contagem.aprovado === validas ? 0 : 1);
})();
