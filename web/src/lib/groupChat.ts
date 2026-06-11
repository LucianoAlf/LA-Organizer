// web/src/lib/groupChat.ts
// Puras do chat de grupo (Fase 1): agrupamento visual + contagem de não-lidas.
export interface ChatMsg {
  id: string; group_id: string; sender_id: string | null;
  role: 'member' | 'tom' | 'system';
  kind: 'text' | 'image' | 'pdf' | 'audio' | 'report';
  content: string | null; media_url: string | null; media_mime: string | null; media_filename: string | null;
  sender_name: string | null; sender_avatar: string | null; created_at: string;
}
export interface DayRow { type: 'day'; key: string; label: string; }
export interface MsgRow { type: 'msg'; key: string; msg: ChatMsg; showAvatar: boolean; mine: boolean; }
export type ChatRow = DayRow | MsgRow;

const SP = 'America/Sao_Paulo';
function ymdSP(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function dayLabel(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return 'hoje';
  const d = new Date(ymd + 'T12:00:00Z'); const t = new Date(todayYmd + 'T12:00:00Z');
  if (Math.round((t.getTime() - d.getTime()) / 86400000) === 1) return 'ontem';
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

/** Constrói as linhas renderizáveis: divisores de dia + flag de avatar (1º de um bloco do mesmo remetente no mesmo dia). */
export function groupMessages(messages: ChatMsg[], meId?: string): ChatRow[] {
  const todayYmd = ymdSP(new Date().toISOString());
  const rows: ChatRow[] = [];
  let lastDay = ''; let lastSender = '';
  for (const msg of messages) {
    const ymd = ymdSP(msg.created_at);
    if (ymd !== lastDay) {
      rows.push({ type: 'day', key: `day-${ymd}`, label: dayLabel(ymd, todayYmd) });
      lastDay = ymd; lastSender = '';
    }
    const senderKey = msg.role === 'tom' ? 'tom' : (msg.sender_id ?? 'system');
    const showAvatar = senderKey !== lastSender;
    lastSender = senderKey;
    rows.push({ type: 'msg', key: msg.id, msg, showAvatar, mine: !!meId && msg.sender_id === meId });
  }
  return rows;
}

/** Não-lidas = mensagens de OUTROS remetentes após lastReadIso (null = nunca leu). */
export function unreadCount(messages: ChatMsg[], lastReadIso: string | null, meId: string): number {
  return messages.filter(x => x.sender_id !== meId && (!lastReadIso || x.created_at > lastReadIso)).length;
}
