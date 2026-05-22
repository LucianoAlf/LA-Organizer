import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

export interface KanbanColumn<T> {
  id: string;
  title: string;
  items: T[];
  accentColor?: string;
  count?: number;
}

interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[];
  renderCard: (item: T, columnId: string) => ReactNode;
  onAddToColumn?: (columnId: string) => void;
  getItemKey: (item: T) => string;
}

export function KanbanBoard<T>({
  columns,
  renderCard,
  onAddToColumn,
  getItemKey,
}: KanbanBoardProps<T>) {
  return (
    <div className="flex gap-3 h-full overflow-x-auto pb-2">
      {columns.map(col => (
        <div
          key={col.id}
          className="flex-shrink-0 w-72 flex flex-col bg-bg-surface border border-border rounded-lg overflow-hidden"
        >
          <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {col.accentColor && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: col.accentColor }}
                />
              )}
              <span className="text-[13px] font-semibold text-fg truncate">{col.title}</span>
              <span className="text-[11px] text-fg-muted font-medium tabular-nums">
                {col.count ?? col.items.length}
              </span>
            </div>
            {onAddToColumn && (
              <button
                type="button"
                onClick={() => onAddToColumn(col.id)}
                aria-label={`Adicionar em ${col.title}`}
                className="w-6 h-6 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated transition-colors focus-ring"
              >
                <Plus size={13} />
              </button>
            )}
          </header>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-0">
            {col.items.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-fg-muted">Vazio</div>
            ) : (
              col.items.map(item => (
                <div key={getItemKey(item)}>{renderCard(item, col.id)}</div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
