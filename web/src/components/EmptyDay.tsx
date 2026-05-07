// Sprint 22 Phase A — empty state compacto pra dia/seção sem itens.
// Spec: docs/design-system.md §4.3.

interface Props {
  message?: string;
  className?: string;
}

export function EmptyDay({ message = 'Nenhuma tarefa', className }: Props) {
  return (
    <p className={['mt-2 text-body-sm text-fg-muted italic', className ?? ''].join(' ')}>
      {message}
    </p>
  );
}
