import { useAccess } from '../../../hooks/useAccess';
import { useIsProfessor } from '../../../hooks/useIsProfessor';

interface Props { onClick: () => void; }

export function ItemFAB({ onClick }: Props) {
  const access = useAccess('inventario');
  const isProf = useIsProfessor();
  if (!access.allowed || isProf) return null;
  return (
    <button onClick={onClick} className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-tom text-black shadow-lg flex items-center justify-center text-2xl font-bold z-50 active:scale-95 transition" aria-label="Novo item">
      +
    </button>
  );
}
