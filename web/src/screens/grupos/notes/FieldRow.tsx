import { useState } from 'react';
import { Copy, Eye, EyeOff, ExternalLink, Check } from 'lucide-react';
import type { NoteField } from '../../../lib/groupNotes';

function normalizeUrl(v: string) {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// Linha rótulo: valor do detalhe da ficha. secret → mascarado + olho; kind=url → abrir; sempre copiar.
export function FieldRow({ field }: { field: NoteField }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const isSecret = field.secret === true;
  const isUrl = field.kind === 'url' && !!field.value;
  const display = field.value ? (isSecret && !shown ? '••••••••' : field.value) : '—';

  function copy() {
    if (!field.value) return;
    navigator.clipboard?.writeText(field.value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className="flex items-center gap-md py-sm border-t border-border first:border-t-0">
      <span className="text-body-sm text-fg-muted w-24 shrink-0">{field.label || '—'}</span>
      <span className={`flex-1 min-w-0 truncate text-body-md ${isSecret ? 'tracking-widest' : ''} ${isUrl ? 'text-tom' : 'text-fg'} ${field.kind === 'password' || isUrl ? 'font-mono' : ''}`}>
        {display}
      </span>
      {field.value && (
        <div className="flex items-center gap-xs shrink-0 text-fg-muted">
          {isSecret && (
            <button type="button" onClick={() => setShown(v => !v)} aria-label={shown ? 'Esconder' : 'Mostrar'} className="p-1 rounded-sm hover:text-fg focus-ring">
              {shown ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          {isUrl && (
            <a href={normalizeUrl(field.value)} target="_blank" rel="noreferrer" aria-label="Abrir link" className="p-1 rounded-sm hover:text-fg focus-ring">
              <ExternalLink size={15} />
            </a>
          )}
          <button type="button" onClick={copy} aria-label="Copiar" className="p-1 rounded-sm hover:text-fg focus-ring">
            {copied ? <Check size={15} className="text-tom" /> : <Copy size={15} />}
          </button>
        </div>
      )}
    </div>
  );
}
