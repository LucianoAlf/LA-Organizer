import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoadingState } from './components/LoadingState';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { DesktopShell } from './components/DesktopShell';
import { useBreakpoint } from './hooks/useBreakpoint';
import { Login } from './screens/Login';
import { Hoje } from './screens/Hoje';
import { Semana } from './screens/Semana';
import Agenda from './screens/Agenda';
import AgendaPreviewDev from './screens/_AgendaPreviewDev';
import { Projetos } from './screens/Projetos';
import { NovoProjeto } from './screens/NovoProjeto';
import { ProjetoDetalhe } from './screens/ProjetoDetalhe';
import { Mais } from './screens/Mais';
import { DashboardTime } from './screens/DashboardTime';
import { PessoaDetalhe } from './screens/PessoaDetalhe';
import { Configuracoes } from './screens/Configuracoes';
import { Historico } from './screens/Historico';
import { Habitos } from './screens/Habitos';
import { HabitoDetalhe } from './screens/HabitoDetalhe';
import { Checklists } from './screens/Checklists';
import { Comunicados } from './screens/Comunicados';
import { ComunicadoDetalhe } from './screens/ComunicadoDetalhe';
import { AgendaEscolar } from './screens/AgendaEscolar';
import { ConfigurarEquipe } from './screens/ConfigurarEquipe';
import { EventoDetalhe } from './screens/EventoDetalhe';
import { Observabilidade } from './screens/Observabilidade';
import { OperacoesFilaTecnica } from './screens/OperacoesFilaTecnica';
import { OperacaoDetalhe } from './screens/OperacaoDetalhe';
import { AderenciaChecklists } from './screens/AderenciaChecklists';
import { AderenciaChecklistDetalhe } from './screens/AderenciaChecklistDetalhe';
import { MeuPerfil } from './screens/MeuPerfil';
import { GestaoEquipe } from './screens/GestaoEquipe';
import { GestaoEquipeNovo } from './screens/GestaoEquipeNovo';
import { GestaoEquipeDetalhe } from './screens/GestaoEquipeDetalhe';
import { DesignSystem } from './screens/DesignSystem';
const LaEducaListaPage = lazy(() => import('./screens/laeduca/ListaPage').then(m => ({ default: m.LaEducaListaPage })));
const LaEducaCadastroPage = lazy(() => import('./screens/laeduca/CadastroEstagiarioPage').then(m => ({ default: m.LaEducaCadastroPage })));
const LaEducaEstagiarioDetalhePage = lazy(() => import('./screens/laeduca/EstagiarioDetalhePage').then(m => ({ default: m.LaEducaEstagiarioDetalhePage })));
const LaEducaPilarPage = lazy(() => import('./screens/laeduca/PilarAvaliacaoPage').then(m => ({ default: m.LaEducaPilarPage })));
const LaEducaAdminTrilhaPage = lazy(() => import('./screens/laeduca/AdminTrilhaPage').then(m => ({ default: m.LaEducaAdminTrilhaPage })));
const LaJourneyListaPage = lazy(() => import('./screens/lajourney/ListaPage').then(m => ({ default: m.LaJourneyListaPage })));
const LaJourneyAdminPage = lazy(() => import('./screens/lajourney/AdminPage').then(m => ({ default: m.LaJourneyAdminPage })));
const LaJourneyCheckpointPage = lazy(() => import('./screens/lajourney/CheckpointPage').then(m => ({ default: m.LaJourneyCheckpointPage })));
const InventarioListaPage = lazy(() => import('./screens/inventario/ListaPage').then(m => ({ default: m.InventarioListaPage })));
const InventarioSalaPage = lazy(() => import('./screens/inventario/SalaPage').then(m => ({ default: m.InventarioSalaPage })));
const LojaHub = lazy(() => import('./screens/inventario/LojaHub').then(m => ({ default: m.LojaHub })));
const ProdutosPage = lazy(() => import('./screens/inventario/ProdutosPage').then(m => ({ default: m.ProdutosPage })));
const HistoricoPage = lazy(() => import('./screens/inventario/HistoricoPage').then(m => ({ default: m.HistoricoPage })));
const ReservasPage = lazy(() => import('./screens/inventario/ReservasPage').then(m => ({ default: m.ReservasPage })));

/**
 * Wrapper que escolhe o shell com base no breakpoint.
 * Mobile (<768px) usa o AppShell legado (BottomNav + Header).
 * Tablet e desktop usam o DesktopShell (Sidebar + Topbar) — Fase D1.
 */
function AppLayout() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <AppShell />;
  return <DesktopShell />;
}

/**
 * Dispatchers de rota legada: /hoje e /semana no mobile mantém Hoje/Semana
 * originais; no desktop redirecionam pra /agenda?view=day|week — assim links
 * antigos (sidebar cacheada, bookmarks) caem na rota nova sem quebrar mobile.
 */
