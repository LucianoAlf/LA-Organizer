// Sprint 12 Bloco D — Badge visual da categoria de execução (action_type)
// decidida pelo TOM via skill priorizacao-inteligente. Espelha a "decisão" do
// agente no app, fechando o loop "TOM inteligente reflete no PWA".
import { Badge } from './Badge';
import { ACTION_TYPE_LABELS, ACTION_TYPE_VISUAL, type ActionType } from '../types';

interface Props {
  type: ActionType | null | undefined;
  /** Quando compact, esconde o label e mostra só ícone. Útil em listas densas. */
  compact?: boolean;
}

export function ActionTypeBadge({ type, compact }: Props) {
  if (!type) return null;
  const visual = ACTION_TYPE_VISUAL[type];
  if (!visual) return null;
  return (
    <Badge tone={visual.tone}>
      <span aria-hidden>{visual.icon}</span>
      {!compact && <span>{ACTION_TYPE_LABELS[type]}</span>}
    </Badge>
  );
}
