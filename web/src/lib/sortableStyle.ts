// Sprint 22.39d — estilo compartilhado para itens sortable.
// Substitui o "opacity 0.5 fantasma in-place" por um feedback de "card erguido"
// (shadow + zIndex). O transform aplicado pelo @dnd-kit ja move o item junto
// com o cursor; o que faltava era o feedback visual de levantamento.
import type { CSSProperties } from 'react'

export function dragLiftStyle(isDragging: boolean | undefined, base?: CSSProperties): CSSProperties {
  if (!isDragging) return base ?? {}
  return {
    ...(base ?? {}),
    zIndex: 50,
    boxShadow: '0 12px 28px -8px rgba(0,0,0,0.35)',
    cursor: 'grabbing',
  }
}
