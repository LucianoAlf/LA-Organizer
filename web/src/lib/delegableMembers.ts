// web/src/lib/delegableMembers.ts
// Quem um líder pode delegar: a equipe direta dele (inversa de resolveLeadersOf).
// Diretor → todos os ativos. Fallback (líder sem arestas) → todos os ativos.
// Sempre exclui o próprio usuário. Função PURA — testável sem rede.
import { membersOf, type Collab } from './team-routing';

export function delegableMembers(meId: string, role: string, allCollabs: Collab[]): Collab[] {
  const active = (allCollabs ?? []).filter(c => c && c.is_active !== false && c.id !== meId);
  if (role === 'director') return active;

  const me = (allCollabs ?? []).find(c => c.id === meId);
  if (!me) return active; // sem contexto → fallback
  const team = membersOf(me, allCollabs);
  return team.length > 0 ? team : active; // fallback: sem equipe configurada → todos ativos
}
