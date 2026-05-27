// web/src/screens/Checklists.tsx
// Sprint 23 — dispatcher mobile/desktop.
// Mobile mantém comportamento original (ChecklistsMobile).
// Desktop ganhou tabs Hoje/Aderência + lista + drawer (ChecklistsDesktop).

import { useBreakpoint } from '../hooks/useBreakpoint';
import { ChecklistsMobile } from './checklists/ChecklistsMobile';
import { ChecklistsDesktop } from './checklists/ChecklistsDesktop';

export function Checklists() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <ChecklistsMobile />;
  return <ChecklistsDesktop />;
}
