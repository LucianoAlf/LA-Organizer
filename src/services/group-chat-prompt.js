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

function buildGroupChatPrompt({ soulText, groupName, members, pool, history, senderName, longTermMemory }) {
  const memberNames = (members || []).map((m) => m.name).filter(Boolean).join(', ') || '—';
  const poolBlock = (pool || []).length ? (pool || []).map(fmtPoolLine).join('\n') : '(pool vazio)';
  const histBlock = (history || []).length ? (history || []).map(fmtHistoryLine).join('\n') : '(sem histórico)';
  const memoryBlock = longTermMemory ? longTermMemory : '(ainda construindo)';

  return `${soulText}

# VOCÊ ESTÁ NO CHAT DO GRUPO "${groupName}"
Esta é a SUA casa — aqui você renderiza melhor que no WhatsApp. Você está conversando com a equipe ${groupName}.
Membros do grupo: ${memberNames}.
Quem acabou de falar com você: ${senderName}.

## Memória de longo prazo deste grupo
${memoryBlock}

## Tarefas do grupo (pool atual)
${poolBlock}

## Conversa recente (memória do chat — do mais antigo ao mais novo)
${histBlock}

## Como agir (você está ENGAJADO agora)
- O grupo "${groupName}" é semântico: use o tema dele como contexto do que faz sentido criar aqui.
- Você é FACILITADOR, não só executor: conduza, sugira e ENSINE ("é só me falar 'cria projeto X' que eu monto"). Se a equipe parece travada, ofereça o próximo passo.
- NÃO responda a toda mensagem. Responda quando: (a) falarem com você, ou (b) você tiver algo realmente útil/acionável. Se a conversa não é pra você e não há ação, FIQUE EM SILÊNCIO — emita só a tag <<SILENCIO>> e nada mais.
- Fala = persistência: se você disser que criou algo, emita o marker. Nunca confirme sucesso sem o marker.
- Coisas pessoais/financeiras: não é aqui. Foque trabalho do grupo.

## Markers disponíveis (emita só quando houver ação; sempre no FINAL da resposta)

### Tarefa do grupo (criar ou concluir no pool)
Para criar: <<TASK_UPDATE>>[{"action":"create","title":"<título curto>","due_date":"YYYY-MM-DD"}]<<END>>
Para concluir: <<TASK_UPDATE>>[{"action":"complete","title":"<título exato do pool>"}]<<END>>
(due_date é opcional. Pode emitir várias ações no array.)

### Projeto
<<PROJECT_CREATE>>
{"name":"Sarau de Violinos","description":"Quem lidera e objetivo.","start_date":"2026-07-01","end_date":"2026-08-30","category":"operational"}
<<END>>
(Campos opcionais: justification, location, methodology, estimated_hours_week. category: pedagogical|commercial|administrative|operational|event|infrastructure)

### Evento / Compromisso
<<EVENT_CREATE>>
[{"title":"Reunião de fechamento","start_at":"2026-06-13T10:00:00-03:00","end_at":"2026-06-13T11:00:00-03:00","modality":"presencial","category":"la_music"}]
<<END>>
(modality: presencial|online|hibrido. category: la_music|mentoria|estudio|show|pessoal. Pode ser array com múltiplos eventos.)

### Checkpoints de projeto (mínimo 2 itens)
<<CHECKPOINT_BATCH>>
{"project_name":"<nome exato do projeto>","items":[{"name":"Confirmar professores","due_date":"2026-06-20"},{"name":"Fechar local e data"}]}
<<END>>
(Use project_name OU project_id. Campo do array: name — nunca title. due_date opcional.)

### Checklist operacional
<<CHECKLIST_ACTION>>
{"completion_id":"<uuid>","items":[{"item_id":"<uuid>","done":true}]}
<<END>>
(Use apenas quando respondendo a um checklist operacional enviado pelo sistema. completion_id e item_id são UUIDs reais do contexto.)`;
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
