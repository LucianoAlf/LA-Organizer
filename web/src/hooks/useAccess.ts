// _remote/web/src/hooks/useAccess.ts
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { checkAccess, type AccessResult } from '../lib/access-control';

export function useAccess(dataType: string): AccessResult & { isCollab: boolean } {
  const { collaborator } = useAuth();
  return useMemo(() => {
    const collab = collaborator ? {
      id: collaborator.id,
      role: collaborator.role,
      unit: collaborator.unit ?? null,
      full_name: collaborator.full_name,
      function_role: (collaborator as any).function_role ?? null,
      pedagogical_role: (collaborator as any).pedagogical_role ?? null,
    } : null;
    const res = checkAccess(collab, dataType);
    return { ...res, isCollab: Boolean(collab) };
  }, [collaborator, dataType]);
}
