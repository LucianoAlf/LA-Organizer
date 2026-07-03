// Módulo Anotações pessoais — DETALHE (two-pane): leitura de ficha tipada (campos +
// senha cifrada) + corpo rico + ações do pessoal (fixar/compartilhar/arquivar/excluir/
// ⚡ virar tarefas). Senha SÓ o dono revela (revealPersonalNoteSecret). Espelha o
// NoteDetail do grupo + os extras do pessoal.
import { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { Pin, PinOff, Pencil, Trash2, ArrowLeft, Users, Archive, Zap, Check, MessageCircle, Monitor, Lock } from 'lucide-react';
import { useNotes, useNoteTaskLinks, useCollabRoster, type Note } from '../../hooks/useNotes';
import { resolveColor, resolveIcon, bodyToHtml, typeLabel, htmlToLines, revealPersonalNoteSecret, type TypeIndex } from '../../lib/personalNotes';
import { splitNoteLines } from '../../lib/noteLines';
import { NoteGlyph } from '../grupos/notes/IconRegistry';
import { FieldRow } from '../grupos/notes/FieldRow';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { BottomSheet } from '../../components/BottomSheet';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { VirarTarefasSheet } from './VirarTarefasSheet';

interface Props { note: Note; idx?: TypeIndex; onEdit: () => void; onBack?: () => void; onDeleted?: () => void }

export function NotaDetalhe({ note, idx, onEdit, onBack, onDeleted }: Props) {
  const { updateNote, deleteNote, meuId } = useNotes();
  const roster = useCollabRoster();
  const links = useNoteTaskLinks(note.id);
  const isOwner = note.collaborator_id === meuId;

  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [agir, setAgir] = useState(false);
  const [selLines, setSelLines] = useState<Set<number>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);

  const hasFields = (note.fields || []).some((f) => f.label || f.value);
  const bodyHtml = note.body ? DOMPurify.sanitize(bodyToHtml(note.body)) : '';
  const lines = useMemo(() => splitNoteLines(htmlToLines(note.body || '')), [note.body]);
  const linkedLines = useMemo(() => new Set((links.data ?? []).map((l) => l.line_no)), [links.data]);
  const selecionadas = lines.filter((l) => selLines.has(l.lineNo));

  function nameFor(id: string) { return (roster.data ?? []).find((c) => c.id === id)?.full_name?.split(' ')[0] ?? 'colega'; }
  async function toggleShare(cid: string) {
    const next = note.shared_with.includes(cid) ? note.shared_with.filter((x) => x !== cid) : [...note.shared_with, cid];
    await updateNote.mutateAsync({ id: note.id, patch: { shared_with: next } });
  }
  async function arquivar() { await updateNote.mutateAsync({ id: note.id, patch: { archived: true } }); onDeleted?.(); }
  async function excluir() { await deleteNote.mutateAsync(note.id); onDeleted?.(); }

  return (
    <div className="flex-1 min-w-0 p-lg overflow-y-auto">
      <div className="flex items-center gap-sm mb-xs">
        {onBack && <button className="md:hidden text-fg-muted p-1 -ml-1 focus-ring rounded-sm" onClick={onBack} aria-label="Voltar"><ArrowLeft size={18} /></button>}
        <NoteGlyph name={resolveIcon(note, idx)} color={resolveColor(note, idx)} size={20} className="shrink-0" />
        <h2 className="flex-1 min-w-0 truncate text-h3 text-fg">{note.title || 'Sem título'}</h2>
        {isOwner && (
          <div className="flex items-center gap-1 shrink-0 text-fg-muted">
            <button onClick={() => updateNote.mutate({ id: note.id, patch: { pinned: !note.pinned } })} aria-label={note.pinned ? 'Desafixar' : 'Fixar'} className="p-1.5 rounded-sm hover:text-fg focus-ring">{note.pinned ? <Pin size={17} className="text-tom" /> : <PinOff size={17} />}</button>
            <button onClick={() => setShareOpen(true)} aria-label="Compartilhar" className={`p-1.5 rounded-sm hover:text-fg focus-ring ${note.shared_with.length ? 'text-tom' : ''}`}><Users size={17} /></button>
            <button onClick={onEdit} aria-label="Editar" className="p-1.5 rounded-sm hover:text-fg focus-ring"><Pencil size={17} /></button>
            <button onClick={arquivar} aria-label="Arquivar" className="p-1.5 rounded-sm hover:text-fg focus-ring"><Archive size={17} /></button>
            <button onClick={() => setConfirmDel(true)} aria-label="Excluir" className="p-1.5 rounded-sm hover:text-danger focus-ring"><Trash2 size={17} /></button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-xs flex-wrap text-caption text-fg-muted mb-lg">
        {isOwner ? (note.shared_with.length > 0
          ? <Badge tone="success"><Users size={10} /> compartilhada ({note.shared_with.length})</Badge>
          : <Badge><Lock size={10} /> privada</Badge>
        ) : <Badge tone="info"><Users size={10} /> de {nameFor(note.collaborator_id)}</Badge>}
        {note.source === 'tom' ? <Badge><MessageCircle size={10} /> via TOM</Badge> : <Badge><Monitor size={10} /> no app</Badge>}
        <span className="px-sm py-[2px] rounded-full bg-tom/10 text-tom">{typeLabel(note.type, idx)}</span>
        {note.created_at && <span>· criado em {new Date(note.created_at).toLocaleDateString('pt-BR')}</span>}
      </div>

      {!isOwner && <p className="text-body-sm text-fg-muted mb-md">👥 Anotação de {nameFor(note.collaborator_id)} — somente leitura.</p>}

      {hasFields && (
        <div className="border-b border-border mb-lg">
          {(note.fields || []).map((f, i) => (f.label || f.value)
            ? <FieldRow key={i} field={f} noteId={note.id} index={i} onReveal={revealPersonalNoteSecret} />
            : null)}
        </div>
      )}

      {!agir ? (
        <>
          {bodyHtml && (
            <div className="mb-lg">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Anotações livres</div>
              <div className="text-body-md text-fg-muted leading-relaxed [&_p]:min-h-[1.4em] [&_h1]:text-h3 [&_h2]:text-body-lg [&_h2]:font-semibold [&_h2]:text-fg [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-tom [&_code]:bg-bg-elevated [&_code]:px-1 [&_code]:rounded [&_strong]:text-fg" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            </div>
          )}
          {isOwner && lines.some((l) => l.actionable && !linkedLines.has(l.lineNo)) && (
            <Button variant="primary" size="md" leadingIcon={<Zap size={16} />} onClick={() => { setAgir(true); setSelLines(new Set()); }}>Virar tarefas</Button>
          )}
          {!hasFields && !bodyHtml && <p className="text-body-sm text-fg-muted">Ficha vazia — toque em editar pra preencher.</p>}
        </>
      ) : (
        <div className="space-y-xs">
          <p className="text-body-sm text-fg-muted">Marca as linhas que viram tarefa:</p>
          {lines.map((l) => {
            if (!l.text) return null;
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
              <button key={l.lineNo} onClick={() => { const next = new Set(selLines); if (on) next.delete(l.lineNo); else next.add(l.lineNo); setSelLines(next); }}
                className={`w-full text-left flex items-center gap-sm py-xs px-sm rounded-sm focus-ring ${on ? 'bg-bg-elevated' : ''}`}>
                <span className={`h-5 w-5 rounded-sm border inline-flex items-center justify-center shrink-0 ${on ? 'bg-tom border-tom' : 'border-border'}`}>{on && <Check size={12} className="text-black" />}</span>
                <span className="text-body-md text-fg">{l.text}</span>
              </button>
            );
          })}
          <div className="flex items-center gap-sm pt-sm">
            <Button variant="primary" size="md" disabled={selecionadas.length === 0} onClick={() => setSheetOpen(true)}>Criar {selecionadas.length} tarefa{selecionadas.length === 1 ? '' : 's'} →</Button>
            <Button variant="ghost" size="md" onClick={() => setAgir(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      <BottomSheet open={shareOpen} onClose={() => setShareOpen(false)} title="Compartilhar com">
        <div className="space-y-xs max-h-80 overflow-y-auto">
          {(roster.data ?? []).filter((c) => c.id !== meuId).map((c) => {
            const on = note.shared_with.includes(c.id);
            return (
              <button key={c.id} onClick={() => toggleShare(c.id)} className={`w-full text-left flex items-center justify-between p-sm rounded-sm focus-ring ${on ? 'bg-bg-elevated' : ''}`}>
                <span className="text-body-md">{c.full_name}</span>{on && <Check size={16} className="text-tom" />}
              </button>
            );
          })}
        </div>
        <p className="text-body-sm text-fg-muted mt-sm">Quem você marcar passa a VER esta anotação (somente leitura). Senhas continuam só com você.</p>
      </BottomSheet>

      <VirarTarefasSheet open={sheetOpen} onClose={() => setSheetOpen(false)} note={note} lines={selecionadas} onDone={() => { setSheetOpen(false); setAgir(false); setSelLines(new Set()); }} />

      <ConfirmDialog open={confirmDel} title="Excluir anotação?" description="Não dá pra desfazer." confirmLabel="Excluir" confirmVariant="danger"
        isPending={deleteNote.isPending} onConfirm={excluir} onClose={() => setConfirmDel(false)} />
    </div>
  );
}
