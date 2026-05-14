// Conteúdo da tela 2 do wizard — personalizado por function_title.
// Mapeamento: function_title → {icon, title, subtitle, chips}

export interface OnboardingSlide2 {
  icon: string;
  title: string;
  subtitle: string;
  chips: Array<{ label: string; highlight: boolean }>;
}

const SALES_SLIDE: OnboardingSlide2 = {
  icon: '📋',
  title: 'Seu pipeline e metas em um lugar só',
  subtitle: 'Registra leads, acompanha negociações e nunca perde um follow-up.',
  chips: [
    { label: '✅ Tarefas',    highlight: true  },
    { label: '📊 Projetos',  highlight: true  },
    { label: '📅 Agenda',    highlight: false },
    { label: '📋 Checklists',highlight: false },
  ],
};

const MANAGEMENT_SLIDE: OnboardingSlide2 = {
  icon: '🏢',
  title: 'Seu time e operação em um lugar só',
  subtitle: 'Gestão de equipe, projetos, checklists e indicadores reunidos.',
  chips: [
    { label: '👥 Equipe',     highlight: true  },
    { label: '📊 Projetos',   highlight: true  },
    { label: '📋 Checklists', highlight: true  },
    { label: '✅ Tarefas',    highlight: false },
  ],
};

const CONTENT: Record<string, OnboardingSlide2> = {
  Farmer: SALES_SLIDE,
  Hunter: SALES_SLIDE,
  Professor: {
    icon: '📚',
    title: 'Suas aulas e agenda em um lugar só',
    subtitle: 'Agenda de aulas, lembretes e checklists de rotina num só lugar.',
    chips: [
      { label: '📅 Agenda',     highlight: true  },
      { label: '📋 Checklists', highlight: true  },
      { label: '✅ Tarefas',    highlight: false },
      { label: '📊 Projetos',   highlight: false },
    ],
  },
  'Assistente Pedagógico': {
    icon: '🎓',
    title: 'Seus checklists e operação em um lugar só',
    subtitle: 'Checklists diários, tarefas e apoio à equipe pedagógica.',
    chips: [
      { label: '📋 Checklists', highlight: true  },
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📅 Agenda',     highlight: false },
      { label: '📊 Projetos',   highlight: false },
    ],
  },
  Financeiro: {
    icon: '💰',
    title: 'Seus projetos e demandas em um lugar só',
    subtitle: 'Acompanha demandas, tarefas e prazos sem perder nada.',
    chips: [
      { label: '📊 Projetos',   highlight: true  },
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📅 Agenda',     highlight: false },
      { label: '📋 Checklists', highlight: false },
    ],
  },
  RH: {
    icon: '👥',
    title: 'Seus projetos e demandas em um lugar só',
    subtitle: 'Acompanha demandas, tarefas e prazos sem perder nada.',
    chips: [
      { label: '📊 Projetos',   highlight: true  },
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📅 Agenda',     highlight: false },
      { label: '📋 Checklists', highlight: false },
    ],
  },
  'Coordenador de Tecnologia': {
    icon: '💻',
    title: 'Seus projetos e demandas em um lugar só',
    subtitle: 'Acompanha projetos de tecnologia, tarefas e prazos sem perder nada.',
    chips: [
      { label: '📊 Projetos',   highlight: true  },
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📅 Agenda',     highlight: false },
      { label: '📋 Checklists', highlight: false },
    ],
  },
  Marketing: {
    icon: '📣',
    title: 'Suas campanhas e projetos em um lugar só',
    subtitle: 'Registra ações, acompanha prazos e nunca perde um entregável.',
    chips: [
      { label: '📊 Projetos',   highlight: true  },
      { label: '✅ Tarefas',    highlight: true  },
      { label: '📅 Agenda',     highlight: false },
      { label: '📋 Checklists', highlight: false },
    ],
  },
  Gerente: MANAGEMENT_SLIDE,
  Coordenador: MANAGEMENT_SLIDE,
  Diretor: {
    icon: '🎯',
    title: 'Visão completa da operação da LA',
    subtitle: 'Time, projetos, checklists e indicadores em um painel só.',
    chips: [
      { label: '👥 Equipe',     highlight: true  },
      { label: '📊 Projetos',   highlight: true  },
      { label: '📋 Checklists', highlight: true  },
      { label: '✅ Tarefas',    highlight: false },
    ],
  },
};

const DEFAULT: OnboardingSlide2 = {
  icon: '📋',
  title: 'Suas tarefas e agenda em um lugar só',
  subtitle: 'Tarefas, lembretes e checklists — tudo num só lugar.',
  chips: [
    { label: '✅ Tarefas', highlight: true  },
    { label: '📅 Agenda',  highlight: true  },
    { label: '📊 Projetos',highlight: false },
    { label: '📋 Checklists', highlight: false },
  ],
};

export function getOnboardingSlide2(functionTitle: string | null): OnboardingSlide2 {
  if (!functionTitle) return DEFAULT;
  return CONTENT[functionTitle] ?? DEFAULT;
}
