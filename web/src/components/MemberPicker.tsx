// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Sprint 9: multi-select inline de collaborators ativos.
// Tap pra selecionar/deselecionar. Lista vira chips.

import { useState } from 'react';
import { wizardInputClass } from '../wizard/wizardTypes';
import type { CollabLite } from '../wizard/wizardTypes';

export function MemberPicker({
  collabs,
  selected,
  onToggle,
}: {
  collabs: CollabLite[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = query.trim()
    ? collabs.filter((c) =>
        c.full_name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : collabs;

  const selectedSet = new Set(selected);
  const selectedNames = collabs.filter((c) => selectedSet.has(c.id));

  return (
    <div className="space-y-sm">
      {selectedNames.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedNames.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggle(c.id)}
              className="inline-flex items-center gap-1 text-body-sm bg-brand/15 text-fg rounded-full pl-3 pr-2 py-1 border border-brand/40 focus-ring"
              aria-label={`Remover ${c.full_name}`}
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
        className={wizardInputClass}
      />

      <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-bg-surface">
        {filtered.length === 0 ? (
          <div className="px-md py-sm text-body-sm text-fg-muted">
            Ninguém com esse nome.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((c) => {
              const isSel = selectedSet.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(c.id)}
                    className={[
                      'w-full text-left px-md py-2 flex items-center gap-md focus-ring',
                      isSel ? 'bg-brand/10' : 'hover:bg-bg-elevated',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'h-5 w-5 rounded-md border flex items-center justify-center shrink-0',
                        isSel ? 'bg-brand border-brand' : 'bg-bg border-border',
                      ].join(' ')}
                      aria-hidden
                    >
                      {isSel && (
                        <span className="text-white text-body-xs font-bold">✓</span>
                      )}
                    </span>
                    <span className="text-body-md text-fg flex-1 truncate">
                      {c.full_name}
                    </span>
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
