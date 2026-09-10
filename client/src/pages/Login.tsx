import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import NumPad from '../components/NumPad';
import { useStore } from '../store';
import type { AuthUser } from '../types';

export default function Login() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clockMsg, setClockMsg] = useState('');
  const setAuth = useStore((s) => s.setAuth);
  const navigate = useNavigate();

  const submit = async (candidate: string) => {
    if (candidate.length < 4 || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ token: string; user: AuthUser }>('/api/auth/login', { pin: candidate });
      setAuth(r.token, r.user);
      navigate(r.user.role === 'kitchen' ? '/kds' : '/pos');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const addDigit = (d: string) => {
    if (pin.length >= 8) return;
    const next = pin + d;
    setPin(next);
  };

  /** Time clock: the PIN identifies you and toggles in/out — no sign-in needed. */
  const clock = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError('');
    setClockMsg('');
    try {
      const r = await api.post<{ name: string; action: 'in' | 'out'; since?: string }>('/api/auth/clock', { pin });
      setClockMsg(
        r.action === 'in'
          ? `✅ ${r.name} clocked IN at ${new Date().toLocaleTimeString()}`
          : `👋 ${r.name} clocked OUT`,
      );
      setPin('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clock failed');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="brand">EasyTempah</div>
      <div className="muted">Enter your PIN to sign in</div>
      <div className="pin-dots">
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span key={i} className={i < pin.length ? 'filled' : ''} />
        ))}
      </div>
      <NumPad
        onDigit={addDigit}
        onClear={() => {
          setPin('');
          setError('');
        }}
        onEnter={() => submit(pin)}
        enterLabel="Go"
      />
      <button className="ghost" onClick={clock} disabled={pin.length < 4 || busy} title="Enter your PIN, then tap to clock in or out for the day">
        ⏱ Clock in / out
      </button>
      {clockMsg && <div style={{ color: 'var(--accent)', fontWeight: 700 }}>{clockMsg}</div>}
      {error && <div className="error-text" role="alert">{error}</div>}
    </div>
  );
}
