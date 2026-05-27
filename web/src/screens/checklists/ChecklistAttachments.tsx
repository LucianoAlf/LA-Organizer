// Sprint 23 — Anexos por item de checklist (foto/PDF)
// Requer item_completion_id (toque o item ao menos uma vez antes de anexar)

import { useRef, useState } from 'react';
import { useChecklistAttachments } from './hooks/useChecklistAttachments';
import { supabase } from '../../lib/supabase';

interface Props {
  scope: 'work' | 'personal';
  itemCompletionId: string | null;
}

export function ChecklistAttachments({ scope, itemCompletionId }: Props) {
  const { list, upload, remove } = useChecklistAttachments(scope, itemCompletionId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  if (!itemCompletionId) {
    return null;
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      alert('Arquivo muito grande (max 10MB)');
      return;
    }
    upload.mutate(
      { file: f },
      {
        onError: (err: Error) => alert(`Erro no upload: ${err.message}`),
      }
    );
    e.target.value = '';
  };

  const ensureUrl = async (att: {
    id: string;
    storage_path: string;
  }) => {
    if (signedUrls[att.id]) return;
    const { data } = await supabase.storage
      .from('checklist-attachments')
      .createSignedUrl(att.storage_path, 300);
    if (data?.signedUrl) {
      setSignedUrls((s) => ({ ...s, [att.id]: data.signedUrl }));
    }
  };

  const items = list.data || [];

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((att) => {
        const isImage = att.mime_type.startsWith('image/');
        return (
          <div
            key={att.id}
            className="relative group"
            onMouseEnter={() => ensureUrl(att)}
          >
            <a
              href={signedUrls[att.id] ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-16 h-16 bg-bg-app border border-border rounded-md overflow-hidden"
              title={att.file_name}
            >
              {isImage && signedUrls[att.id] ? (
                <img
                  src={signedUrls[att.id]}
                  alt={att.file_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-fg/40">
                  📎
                </div>
              )}
            </a>
            <button
              onClick={() => {
                if (confirm('Remover anexo?')) {
                  remove.mutate({ id: att.id, storagePath: att.storage_path });
                }
              }}
              className="absolute -top-1 -right-1 w-4 h-4 bg-danger text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 flex items-center justify-center"
              aria-label="Remover anexo"
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={upload.isPending}
        className="w-16 h-16 border border-dashed border-border rounded-md text-fg/40 hover:text-tom hover:border-tom text-xs disabled:opacity-50 flex items-center justify-center"
        title="Anexar foto/PDF"
      >
        {upload.isPending ? '...' : '+ 📎'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
}
