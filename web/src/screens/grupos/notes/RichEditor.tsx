import { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import DOMPurify from 'dompurify';
import { Bold, Italic, Heading2, List, Link2, Palette, Sparkles } from 'lucide-react';
import { bodyToHtml, NOTE_COLORS } from '../../../lib/groupNotes';
import { formatNote, type FormatAction } from '../../../lib/formatNote';
import { FormatPreview } from './FormatPreview';
import { showToast } from '../../../components/Toast';

const IA_ACTIONS: { key: FormatAction; label: string }[] = [
  { key: 'format', label: 'Auto-formatar' },
  { key: 'summarize', label: 'Resumir' },
  { key: 'fix', label: 'Corrigir ortografia' },
  { key: 'tone', label: 'Deixar mais claro' },
];

// Editor visual (TipTap) do corpo livre da ficha + botão "✨ Formatar com o TOM".
export function RichEditor({ valueHtml, onChange }: { valueHtml: string; onChange: (html: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [preview, setPreview] = useState<{ before: string; after: string } | null>(null);
  const [loadingIa, setLoadingIa] = useState(false);

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

  async function runIa(action: FormatAction) {
    setMenuOpen(false);
    const before = editor!.getHTML();
    setLoadingIa(true);
    setPreview({ before, after: '' });
    const r = await formatNote(action, before);
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

  const btn = (active: boolean) =>
    `grid place-items-center w-8 h-8 rounded-md border shrink-0 focus-ring ${active ? 'border-tom text-tom' : 'border-border text-fg-muted hover:text-fg'}`;

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center gap-1 flex-wrap p-1.5 border-b border-border bg-bg-surface relative">
        <button type="button" aria-label="Negrito" className={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></button>
        <button type="button" aria-label="Itálico" className={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></button>
        <button type="button" aria-label="Título" className={btn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></button>
        <button type="button" aria-label="Lista" className={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></button>
        <button type="button" aria-label="Cor do texto" className={btn(colorOpen)} onClick={() => setColorOpen((o) => !o)}><Palette size={15} /></button>
        <button type="button" aria-label="Link" className={btn(editor.isActive('link'))} onClick={() => {
          const prev = editor.getAttributes('link').href as string | undefined;
          const url = window.prompt('URL do link:', prev || '');
          if (url === null) return;                 // cancelou
          if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
          ensureSelection();
          const { from, to } = editor.state.selection;
          if (from === to) editor.chain().focus().insertContent(`<a href="${url}">${url}</a>`).run();
          else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }}><Link2 size={15} /></button>

        <div className="ml-auto relative">
          <button type="button" onClick={() => setMenuOpen((o) => !o)} className="inline-flex items-center gap-1 text-body-sm text-tom font-medium px-2 py-1.5 rounded-md hover:bg-tom/10 focus-ring">
            <Sparkles size={15} /> Formatar com o TOM
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-48 bg-bg-elevated border border-border rounded-md shadow-lg py-1">
              {IA_ACTIONS.map((a) => (
                <button key={a.key} type="button" onClick={() => runIa(a.key)} className="w-full text-left px-3 py-2 text-body-sm text-fg hover:bg-bg-surface">{a.label}</button>
              ))}
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
