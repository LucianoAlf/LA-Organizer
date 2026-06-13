import { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import DOMPurify from 'dompurify';
import { Bold, Italic, Heading2, List, Link2, Palette, Sparkles, Wand2, AlignLeft, SpellCheck, Feather, Smile, type LucideIcon } from 'lucide-react';
import { bodyToHtml, NOTE_COLORS } from '../../../lib/groupNotes';
import { formatNote, type FormatAction } from '../../../lib/formatNote';
import { FormatPreview } from './FormatPreview';
import { showToast } from '../../../components/Toast';

// Lista única de ações — cada uma com seu ícone. "Organizar" (format) é a primeira,
// sem destaque exagerado. Todas herdam a formatação semântica no motor.
const IA_ACTIONS: { key: FormatAction; label: string; Icon: LucideIcon }[] = [
  { key: 'format', label: 'Organizar', Icon: Sparkles },
  { key: 'summarize', label: 'Resumir', Icon: AlignLeft },
  { key: 'fix', label: 'Corrigir ortografia', Icon: SpellCheck },
  { key: 'tone', label: 'Deixar mais claro', Icon: Feather },
];

// Editor visual (TipTap) do corpo livre da ficha + botão "✨ Formatar com o TOM".
export function RichEditor({ valueHtml, onChange }: { valueHtml: string; onChange: (html: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [preview, setPreview] = useState<{ before: string; after: string } | null>(null);
  const [loadingIa, setLoadingIa] = useState(false);
  const [instrOpen, setInstrOpen] = useState(false);
  const [instrText, setInstrText] = useState('');
  // Toggle de emojis (default ligado), persistido — afeta toda execução de IA.
  const [useEmoji, setUseEmoji] = useState<boolean>(() => {
    try { return localStorage.getItem('tom_notes_emoji') !== '0'; } catch { return true; }
  });
  function toggleEmoji() {
    setUseEmoji((v) => {
      const next = !v;
      try { localStorage.setItem('tom_notes_emoji', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color, Link.configure({ openOnClick: false })],
    content: DOMPurify.sanitize(bodyToHtml(valueHtml)),
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[160px] text-body-sm text-fg leading-relaxed [&_h2]:text-body-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-tom [&_strong]:text-fg',
      },
    },
  });

  if (!editor) return null;

  async function runIa(action: FormatAction, instruction?: string) {
    setMenuOpen(false);
    setInstrOpen(false);
    const before = editor!.getHTML();
    setLoadingIa(true);
    setPreview({ before, after: '' });
    const r = await formatNote(action, before, { instruction, emoji: useEmoji });
    setLoadingIa(false);
    if (r.ok) {
      setPreview({ before, after: r.html });
    } else {
      setPreview(null);
      showToast({ kind: 'error', title: 'O TOM não conseguiu formatar agora. Tenta de novo.' });
    }
  }

  function applyPreview() {
    if (preview?.after) {
      editor!.commands.setContent(DOMPurify.sanitize(preview.after));
      onChange(editor!.getHTML());
    }
    setPreview(null);
  }

  // Se nada está selecionado, seleciona a palavra sob o cursor — assim cor/link aplicam
  // numa palavra com um clique só (sem precisar selecionar manualmente antes).
  function ensureSelection() {
    const sel = editor!.state.selection;
    if (!sel.empty) return;
    const { from } = sel;
    const $pos = editor!.state.doc.resolve(from);
    const text = $pos.parent.textContent || '';
    const off = $pos.parentOffset;
    let start = off, end = off;
    while (start > 0 && /\S/.test(text[start - 1])) start--;
    while (end < text.length && /\S/.test(text[end])) end++;
    if (end > start) {
      const base = from - off;
      editor!.chain().setTextSelection({ from: base + start, to: base + end }).run();
    }
  }

  // Aplica o link do campo inline (sem window.prompt, que é bloqueado no PWA).
  function applyLink() {
    const url = linkUrl.trim();
    if (!url) { setLinkOpen(false); return; }
    const href = /^[a-z]+:\/\//i.test(url) || url.startsWith('mailto:') ? url : `https://${url}`;
    ensureSelection();
    const { from, to } = editor!.state.selection;
    if (from === to) editor!.chain().focus().insertContent(`<a href="${href}">${url}</a>`).run();
    else editor!.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkUrl('');
    setLinkOpen(false);
  }

  function openLink() {
    setLinkUrl((editor!.getAttributes('link').href as string) || '');
    setColorOpen(false);
    setMenuOpen(false);
    setLinkOpen((o) => !o);
  }

  const btn = (active: boolean) =>
    `grid place-items-center w-8 h-8 rounded-md border shrink-0 focus-ring ${active ? 'border-tom text-tom' : 'border-border text-fg-muted hover:text-fg'}`;

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center gap-1 flex-wrap p-1.5 border-b border-border bg-bg-surface relative">
        <button type="button" aria-label="Negrito" className={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></button>
        <button type="button" aria-label="Itálico" className={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></button>
        <button type="button" aria-label="Título" className={btn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></button>
        <button type="button" aria-label="Lista" className={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></button>
        <button type="button" aria-label="Cor do texto" className={btn(colorOpen)} onClick={() => { setLinkOpen(false); setMenuOpen(false); setColorOpen((o) => !o); }}><Palette size={15} /></button>
        <div className="relative">
          <button type="button" aria-label="Link" className={btn(editor.isActive('link') || linkOpen)} onClick={openLink}><Link2 size={15} /></button>
          {linkOpen && (
            <div className="absolute left-0 top-full mt-1 z-30 flex items-center gap-1 p-2 bg-bg-elevated border border-border rounded-md shadow-lg w-64">
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLinkOpen(false); }}
                placeholder="https://…"
                autoFocus
                className="flex-1 min-w-0 bg-bg-surface border border-border rounded p-1 text-body-sm text-fg focus:outline-none focus:border-tom"
              />
              <button type="button" onClick={applyLink} className="text-caption text-tom px-1 shrink-0 focus-ring rounded">Aplicar</button>
              {editor.isActive('link') && (
                <button type="button" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }} className="text-caption text-fg-muted px-1 shrink-0 focus-ring rounded">Remover</button>
              )}
            </div>
          )}
        </div>

        <div className="w-full sm:w-auto sm:ml-auto relative">
          <button type="button" onClick={() => { setColorOpen(false); setLinkOpen(false); setInstrOpen(false); setMenuOpen((o) => !o); }} className="w-full sm:w-auto justify-center inline-flex items-center gap-1 text-body-sm text-tom font-medium px-2 py-1.5 rounded-md hover:bg-tom/10 focus-ring">
            <Sparkles size={15} /> Formatar com o TOM
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-60 bg-bg-elevated border border-border rounded-md shadow-lg p-1">
              {IA_ACTIONS.map((a) => (
                <button key={a.key} type="button" onClick={() => runIa(a.key)} className="w-full text-left px-3 py-2 text-body-sm text-fg hover:bg-bg-surface rounded-md flex items-center gap-2">
                  <a.Icon size={15} className="text-tom shrink-0" /> {a.label}
                </button>
              ))}
              {!instrOpen ? (
                <button type="button" onClick={() => setInstrOpen(true)} className="w-full text-left px-3 py-2 text-body-sm text-fg hover:bg-bg-surface rounded-md flex items-center gap-2"><Wand2 size={15} className="text-tom shrink-0" /> Formatar do meu jeito…</button>
              ) : (
                <div className="px-2 py-2">
                  <div className="text-caption text-fg-muted mb-1">Diz pro TOM como quer:</div>
                  <textarea
                    value={instrText}
                    onChange={(e) => setInstrText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && instrText.trim()) { e.preventDefault(); runIa('format', instrText.trim()); } }}
                    placeholder="ex.: separa por loja e põe o total no fim"
                    rows={3}
                    autoFocus
                    className="w-full bg-bg-surface border border-border rounded-md p-2 text-body-sm text-fg focus:outline-none focus:border-tom resize-none"
                  />
                  <div className="flex items-center justify-end gap-2 mt-1">
                    <button type="button" onClick={() => { setInstrOpen(false); setInstrText(''); }} className="text-caption text-fg-muted px-2 py-1 focus-ring rounded">Cancelar</button>
                    <button type="button" disabled={!instrText.trim()} onClick={() => runIa('format', instrText.trim())} className="text-caption text-black bg-tom font-medium px-3 py-1 rounded-md disabled:opacity-40 focus-ring">Formatar</button>
                  </div>
                </div>
              )}
              <div className="h-px bg-border my-1" />
              <button type="button" onClick={toggleEmoji} aria-pressed={useEmoji} className="w-full text-left px-3 py-2 text-body-sm text-fg hover:bg-bg-surface rounded-md flex items-center justify-between">
                <span className="flex items-center gap-2"><Smile size={15} className="text-tom shrink-0" /> Usar emojis</span>
                <span className={`inline-flex items-center h-5 w-9 rounded-full transition-colors shrink-0 ${useEmoji ? 'bg-tom' : 'bg-border'}`}>
                  <span className={`h-4 w-4 rounded-full bg-white transition-transform ${useEmoji ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </span>
              </button>
            </div>
          )}
        </div>

        {colorOpen && (
          <div className="absolute left-0 top-full mt-1 z-30 flex flex-wrap items-center gap-xs p-2 bg-bg-elevated border border-border rounded-md shadow-lg w-60">
            {NOTE_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Cor do texto ${c}`} onClick={() => { ensureSelection(); editor.chain().focus().setColor(c).run(); setColorOpen(false); }} className="w-6 h-6 rounded-full focus-ring shrink-0" style={{ background: c }} />
            ))}
            <button type="button" onClick={() => { editor.chain().focus().unsetColor().run(); setColorOpen(false); }} className="text-caption text-fg-muted px-2">limpar</button>
          </div>
        )}
      </div>

      <div className="p-3">
        <EditorContent editor={editor} />
      </div>

      {preview && (
        <FormatPreview beforeHtml={preview.before} afterHtml={preview.after} loading={loadingIa} onApply={applyPreview} onDiscard={() => setPreview(null)} />
      )}
    </div>
  );
}
