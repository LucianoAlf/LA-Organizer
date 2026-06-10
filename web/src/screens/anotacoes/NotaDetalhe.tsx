// Módulo Anotações — DETALHE/EDITOR + modo "⚡ Virar tarefas" (opção B do brainstorm).
// 100% nos tokens do DS: tipografia da escala (card-title/body-md/sm/label), spacing
// xs/sm/md/lg/2xl, radius sm/md, Badge pra chips, Button pra ações, receita canônica
// de input (CLAUDE.md). Autosave debounce (padrão Configurações); dono edita,
// compartilhado lê; linha já convertida mostra Badge "✓ criada".
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pin, Users, Archive, Trash2, Zap, Check } from 'lucide-react';
import { useNotes, useNoteTaskLinks, useCollabRoster } from '../../hooks/useNotes';
import { splitNoteLines } from '../../lib/noteLines';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { BottomSheet } from '../../components/BottomSheet';
import { LoadingState } from '../../components/LoadingState';
import { VirarTarefasSheet } from './VirarTarefasSheet';

export function NotaDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { list, updateNote, deleteNote, meuId } = useNotes();
  const links = useNoteTaskLinks(id);
  const roster = useCollabRoster();

  const note = (list.data ?? []).find((n) => n.id === id);
  const isOwner = !!note && note.collaborator_id === meuId;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSel, setShareSel] = useState<string[]>([]);
  const [agir, setAgir] = useState(false);
  const [selLines, setSelLines] = useState<Set<number>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const loadedId = useRef<string | null>(null);

  useEffect(() => {
    if (note && loadedId.current !== note.id) {
      loadedId.current = note.id;
      setTitle(note.title);
      setBody(note.body);
      setShareSel(note.shared_with);
      setDirty(false);
    }
  }, [note]);

  // Autosave debounce 800ms (padrão AutoSaveConfig — sem botão Salvar).
  useEffect(() => {
    if (!dirty || !isOwner || !note) return;
    const t = setTimeout(async () => {
      await updateNote.mutateAsync({ id: note.id, patch: { title, body } });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }, 800);
    return () => clearTimeout(t);
  }, [dirty, title, body, isOwner, note, updateNote]);

  const lines = useMemo(() => splitNoteLines(body), [body]);
  const linkedLines = useMemo(() => new Set((links.data ?? []).map((l) => l.line_no)), [links.data]);
  const selecionadas = lines.filter((l) => selLines.has(l.lineNo));

  if (list.isLoading) return <LoadingState />;
  if (!note) {
    return (
      <div className="max-w-content mx-auto w-full space-y-md">
        <p className="text-body-md text-fg-muted">Anotação não encontrada (pode ter sido excluída).</p>
        <Button variant="secondary" size="md" onClick={() => navigate('/anotacoes')}>← Voltar</Button>
      </div>
    );
  }

  async function toggleShare(cid: string) {
    const next = shareSel.includes(cid) ? shareSel.filter((x) => x !== cid) : [...shareSel, cid];
    setShareSel(next);
    await updateNote.mutateAsync({ id: note!.id, patch: { shared_with: next } });
  }

  async function excluir() {
    if (!window.confirm('Excluir esta anotação? Não dá pra desfazer.')) return;
    await deleteNote.mutateAsync(note!.id);
    navigate('/anotacoes');
  }

  async function arquivar() {
    await updateNote.mutateAsync({ id: note!.id, patch: { archived: true } });
    navigate('/anotacoes');
  }

  return (
    <div className="space-y-md max-w-content mx-auto w-full pb-2xl">
      <div className="flex items-center justify-between gap-sm">
        <button onClick={() => navigate('/anotacoes')} className="inline-flex items-center gap-xs text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm p-xs">
          <ArrowLeft size={16} /> Anotações
        </button>
        <div className="flex items-center gap-xs">
          {saved && <span className="text-label text-tom">salvo ✓</span>}
          {isOwner && (
            <>
              <button
                onClick={() => updateNote.mutate({ id: note.id, patch: { pinned: !note.pinned } })}
                className={`p-sm rounded-sm focus-ring ${note.pinned ? 'text-tom' : 'text-fg-muted hover:text-fg'}`}
                aria-label="Fixar"
              ><Pin size={16} /></button>
              <button onClick={() => setShareOpen(true)} className={`p-sm rounded-sm focus-ring ${note.shared_with.length ? 'text-tom' : 'text-fg-muted hover:text-fg'}`} aria-label="Compartilhar">
                <Users size={16} />
              </button>
              <button onClick={arquivar} className="p-sm rounded-sm text-fg-muted hover:text-fg focus-ring" aria-label="Arquivar"><Archive size={16} /></button>
              <button onClick={excluir} className="p-sm rounded-sm text-fg-muted hover:text-danger focus-ring" aria-label="Excluir"><Trash2 size={16} /></button>
            </>
          )}
        </div>
      </div>

      {!isOwner && (
        <p className="text-body-sm text-fg-muted">
          👥 Anotação de {(roster.data ?? []).find((c) => c.id === note.collaborator_id)?.full_name ?? 'colega'} — somente leitura.
        </p>
      )}

      <input
        value={title}
        onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
        readOnly={!isOwner}
        placeholder="Título da anotação"
        className="w-full bg-transparent text-card-title text-fg focus:outline-none border-b border-border focus:border-tom pb-xs"
      />

      {!agir ? (
        <>
          <textarea
            value={body}
            onChange={(e) => { setBody(e.target.value); setDirty(true); }}
            readOnly={!isOwner}
            placeholder="Escreve aqui… (ou dita pro TOM no WhatsApp)"
            rows={Math.max(10, body.split('\n').length + 2)}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg text-body-md focus:outline-none focus:border-tom resize-y"
          />
          {isOwner && lines.some((l) => l.actionable) && (
            <Button variant="primary" size="md" leadingIcon={<Zap size={16} />} onClick={() => { setAgir(true); setSelLines(new Set()); }}>
              Virar tarefas
            </Button>
          )}
        </>
      ) : (
        <div className="space-y-xs">
          <p className="text-body-sm text-fg-muted">Marca as linhas que viram tarefa:</p>
          {lines.map((l) => {
            if (!l.text) return <div key={l.lineNo} className="h-sm" />;
            const linked = linkedLines.has(l.lineNo);
            if (!l.actionable || linked) {
              return (
                <div key={l.lineNo} className="flex items-center justify-between gap-sm py-xs px-sm">
                  <span className={l.actionable ? 'text-body-md text-fg-muted' : 'text-body-md text-fg'}>{l.text}</span>
                  {linked && <Badge tone="success"><Check size={10} /> criada</Badge>}
                </div>
              );
            }
            const on = selLines.has(l.lineNo);
            return (
              <button
                key={l.lineNo}
                onClick={() => {
                  const next = new Set(selLines);
                  if (on) next.delete(l.lineNo); else next.add(l.lineNo);
                  setSelLines(next);
                }}
                className={`w-full text-left flex items-center gap-sm py-xs px-sm rounded-sm focus-ring ${on ? 'bg-bg-elevated' : ''}`}
              >
                <span className={`h-5 w-5 rounded-sm border inline-flex items-center justify-center shrink-0 ${on ? 'bg-tom border-tom' : 'border-border'}`}>
                  {on && <Check size={12} className="text-black" />}
                </span>
                <span className="text-body-md text-fg">{l.text}</span>
              </button>
            );
          })}
          <div className="flex items-center gap-sm pt-sm">
            <Button variant="primary" size="md" disabled={selecionadas.length === 0} onClick={() => setSheetOpen(true)}>
              Criar {selecionadas.length} tarefa{selecionadas.length === 1 ? '' : 's'} →
            </Button>
            <Button variant="ghost" size="md" onClick={() => setAgir(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      <BottomSheet open={shareOpen} onClose={() => setShareOpen(false)} title="Compartilhar com">
        <div className="space-y-xs max-h-80 overflow-y-auto">
          {(roster.data ?? []).filter((c) => c.id !== meuId).map((c) => {
            const on = shareSel.includes(c.id);
            return (
              <button key={c.id} onClick={() => toggleShare(c.id)} className={`w-full text-left flex items-center justify-between p-sm rounded-sm focus-ring ${on ? 'bg-bg-elevated' : ''}`}>
                <span className="text-body-md">{c.full_name}</span>
                {on && <Check size={16} className="text-tom" />}
              </button>
            );
          })}
        </div>
        <p className="text-body-sm text-fg-muted mt-sm">Quem você marcar passa a VER esta anotação (somente leitura).</p>
      </BottomSheet>

      <VirarTarefasSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        note={note}
        lines={selecionadas}
        onDone={() => { setSheetOpen(false); setAgir(false); setSelLines(new Set()); }}
      />
    </div>
  );
}