function HojeOrDesktopAgenda() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <Hoje />;
  return <Navigate to="/agenda?view=day" replace />;
}
function SemanaOrDesktopAgenda() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <Semana />;
  return <Navigate to="/agenda?view=week" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingState />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/_agenda-preview" element={<AgendaPreviewDev />} />
      <Route path="/design-system" element={<DesignSystem />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/hoje" replace />} />
          <Route path="hoje" element={<HojeOrDesktopAgenda />} />
          <Route path="semana" element={<SemanaOrDesktopAgenda />} />
          <Route path="agenda" element={<Agenda />} />
          <Route path="projetos" element={<Projetos />} />
          <Route path="projetos/novo" element={<NovoProjeto />} />
          <Route path="projetos/:id" element={<ProjetoDetalhe />} />
          <Route path="mais" element={<Mais />} />
          <Route path="configuracoes" element={<Configuracoes />} />
          <Route path="historico" element={<Historico />} />
          <Route path="habitos" element={<Habitos />} />
          <Route path="habitos/:id" element={<HabitoDetalhe />} />
          <Route path="checklists" element={<Checklists />} />

          {/* Agenda Escolar — leitura aberta a toda equipe (resolver dor da Barra). */}
          {/* Criação/edição segue restrita a director/coordinator (validado por RLS no banco). */}
          <Route path="mais/perfil" element={<MeuPerfil />} />
          <Route path="mais/agenda-escolar" element={<AgendaEscolar />} />
          <Route path="mais/eventos/:id" element={<EventoDetalhe />} />

          {/* Sprint 23.6 — Gestão de equipe (admin panel) */}
          <Route element={<ProtectedRoute requireRoles={['director', 'coordinator', 'manager']} />}>
            <Route path="mais/gestao-equipe" element={<GestaoEquipe />} />
            <Route path="mais/gestao-equipe/novo" element={<GestaoEquipeNovo />} />
            <Route path="mais/gestao-equipe/:id" element={<GestaoEquipeDetalhe />} />
          </Route>

          <Route element={<ProtectedRoute requireRoles={['director', 'coordinator']} />}>
            <Route path="mais/comunicados" element={<Comunicados />} />
            <Route path="mais/comunicados/:id" element={<ComunicadoDetalhe />} />
            <Route path="mais/agenda-escolar/equipe" element={<ConfigurarEquipe />} />
            <Route path="mais/observabilidade" element={<Observabilidade />} />
          </Route>

          <Route element={<ProtectedRoute requireRoles={['director', 'coordinator', 'manager']} />}>
            <Route path="mais/operacoes" element={<OperacoesFilaTecnica />} />
            <Route path="mais/operacoes/:id" element={<OperacaoDetalhe />} />
          </Route>

          {/* LA EDUCA — qualquer autenticado pode acessar (RLS filtra o que vê).
              Cadastro e admin da trilha ficam gated com ProtectedRoute pra coord/director. */}
          <Route path="la-educa" element={<LaEducaListaPage />} />
          <Route element={<ProtectedRoute requireRoles={['coordinator', 'director']} />}>
            <Route path="la-educa/novo" element={<LaEducaCadastroPage />} />
            <Route path="la-educa/admin" element={<LaEducaAdminTrilhaPage />} />
          </Route>
          <Route path="la-educa/:id" element={<LaEducaEstagiarioDetalhePage />} />
          <Route path="la-educa/:id/:pilar" element={<LaEducaPilarPage />} />

          {/* LA JOURNEY — qualquer autenticado pode acessar (RLS filtra o que vê).
              Admin gated com ProtectedRoute pra coord/director.
              IMPORTANT: la-journey/admin declarado ANTES de la-journey/:checkpointId. */}
          <Route path="la-journey" element={<LaJourneyListaPage />} />
          <Route element={<ProtectedRoute requireRoles={['coordinator', 'director']} />}>
            <Route path="la-journey/admin" element={<LaJourneyAdminPage />} />
          </Route>
          <Route path="la-journey/:checkpointId" element={<LaJourneyCheckpointPage />} />

          {/* INVENTÁRIO — gated por access-rules.json (dataType 'inventario').
              Permite role director/coordinator + function_role ops_tecnicas/farmer/tech + manager_unit + pedagogico + professor_seus_unidades.
              Rafinha (role=collaborator, function_role=ops_tecnicas, unit='all') passa.
              IMPORTANT: /inventario/loja antes de /inventario/sala/:salaId. */}
          <Route element={<ProtectedRoute requireAccess="inventario" />}>
            <Route path="inventario" element={<InventarioListaPage />} />
            <Route path="inventario/sala/:salaId" element={<InventarioSalaPage />} />
          </Route>

          {/* LOJINHA — gated por access-rules.json (dataType 'loja_produtos').
              Permite role director + function_role ops_tecnicas/farmer/backoffice_fin + manager_unit. */}
          <Route element={<ProtectedRoute requireAccess="loja_produtos" />}>
            <Route path="inventario/loja" element={<LojaHub />} />
            <Route path="inventario/loja/produtos" element={<ProdutosPage />} />
            <Route path="inventario/loja/historico" element={<HistoricoPage />} />
            <Route path="inventario/loja/reservas" element={<ReservasPage />} />
          </Route>

          <Route element={<ProtectedRoute requireRoles={['coordinator', 'director']} />}>
            <Route path="time" element={<DashboardTime />} />
            <Route path="time/:id" element={<PessoaDetalhe />} />
          </Route>

          {/* Sprint 22.37 — Aderência operacional pra liderança operacional */}
          <Route element={<ProtectedRoute requireRoles={['director', 'manager']} />}>
            <Route path="mais/aderencia-checklists" element={<AderenciaChecklists />} />
            <Route path="mais/aderencia-checklists/:id" element={<AderenciaChecklistDetalhe />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/hoje" replace />} />
    </Routes>
    </Suspense>
  );
}
