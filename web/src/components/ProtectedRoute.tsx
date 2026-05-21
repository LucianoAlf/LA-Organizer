import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { Role } from '../types';
import { LoadingState } from './LoadingState';
import { checkAccess } from '../lib/access-control';

interface Props {
  requireRoles?: Role[];
  /** Verifica acesso via access-rules.json (3 camadas: role + function_role + pedagogical_role).
   *  Use isso para rotas governadas por dataType (ex: 'inventario', 'loja_produtos').
   *  Tem precedência sobre requireRoles quando ambos são passados. */
  requireAccess?: string;
}

/**
 * Gates a route. Four behaviors:
 *  - loading -> spinner
 *  - no session -> /login
 *  - requireAccess set e checkAccess.allowed === false -> /hoje
 *  - requireRoles set e role não está na lista -> /hoje
 */
export function ProtectedRoute({ requireRoles, requireAccess }: Props) {
  const { session, role, collaborator, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState fullScreen label="Carregando..." />;

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAccess) {
    const collab = collaborator ? {
      id: collaborator.id,
      role: collaborator.role,
      unit: collaborator.unit ?? null,
      full_name: collaborator.full_name,
      function_role: (collaborator as any).function_role ?? null,
      pedagogical_role: (collaborator as any).pedagogical_role ?? null,
    } : null;
    const res = checkAccess(collab, requireAccess);
    if (!res.allowed) {
      return <Navigate to="/hoje" replace />;
    }
    return <Outlet />;
  }

  if (requireRoles && (!role || !requireRoles.includes(role))) {
    return <Navigate to="/hoje" replace />;
  }

  return <Outlet />;
}
