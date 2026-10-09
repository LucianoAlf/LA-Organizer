'use strict';
// src/lib/jev-sombra.js — SOMBRA do Jev nas conversas 1:1 (Alf 09/10). SÓ REGISTRA, nunca muda resposta.
//
// O Jev (typesafe/jev-1.13, OpenRouter) é o "mordomo" que na Maria escolhe a ferramenta. Aqui ele decide em
// paralelo — DEPOIS que o TOM já respondeu — qual assunto (gaveta) e qual ação (caixa) a fala pedia, e a gente
// compara com o pickSkill e com o marcador que o TOM emitiu de fato. Bancada de 09/10 (115 frases reais,
// rótulo antes): assunto 99/115 × pickSkill 26/88 nas falas com pedido; 0 sugestão de escrita errada com
// confiança ≥ 0,9. Doc: docs/arquitetura/2026-10-08-handoff-mordomo-jev.md.
//
// Regras (condições do Alf):
//  - TOM_JEV_SOMBRA=1 liga; qualquer outro valor desliga (pm2 restart --update-env, sem deploy).
//  - fire-and-forget: o engine chama sem await; falha/timeout = nada muda, nada é lançado.
//  - registro sem telefone (collaborator_id + fala mascarada), header X-Title: Tom.
//  - fala curta (só palavras de continuação) não recebe sugestão de escrita: fica com a confirmação do TOM.
const fs = require('fs');
const path = require('path');

const URL = 'https://openrouter.ai/api/alpha/decisions';
const MODELO = 'typesafe/jev-1.13';
const TIMEOUT_MS = 6000;
const ARQUIVO = path.join(__dirname, '..', '..', 'logs', 'jev-sombra.jsonl');

// GAVETAS = assuntos; exemplos genéricos (não são frases de teste). CAIXAS = ação por gaveta; GRAVA = escrita.
const GAVETAS = {
  tarefas: 'Tarefas e lembretes: criar ("me lembra amanhã 9h de ligar pro fornecedor"), concluir ("feito", "fecha", "já fiz"), remarcar ("passa pra sexta"), cancelar, delegar tarefa para um colega.',
  agenda: 'Compromissos com horário na agenda (reunião, ensaio, evento, aula, mentoria): criar, responder convite ("vou", "posso"), dizer como foi / fechar o compromisso do dia, remarcar ou encerrar uma série.',
  recados: 'Mandar recado, aviso ou pergunta para OUTRA pessoa da equipe ("avisa a Rose que...", "pergunta pro João se...", "responde ele que...").',
  manutencao: 'Problema físico ou compra para a escola: defeito, conserto, vazamento, lâmpada, equipamento, instrumento, foto de algo quebrado, valor de peça.',
  financeiro: 'Dinheiro pessoal do usuário: gasto, compra, conta paga, quanto gastou.',
  habitos: 'Hábitos pessoais recorrentes (remédio, vitamina, exercício): registrar, pausar ou parar o aviso do hábito.',
  projetos: 'Projetos da escola: andamento, etapas, aprovação de projeto.',
  consulta: 'Pergunta que pede informação: o que tenho hoje/na semana, quando é tal compromisso, o que fulano tem pendente, números da escola, link do sistema.',
  conversa: 'Papo, cumprimento, agradecimento, emoji, "ok", comentário sem pedido, mensagem cortada.',
};
const CAIXAS = {
  tarefas: { tarefa_criar: 'GRAVA criar tarefa ou lembrete', tarefa_concluir: 'GRAVA marcar tarefa como feita', tarefa_reagendar: 'GRAVA mudar a data da tarefa', tarefa_cancelar: 'GRAVA cancelar/apagar tarefa ou rotina', tarefa_delegar: 'GRAVA passar tarefa para outra pessoa', nenhuma: 'nada a gravar' },
  agenda: { evento_criar: 'GRAVA criar compromisso com horário', evento_concluir: 'GRAVA fechar compromisso que já aconteceu', evento_rsvp: 'GRAVA responder convite', evento_editar: 'GRAVA remarcar, cancelar ou encerrar série', consulta: 'só consultar a agenda' },
  recados: { recado: 'GRAVA mandar recado/aviso para colega (com confirmação)', nenhuma: 'não mandar nada' },
  manutencao: { manutencao_registrar: 'GRAVA registrar demanda de manutenção ou compra' },
  financeiro: { gasto_registrar: 'GRAVA registrar gasto/receita pessoal', consulta: 'consultar gastos' },
  habitos: { habito: 'GRAVA registrar/pausar/parar hábito' },
  projetos: { nenhuma: 'conversa sobre projeto' },
  consulta: { consulta: 'só ler e responder' },
  conversa: { nenhuma: 'nada a fazer' },
};
const grava = (c) => !['nenhuma', 'consulta', 'confirmacao_do_tom', 'erro'].includes(c);

