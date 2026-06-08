// web/src/screens/DashboardTime.tsx
// Dispatcher (Guardrail Desktop): mobile = DashboardTimeMobile (visão atual);
// desktop = DashboardTimeDesktop (CEO: semáforo de líderes + drill master-detail).
// A rota /time aponta pra cá — o export `DashboardTime` não muda.
import { useBreakpoint } from '../hooks/useBreakpoint';
import { DashboardTimeMobile } from './DashboardTimeMobile';
import { DashboardTimeDesktop } from './DashboardTimeDesktop';

export function DashboardTime() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <DashboardTimeMobile />;
  return <DashboardTimeDesktop />;
}
