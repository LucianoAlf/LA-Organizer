// Devolutiva da delegação (2026-07-02) — ação "deixar devolutiva" numa tarefa.
// Executor OU quem está em cópia manda um retorno → chega pra quem delegou + o círculo
// (menos o autor). Escreve via internal-api (service_role) — sem RLS. Voz/broadcast no backend.
import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Button } from './Button';
import { showToast } from './Toast';
import { sendTaskReturn } from '../lib/tomEngine';

interface TaskReturnSectionProps {
  taskId: string;
  meId: string | null;
}

export function TaskReturnSection({ taskId, meId }: TaskReturnSectionProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const text = note.trim();
    if (!text || !meId) return;
    setSending(true);
    try {
      const r = await sendTaskReturn(taskId, meId, text);
      if (r.ok) {
        showToast({ kind: 'success', title: '💬 Devolutiva enviada', msg: 'Quem delegou já foi avisado.' });
        setNote('');
        setOpen(false);
      } else {
        showToast({ kind: 'error', title: 'Não consegui enviar a devolutiva', msg: 'Tenta de novo já já.' });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="pt-sm border-t border-border">
      <div className="text-label uppercase tracking-wide text-fg-muted mb-1">Devolutiva</div>
      {!open ? (
        <Button variant="secondary" size="sm" leadingIcon={<MessageSquarePlus size={15} />} onClick={() => setOpen(true)}>
          Deixar devolutiva
        </Button>
      ) : (
        <div className="space-y-sm">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Ex: já resolvi — falei com a mãe, volta segunda."
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg text-body-md focus:outline-none focus:border-tom resize-none"
          />
          <div className="flex items-center gap-sm">
            <Button variant="primary" size="sm" loading={sending} onClick={send}>Enviar</Button>
            <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setNote(''); }}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
