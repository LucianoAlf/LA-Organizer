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

// Estilos do conteúdo renderizado: quebra strings longas (códigos de barras) e estiliza
// títulos/listas/tabelas que a IA pode devolver. overflow-wrap:anywhere evita a sobreposição.
const proseCls =
  '[overflow-wrap:anywhere] [&_h2]:font-semibold [&_h2]:text-fg [&_ul]:list-disc [&_ul]:pl-5 ' +
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-fg [&_a]:text-tom ' +
  '[&_table]:w-full [&_table]:border-collapse [&_table]:my-1 [&_table]:text-caption ' +
  '[&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-1 [&_td]:align-top ' +
  '[&_th]:border [&_th]:border-border [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold';

// Painel antes/depois da IA "Formatar com o TOM" (estilo Samsung Note Assist).
export function FormatPreview({ beforeHtml, afterHtml, loading, onApply, onDiscard }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onDiscard}>
      <div className="bg-bg-app border border-border rounded-lg w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm p-md border-b border-border shrink-0">
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
          <div className="flex-1 min-h-0 overflow-y-auto p-md grid grid-cols-1 md:grid-cols-2 gap-md">
            <div className="min-w-0">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Antes</div>
              <div
                className={`text-body-sm text-fg-muted overflow-x-auto ${proseCls}`}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(beforeHtml) }}
              />
            </div>
            <div className="min-w-0 md:border-l md:border-border md:pl-md">
              <div className="text-label uppercase tracking-wide text-tom mb-xs">Depois</div>
              <div
                className={`text-body-sm text-fg overflow-x-auto ${proseCls}`}
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
