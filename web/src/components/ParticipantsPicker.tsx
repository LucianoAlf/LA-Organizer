// Sprint 22.32 — multi-select de participants pra Compromisso.
// User pode escolher N pessoas do time pra um evento. Ao salvar, parent insere
// em event_participants. TOM notifica (Sprint 22.33+).
//
// Visual: lista vertical de cards clicaveis (igual padrao MemberPicker do wizard
// de projeto). Acima, chips dos selecionados pra varredura visual rapida.

import { useState } from 'react';

interface Collab {
  id: string;
  full_name: string;
  role: string;
}

interface Props {
  options: Collab[];
  value: string[];
  onChange: (ids: string[]) => void;
}

export function ParticipantsPicker({ options, value, onChange }: Props) {
  const [query, setQuery] = useState('');

  const selectedSet = new Set(value);
  const selected = options.filter(c => selectedSet.has(c.id));
  const filtered = query.trim()
    ? options.filter(c => c.full_name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function toggle(id: string) {
    if (selectedSet.has(id)) onChange(value.filter(x => x !== id));
    else onChange([...value, id]);
  }

  return (
    <div className="space-y-sm">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              aria-label={`Remover ${c.full_name}`}
              className="inline-flex items-center gap-1 text-body-sm bg-tom/15 text-fg rounded-full pl-3 pr-2 py-1 border border-tom/40 focus-ring"
            >
              <span>{c.full_name}</span>
              <span className="text-fg-muted text-body-md leading-none">×</span>
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar pelo nome…"
        className="w-full h-11 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />

      <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-bg-surface">
        {filtered.length === 0 ? (
          <div className="px-md py-sm text-body-sm text-fg-muted">Ninguém com esse nome.</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map(c => {
              const isSel = selectedSet.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={[
                      'w-full text-left px-md py-2 flex items-center gap-md focus-ring',
                      isSel ? 'bg-tom/10' : 'hover:bg-bg-elevated',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'h-5 w-5 rounded-md border flex items-center justify-center shrink-0',
                        isSel ? 'bg-tom border-tom' : 'bg-bg border-border',
                      ].join(' ')}
                      aria-hidden
                    >
                      {isSel && <span className="text-white text-body-xs font-bold">✓</span>}
                    </span>
                    <span className="text-body-md text-fg flex-1 truncate">{c.full_name}</span>
                    <span className="text-body-xs text-fg-muted">{c.role}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
