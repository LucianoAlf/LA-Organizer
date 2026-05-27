// Sprint 23 — AderenciaTab: gestão com toggle Cards/Tabela + filtros Hoje/Semana/Mês

import { useState } from 'react';
import { useAderencia, type Range } from './hooks/useAderencia';
import { AderenciaCards } from './AderenciaCards';
import { AderenciaTabela } from './AderenciaTabela';

type View = 'cards' | 'tabela';

export function AderenciaTab() {
  const [range, setRange] = useState<Range>('today');
  const [view, setView] = useState<View>('cards');
  const { data, isLoading } = useAderencia(range);

  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Chip active={range === 'today'} onClick={() => setRange('today')}>
          Hoje
        </Chip>
        <Chip active={range === 'week'} onClick={() => setRange('week')}>
          Semana
        </Chip>
        <Chip active={range === 'month'} onClick={() => setRange('month')}>
          Mês
        </Chip>

        <div className="ml-auto inline-flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setView('cards')}
            className={`px-3 py-1.5 text-xs font-medium ${
              view === 'cards'
                ? 'bg-tom text-bg-app'
                : 'text-fg/70 hover:text-fg'
            }`}
          >
            ◧ Cards
          </button>
          <button
            onClick={() => setView('tabela')}
            className={`px-3 py-1.5 text-xs font-medium border-l border-border ${
              view === 'tabela'
                ? 'bg-tom text-bg-app'
                : 'text-fg/70 hover:text-fg'
            }`}
          >
            ☰ Tabela
          </button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="text-fg/40 text-sm">Carregando…</div>
      ) : view === 'cards' ? (
        <AderenciaCards data={data.byTemplate} />
      ) : (
        <AderenciaTabela data={data.instances} />
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium ${
        active
          ? 'bg-tom text-bg-app'
          : 'bg-bg-surface text-fg/70 hover:text-fg border border-border'
      }`}
    >
      {children}
    </button>
  );
}
