import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from '../features/auth/RequireAuth';
import { LoginScreen } from '../features/auth/LoginScreen';
import { ChangePasswordScreen } from '../features/auth/ChangePasswordScreen';
import { Shell } from '../features/shell/Shell';
import { UnitsScreen } from '../features/survey/UnitsScreen';
import { UnitScreen } from '../features/survey/UnitScreen';
import { SheetScreen } from '../features/survey/SheetScreen';
import { RegistryScreen } from '../features/registry/RegistryScreen';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { CoordinationScreen } from '../features/coordination/CoordinationScreen';
import { GradingScreen } from '../features/grading/GradingScreen';
import { RoleMatrixScreen } from '../features/access/RoleMatrixScreen';

export const BASENAME = '/new';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/change-password" element={<RequireAuth><ChangePasswordScreen /></RequireAuth>} />
      <Route path="/" element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<UnitsScreen />} />
        <Route path="survey/:unit" element={<UnitScreen />} />
        <Route path="survey/:unit/:position" element={<SheetScreen />} />
        <Route path="registry" element={<RegistryScreen />} />
        <Route path="dashboard/:tab?" element={<DashboardScreen />} />
        <Route path="coordination" element={<CoordinationScreen />} />
        <Route path="grading/:block?" element={<GradingScreen />} />
        <Route path="access" element={<RoleMatrixScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