// Trava de fala curta — regra da Maria (porteiro2.falaCurta) + léxico do TOM (09/10).
const CONTINUACAO = new Set(('pode podes manda mande segue seguir siga sim ok okay isso vai bora grava gravar confirma confirmo ' +
  'aplica aplicar beleza blz certo correto perfeito faz fazer fecha fechar pronto entao so e o a os as para pra pro de do da ' +
  'dos das um uma com maria tambem tudo todos todas proximos proximas proximo proxima esse essa esses essas aqui ai ja agora ' +
  'mesmo la por favor obrigado obrigada valeu dale show top otimo isto assim continua continuar pode-seguir ' +
  'concluida concluido feito feita fechou ainda hj tom').split(' '));
const limpa = (t) => String(t || '').replace(/\[O usuário[^\]]*\]\s*/g, '').replace(/\[áudio transcrito\]\s*/gi, '').trim();
function falaCurta(fala) {
  const t = limpa(fala);
  if (!t || /\d/.test(t)) return false;
  const w = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z-]+/).filter(Boolean);
  return w.length > 0 && w.length <= 6 && w.every((x) => CONTINUACAO.has(x));
}

const mascara = (t) => String(t || '')
  .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[email]')
  .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
  .replace(/\+?\d[\d\s().-]{8,}\d/g, '[tel]');

// Títulos que a fala pode estar citando: na mensagem citada, ou na última do TOM.
const citada = (fala) => (/RESPONDENDO a esta mensagem anterior[^:]*:\s*"([\s\S]*?)"\]/.exec(String(fala || '')) || [])[1] || '';
function titulosCitados(t) {
  const s = String(t || '');
  const out = [];
  const conv = /\[convite de [^:]+:\s*([^\]]+)\]/.exec(s); if (conv) out.push(conv[1].trim());
  const lem = /hora de\s+"([^"]+)"/.exec(s); if (lem) out.push(lem[1].trim());
  for (const m of s.matchAll(/\*([^*\n]{4,80})\*/g)) out.push(m[1].trim());
  return out.filter((x) => !/^(PESSOAL|TRABALHO|Fechamento do dia|Lembrete:|Governança|Higiene de tarefas|Seu scorecard|Atrasadas:|Projetos parados:)/i.test(x) && !/^\d/.test(x)).slice(0, 4);
}

function estado(fala, ultimaDoTom, item) {
  let s = `Mensagem para o Tom (assistente de tarefas e agenda da equipe da LA Music, escola de música): "${limpa(fala).slice(0, 700)}"`;
  if (/ACABOU DE ENVIAR uma imagem/.test(String(fala || ''))) s += '\nA mensagem veio com uma FOTO (a descrição está no texto).';
  if (ultimaDoTom) s += `\nÚltima mensagem do Tom antes desta: "${String(ultimaDoTom).slice(0, 500)}"`;
  if (item && item.tipo) s += `\nEla está respondendo sobre um item que é ${item.tipo.toUpperCase()}: "${item.titulo}"`;
  return s;
}

async function decidir(state, questions, { chave, fetchImpl, timeoutMs }) {
  const t0 = Date.now();
  try {
    const r = await fetchImpl(URL, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json', 'X-Title': 'Tom' },
      body: JSON.stringify({ model: MODELO, state, questions }),
    });
    if (!r.ok) return { erro: `http_${r.status}`, ms: Date.now() - t0 };
    return { ...(await r.json()), ms: Date.now() - t0 };
  } catch (e) {
    return { erro: e && e.name === 'TimeoutError' ? 'timeout' : 'falha', ms: Date.now() - t0 };
  }
}

/** Pergunta ao Jev (2 passos, igual porteiro2 da Maria). Nunca lança. */
async function perguntarJev(fala, ultimaDoTom, item, { chave = process.env.OPENROUTER_API_KEY, fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!chave) return { erro: 'sem_chave' };
  const st = estado(fala, ultimaDoTom, item);
  const op = { chave, fetchImpl, timeoutMs };
  const r1 = await decidir(st, { gaveta: { type: 'choice', instructions: 'Qual gaveta (assunto) desta mensagem para o Tom?', criteria: GAVETAS } }, op);
  const g = r1 && r1.answers && r1.answers.gaveta;
  if (!g || !g.choice) return { erro: r1.erro || 'sem_gaveta', ms: r1.ms };
  const out = { gaveta: g.choice, conf_gaveta: g.confidence ?? 0, caixa: 'nenhuma', conf_caixa: 0, ms: r1.ms, custo: (r1.usage && r1.usage.cost) || 0 };
  const opc = CAIXAS[g.choice] || {};
  const ks = Object.keys(opc);
  if (ks.length === 1) { out.caixa = ks[0]; out.conf_caixa = out.conf_gaveta; } else if (ks.length > 1) {
    const r2 = await decidir(st, { caixa: { type: 'choice', instructions: 'O que o Tom deve fazer? Se a pessoa pediu para mudar/registrar/fechar algo, escolha a que GRAVA; se pediu informação ou só conversou, a que não grava.', criteria: opc } }, op);
    const c = r2 && r2.answers && r2.answers.caixa;
    out.caixa = (c && c.choice) || 'erro'; out.conf_caixa = (c && c.confidence) ?? 0;
    out.ms += r2.ms || 0; out.custo += (r2.usage && r2.usage.cost) || 0;
  }
  out.fala_curta = falaCurta(fala);
  if (out.fala_curta && grava(out.caixa)) { out.caixa_jev = out.caixa; out.caixa = 'confirmacao_do_tom'; }
  return out;
}

