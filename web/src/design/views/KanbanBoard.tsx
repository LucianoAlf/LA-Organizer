import { useState, type ReactNode } from 'react';
import { Plus, GripVertical } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

export interface KanbanColumn<T> {
  id: string;
  title: string;
  items: T[];
  accentColor?: string;
  count?: number;
}

interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[];
  /**
   * Render do card. Recebe (item, columnId, dragHandle?) — o `dragHandle` é um
   * ReactNode já com listeners/ref do @dnd-kit; o card deve renderizá-lo DENTRO
   * de si (antes do título, por exemplo). Se ausente, renderiza sem handle.
   */
  renderCard: (item: T, columnId: string, dragHandle?: ReactNode) => ReactNode;
  onAddToColumn?: (columnId: string) => void;
  getItemKey: (item: T) => string;
  /**
   * Callback ao mover um card entre colunas. Se ausente, drops são no-op.
   */
  onMoveItem?: (itemId: string, fromColumnId: string, toColumnId: string) => void;
}

interface DraggableCardProps<T> {
  id: string;
  columnId: string;
  item: T;
  renderCard: (item: T, columnId: string, dragHandle?: ReactNode) => ReactNode;
}

function DraggableCard<T>({ id, columnId, item, renderCard }: DraggableCardProps<T>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({
    id,
    data: { columnId, type: 'card' },
  });

  // Handle do drag — só o handle escuta os listeners. Click no card abre drawer;
  // drag pelo handle move entre colunas. stopPropagation no click/mousedown
  // garante que arrastar o handle não dispara o onClick do card.
  const dragHandle = (
    <span
      ref={setActivatorNodeRef}
      aria-label="Arrastar card"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      {...attributes}
      {...listeners}
      className="shrink-0 inline-grid place-items-center w-4 h-5 rounded text-fg-muted/60 hover:text-fg hover:bg-bg-app/60 transition-colors cursor-grab active:cursor-grabbing touch-none focus-ring -ml-0.5"
    >
      <GripVertical size={12} />
    </span>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        // O card original fica fixo no lugar com opacity reduzida — NÃO se move
        // via transform. Quem segue o cursor é o <DragOverlay>. Isso elimina
        // jitter e "teleport" visual quando o card é solto em outra coluna.
        opacity: isDragging ? 0.3 : 1,
      }}
    >
      {renderCard(item, columnId, dragHandle)}
    </div>
  );
}

interface ColumnDropZoneProps {
  columnId: string;
  isEmpty: boolean;
  children: ReactNode;
}

function ColumnDropZone({ columnId, isEmpty, children }: ColumnDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnId,
    data: { type: 'column' },
  });
  return (
    <div
      ref={setNodeRef}
      className={[
        'flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-0 transition-colors',
        isOver ? 'bg-tom/5 ring-2 ring-inset ring-tom/30' : '',
        isEmpty ? 'flex items-center justify-center' : '',
      ].join(' ')}
    >
      {children}
    </div>
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
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Hybrid collision detection: pointerWithin (preciso, segue o cursor) com
  // fallback pra rectIntersection (pega drops onde o cursor saiu rapidamente
  // do droppable). Mais fluido que closestCorners pra kanban com mouse.
  const collisionDetection: CollisionDetection = args => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return rectIntersection(args);
  };

  // Estado do card sendo arrastado — necessário pro DragOverlay renderizar
  // o mesmo card no portal seguindo o cursor.
  const [active, setActive] = useState<{ id: string; columnId: string; item: T } | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const columnId = event.active.data.current?.columnId as string | undefined;
    if (!columnId) return;
    const col = columns.find(c => c.id === columnId);
    const item = col?.items.find(it => getItemKey(it) === id);
    if (item) setActive({ id, columnId, item });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActive(null);
    const { active: act, over } = event;
    if (!over || !onMoveItem) return;

    const fromColumnId = act.data.current?.columnId as string | undefined;
    const overType = over.data.current?.type;
    const toColumnId =
      overType === 'card'
        ? (over.data.current?.columnId as string | undefined)
        : String(over.id);

    if (fromColumnId && toColumnId && fromColumnId !== toColumnId) {
      onMoveItem(String(act.id), fromColumnId, toColumnId);
    }
  }

  function handleDragCancel() {
    setActive(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-3 h-full overflow-x-auto pb-2">
        {columns.map(col => {
          const isEmpty = col.items.length === 0;
          return (
            <div
              key={col.id}
              // Colunas: fundo bem escuro (sutil acima do app), borda discreta + gradiente
              // top-down pra dar sensacao de elevacao sem ficar clarao "cinza Office"
              className="flex-shrink-0 w-72 flex flex-col rounded-lg overflow-hidden border border-border/70 bg-gradient-to-b from-[#141414] to-[#0E0E0E] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
            >
              <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border/60 shrink-0 bg-black/20">
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
              <ColumnDropZone columnId={col.id} isEmpty={isEmpty}>
                {isEmpty ? (
                  <div className="text-[11px] text-fg-muted">Vazio</div>
                ) : (
                  col.items.map(item => (
                    <DraggableCard
                      key={getItemKey(item)}
                      id={getItemKey(item)}
                      columnId={col.id}
                      item={item}
                      renderCard={renderCard}
                    />
                  ))
                )}
              </ColumnDropZone>
            </div>
          );
        })}
      </div>

      {/* DragOverlay renderiza o card no portal do body seguindo o cursor.
          dropAnimation={null} = snap imediato no soltar (sem animação de "voo
          de volta"). A mutação optimista do React Query já move o card visualmente
          assim que o drop acontece, então a animação de drop ficaria conflitante. */}
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div
            style={{
              width: 272, // mesma largura do card original (w-72 da coluna - px-2)
              boxShadow: '0 8px 24px -6px rgba(0,0,0,0.45)',
              borderRadius: 8,
              cursor: 'grabbing',
            }}
          >
            {renderCard(active.item, active.columnId, undefined)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
