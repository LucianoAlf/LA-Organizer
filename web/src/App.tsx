import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { Login } from './screens/Login';
import { Hoje } from './screens/Hoje';
import { Semana } from './screens/Semana';
import { Projetos } from './screens/Projetos';
import { ProjetoDetalhe } from './screens/ProjetoDetalhe';
import { Mais } from './screens/Mais';
import { DashboardTime } from './screens/DashboardTime';
import { Configuracoes } from './screens/Configuracoes';
import { Historico } from './screens/Historico';

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
          <Route path="projetos/:id" element={<ProjetoDetalhe />} />
          <Route path="mais" element={<Mais />} />
          <Route path="configuracoes" element={<Configuracoes />} />
          <Route path="historico" element={<Historico />} />

          <Route element={<ProtectedRoute requireRoles={['coordinator', 'director']} />}>
            <Route path="time" element={<DashboardTime />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/hoje" replace />} />
    </Routes>
  );
}
