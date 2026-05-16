import { useState, type ReactNode } from 'react';
import { Badge } from '../../../components/Badge';
import type { JourneyMarcoComCampos } from '../../../lib/lajourney-types';
import { camposDoTipo } from '../../../lib/lajourney-types';

interface Props {
  marco: JourneyMarcoComCampos;
  total: number;
  defaultOpen?: boolean;
  readOnly?: boolean;
  onRemove?: () => void;
  children: ReactNode;
}

function tipoLabel(tipo: string): string {
  if (tipo === 'aprendizado') return 'Aprendizado';
  if (tipo === 'consolidacao') return 'Consolidação';
  return 'Ancoragem Radial';
}

function tipoTone(tipo: string): 'success' | 'warning' | 'info' {
  if (tipo === 'aprendizado') return 'success';
  if (tipo === 'consolidacao') return 'warning';
  return 'info';
}

export function MarcoCard({ marco, total, defaultOpen = false, readOnly = false, onRemove, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const chaves = camposDoTipo(marco.tipo);
  const preenchidos = chaves.filter(k => (marco.campos[k] ?? '').trim()).length;

  return (
    <div className={`bg-bg-surface rounded-lg border border-border overflow-hidden ${open ? 'shadow-sm' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-md py-sm flex items-center gap-sm text-left hover:bg-bg-app/40"
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
          marco.tipo === 'aprendizado' ? 'bg-tom/10 text-tom' :
          marco.tipo === 'consolidacao' ? 'bg-warning/20 text-warning' :
          'bg-info/20 text-info'
        }`}>
          {marco.numero}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">
            Marco {marco.numero} de {total}
          </div>
          <div className="text-body-sm font-semibold text-fg truncate">
            {marco.titulo || marco.tema_foco || tipoLabel(marco.tipo)}
          </div>
          <div className="text-[10px] text-fg-muted">
            {preenchidos}/{chaves.length} campos
          </div>
        </div>
        <Badge tone={tipoTone(marco.tipo)}>{tipoLabel(marco.tipo)}</Badge>
        <span className={`text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="border-t border-border p-md space-y-md">
          {children}
          {!readOnly && onRemove && marco.tipo !== 'consolidacao' && (
            <button
              type="button"
              onClick={onRemove}
              className="text-body-sm text-danger hover:underline mt-md"
            >
              🗑 Remover marco
            </button>
          )}
        </div>
      )}
    </div>
  );
}
