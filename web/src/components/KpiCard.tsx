import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

// Sprint Agenda Desktop / Governança — card de estatística padronizado.
// Usado em ProjectsDashboard e GovernancaPage (Credenciais). Mantém consistência
// visual entre módulos: número grande, label uppercase, ícone à direita com
// accent color, linha de gradiente no rodapé.

export interface KpiCardProps {
  label: string;
  value: number | string;
  Icon: ComponentType<LucideProps>;
  /** Hex (ex. "#A3BE50"). Default = tom verde. */
  accentColor?: string;
}

export function KpiCard({ label, value, Icon, accentColor = '#A3BE50' }: KpiCardProps) {
  return (
    <div className="relative rounded-xl border border-border bg-bg-surface p-4 overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold">{label}</div>
          <div className="text-[32px] font-bold text-fg leading-none mt-2 tabular-nums">{value}</div>
        </div>
        <div
          className="shrink-0 w-9 h-9 rounded-full grid place-items-center"
          style={{ backgroundColor: `${accentColor}1F`, color: accentColor }}
        >
          <Icon size={16} />
        </div>
      </div>
      <div
        className="absolute left-0 right-0 bottom-0 h-0.5"
        style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }}
      />
    </div>
  );
}
