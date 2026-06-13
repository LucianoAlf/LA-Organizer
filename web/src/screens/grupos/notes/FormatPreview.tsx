import DOMPurify from 'dompurify';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '../../../components/Button';

interface Props {
  beforeHtml: string;
  afterHtml: string;
  loading: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

// Painel antes/depois da IA "Formatar com o TOM" (estilo Samsung Note Assist).
export function FormatPreview({ beforeHtml, afterHtml, loading, onApply, onDiscard }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onDiscard}>
      <div className="bg-bg-app border border-border rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm p-md border-b border-border">
          <Sparkles size={18} className="text-tom" />
          <h3 className="text-body-lg font-semibold text-fg">Formatar com o TOM</h3>
        </div>
        {loading ? (
          <div className="flex-1 grid place-items-center p-2xl">
            <div className="flex flex-col items-center gap-sm text-fg-muted">
              <Loader2 size={28} className="animate-spin text-tom" />
              <span className="text-body-sm">O TOM tá organizando…</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-md grid md:grid-cols-2 gap-md">
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Antes</div>
              <div
                className="text-body-sm text-fg-muted [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(beforeHtml) }}
              />
            </div>
            <div>
              <div className="text-label uppercase tracking-wide text-tom mb-xs">Depois</div>
              <div
                className="text-body-sm text-fg [&_h2]:font-semibold [&_h2]:text-fg [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:text-fg"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(afterHtml) }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-sm p-md border-t border-border">
          <Button variant="secondary" size="md" onClick={onDiscard}>Descartar</Button>
          <Button variant="primary" size="md" onClick={onApply} disabled={loading || !afterHtml}>Aplicar</Button>
        </div>
      </div>
    </div>
  );
}
