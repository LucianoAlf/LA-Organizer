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
import { Checklists } from './screens/Checklists';
import { ChecklistsTemplates } from './screens/ChecklistsTemplates';
import { Comunicados } from './screens/Comunicados';
import { AgendaEscolar } from './screens/AgendaEscolar';
import { ConfigurarEquipe } from './screens/ConfigurarEquipe';
import { EventoDetalhe } from './screens/EventoDetalhe';
import { Observabilidade } from './screens/Observabilidade';
import { OperacoesFilaTecnica } from './screens/OperacoesFilaTecnica';
import { OperacaoDetalhe } from './screens/OperacaoDetalhe';

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
          <Route path="checklists" element={<Checklists />} />
          <Route path="mais/checklists-templates" element={<ChecklistsTemplates />} />
          <Route path="mais/comunicados" element={<Comunicados />} />
          <Route path="mais/agenda-escolar" element={<AgendaEscolar />} />
          <Route path="mais/observabilidade" element={<Observabilidade />} />
          <Route path="mais/eventos/:id" element={<EventoDetalhe />} />
          <Route path="mais/agenda-escolar/equipe" element={<ConfigurarEquipe />} />
          <Route path="mais/operacoes" element={<OperacoesFilaTecnica />} />
          <Route path="mais/operacoes/:id" element={<OperacaoDetalhe />} />

          <Route element={<ProtectedRoute requireRoles={['coordinator', 'director']} />}>
            <Route path="time" element={<DashboardTime />} />
            <Route path="time/:id" element={<PessoaDetalhe />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/hoje" replace />} />
    </Routes>
  );
}
