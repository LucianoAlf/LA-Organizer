// web/src/screens/grupos/chat/GroupChatDrawer.tsx
// Drawer do chat do grupo (Fase 1): desktop empurra o conteúdo (380px), tela cheia
// (overlay) e mobile sempre tela cheia. Lista + composer; realtime cobre a sync.
import { useEffect } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useGroupChat } from '../../../hooks/useGroupChat';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

interface Props {
  groupId: string;
  groupName: string;
  membersLine: string;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onSeen: () => void;
}

export function GroupChatDrawer({ groupId, groupName, membersLine, fullscreen, onToggleFullscreen, onClose, onSeen }: Props) {
  const chat = useGroupChat(groupId);
  const msgs = chat.messages.data ?? [];

  // Marca como lido quando a query resolve e quando chega mensagem nova (chat aberto).
  useEffect(() => { if (chat.messages.isSuccess) onSeen(); }, [msgs.length, chat.messages.isSuccess, onSeen]);

  return (
    <aside
      className={[
        'flex flex-col bg-bg-surface border-l border-border min-h-0',
        fullscreen
          ? 'fixed inset-0 z-50'
          // Desktop in-flow: gruda no topo do <main> (top-14 do shell) e ocupa a altura
          // da viewport menos o topbar, pra MessageList rolar por dentro. Mobile = tela cheia.
          : 'w-full md:w-[380px] shrink-0 md:self-start md:sticky md:top-0 md:h-[calc(100vh-3.5rem)] max-md:fixed max-md:inset-0 max-md:z-50',
      ].join(' ')}
    >
      <header className="flex items-center gap-sm px-md py-sm border-b border-border shrink-0">
        <img src="/tom-avatar.png" alt="" className="w-7 h-7 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <div className="text-body-md font-semibold truncate">{groupName} · chat</div>
          <div className="text-body-sm text-fg-muted truncate">{membersLine} e TOM</div>
        </div>
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="w-8 h-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated max-md:hidden focus-ring"
          aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring"
          aria-label="Fechar chat"
        >
          <X size={18} />
        </button>
      </header>
      <MessageList messages={msgs} meId={chat.meId} />
      <Composer onSend={chat.send.mutateAsync} upload={chat.uploadAttachment} />
    </aside>
  );
}
