// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Sprint 11 F2+ / Sessao B — Hierarquia tipografica do wizard 5W2H corrigida.
// Antes: label e valor com pesos/tamanhos proximos demais → poluicao visual.
// Depois: 3 niveis claros — eyebrow (rotulo), value (texto principal), help (sub).

import type { ReactNode } from 'react';

export function Field({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-body-md font-semibold text-fg block leading-snug">{label}</label>
      {sub && <div className="text-body-sm text-fg-muted leading-snug">{sub}</div>}
      {children}
    </div>
  );
}
