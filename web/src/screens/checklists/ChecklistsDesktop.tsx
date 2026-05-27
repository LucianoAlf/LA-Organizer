// Sprint 23 — ChecklistsDesktop com tabs Hoje | Aderência + engrenagem ⚙️ Templates.
// Tela principal mostra execução do dia; sub-aba mostra gestão; engrenagem leva pra rota separada.

import { useState } from 'react';
import { PageShell } from '../../design/primitives/PageShell';
import { KpiStripe } from './KpiStripe';
import { HojeTab } from './HojeTab';
import { AderenciaTab } from './AderenciaTab';

type Tab = 'hoje' | 'aderencia';

export function ChecklistsDesktop() {
  const [tab, setTab] = useState<Tab>('hoje');

  return (
    <PageShell
      title="Checklists"
      subtitle={tab === 'hoje' ? 'Sua execução de hoje' : 'Aderência da equipe'}
      toolbar={
        <div className="flex items-center w-full">
          <div className="flex items-center gap-1">
            <TabButton active={tab === 'hoje'} onClick={() => setTab('hoje')}>
              Hoje
            </TabButton>
            <TabButton active={tab === 'aderencia'} onClick={() => setTab('aderencia')}>
              Aderência
            </TabButton>
          </div>
          <a
            href="/checklists/templates"
            className="ml-auto text-fg/60 hover:text-tom p-2 text-lg"
            title="Gerenciar templates"
            aria-label="Gerenciar templates"
          >
            ⚙️
          </a>
        </div>
      }
    >
      <KpiStripe />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'hoje' && <HojeTab />}
        {tab === 'aderencia' && <AderenciaTab />}
      </div>
    </PageShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? 'text-tom border-tom'
          : 'text-fg/60 border-transparent hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
