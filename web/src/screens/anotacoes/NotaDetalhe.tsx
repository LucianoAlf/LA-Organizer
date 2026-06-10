// Módulo Anotações — DETALHE/EDITOR + modo "⚡ Virar tarefas" (opção B do brainstorm).
// Autosave com debounce (padrão Configurações); compartilhar via lista de pessoas;
// dono edita, compartilhado lê. Linha já convertida mostra "✓ criada".
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pin, Users, Archive, Trash2, Zap, Check } from 'lucide-react';
import { useNotes, useNoteTaskLinks, useCollabRoster } from '../../hooks/useNotes';
import { splitNoteLines } from '../../lib/noteLines';
import { Button } from '../../components/Button';
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
      <div className="max-w-3xl mx-auto w-full space-y-md">
        <p className="text-body-md text-fg-muted">Anotação não encontrada (pode ter sido excluída).</p>
        <Button variant="secondary" size="sm" onClick={() => navigate('/anotacoes')}>← Voltar</Button>
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
    <div className="space-y-md max-w-3xl mx-auto w-full pb-28">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => navigate('/anotacoes')} className="inline-flex items-center gap-1 text-body-sm text-fg-muted hover:text-fg focus-ring rounded-md p-1">
          <ArrowLeft size={16} /> Anotações
        </button>
        <div className="flex items-center gap-1">
          {saved && <span className="text-[11px] text-tom mr-1">salvo ✓</span>}
          {isOwner && (
            <>
              <button
                onClick={() => updateNote.mutate({ id: note.id, patch: { pinned: !note.pinned } })}
                className={`p-2 rounded-md focus-ring ${note.pinned ? 'text-tom' : 'text-fg-muted hover:text-fg'}`}
                aria-label="Fixar"
              ><Pin size={16} /></button>
              <button onClick={() => setShareOpen(true)} className={`p-2 rounded-md focus-ring ${note.shared_with.length ? 'text-tom' : 'text-fg-muted hover:text-fg'}`} aria-label="Compartilhar">
                <Users size={16} />
              </button>
              <button onClick={arquivar} className="p-2 rounded-md text-fg-muted hover:text-fg focus-ring" aria-label="Arquivar"><Archive size={16} /></button>
              <button onClick={excluir} className="p-2 rounded-md text-fg-muted hover:text-danger focus-ring" aria-label="Excluir"><Trash2 size={16} /></button>
            </>
          )}
        </div>
      </div>

      {!isOwner && (
        <p className="text-[11px] text-fg-muted">
          👥 Anotação de {(roster.data ?? []).find((c) => c.id === note.collaborator_id)?.full_name ?? 'colega'} — somente leitura.
        </p>
      )}

      <input
        value={title}
        onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
        readOnly={!isOwner}
        placeholder="Título da anotação"
        className="w-full bg-transparent text-lg font-bold text-fg focus:outline-none border-b border-border focus:border-tom pb-1"
      />

      {!agir ? (
        <>
          <textarea
            value={body}
            onChange={(e) => { setBody(e.target.value); setDirty(true); }}
            readOnly={!isOwner}
            placeholder="Escreve aqui… (ou dita pro TOM no WhatsApp)"
            rows={Math.max(10, body.split('\n').length + 2)}
            className="w-full bg-bg-surface border border-border rounded-md p-3 text-fg text-body-md leading-relaxed focus:outline-none focus:border-tom resize-y"
          />
          {isOwner && lines.some((l) => l.actionable) && (
            <Button variant="primary" size="sm" onClick={() => { setAgir(true); setSelLines(new Set()); }}>
              <Zap size={14} className="mr-1" /> Virar tarefas
            </Button>
          )}
        </>
      ) : (
        <div className="space-y-1">
          <p className="text-body-sm text-fg-muted">Marca as linhas que viram tarefa:</p>
          {lines.map((l) => {
            if (!l.text) return <div key={l.lineNo} className="h-2" />;
            const linked = linkedLines.has(l.lineNo);
            if (!l.actionable || linked) {
              return (
                <div key={l.lineNo} className="flex items-center justify-between py-1 px-2 text-body-sm text-fg-muted">
                  <span className={l.actionable ? '' : 'font-semibold text-fg'}>{l.text}</span>
                  {linked && <span className="inline-flex items-center gap-1 text-[11px] bg-tom text-black rounded px-1.5 py-0.5 font-semibold"><Check size={11} /> criada</span>}
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
                className={`w-full text-left flex items-center gap-2 py-1.5 px-2 rounded-md focus-ring ${on ? 'bg-bg-elevated' : ''}`}
              >
                <span className={`w-4 h-4 rounded border inline-flex items-center justify-center shrink-0 ${on ? 'bg-tom border-tom' : 'border-border'}`}>
                  {on && <Check size={12} className="text-black" />}
                </span>
                <span className="text-body-sm text-fg">{l.text}</span>
              </button>
            );
          })}
          <div className="flex items-center gap-2 pt-2">
            <Button variant="primary" size="sm" disabled={selecionadas.length === 0} onClick={() => setSheetOpen(true)}>
              Criar {selecionadas.length} tarefa{selecionadas.length === 1 ? '' : 's'} →
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAgir(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      <BottomSheet open={shareOpen} onClose={() => setShareOpen(false)} title="Compartilhar com">
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {(roster.data ?? []).filter((c) => c.id !== meuId).map((c) => {
            const on = shareSel.includes(c.id);
            return (
              <button key={c.id} onClick={() => toggleShare(c.id)} className={`w-full text-left flex items-center justify-between p-2 rounded-md focus-ring ${on ? 'bg-bg-elevated' : ''}`}>
                <span className="text-body-md">{c.full_name}</span>
                {on && <Check size={16} className="text-tom" />}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-fg-muted mt-2">Quem você marcar passa a VER esta anotação (somente leitura).</p>
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
