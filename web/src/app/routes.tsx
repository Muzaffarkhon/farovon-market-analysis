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
import { KeyRisksScreen } from '../features/keyRisks/KeyRisksScreen';
import { RoleMatrixScreen } from '../features/access/RoleMatrixScreen';
import { AdminHub } from '../features/admin/AdminHub';
import { UsersScreen } from '../features/admin/users/UsersScreen';
import { DivisionsScreen } from '../features/admin/divisions/DivisionsScreen';
import { StaffScreen } from '../features/admin/staff/StaffScreen';
import { GradingAdminScreen } from '../features/admin/grading/GradingAdminScreen';
import { BenchmarkAdminScreen } from '../features/admin/benchmark/BenchmarkAdminScreen';

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
        <Route path="key-risks" element={<KeyRisksScreen />} />
        <Route path="access" element={<RoleMatrixScreen />} />
        <Route path="admin" element={<AdminHub />} />
        <Route path="admin/users" element={<UsersScreen />} />
        <Route path="admin/divisions" element={<DivisionsScreen />} />
        <Route path="admin/staff" element={<StaffScreen />} />
        <Route path="admin/grading" element={<GradingAdminScreen />} />
        <Route path="admin/benchmark" element={<BenchmarkAdminScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
