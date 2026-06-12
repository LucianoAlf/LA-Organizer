// web/src/screens/grupos/chat/GroupChatDrawer.tsx
// Drawer do chat do grupo: fixo na viewport (desktop) empurrando o conteúdo, ou tela cheia (mobile).
// Recolhível: o chevron na beira vira o painel numa faixa fina (igual a sidebar recolhe) e expande
// de volta — "drawer de verdade". Fechar de vez (desktop) é pelo botão "Chat" do topo do workspace.
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { useGroupChat } from '../../../hooks/useGroupChat';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

// Tempo máximo (ms) que o indicador "TOM está digitando" fica visível
const TYPING_TIMEOUT_MS = 15_000;

interface Props {
  groupId: string;
  groupName: string;
  membersLine: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onClose: () => void;
  onSeen: () => void;
}

export function GroupChatDrawer({ groupId, groupName, membersLine, collapsed, onToggleCollapse, onClose, onSeen }: Props) {
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

  // ── Recolhido (desktop): faixa fina na beira, clicável para expandir ─────────
  if (collapsed) {
    return (
      <aside className="hidden md:flex md:fixed md:top-14 md:right-0 md:bottom-0 md:z-30 w-12 flex-col items-center gap-3 bg-bg-surface border-l border-border py-sm">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="w-9 h-9 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors focus-ring"
          aria-label="Expandir chat"
          title="Expandir chat"
        >
          <ChevronLeft size={18} />
        </button>
        <button type="button" onClick={onToggleCollapse} className="focus-ring rounded-full" aria-label="Expandir chat">
          <img src="/tom-avatar.png" alt="" className="w-8 h-8 rounded-full object-cover" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col bg-bg-surface border-l border-border min-h-0 w-full md:w-[400px] xl:w-[460px] 2xl:w-[520px] md:fixed md:top-14 md:right-0 md:bottom-0 md:z-30 max-md:fixed max-md:inset-0 max-md:z-50">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-md py-sm border-b border-border shrink-0">
        <img src="/tom-avatar.png" alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-body-md font-semibold truncate">{groupName} · chat</div>
          <div className="text-body-sm text-fg-muted truncate">{membersLine} e TOM</div>
        </div>
        {/* Recolher (desktop) — vira faixa fina; fechar de vez é pelo botão "Chat" do topo */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="w-8 h-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors max-md:hidden focus-ring shrink-0"
          aria-label="Recolher chat"
          title="Recolher"
        >
          <ChevronRight size={18} />
        </button>
        {/* Fechar (mobile, tela cheia) */}
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated hover:text-fg transition-colors md:hidden focus-ring shrink-0"
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
