'use strict';
// group-memory.js — o TOM guarda o que o GRUPO conversou.
//
// Por que existe: a memória semântica do TOM (collaborator_memory + Dream das 3h) sempre teve
// sujeito PESSOA. O Dream JÁ percorre os grupos no mesmo laço, mas só chama o auditor — ele
// julga o grupo e não guarda nada dele. Esta é a metade que faltava.
//
// Fatia 1: só ESCREVE. Nada aqui entra no prompt — ler é a Fatia 2, depois de o Alf conferir
// o que foi guardado.

const { prepararCandidatas, defaultsPorTipo } = require('./agent-memory');

const JANELA_HORAS = 24;   // grupo de trabalho conversa todo dia (o 1:1 usa 7d por outro motivo)
const TETO_POR_NOITE = 8;  // grupo movimentado não pode afogar a memória em uma noite
const EVIDENCE_MAX = 200;

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

async function consolidateGroupMemoryFor({ supabase, group, chat, getEmbedding, agora = new Date() }) {
  const desde = new Date(agora.getTime() - JANELA_HORAS * 3600 * 1000).toISOString();
  const out = { mensagens: 0, candidatas: 0, salvas: 0, descartadas: null, erro: null };

  const { data: msgs } = await supabase.from('group_chat_messages')
    .select('role, content, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
    .eq('group_id', group.id).gte('created_at', desde).order('created_at', { ascending: true });

  const mensagens = msgs || [];
  out.mensagens = mensagens.length;
  if (!mensagens.length) return out; // PISO: grupo parado não gasta LLM

  const historyText = montarHistorico(mensagens);
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

  const { aceitas, descartadas } = prepararCandidatas(candidatas, existentes, { teto: TETO_POR_NOITE });
  out.descartadas = descartadas;

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
      decay_at: c.decay_at || null,
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

module.exports = {
  montarHistorico, extrairMemoriaDeGrupo, consolidateGroupMemoryFor, deveConsolidarGrupo,
  JANELA_HORAS, TETO_POR_NOITE,
};
