// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Linhas/blocos de resumo (review do wizard + tela de sucesso). Mantem pareamento
// label-uppercase + valor-em-destaque consistente.

import type { ReactNode } from 'react';

export function SummaryInline({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-md">
      <span className="text-label uppercase tracking-wide text-fg-muted shrink-0 pt-1">
        {label}
      </span>
      <span className="text-body-md font-semibold text-fg text-right break-words">
        {children}
      </span>
    </div>
  );
}

export function SummaryBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-label uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-body-md text-fg whitespace-pre-wrap break-words leading-snug">
        {children}
      </div>
    </div>
  );
}
