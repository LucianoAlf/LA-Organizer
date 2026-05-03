// web/src/components/ChecklistItemRow.tsx
interface Props {
  index: number
  name: string
  done: boolean
  readonly: boolean
  onToggle: () => void
}

export function ChecklistItemRow({ index, name, done, readonly, onToggle }: Props) {
  return (
    <button
      type="button"
      className={[
        'w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors',
        readonly
          ? 'cursor-default opacity-70'
          : 'hover:bg-bg-surface cursor-pointer active:opacity-80',
      ].join(' ')}
      onClick={readonly ? undefined : onToggle}
      disabled={readonly}
    >
      <span
        className={[
          'w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors',
          done ? 'bg-success border-success' : 'border-border',
        ].join(' ')}
      >
        {done && (
          <svg className="text-white" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={['text-body-sm', done ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>
        {index}. {name}
      </span>
    </button>
  )
}
