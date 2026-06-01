import { Button } from './Button';
import { AdaptiveSheet } from './AdaptiveSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  onChoose: (scope: 'only_this' | 'this_and_future') => void;
}

export function RecurrenceScopeDialog({ open, onClose, onChoose }: Props) {
  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Tarefa recorrente" size="sm">
      <div className="space-y-4">
        <p className="text-[13px] text-fg-muted">
          Esta tarefa se repete. Onde aplicar as alterações?
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" fullWidth onClick={() => onChoose('this_and_future')}>
            Esta e as próximas
          </Button>
          <Button variant="secondary" fullWidth onClick={() => onChoose('only_this')}>
            Só este dia
          </Button>
          <Button variant="ghost" fullWidth onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
