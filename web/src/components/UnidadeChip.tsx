import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { useUnidadeSelecionada } from '../hooks/useUnidadeSelecionada';

export function UnidadeChip() {
  const { unidade, unidades, setUnidade } = useUnidadeSelecionada();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-bg-surface border border-border rounded-xl px-3 py-1.5 text-body-sm text-fg flex items-center gap-1"
      >
        {unidade?.nome ?? 'Selecionar'} <span className="text-fg-muted">▾</span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Unidade">
        <div className="space-y-1">
          {unidades.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => { setUnidade(u.id); setOpen(false); }}
              className={[
                'w-full text-left px-md py-3 rounded-md border',
                u.id === unidade?.id
                  ? 'bg-tom/10 border-tom text-tom font-semibold'
                  : 'bg-bg-surface border-border text-fg hover:border-tom/30',
              ].join(' ')}
            >
              {u.nome}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
