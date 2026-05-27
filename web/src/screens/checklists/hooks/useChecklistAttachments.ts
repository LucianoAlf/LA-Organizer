// Sprint 23 — Upload + listagem + delete de anexos em checklist
// Path pattern no Storage: {scope}/{user_uuid}/{item_completion_id}/{uuid}.{ext}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

type Scope = 'work' | 'personal';

interface AttachmentRow {
  id: string;
  scope: Scope;
  item_completion_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

export function useChecklistAttachments(scope: Scope, itemCompletionId: string | null) {
  const qc = useQueryClient();
  const queryKey = ['checklist-attachments', scope, itemCompletionId];

  const list = useQuery<AttachmentRow[]>({
    queryKey,
    queryFn: async () => {
      if (!itemCompletionId) return [];
      const { data, error } = await supabase
        .from('checklist_attachments')
        .select('*')
        .eq('scope', scope)
        .eq('item_completion_id', itemCompletionId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as AttachmentRow[];
    },
    enabled: !!itemCompletionId,
  });

  const upload = useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      if (!itemCompletionId) throw new Error('Sem item_completion_id (toque o item ao menos uma vez primeiro)');
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error('Sem usuário');

      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `${scope}/${user.id}/${itemCompletionId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('checklist-attachments')
        .upload(path, file, { contentType: file.type, cacheControl: '3600' });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from('checklist_attachments').insert({
        scope,
        item_completion_id: itemCompletionId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by: user.id,
      });
      if (insErr) throw insErr;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const remove = useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      await supabase.storage.from('checklist-attachments').remove([storagePath]);
      const { error } = await supabase.from('checklist_attachments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return { list, upload, remove };
}
