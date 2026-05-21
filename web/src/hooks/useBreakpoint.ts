import { useMediaQuery } from './useMediaQuery';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

/**
 * Detecta o breakpoint atual baseado em largura da viewport.
 *  - mobile  : < 768px
 *  - tablet  : 768px – 1023.98px
 *  - desktop : >= 1024px
 */
export function useBreakpoint(): Breakpoint {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023.98px)');
  if (isDesktop) return 'desktop';
  if (isTablet) return 'tablet';
  return 'mobile';
}
