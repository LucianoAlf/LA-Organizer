import { ArrowRight } from 'lucide-react';
import { AdaptiveSheet } from '../../../components/AdaptiveSheet';
import { DayBoard } from './DayBoard';
import { dowShort, brShort } from '../../../utils/date';

interface Props {
  open: boolean;
  ymd: string | null;
  onClose: () => void;
  onOpenFullDay: (ymd: string) => void;
}

export function MonthDaySheet({ open, ymd, onClose, onOpenFullDay }: Props) {
  return (
    <AdaptiveSheet
      open={open && Boolean(ymd)}
      onClose={onClose}
      title={ymd ? `${dowShort(ymd)} ${brShort(ymd)}` : ''}
      size="md"
    >
      {ymd && (
        <div className="space-y-md">
          <DayBoard ymd={ymd} />
          <button
            type="button"
            onClick={() => onOpenFullDay(ymd)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md border border-border text-fg-secondary hover:text-fg focus-ring"
          >
            Ver dia completo <ArrowRight size={16} />
          </button>
        </div>
      )}
    </AdaptiveSheet>
  );
}
