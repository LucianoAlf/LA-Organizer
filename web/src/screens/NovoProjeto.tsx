import { useBreakpoint } from '../hooks/useBreakpoint';
import { NovoProjetoMobile } from './NovoProjetoMobile';
import { NovoProjetoDesktop } from './NovoProjetoDesktop';

/**
 * NovoProjeto — dispatcher por breakpoint.
 * - mobile (<768px): wizard sticky-bottom (original)
 * - tablet/desktop (≥768px): wizard centralizado em card max-w-3xl com stepper horizontal
 */
export function NovoProjeto() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <NovoProjetoMobile />;
  return <NovoProjetoDesktop />;
}
