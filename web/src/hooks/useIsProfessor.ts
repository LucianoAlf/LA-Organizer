// _remote/web/src/hooks/useIsProfessor.ts
import { useAuth } from '../contexts/AuthContext';
export function useIsProfessor(): boolean {
  const { collaborator } = useAuth();
  return (collaborator as any)?.function_role === 'professor';
}
