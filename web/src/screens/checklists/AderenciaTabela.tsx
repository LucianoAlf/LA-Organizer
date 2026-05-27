// Sprint 23 — AderenciaTabela: visão tabular densa

import type { AderenciaInstance } from './hooks/useAderencia';

export function AderenciaTabela({ data }: { data: AderenciaInstance[] }) {
  if (data.length === 0) {
    return (
      <div className="text-fg/40 text-sm py-8 text-center">
        Sem dados pra este período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-border rounded-md">
      <table className="min-w-full text-sm">
        <thead className="bg-bg-app">
          <tr>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">
              Template
            </th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">
              Colaborador
            </th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">
              Data
            </th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">
              Horário
            </th>
            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-fg/60 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((inst, idx) => (
            <tr
              key={`${inst.template_id}-${inst.collaborator_id}-${inst.reference_date}-${idx}`}
              className="border-t border-border"
            >
              <td className="px-3 py-2">{inst.template_name}</td>
              <td className="px-3 py-2">{inst.collaborator_name}</td>
              <td className="px-3 py-2 text-fg/60">{inst.reference_date}</td>
              <td className="px-3 py-2 text-fg/60">
                {inst.dispatch_time?.slice(0, 5) ?? '—'}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={inst.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: 'done' | 'late' | 'pending' }) {
  const map = {
    done: { label: 'Feita', cls: 'bg-tom/20 text-tom' },
    late: { label: 'Atrasada', cls: 'bg-danger/20 text-danger' },
    pending: {
      label: 'Pendente',
      cls: 'bg-bg-app text-fg/60 border border-border',
    },
  };
  const m = map[status];
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
