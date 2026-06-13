import { KeyRound, Building2, Banknote, NotebookPen, FileText } from 'lucide-react';
import type { NoteType } from '../../../lib/groupNotes';

const MAP = { acesso: KeyRound, cnpj: Building2, conta: Banknote, reuniao: NotebookPen, livre: FileText } as const;

export function TypeIcon({ type, size = 16, className }: { type: NoteType; size?: number; className?: string }) {
  const Icon = MAP[type] ?? FileText;
  return <Icon size={size} className={className} aria-hidden />;
}
