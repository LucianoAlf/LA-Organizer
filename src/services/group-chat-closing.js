// src/services/group-chat-closing.js
// Chat de grupo Fase 3 — card de fechamento proativo.
//
// Chamado pelo group-chat-watcher quando um grupo engajado fica idle >= 8min.
// Idempotente: se tom_chat_closed_session_at >= tom_chat_engaged_at, a sessão
// já foi fechada e retorna sem fazer nada. Degrada gracioso (try/catch, nunca lança).

const ai = require('../ai/provider');
const { loadGroupChatSoul } = require('./group-chat-prompt');

// Limite do resumo rolante em caracteres.
const MEMORY_LIMIT = 3000;
// Quantas mensagens recentes carregar para resumir.
const CLOSING_HISTORY_LIMIT = 40;

/**
 * Gera card de fechamento (kind='report', HTML) quando o grupo esteve engajado
 * e ficou idle >= 8min. Atualiza tom_chat_memory (resumo rolante), seta
 * tom_chat_closed_session_at=now() e tom_chat_engaged_at=null.
 *
 * @param {{ supabase: object, group: object }} opts
 *   group deve ter: id, name, tom_chat_engaged_at, tom_chat_closed_session_at, tom_chat_memory
 */
async function processGroupChatClosing({ supabase, group }) {
  try {
    // ── Guard de idempotência ─────────────────────────────────────────────────
    // Se closed_session_at já existe E é >= engaged_at, esta sessão já foi fechada.
    if (group.tom_chat_closed_session_at && group.tom_chat_engaged_at) {
      const closedAt = new Date(group.tom_chat_closed_session_at).getTime();
      const engagedAt = new Date(group.tom_chat_engaged_at).getTime();
      if (closedAt >= engagedAt) {
        return; // já fechou esta sessão
      }
    }
    // Se não há engajamento registrado, não há sessão a fechar.
    if (!group.tom_chat_engaged_at) return;

    // ── Carregar histórico desde o engajamento ────────────────────────────────
    const { data: histRows, error: histErr } = await supabase
      .from('group_chat_messages')
      .select('role, content, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
      .eq('group_id', group.id)
      .gte('created_at', group.tom_chat_engaged_at)
      .order('created_at', { ascending: true })
      .limit(CLOSING_HISTORY_LIMIT);

    if (histErr) {
      console.error(`[GroupChat][closing] erro ao carregar histórico grupo=${group.id}:`, histErr.message);
      return;
    }

    // ── Substance guard ───────────────────────────────────────────────────────
    // Só vale postar card de fechamento se a sessão teve TRABALHO real (alguma ação do TOM,
    // marcada por ‹‹ACTIONS›› no content) OU discussão substancial (>=4 mensagens de membro).
    // Sessão trivial ("fala tom"/"oi") → desengaja em SILÊNCIO, sem poluir o chat com card vazio.
    const rows = histRows || [];
    const hadActions = rows.some((m) => m.role === 'tom' && (m.content || '').includes('‹‹ACTIONS››'));
    const memberMsgs = rows.filter((m) => m.role === 'member').length;
    if (!hadActions && memberMsgs < 4) {
      await supabase.from('work_groups')
        .update({ tom_chat_engaged_at: null, tom_chat_closed_session_at: new Date().toISOString() })
        .eq('id', group.id);
      console.log(`[GroupChat][closing] sessão sem substância — desengajado em silêncio grupo=${group.id}`);
      return;
    }

    const histText = rows
      .map((m) => {
        const who = m.role === 'tom' ? 'TOM' : ((m.sender?.preferred_name || m.sender?.full_name || '').split(' ')[0] || 'alguém');
        return `${who}: ${(m.content || '').replace('‹‹ACTIONS››', ' [ações: ')}`;
      })
      .join('\n') || '(sem mensagens nesta sessão)';

    // ── Montar prompt de fechamento ───────────────────────────────────────────
    const soulText = loadGroupChatSoul();
    const previousMemory = group.tom_chat_memory
      ? `\n\n## Memória anterior do grupo (longo prazo)\n${group.tom_chat_memory}`
      : '';

    const systemPrompt = `${soulText}${previousMemory}

# TAREFA: RESUMO DE FECHAMENTO DE SESSÃO — grupo "${group.name}"

A conversa esfriou (silêncio >= 8 min). Gere um card de fechamento em HTML simples.

## Conversa desta sessão
${histText}

## Instruções do card
- Retorne APENAS o HTML, sem markdown, sem explicações fora da tag.
- Use somente tags básicas: <div>, <p>, <ul>, <li>, <strong>, <em>, <h3>.
- Estrutura obrigatória (com emoji no título de cada bloco pra dar HIERARQUIA visual):
  1. <h3>📋 Resumo da sessão</h3> seguido de <ul> com 2 a 4 <li> CURTOS — UMA ideia por item.
     NUNCA um parágrafo corrido/denso: quebre em itens curtos e escaneáveis.
  2. <h3>✅ Em aberto</h3> seguido de <ul><li>...</li></ul> — o que ficou pendente
     (se nada, <p>(nenhuma pendência identificada)</p>).
  3. <p><em>Quer transformar algum item em tarefa? É só me chamar. 👋</em></p>
- FORMATAÇÃO É OBRIGATÓRIA: cada item em sua própria linha (<li>), frases curtas, sem
  blocão de texto. O leitor tem que bater o olho e entender — nada de maçaroca.
- Seja conciso: o card inteiro não deve passar de 250 palavras.
- Tom: leve, direto, sem jargão corporativo.
- ANTI-CONFABULAÇÃO: NUNCA afirme que o sistema "não tem" uma funcionalidade. O sistema TEM recorrência (tarefas/eventos), lembretes, projetos, checklists e anotações. Se a conversa antiga sugeriu o contrário, NÃO repita esse erro no resumo.`;

    // ── Chamar IA ─────────────────────────────────────────────────────────────
    let response;
    try {
      response = await ai.chat(systemPrompt, [{ role: 'user', content: 'Gere o card de fechamento.' }]);
    } catch (aiErr) {
      console.error(`[GroupChat][closing] IA falhou grupo=${group.id}:`, aiErr.message?.slice(0, 200));
      return;
    }

    const cardHtml = (response.text || '').trim();
    if (!cardHtml) {
      console.warn(`[GroupChat][closing] IA retornou vazio para grupo=${group.id}`);
      return;
    }

    // ── Inserir card de fechamento (kind='report') ────────────────────────────
    const { error: insertErr } = await supabase.from('group_chat_messages').insert({
      group_id: group.id,
      sender_id: null,
      role: 'tom',
      kind: 'report',
      content: cardHtml,
      channel: 'app',
    });
    if (insertErr) {
      console.error(`[GroupChat][closing] falha ao inserir card grupo=${group.id}:`, insertErr.message);
      return;
    }

    // ── Atualizar tom_chat_memory (resumo rolante, limite ~3000 chars) ────────
    const separator = group.tom_chat_memory ? '\n\n---\n\n' : '';
    const rawMemory = (group.tom_chat_memory || '') + separator + cardHtml;
    // Trunca pelo início mantendo os últimos MEMORY_LIMIT chars (memória mais recente ganha).
    const newMemory = rawMemory.length > MEMORY_LIMIT
      ? rawMemory.slice(rawMemory.length - MEMORY_LIMIT)
      : rawMemory;

    const now = new Date().toISOString();
    const { error: updateErr } = await supabase.from('work_groups').update({
      tom_chat_memory: newMemory,
      tom_chat_closed_session_at: now,
      tom_chat_engaged_at: null,
    }).eq('id', group.id);

    if (updateErr) {
      console.error(`[GroupChat][closing] falha ao atualizar grupo=${group.id}:`, updateErr.message);
      return;
    }

    console.log(`[GroupChat][closing] sessão fechada para grupo=${group.id} (${group.name})`);
  } catch (err) {
    // Degrada gracioso — nunca propaga exceção para o watcher.
    console.error(`[GroupChat][closing] erro inesperado grupo=${group.id}:`, err.message);
  }
}

module.exports = { processGroupChatClosing };
