import { useState } from 'react';
import { Copy, Eye, EyeOff, ExternalLink, Check, Loader2 } from 'lucide-react';
import { revealNoteSecret, isEncrypted, type NoteField } from '../../../lib/groupNotes';

function normalizeUrl(v: string) {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// Linha rótulo: valor. secret cifrado → mascarado; revelar/copiar via RPC (decifra server-side).
// onReveal: como decifrar um secret (default = RPC de grupo). O pessoal passa o seu.
export function FieldRow({ field, noteId, index, onReveal }: { field: NoteField; noteId?: string; index: number; onReveal?: (noteId: string, index: number) => Promise<string> }) {
  const [shown, setShown] = useState(false);
  const [plain, setPlain] = useState<string | null>(null); // segredo revelado (só em memória)
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const isSecret = field.secret === true;
  const isUrl = field.kind === 'url' && !!field.value;
  const secretEnc = isSecret && isEncrypted(field.value);
  const display = !field.value ? '—' : isSecret ? (shown && plain != null ? plain : '••••••••') : field.value;

  async function ensurePlain(): Promise<string | null> {
    if (plain != null) return plain;
    if (!secretEnc) { setPlain(field.value); return field.value; } // secret legado/texto puro
    if (!noteId) return null;
    setBusy(true);
    try { const v = await (onReveal ?? revealNoteSecret)(noteId, index); setPlain(v); return v; }
    catch { return null; } finally { setBusy(false); }
  }
  async function toggle() {
    if (shown) { setShown(false); return; }
    const v = await ensurePlain();
    if (v == null && secretEnc) return; // falha ao revelar → não abre
    setShown(true);
  }
  async function copy() {
    const v = isSecret ? await ensurePlain() : field.value;
    if (!v) return;
    navigator.clipboard?.writeText(v).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); });
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
            <button type="button" onClick={toggle} aria-label={shown ? 'Esconder' : 'Mostrar'} className="p-1 rounded-sm hover:text-fg focus-ring">
              {busy ? <Loader2 size={15} className="animate-spin" /> : shown ? <EyeOff size={15} /> : <Eye size={15} />}
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
