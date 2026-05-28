// web/src/components/EmojiPicker.tsx
// Grid curado de ~40 emojis para personal checklists.
// Sem dependências externas — funciona em Simple Browser, PWA e desktop.

interface EmojiPickerProps {
  value: string | null
  onChange: (emoji: string | null) => void
}

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Listas & tarefas', emojis: ['📝', '📋', '✅', '☑️', '🗒️', '🗂️'] },
  { label: 'Mercado & casa',   emojis: ['🛒', '🧺', '🍕', '🥦', '🥛', '🧹'] },
  { label: 'Saúde',            emojis: ['💊', '🏃', '🧘', '💪', '🩺', '🩹'] },
  { label: 'Viagem',           emojis: ['✈️', '🧳', '🗺️', '🏖️', '🏔️', '🚂'] },
  { label: 'Trabalho',         emojis: ['💼', '💻', '📊', '🎯', '📈', '🗓️'] },
  { label: 'Finanças',         emojis: ['💰', '💳', '📦', '🧾', '💵'] },
  { label: 'Geral',            emojis: ['⭐', '❤️', '🔥', '🌟', '🎉', '🎵'] },
]

export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
  return (
    <div>
      <label className="text-caption text-fg-muted block mb-2">Ícone</label>
      <div className="space-y-2">
        {EMOJI_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-caption text-fg-muted mb-1">{group.label}</p>
            <div className="flex flex-wrap gap-1">
              {group.emojis.map(emoji => {
                const active = value === emoji
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onChange(active ? null : emoji)}
                    aria-pressed={active}
                    className={[
                      'w-9 h-9 rounded-md text-xl flex items-center justify-center transition-colors focus-ring',
                      active
                        ? 'bg-bg-surface border-2 border-tom'
                        : 'bg-bg-app border border-border hover:border-tom',
                    ].join(' ')}
                  >
                    {emoji}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="mt-2 text-caption text-fg-muted hover:text-fg transition-colors focus-ring rounded-sm"
        >
          ✕ Nenhum ícone
        </button>
      )}
    </div>
  )
}
