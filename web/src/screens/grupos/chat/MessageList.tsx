// web/src/screens/grupos/chat/MessageList.tsx
import { useEffect, useRef } from 'react';
import { groupMessages, type ChatMsg } from '../../../lib/groupChat';
import { MessageBubble } from './MessageBubble';

export function MessageList({ messages, meId }: { messages: ChatMsg[]; meId: string }) {
  const rows = groupMessages(messages, meId);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  return (
    <div className="flex-1 overflow-y-auto px-md py-sm bg-bg-app">
      {rows.map(r => r.type === 'day'
        ? <div key={r.key} className="text-center my-sm"><span className="text-label text-fg-muted bg-bg-elevated rounded-full px-sm py-0.5">{r.label}</span></div>
        : <MessageBubble key={r.key} msg={r.msg} showAvatar={r.showAvatar} mine={r.mine} />
      )}
      <div ref={endRef} />
    </div>
  );
}
