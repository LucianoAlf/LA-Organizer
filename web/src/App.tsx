import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { Login } from './screens/Login';
import { Hoje } from './screens/Hoje';
import { Semana } from './screens/Semana';
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
import { LaEducaListaPage } from './screens/laeduca/ListaPage';
import { LaEducaCadastroPage } from './screens/laeduca/CadastroEstagiarioPage';
import { LaEducaEstagiarioDetalhePage } from './screens/laeduca/EstagiarioDetalhePage';
import { LaEducaPilarPage } from './screens/laeduca/PilarAvaliacaoPage';
import { LaEducaAdminTrilhaPage } from './screens/laeduca/AdminTrilhaPage';
import { LaJourneyListaPage } from './screens/lajourney/ListaPage';
import { LaJourneyAdminPage } from './screens/lajourney/AdminPage';
import { LaJourneyCheckpointPage } from './screens/lajourney/CheckpointPage';
import { InventarioListaPage } from './screens/inventario/ListaPage';
import { InventarioSalaPage } from './screens/inventario/SalaPage';
import { LojaHub } from './screens/inventario/LojaHub';
import { ProdutosPage } from './screens/inventario/ProdutosPage';
import { HistoricoPage } from './screens/inventario/HistoricoPage';
import { ReservasPage } from './screens/inventario/ReservasPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/hoje" replace />} />
          <Route path="hoje" element={<Hoje />} />
          <Route path="semana" element={<Semana />} />
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

          {/* INVENTÁRIO — dados vêm do LA Report via internal-api do TOM. Read-only.
              Gated em coord/director/manager (Rafinha é manager).
              IMPORTANT: /inventario/loja antes de /inventario/sala/:salaId. */}
          <Route element={<ProtectedRoute requireRoles={['coordinator', 'director', 'manager']} />}>
            <Route path="inventario" element={<InventarioListaPage />} />
            <Route path="inventario/loja" element={<LojaHub />} />
            <Route path="inventario/loja/produtos" element={<ProdutosPage />} />
            <Route path="inventario/loja/historico" element={<HistoricoPage />} />
            <Route path="inventario/loja/reservas" element={<ReservasPage />} />
            <Route path="inventario/sala/:salaId" element={<InventarioSalaPage />} />
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
  );
}
