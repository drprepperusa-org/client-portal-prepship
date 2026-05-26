import { Navigate, Route, Routes } from 'react-router-dom';
import PortalLayout from './components/PortalLayout';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './lib/auth';
import Analysis from './pages/Analysis';
import Inbound from './pages/Inbound';
import Inventory from './pages/Inventory';
import Invoices from './pages/Invoices';
import Connections from './pages/Connections';
import Login from './pages/Login';
import Orders from './pages/Orders';
import Overview from './pages/Overview';
import Reports from './pages/Reports';
import ResetPassword from './pages/ResetPassword';
import Settings from './pages/Settings';
import Shipments from './pages/Shipments';

function Logout() {
  const auth = useAuth();
  void auth.signOut();
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/logout" element={<Logout />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <PortalLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Overview />} />
        <Route path="orders" element={<Orders />} />
        <Route path="inbound" element={<Inbound />} />
        <Route path="shipments" element={<Shipments />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="analysis" element={<Analysis />} />
        <Route path="reports" element={<Reports />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="connections" element={<Connections />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/:section" element={<Settings />} />
      </Route>
      <Route path="/portal/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
