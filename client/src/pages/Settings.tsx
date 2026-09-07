import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { BusinessSettings, TaxSettings } from '../types';

export default function SettingsPage() {
  const setSettings = useStore((s) => s.setSettings);
  const [business, setBusiness] = useState<BusinessSettings | null>(null);
  const [tax, setTax] = useState<TaxSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ business: BusinessSettings; tax: TaxSettings }>('/api/settings')
      .then((r) => {
        setBusiness(r.business);
        setTax(r.tax);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (!business || !tax) return <div className="muted">Loading…</div>;

  const save = async () => {
    setError('');
    setSaved(false);
    try {
      const r = await api.put<{ business: BusinessSettings; tax: TaxSettings }>('/api/settings', {
        business,
        tax,
      });
      setBusiness(r.business);
      setTax(r.tax);
      setSettings(r.business, r.tax);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  };

  const bField = (key: keyof BusinessSettings, label: string) => (
    <div className="mb">
      <label>{label}</label>
      <input
        value={business[key] as string}
        onChange={(e) => setBusiness({ ...business, [key]: e.target.value })}
        style={{ width: '100%' }}
      />
    </div>
  );

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Settings</h1>
      <div className="panel mb">
        <h2>Business</h2>
        {bField('name', 'Business name')}
        {bField('address', 'Address')}
        {bField('phone', 'Phone')}
        {bField('registrationNo', 'Registration / SST no.')}
        <div className="row">
          <div className="grow">{bField('currency', 'Currency code')}</div>
          <div className="grow">{bField('currencySymbol', 'Currency symbol')}</div>
        </div>
        {bField('receiptFooter', 'Receipt footer')}
      </div>

      <div className="panel mb">
        <h2>Tax & charges</h2>
        <div className="row">
          <div className="grow mb">
            <label>Tax rate (%)</label>
            <input type="number" value={tax.taxRate} onChange={(e) => setTax({ ...tax, taxRate: Number(e.target.value) })} style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>Tax label</label>
            <input value={tax.taxLabel} onChange={(e) => setTax({ ...tax, taxLabel: e.target.value })} style={{ width: '100%' }} />
          </div>
        </div>
        <div className="row">
          <div className="grow mb">
            <label>Service charge (%)</label>
            <input type="number" value={tax.serviceRate} onChange={(e) => setTax({ ...tax, serviceRate: Number(e.target.value) })} style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>Service label</label>
            <input value={tax.serviceLabel} onChange={(e) => setTax({ ...tax, serviceLabel: e.target.value })} style={{ width: '100%' }} />
          </div>
        </div>
        <div className="row mb">
          <button className={tax.taxOnService ? 'primary' : ''} onClick={() => setTax({ ...tax, taxOnService: !tax.taxOnService })}>
            {tax.taxOnService ? 'Tax applies on service charge' : 'Tax on subtotal only'}
          </button>
        </div>
        <label>Cash rounding (sen)</label>
        <div className="row wrap">
          {[0, 5, 10, 25, 50].map((v) => (
            <button key={v} className={tax.cashRoundingCents === v ? 'primary' : ''} onClick={() => setTax({ ...tax, cashRoundingCents: v })}>
              {v === 0 ? 'Off' : v}
            </button>
          ))}
        </div>
      </div>

      <button className="primary" onClick={save}>Save settings</button>
      {saved && <span style={{ color: 'var(--accent)', marginLeft: '0.8rem' }}>Saved ✓</span>}
      {error && <div className="error-text mt">{error}</div>}
    </div>
  );
}
