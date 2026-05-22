import type { ReactNode } from 'react';

export interface DenseTableColumn<T> {
  key: string;
  label: string;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
}

interface DenseTableProps<T> {
  columns: DenseTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
}

export function DenseTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  emptyState,
}: DenseTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-bg-elevated z-10">
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  style={{ width: col.width, textAlign: col.align ?? 'left' }}
                  className="px-3 py-2 text-[10px] uppercase tracking-wider text-fg-muted font-semibold border-b border-border"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={[
                  'border-b border-border/50 last:border-b-0 transition-colors',
                  onRowClick ? 'cursor-pointer hover:bg-bg-elevated' : '',
                ].join(' ')}
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    style={{ textAlign: col.align ?? 'left' }}
                    className="px-3 py-2 text-[13px] text-fg"
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
