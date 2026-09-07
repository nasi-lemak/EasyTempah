import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import type { Role } from '../types';

interface UserRow {
  id: number;
  name: string;
  role: Role;
  active: number;
  created_at: string;
}

const ROLES: Role[] = ['admin', 'manager', 'cashier', 'kitchen'];

export default function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState<{ id: number; name: string; role: Role; pin: string } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ users: UserRow[] }>('/api/users').then((r) => setUsers(r.users)).catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!form) return;
    setError('');
    try {
      if (form.id) {
        await api.patch(`/api/users/${form.id}`, {
          name: form.name,
          role: form.role,
          ...(form.pin ? { pin: form.pin } : {}),
        });
      } else {
        await api.post('/api/users', { name: form.name, role: form.role, pin: form.pin });
      }
      setForm(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const toggleActive = async (u: UserRow) => {
    setError('');
    try {
      await api.patch(`/api/users/${u.id}`, { active: !u.active });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div>
      <div className="row mb">
        <h1 className="grow">Users</h1>
        <button className="primary" onClick={() => setForm({ id: 0, name: '', role: 'cashier', pin: '' })}>+ New user</button>
      </div>
      {error && <div className="error-text mb">{error}</div>}
      <table className="data">
        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.role}</td>
              <td>{u.active ? <span className="badge paid">active</span> : <span className="badge void">disabled</span>}</td>
              <td className="right">
                <button onClick={() => setForm({ id: u.id, name: u.name, role: u.role, pin: '' })}>Edit</button>{' '}
                <button className="ghost" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {form && (
        <Modal title={form.id ? 'Edit user' : 'New user'} onClose={() => setForm(null)}>
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%' }} className="mb" />
          <label>Role</label>
          <div className="row wrap mb">
            {ROLES.map((r) => (
              <button key={r} className={form.role === r ? 'primary' : ''} onClick={() => setForm({ ...form, role: r })}>{r}</button>
            ))}
          </div>
          <label>{form.id ? 'New PIN (leave blank to keep current)' : 'PIN (4-8 digits)'}</label>
          <input inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} style={{ width: '100%' }} />
          <button className="primary mt" onClick={save}>Save</button>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}
    </div>
  );
}