/** Monta a linha do registro (sem telefone). PURO. */
function montarRegistro({ collabId, fala, metrics, item, jev, agora = new Date() }) {
  return {
    ts: agora.toISOString(),
    collaborator_id: collabId,
    fala: mascara(limpa(fala)).slice(0, 300),
    item_tipo: (item && item.tipo) || '',
    skill_pick: (metrics && metrics.skill_active) || null,
    tom_marcador: (metrics && metrics.marker_emitted) || '',
    tom_resultado: (metrics && metrics.marker_result) || '',
    tom_acionavel: !!(metrics && metrics.actionable_intent),
    ...jev,
  };
}

// Tipo do item citado, resolvido pelo BANCO (compromisso × tarefa × projeto × hábito).
async function resolverItem(sb, collabId, fonte) {
  if (/hora de\s+"/.test(fonte) && /💊|💪/.test(fonte)) return { tipo: 'hábito', titulo: titulosCitados(fonte)[0] || '' };
  for (const t of titulosCitados(fonte)) {
    const q = t.replace(/[%_,()]/g, ' ').trim().slice(0, 60);
    const [ev, tk, pj] = await Promise.all([
      sb.from('events').select('id').eq('collaborator_id', collabId).ilike('title', `%${q}%`).limit(1),
      sb.from('tasks').select('id').or(`assigned_to.eq.${collabId},created_by.eq.${collabId}`).ilike('title', `%${q}%`).limit(1),
      sb.from('projects').select('id').ilike('name', `%${q}%`).limit(1),
    ]);
    const e = !!(ev.data && ev.data.length); const k = !!(tk.data && tk.data.length);
    if (e && !k) return { tipo: 'compromisso', titulo: t };
    if (k && !e) return { tipo: 'tarefa', titulo: t };
    if (e && k) return { tipo: 'compromisso ou tarefa (mesmo título)', titulo: t };
    if (pj.data && pj.data.length) return { tipo: 'projeto', titulo: t };
    if (/\[convite de/.test(fonte)) return { tipo: 'compromisso', titulo: t };
  }
  return null;
}

/**
 * Ponto de entrada do engine — chamado SEM await, depois do recordMessage. Nunca lança.
 * Lê a fala e a última do TOM do histórico (fonte única), pergunta ao Jev e grava 1 linha em logs/jev-sombra.jsonl.
 */
async function registrarSombra(collabId, metrics, { sb = require('../supabase/client'), arquivo = ARQUIVO, env = process.env, perguntar = perguntarJev } = {}) {
  try {
    if (env.TOM_JEV_SOMBRA !== '1' || !collabId) return null;
    const { data } = await sb.from('conversation_history').select('direction, content')
      .eq('collaborator_id', collabId).order('created_at', { ascending: false }).limit(8);
    const h = data || [];
    const iIn = h.findIndex((m) => m.direction === 'inbound');
    if (iIn < 0) return null;
    const fala = h[iIn].content || '';
    if (!limpa(fala)) return null;
    const ult = h.slice(iIn + 1).find((m) => m.direction === 'outbound');
    const ultimaDoTom = ult ? mascara(ult.content).slice(0, 500) : '';
    let item = null;
    try { item = await resolverItem(sb, collabId, citada(fala) || ultimaDoTom); } catch (_) { item = null; }
    const jev = await perguntar(fala, ultimaDoTom, item, { chave: env.OPENROUTER_API_KEY });
    const linha = montarRegistro({ collabId, fala, metrics, item, jev });
    fs.appendFileSync(arquivo, JSON.stringify(linha) + '\n');
    return linha;
  } catch (e) {
    try { console.warn('[JevSombra] falhou (nada muda):', String(e && e.message).slice(0, 120)); } catch (_) { /* nada */ }
    return null;
  }
}

module.exports = { registrarSombra, perguntarJev, montarRegistro, falaCurta, mascara, titulosCitados, estado, GAVETAS, CAIXAS, grava, ARQUIVO };
