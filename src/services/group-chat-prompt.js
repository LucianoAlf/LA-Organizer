// src/services/group-chat-prompt.js
// Chat de grupo Fase 2 — montagem do system prompt do TOM DENTRO do chat do grupo.
// buildGroupChatPrompt: formatação PURA (recebe soul + contexto). loadGroupChatSoul: thin I/O.
const fs = require('fs');
const path = require('path');

function fmtPoolLine(t) {
  const status = t.status === 'done' ? '✓ concluída' : 'pendente';
  const due = t.due_date ? ` (prazo ${t.due_date})` : '';
  return `- ${t.title} — ${status}${due}`;
}

function fmtHistoryLine(m) {
  const who = m.role === 'tom' ? 'TOM' : (m.who || 'alguém');
  return `${who}: ${m.content || ''}`;
}

function buildGroupChatPrompt({ soulText, groupName, members, pool, history, senderName }) {
  const memberNames = (members || []).map((m) => m.name).filter(Boolean).join(', ') || '—';
  const poolBlock = (pool || []).length ? (pool || []).map(fmtPoolLine).join('\n') : '(pool vazio)';
  const histBlock = (history || []).length ? (history || []).map(fmtHistoryLine).join('\n') : '(sem histórico)';

  return `${soulText}

# VOCÊ ESTÁ NO CHAT DO GRUPO "${groupName}"
Esta é a SUA casa — aqui você renderiza melhor que no WhatsApp. Você está conversando com a equipe ${groupName}.
Membros do grupo: ${memberNames}.
Quem acabou de falar com você: ${senderName}.

## Tarefas do grupo (pool atual)
${poolBlock}

## Conversa recente (memória do chat — do mais antigo ao mais novo)
${histBlock}

## Como agir
- Você foi CHAMADO agora. Responda direto ao ponto, no tom da casa: leve, claro, sem enrolação.
- Você pode CRIAR ou CONCLUIR tarefa do grupo a partir da conversa. Para isso, emita o marker abaixo no FINAL da resposta.
- Toda tarefa que você criar entra no POOL do grupo (qualquer membro pega).
- NÃO invente conclusão: só conclua tarefa que existe no pool e que a conversa confirma como feita.
- Se não há ação a tomar, só responda em texto — não emita marker.

## Marker de tarefa (emita só quando houver ação)
Para criar: <<TASK_UPDATE>>[{"action":"create","title":"<título curto>","due_date":"YYYY-MM-DD"}]<<END>>
Para concluir: <<TASK_UPDATE>>[{"action":"complete","title":"<título exato do pool>"}]<<END>>
(due_date é opcional. Pode emitir várias ações no array.)`;
}

function loadGroupChatSoul() {
  // SOUL real fica em D:/la-organizer/soul/SOUL.md (dois níveis acima de _remote/src/services).
  // Degrada gracioso se não achar (nunca lança).
  try {
    const soulPath = path.join(__dirname, '..', '..', '..', 'soul', 'SOUL.md');
    return fs.readFileSync(soulPath, 'utf8');
  } catch (_) {
    return 'Você é o TOM, o assistente da equipe. Tom leve, direto, prestativo.';
  }
}

module.exports = { buildGroupChatPrompt, loadGroupChatSoul, fmtPoolLine, fmtHistoryLine };
