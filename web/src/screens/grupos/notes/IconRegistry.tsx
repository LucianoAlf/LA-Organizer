// Registry nome→componente Lucide pros ícones curados das fichas (NOTE_ICONS).
// NoteGlyph resolve o nome; fallback FileText se o nome não existir no registry.
import {
  KeyRound, Building2, Store, Banknote, CreditCard, NotebookPen, FileText,
  IdCard, CalendarDays, Landmark, Receipt, Lock, Mail, Phone, MapPin, Star,
  type LucideIcon,
} from 'lucide-react';

const REG: Record<string, LucideIcon> = {
  KeyRound, Building2, BuildingStore: Store, Banknote, CreditCard, NotebookPen, FileText,
  IdCard, CalendarDays, Landmark, Receipt, Lock, Mail, Phone, MapPin, Star,
};

export function NoteGlyph({ name, color, size = 16, className }: { name: string; color?: string; size?: number; className?: string }) {
  const Icon = REG[name] ?? FileText;
  return <Icon size={size} color={color} className={className} aria-hidden />;
}
