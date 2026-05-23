import { useBreakpoint } from '../hooks/useBreakpoint';
import { Hoje } from './Hoje';
import { AgendaDesktop } from './AgendaDesktop';

export default function Agenda() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <Hoje />;
  return <AgendaDesktop />;
}
