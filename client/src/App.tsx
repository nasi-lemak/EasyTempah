import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { hasRole, useStore, type SettingsBundle } from './store';
import { applyAccent, applyThemePref, getThemePref, type ThemePref } from './theme';
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
import Board from './pages/Board';
import GuestOrder from './pages/GuestOrder';
import TableQr from './pages/TableQr';
import Bookings from './pages/Bookings';
import Customers from './pages/Customers';
import Today from './pages/Today';
import Einvoices from './pages/Einvoices';
import PaymentQr from './pages/PaymentQr';

/** Shown the moment the live connection to the shop server drops. */
function ConnectionBanner() {
  const connected = useStore((s) => s.connected);
  if (connected) return null;
  return (
    <div className="conn-banner" role="alert">
      ⚠ Connection to the shop server lost — reconnecting… Numbers on screen may be stale.
    </div>
  );
}

/** Floating reminder that every number on screen came from `npm run seed:demo`. */
function DemoBadge() {
  const demo = useStore((s) => s.demo);
  if (!demo?.enabled) return null;
  return (
    <div className="demo-badge" title="Generated sample data — reset with: npm run seed:demo -- --reset">
      DEMO DATA
    </div>
  );
}

const THEME_LABEL: Record<ThemePref, string> = { dark: '🌙 Dark', light: '☀️ Light', system: '🖥 Auto' };
const THEME_NEXT: Record<ThemePref, ThemePref> = { dark: 'light', light: 'system', system: 'dark' };

const LOCK_KEY = 'easytempah.autolock';
const LOCK_STEPS = [0, 2, 5, 15]; // minutes; 0 = off

/**
 * Idle-lock minutes for this terminal: an explicit per-device choice wins;
 * otherwise the venue-wide default from Settings → Terminals applies.
 */
function getLockMinutes(venueDefault = 0): number {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (raw === null) return venueDefault;
    const v = parseFloat(raw);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return venueDefault;
  }
}

/**
 * Per-device idle lock: after N quiet minutes, return this terminal to the
 * PIN screen. Kitchen accounts are exempt — a KDS is glanced at, not touched.
 */
function useIdleLock() {
  const user = useStore((s) => s.user);
  const clearAuth = useStore((s) => s.clearAuth);
  const venueDefault = useStore((s) => s.terminals?.idleLockDefaultMinutes ?? 0);
  useEffect(() => {
    if (!user || user.role === 'kitchen') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      const mins = getLockMinutes(venueDefault);
      if (mins > 0) timer = setTimeout(() => clearAuth(), mins * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, arm, { passive: true });
    arm();
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, arm);
    };
  }, [user, clearAuth, venueDefault]);
}

function Sidebar() {
  const user = useStore((s) => s.user);
  const business = useStore((s) => s.business);
  const clearAuth = useStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const venueLockDefault = useStore((s) => s.terminals?.idleLockDefaultMinutes ?? 0);
  // null = this device never chose, so the venue-wide default applies.
  const [lockMins, setLockMins] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(LOCK_KEY);
      if (raw === null) return null;
      const v = parseFloat(raw);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch {
      return null;
    }
  });
  const effectiveLock = lockMins ?? venueLockDefault;

  const cycleTheme = () => {
    const next = THEME_NEXT[theme];
    applyThemePref(next);
    setTheme(next);
  };

  const cycleLock = () => {
    const next = LOCK_STEPS[(LOCK_STEPS.indexOf(effectiveLock) + 1) % LOCK_STEPS.length] ?? 0;
    try {
      localStorage.setItem(LOCK_KEY, String(next));
    } catch { /* per-device convenience */ }
    setLockMins(next);
  };

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
      {canSell && <NavLink to="/bookings">Bookings</NavLink>}
      <NavLink to="/kds">Kitchen</NavLink>
      {canSell && <NavLink to="/orders">Orders</NavLink>}
      {canSell && <NavLink to="/shift">Shift</NavLink>}
      {isManager && <NavLink to="/today">Today</NavLink>}
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
      <button onClick={cycleTheme} title="Theme for this device: dark, light or follow system">
        {THEME_LABEL[theme]}
      </button>
      {user?.role !== 'kitchen' && (
        <button onClick={cycleLock} title="Return this terminal to the PIN screen after idle time">
          🔒 {effectiveLock === 0 ? 'Lock off' : `Lock ${effectiveLock}m`}
        </button>
      )}
      <button onClick={logout}>Sign out</button>
    </nav>
  );
}

export default function App() {
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);
  const setSettings = useStore((s) => s.setSettings);
  const location = useLocation();
  useIdleLock();

  useEffect(() => {
    if (!token) return;
    api
      .get<SettingsBundle>('/api/settings')
      .then((r) => {
        setSettings(r);
        applyAccent(r.business.accentColor);
      })
      .catch(() => {
        /* 401 handled by api layer */
      });
  }, [token, setSettings]);

  // Guest QR ordering and the collection board are public — no staff shell.
  if (location.pathname.startsWith('/order/')) {
    return (
      <Routes>
        <Route path="/order/:token" element={<GuestOrder />} />
      </Routes>
    );
  }
  if (location.pathname === '/board') {
    return (
      <Routes>
        <Route path="/board" element={<Board />} />
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
      <ConnectionBanner />
      <DemoBadge />
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/login" element={<Navigate to={home} replace />} />
          <Route path="/pos" element={<Pos />} />
          <Route path="/pos/:orderId" element={<Pos />} />
          <Route path="/tables" element={<Tables />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/kds" element={<Kds />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/shift" element={<ShiftPage />} />
          <Route path="/today" element={<Today />} />
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
