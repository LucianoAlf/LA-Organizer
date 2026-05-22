import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
  /**
   * Callback ao mover um card. Chamado tanto em moves cross-column (status change)
   * quanto same-column (reorder). Se ausente, DnD ainda é habilitado visualmente
   * mas drops são no-op.
   */
  onMoveItem?: (itemId: string, fromColumnId: string, toColumnId: string) => void;
}

interface SortableCardProps {
  id: string;
  columnId: string;
  children: ReactNode;
}

function SortableCard({ id, columnId, children }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { columnId, type: 'card' },
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

interface ColumnDropZoneProps {
  columnId: string;
  cardIds: string[];
  isEmpty: boolean;
  children: ReactNode;
}

function ColumnDropZone({ columnId, cardIds, isEmpty, children }: ColumnDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnId,
    data: { type: 'column' },
  });
  return (
    <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={[
          'flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-0 transition-colors',
          isOver ? 'bg-tom/5 outline outline-2 outline-tom/30 outline-offset-[-4px] rounded-md' : '',
          isEmpty ? 'flex items-center justify-center' : '',
        ].join(' ')}
      >
        {children}
      </div>
    </SortableContext>
  );
}

export function KanbanBoard<T>({
  columns,
  renderCard,
  onAddToColumn,
  getItemKey,
  onMoveItem,
}: KanbanBoardProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !onMoveItem) return;
    if (active.id === over.id) return;

    const fromColumnId = active.data.current?.columnId as string | undefined;
    const overType = over.data.current?.type;
    // Se solto sobre um card, pega a coluna do card. Se solto sobre o corpo da
    // coluna (drop zone), over.id é o ID da coluna.
    const toColumnId =
      overType === 'card'
        ? (over.data.current?.columnId as string | undefined)
        : String(over.id);

    if (fromColumnId && toColumnId) {
      onMoveItem(String(active.id), fromColumnId, toColumnId);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 h-full overflow-x-auto pb-2">
        {columns.map(col => {
          const cardIds = col.items.map(getItemKey);
          const isEmpty = col.items.length === 0;
          return (
            <div
              key={col.id}
              className="flex-shrink-0 w-72 flex flex-col bg-bg-elevated2 border border-border rounded-lg overflow-hidden"
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
              <ColumnDropZone columnId={col.id} cardIds={cardIds} isEmpty={isEmpty}>
                {isEmpty ? (
                  <div className="text-[11px] text-fg-muted">Vazio</div>
                ) : (
                  col.items.map(item => {
                    const key = getItemKey(item);
                    return (
                      <SortableCard key={key} id={key} columnId={col.id}>
                        {renderCard(item, col.id)}
                      </SortableCard>
                    );
                  })
                )}
              </ColumnDropZone>
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
