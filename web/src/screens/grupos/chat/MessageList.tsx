// web/src/screens/grupos/chat/MessageList.tsx
import { useEffect, useRef } from 'react';
import { groupMessages, type ChatMsg } from '../../../lib/groupChat';
import { MessageBubble } from './MessageBubble';

// Distância do fundo (px) dentro da qual o auto-scroll é acionado
const NEAR_BOTTOM_PX = 120;

interface Props {
  messages: ChatMsg[];
  meId: string;
  /** Quando true, mostra a bolha "TOM está digitando…" */
  tomTyping?: boolean;
}

export function MessageList({ messages, meId, tomTyping = false }: Props) {
  const rows = groupMessages(messages, meId);
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Guarda o id da última mensagem do usuário para saber quando ele acabou de enviar
  const lastMineIdRef = useRef<string | null>(null);

  const mineMsgs = messages.filter(m => m.sender_id === meId);
  const lastMineId = mineMsgs.length > 0 ? mineMsgs[mineMsgs.length - 1].id : null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || messages.length === 0) return;

    const justSentByMe = lastMineId !== null && lastMineId !== lastMineIdRef.current;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom <= NEAR_BOTTOM_PX;

    if (justSentByMe || nearBottom) {
      endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }

    lastMineIdRef.current = lastMineId;
  }, [messages.length, lastMineId]);

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto px-md py-sm bg-bg-app">
      {rows.map(r => r.type === 'day'
        ? <div key={r.key} className="text-center my-sm"><span className="text-label text-fg-muted bg-bg-elevated rounded-full px-sm py-0.5">{r.label}</span></div>
        : <MessageBubble key={r.key} msg={r.msg} showAvatar={r.showAvatar} mine={r.mine} />
      )}

      {/* Indicador "TOM está digitando…" */}
      {tomTyping && (
        <div className="flex items-end gap-xs my-xs">
          <img src="/tom-avatar.png" alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
          <div className="bg-bg-elevated border border-border rounded-2xl rounded-bl-sm px-sm py-2 flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full bg-fg-muted"
              style={{ animation: 'tomDot 1.2s ease-in-out infinite', animationDelay: '0ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-fg-muted"
              style={{ animation: 'tomDot 1.2s ease-in-out infinite', animationDelay: '200ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-fg-muted"
              style={{ animation: 'tomDot 1.2s ease-in-out infinite', animationDelay: '400ms' }}
            />
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
