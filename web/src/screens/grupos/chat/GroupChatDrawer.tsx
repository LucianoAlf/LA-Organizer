// web/src/screens/grupos/chat/GroupChatDrawer.tsx
// Drawer do chat do grupo (Fase 1): desktop empurra o conteúdo (380px), tela cheia
// (overlay) e mobile sempre tela cheia. Lista + composer; realtime cobre a sync.
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useGroupChat } from '../../../hooks/useGroupChat';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

// Tempo máximo (ms) que o indicador "TOM está digitando" fica visível
const TYPING_TIMEOUT_MS = 15_000;

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

  // ── Indicador "TOM está digitando" ──────────────────────────────────────────
  const [tomTyping, setTomTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Conta quantas msgs do TOM existem; quando aumentar → apaga o indicador
  const tomMsgCount = msgs.filter(m => m.role === 'tom').length;
  const prevTomCountRef = useRef(tomMsgCount);

  useEffect(() => {
    if (tomMsgCount > prevTomCountRef.current) {
      // Chegou resposta do TOM → apaga indicador imediatamente
      setTomTyping(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    }
    prevTomCountRef.current = tomMsgCount;
  }, [tomMsgCount]);

  // Chamado pelo Composer quando o usuário envia mensagem
  const handleSend: typeof chat.send.mutateAsync = useCallback(async (input) => {
    const result = await chat.send.mutateAsync(input);
    // Liga o indicador e programa o timeout de segurança
    setTomTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => setTomTyping(false), TYPING_TIMEOUT_MS);
    return result;
  }, [chat.send]);

  // Limpa timer ao desmontar
  useEffect(() => () => { if (typingTimerRef.current) clearTimeout(typingTimerRef.current); }, []);

  // Marca como lido quando a query resolve e quando chega mensagem nova (chat aberto).
  useEffect(() => { if (chat.messages.isSuccess) onSeen(); }, [msgs.length, chat.messages.isSuccess, onSeen]);

  return (
    <aside
      className={[
        'flex flex-col bg-bg-surface border-l border-border min-h-0',
        fullscreen
          ? 'fixed inset-0 z-50'
          // Desktop: painel FIXO na viewport — top na topbar do shell (top-14=3.5rem), right-0 e
          // bottom-0. Encosta nas 3 bordas por definição (sem cálculo de altura/dvh, sem sobrar
          // pedaço embaixo/na lateral). A coluna de conteúdo reserva o espaço via padding-right.
          // Mobile = tela cheia (inset-0).
          : 'w-full md:w-[400px] xl:w-[460px] 2xl:w-[520px] md:fixed md:top-14 md:right-0 md:bottom-0 md:z-30 max-md:fixed max-md:inset-0 max-md:z-50',
      ].join(' ')}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-md py-sm border-b border-border shrink-0">
        <img src="/tom-avatar.png" alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-body-md font-semibold truncate">{groupName} · chat</div>
          <div className="text-body-sm text-fg-muted truncate">{membersLine} e TOM</div>
        </div>
        {/* Botão tela cheia (oculto no mobile) */}
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="w-8 h-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors max-md:hidden focus-ring shrink-0"
          aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        {/* Botão fechar */}
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors focus-ring shrink-0"
          aria-label="Fechar chat"
        >
          <X size={18} />
        </button>
      </header>

      <MessageList messages={msgs} meId={chat.meId} tomTyping={tomTyping} />
      <Composer onSend={handleSend} upload={chat.uploadAttachment} />
    </aside>
  );
}
