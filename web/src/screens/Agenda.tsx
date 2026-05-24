import { Navigate } from 'react-router-dom';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { AgendaDesktop } from './AgendaDesktop';

/**
 * Dispatcher /agenda — só mobile puro (<768px) redireciona para `/hoje` (preserva
 * AppShell mobile com AgendaTabs original). Tablet (768-1023) E desktop (>=1024)
 * renderizam o AgendaDesktop — ambos têm espaço pra shell de 3 painéis.
 */
export default function Agenda() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <Navigate to="/hoje" replace />;
  return <AgendaDesktop />;
}
