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

          <Route element={<ProtectedRoute requireRoles={['director', 'coordinator']} />}>
            <Route path="mais/comunicados" element={<Comunicados />} />
            <Route path="mais/comunicados/:id" element={<ComunicadoDetalhe />} />
            <Route path="mais/agenda-escolar" element={<AgendaEscolar />} />
            <Route path="mais/agenda-escolar/equipe" element={<ConfigurarEquipe />} />
            <Route path="mais/observabilidade" element={<Observabilidade />} />
            <Route path="mais/eventos/:id" element={<EventoDetalhe />} />
          </Route>

          <Route element={<ProtectedRoute requireRoles={['director', 'coordinator', 'manager']} />}>
            <Route path="mais/operacoes" element={<OperacoesFilaTecnica />} />
            <Route path="mais/operacoes/:id" element={<OperacaoDetalhe />} />
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
