import { useBreakpoint } from '../hooks/useBreakpoint';
import { ProjetosMobile } from './ProjetosMobile';
import { ProjetosDesktop } from './ProjetosDesktop';

/**
 * Projetos — dispatcher por breakpoint.
 *
 * - mobile (<768px): renderiza a UI mobile original (lista, swipe, DnD, inline rename)
 * - tablet/desktop (≥768px): renderiza a UI desktop nova (PageShell + Kanban/Lista/Timeline/Calendário + DetailDrawer)
 *
 * Ambas as variantes compartilham as mesmas queries Supabase e mutações
 * (cada arquivo tem sua cópia), mas o layout/interação é específico do
 * dispositivo. Isso garante zero regressão na experiência mobile que já
 * estava funcionando.
 */
export function Projetos() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <ProjetosMobile />;
  return <ProjetosDesktop />;
}
