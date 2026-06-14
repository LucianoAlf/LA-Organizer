// Modal de "Pré-visualizar" (#3 das notificações do grupo): mostra o relatório que aquele
// preset GERARIA, montado pelo backend (read-only) — sem disparar nada pro grupo/WhatsApp.
import DOMPurify from 'dompurify';
import { Eye, Loader2, Send, X } from 'lucide-react';
import { Button } from '../../../components/Button';

interface Props {
  title: string;        // rótulo do preset, ex.: "Bom dia diário"
  loading: boolean;
  html: string;
  isEmpty: boolean;
  error?: string | null;
  sending: boolean;
  onSendNow: () => void;
  onClose: () => void;
}

// Estiliza o HTML determinístico do builder (h3 / ul / li / p).
const proseCls =
  '[overflow-wrap:anywhere] [&_h3]:font-semibold [&_h3]:text-fg [&_h3]:mt-sm [&_h3]:mb-xs ' +
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5 [&_li]:text-fg [&_p]:text-fg-muted';

export function ReportPreviewModal({ title, loading, html, isEmpty, error, sending, onSendNow, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-bg-app border border-border rounded-lg w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-sm p-md border-b border-border shrink-0">
          <Eye size={18} className="text-tom" />
          <h3 className="text-body-lg font-semibold text-fg flex-1">Prévia · {title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-sm text-fg-muted hover:text-fg"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 grid place-items-center p-2xl">
            <div className="flex flex-col items-center gap-sm text-fg-muted">
              <Loader2 size={28} className="animate-spin text-tom" />
              <span className="text-body-sm">Montando a prévia…</span>
            </div>
          </div>
        ) : error ? (
          <div className="p-md text-body-sm text-danger">Não consegui montar a prévia ({error}).</div>
        ) : isEmpty ? (
          <div className="p-md text-body-sm text-fg-muted">
            Nada pra mostrar agora — com os dados de hoje, esse relatório não enviaria nada pro grupo.
          </div>
        ) : (
          <div
            className={`flex-1 min-h-0 overflow-y-auto p-md text-body-sm text-fg ${proseCls}`}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
          />
        )}

        <div className="flex items-center justify-between gap-sm p-md border-t border-border">
          <span className="text-caption text-fg-muted">Prévia — só você vê até clicar em enviar.</span>
          <div className="flex items-center gap-sm">
            <Button variant="secondary" size="md" onClick={onClose}>Fechar</Button>
            <Button
              variant="primary"
              size="md"
              leadingIcon={sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              onClick={onSendNow}
              disabled={loading || sending || isEmpty || !!error || !html}
            >
              {sending ? 'Enviando…' : 'Enviar pro grupo agora'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
