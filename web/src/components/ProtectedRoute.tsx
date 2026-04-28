import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { Role } from '../types';
import { LoadingState } from './LoadingState';

interface Props {
  requireRoles?: Role[];
}

/**
 * Gates a route. Three behaviors:
 *  - loading -> spinner
 *  - no session -> /login
 *  - session but role not in requireRoles -> /hoje (visual no-op)
 */
export function ProtectedRoute({ requireRoles }: Props) {
  const { session, role, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState fullScreen label="Carregando..." />;

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireRoles && (!role || !requireRoles.includes(role))) {
    return <Navigate to="/hoje" replace />;
  }

  return <Outlet />;
}
