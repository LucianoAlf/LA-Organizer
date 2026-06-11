// web/src/screens/grupos/chat/MessageBubble.tsx
// Bolha do chat de grupo (Fase 1). HTML SEMPRE via DOMPurify (mesmo do TOM).
import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ChatMsg } from '../../../lib/groupChat';

const SP = 'America/Sao_Paulo';
function hm(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
function firstName(n: string | null) { return (n ?? '').split(' ')[0] || '—'; }
function safeSrc(url: string | null): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}
const PURIFY = { ALLOWED_TAGS: ['b','strong','i','em','u','a','p','br','ul','ol','li','h3','h4','table','thead','tbody','tr','th','td','span','div','code','pre','blockquote'], ALLOWED_ATTR: ['href','target','rel'] };

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noreferrer noopener');
  }
});

export function MessageBubble({ msg, showAvatar, mine }: { msg: ChatMsg; showAvatar: boolean; mine: boolean }) {
  const isTom = msg.role === 'tom';
  const html = useMemo(() => {
    if (!msg.content) return '';
    const raw = msg.kind === 'report' ? msg.content : (marked.parse(msg.content, { async: false }) as string);
    return DOMPurify.sanitize(raw, PURIFY);
  }, [msg.content, msg.kind]);

  const avatar = isTom
    ? <img src="/tom-avatar.png" alt="TOM" className="w-7 h-7 rounded-full object-cover shrink-0" />
    : msg.sender_avatar
      ? <img src={msg.sender_avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
      : <span className="w-7 h-7 rounded-full bg-bg-elevated grid place-items-center text-label text-fg-muted shrink-0">{firstName(msg.sender_name)[0]}</span>;

  const bubbleCls = mine
    ? 'bg-tom text-black rounded-2xl rounded-br-sm'
    : isTom
      ? 'bg-tom-tint border border-tom rounded-2xl rounded-bl-sm'
      : 'bg-bg-surface border border-border rounded-2xl rounded-bl-sm';

  return (
    <div className={`flex gap-sm mb-xs ${mine ? 'flex-row-reverse' : ''}`}>
      <div className="w-7 shrink-0">{!mine && showAvatar && avatar}</div>
      <div className={`max-w-[78%] min-w-0 ${mine ? 'items-end' : ''}`}>
        {!mine && showAvatar && <div className="text-label text-tom-deep mb-0.5">{isTom ? 'TOM' : firstName(msg.sender_name)}</div>}
        <div className={`px-md py-sm ${bubbleCls}`}>
          {msg.kind === 'image' && safeSrc(msg.media_url) && (
            <a href={safeSrc(msg.media_url)} target="_blank" rel="noreferrer"><img src={safeSrc(msg.media_url)} alt={msg.media_filename ?? ''} className="rounded-md max-h-60 mb-xs" /></a>
          )}
          {msg.kind === 'audio' && safeSrc(msg.media_url) && (
            <audio controls src={safeSrc(msg.media_url)} className="max-w-full mb-xs" />
          )}
          {msg.kind === 'pdf' && safeSrc(msg.media_url) && (
            <a href={safeSrc(msg.media_url)} target="_blank" rel="noreferrer" className="flex items-center gap-xs text-body-sm underline mb-xs">📄 {msg.media_filename ?? 'documento.pdf'}</a>
          )}
          {html && (
            msg.kind === 'report'
              ? <div className="rounded-md border border-tom overflow-hidden text-body-sm break-words [&_h4]:bg-tom [&_h4]:text-black [&_h4]:px-sm [&_h4]:py-xs [&_h4]:font-bold [&>div]:p-sm [&_li]:my-0.5" dangerouslySetInnerHTML={{ __html: html }} />
              : <div className="text-body-sm leading-relaxed break-words [&_a]:underline [&_ul]:list-disc [&_ul]:pl-4" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          <div className={`text-[10px] mt-0.5 ${mine ? 'text-black/60' : 'text-fg-muted'}`}>{hm(msg.created_at)}</div>
        </div>
        {msg.kind === 'report' && (
          <div className="flex gap-xs mt-xs">
            <a href={`data:text/html;charset=utf-8,${encodeURIComponent(msg.content ?? '')}`} download="resumo.html" className="text-label text-fg-muted hover:text-fg">⬇ Baixar</a>
          </div>
        )}
      </div>
    </div>
  );
}
