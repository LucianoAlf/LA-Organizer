// Módulo Anotações — LISTA (spec 2026-06-10, mockup aprovado no brainstorm).
// Tela NOVA e responsiva (sem versão mobile pré-existente — guardrail preservado:
// nenhuma rota antiga foi tocada). Detalhe em NotaDetalhe.tsx.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pin, Lock, Users, MessageCircle, Monitor } from 'lucide-react';
import { useNotes, useCollabRoster, type Note } from '../../hooks/useNotes';
import { Fab } from '../../components/Fab';
import { Button } from '../../components/Button';
import { LoadingState } from '../../components/LoadingState';
import { useBreakpoint } from '../../hooks/useBreakpoint';

function relAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `há ${Math.max(1, min)}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

function preview(body: string): string {
  const flat = String(body || '').split('\n').map((l) => l.trim()).filter(Boolean).join(' · ');
  return flat.length > 140 ? flat.slice(0, 140) + '…' : flat;
}

export function Anotacoes() {
  const navigate = useNavigate();
  const { list, createNote, meuId } = useNotes();
  const roster = useCollabRoster();
  const [busca, setBusca] = useState('');
  const bp = useBreakpoint();

  const nameOf = (id: string) =>
    (roster.data ?? []).find((c) => c.id === id)?.full_name.split(' ')[0] ?? 'colega';

  const notes = useMemo(() => {
    const all = list.data ?? [];
    const q = busca.trim().toLowerCase();
    if (!q) return all;
    return all.filter((n) => (n.title + '\n' + n.body).toLowerCase().includes(q));
  }, [list.data, busca]);

  async function novaAnotacao() {
    const n = await createNote.mutateAsync();
    navigate(`/anotacoes/${n.id}`);
  }

  if (list.isLoading) return <LoadingState />;

  return (
    <div className="space-y-lg max-w-3xl mx-auto w-full pb-24">
      <header className="flex items-end justify-between">
        <div>
          <h2 className="text-section-title">📒 Anotações</h2>
          <p className="text-body-sm text-fg-muted mt-1">
            Dita pro TOM ("anota aí…") ou escreve aqui — e vira tarefas com um toque.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-body-sm text-fg-muted">{notes.length} anotaç{notes.length === 1 ? 'ão' : 'ões'}</span>
          {bp !== 'mobile' && (
            <Button variant="primary" size="sm" onClick={novaAnotacao}>+ Nova anotação</Button>
          )}
        </div>
      </header>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="🔍 Buscar nas anotações…"
        className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
      />

      {notes.length === 0 ? (
        <div className="surface p-lg text-center text-fg-muted text-body-md">
          Nenhuma anotação ainda. Manda um <em>"TOM, anota aí…"</em> no WhatsApp ou toca no + pra criar a primeira.
        </div>
      ) : (
        <ul className="space-y-sm">
          {notes.map((n: Note) => {
            const minha = n.collaborator_id === meuId;
            return (
              <li key={n.id}>
                <button
                  onClick={() => navigate(`/anotacoes/${n.id}`)}
                  className={`w-full text-left surface p-md rounded-lg border ${n.pinned ? 'border-tom' : 'border-border'} hover:bg-bg-elevated focus-ring`}
                >
                  <div className="flex items-center gap-2">
                    {n.pinned && <Pin size={14} className="text-tom shrink-0" />}
                    <span className="text-body-md font-semibold truncate">{n.title || 'Sem título'}</span>
                  </div>
                  {n.body && <p className="text-body-sm text-fg-muted mt-1 line-clamp-2">{preview(n.body)}</p>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-fg-muted">
                    {minha ? (
                      n.shared_with.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-tom"><Users size={12} /> compartilhada ({n.shared_with.length})</span>
                      ) : (
                        <span className="inline-flex items-center gap-1"><Lock size={12} /> privada</span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 text-tom"><Users size={12} /> de {nameOf(n.collaborator_id)}</span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      {n.source === 'tom' ? <><MessageCircle size={12} /> via TOM</> : <><Monitor size={12} /> criada no app</>}
                    </span>
                    <span>{relAge(n.updated_at)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {bp === 'mobile' && <Fab onClick={novaAnotacao} ariaLabel="Nova anotação" />}
    </div>
  );
}
