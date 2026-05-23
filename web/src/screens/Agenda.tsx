import { Navigate } from 'react-router-dom';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { AgendaDesktop } from './AgendaDesktop';

/**
 * Dispatcher /agenda — mobile NUNCA hospeda essa rota: redireciona para `/hoje`
 * (preserva o AppShell mobile com AgendaTabs original intocado). Desktop renderiza
 * o AgendaDesktop completo. Tablet também vai pro mobile (Hoje) — desktop só >=1024px.
 */
export default function Agenda() {
  const bp = useBreakpoint();
  if (bp !== 'desktop') return <Navigate to="/hoje" replace />;
  return <AgendaDesktop />;
}
