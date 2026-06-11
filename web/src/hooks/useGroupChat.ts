// web/src/hooks/useGroupChat.ts
// Chat de grupo (Fase 1): mensagens + envio + upload de anexo. Realtime cobre a sync.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { ChatMsg } from '../lib/groupChat';

const SELECT =
  'id, group_id, sender_id, role, kind, content, media_url, media_mime, media_filename, created_at, ' +
  'sender:collaborators!group_chat_messages_sender_id_fkey(full_name, avatar_url)';

function mapRow(r: any): ChatMsg {
  return {
    id: r.id, group_id: r.group_id, sender_id: r.sender_id, role: r.role, kind: r.kind,
    content: r.content, media_url: r.media_url, media_mime: r.media_mime, media_filename: r.media_filename,
    sender_name: r.sender?.full_name ?? (r.role === 'tom' ? 'TOM' : null),
    sender_avatar: r.sender?.avatar_url ?? null, created_at: r.created_at,
  };
}

export function useGroupChat(groupId: string | undefined) {
  const qc = useQueryClient();
  const { collaborator } = useAuth();

  const messages = useQuery({
    queryKey: ['group-chat', groupId],
    enabled: Boolean(groupId),
    queryFn: async (): Promise<ChatMsg[]> => {
      const { data, error } = await supabase
        .from('group_chat_messages').select(SELECT)
        .eq('group_id', groupId!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapRow).reverse();
    },
  });

  async function uploadAttachment(file: Blob, filename: string, mime: string): Promise<{ url: string; mime: string; filename: string; kind: ChatMsg['kind'] }> {
    const ext = (filename.split('.').pop() || 'bin').toLowerCase();
    const path = `${groupId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('group-chat').upload(path, file, { contentType: mime, upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('group-chat').getPublicUrl(path);
    const kind: ChatMsg['kind'] = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime === 'application/pdf' ? 'pdf' : 'text';
    return { url: data.publicUrl, mime, filename, kind };
  }

  const send = useMutation({
    mutationFn: async (input: { text?: string; attachment?: { url: string; mime: string; filename: string; kind: ChatMsg['kind'] } }) => {
      if (!collaborator) throw new Error('no_session');
      const a = input.attachment;
      const { error } = await supabase.from('group_chat_messages').insert({
        group_id: groupId, sender_id: collaborator.id, role: 'member',
        kind: a ? a.kind : 'text',
        content: input.text?.trim() || null,
        media_url: a?.url ?? null, media_mime: a?.mime ?? null, media_filename: a?.filename ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group-chat', groupId] }),
  });

  return { messages, send, uploadAttachment, meId: collaborator?.id ?? '' };
}
