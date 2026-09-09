import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { hasRole, useStore, type SettingsBundle } from './store';
import Login from './pages/Login';
import Pos from './pages/Pos';
import Tables from './pages/Tables';
import Kds from './pages/Kds';
import Orders from './pages/Orders';
import ShiftPage from './pages/Shift';
import Reports from './pages/Reports';
import MenuAdmin from './pages/MenuAdmin';
import Inventory from './pages/Inventory';
import Users from './pages/Users';
import SettingsPage from './pages/Settings';
import GuestOrder from './pages/GuestOrder';
import TableQr from './pages/TableQr';
import Customers from './pages/Customers';
import Einvoices from './pages/Einvoices';
import PaymentQr from './pages/PaymentQr';

function Sidebar() {
  const user = useStore((s) => s.user);
  const business = useStore((s) => s.business);
  const clearAuth = useStore((s) => s.clearAuth);
  const navigate = useNavigate();

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* session may already be gone */
    }
    clearAuth();
    navigate('/login');
  };

  const canSell = hasRole(user, 'cashier');
  const isManager = hasRole(user, 'manager');
  const isAdmin = hasRole(user, 'admin');

  return (
    <nav className="sidebar">
      <div className="brand">EasyTempah</div>
      {canSell && <NavLink to="/pos">POS</NavLink>}
      {canSell && <NavLink to="/tables">Tables</NavLink>}
      <NavLink to="/kds">Kitchen</NavLink>
      {canSell && <NavLink to="/orders">Orders</NavLink>}
      {canSell && <NavLink to="/shift">Shift</NavLink>}
      {isManager && <NavLink to="/reports">Reports</NavLink>}
      {isManager && <NavLink to="/menu-admin">Menu</NavLink>}
      {isManager && <NavLink to="/inventory">Inventory</NavLink>}
      {isManager && <NavLink to="/customers">Members</NavLink>}
      {isManager && <NavLink to="/einvoices">E-Invoices</NavLink>}
      {isAdmin && <NavLink to="/users">Users</NavLink>}
      {isAdmin && <NavLink to="/settings">Settings</NavLink>}
      <div className="spacer" />
      <div className="whoami">
        <strong>{user?.name}</strong>
        {user?.role} · {business?.name ?? 'EasyTempah'}
      </div>
      <button onClick={logout}>Sign out</button>
    </nav>
  );
}

export default function App() {
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);
  const setSettings = useStore((s) => s.setSettings);
  const location = useLocation();

  useEffect(() => {
    if (!token) return;
    api
      .get<SettingsBundle>('/api/settings')
      .then((r) => setSettings(r))
      .catch(() => {
        /* 401 handled by api layer */
      });
  }, [token, setSettings]);

  // Guest QR ordering is public and renders without the staff shell.
  if (location.pathname.startsWith('/order/')) {
    return (
      <Routes>
        <Route path="/order/:token" element={<GuestOrder />} />
      </Routes>
    );
  }

  if (!token || !user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  const home = user.role === 'kitchen' ? '/kds' : '/pos';

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/login" element={<Navigate to={home} replace />} />
          <Route path="/pos" element={<Pos />} />
          <Route path="/pos/:orderId" element={<Pos />} />
          <Route path="/tables" element={<Tables />} />
          <Route path="/kds" element={<Kds />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/shift" element={<ShiftPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/menu-admin" element={<MenuAdmin />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/table-qr" element={<TableQr />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/einvoices" element={<Einvoices />} />
          <Route path="/payment-qr" element={<PaymentQr />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  );
}
