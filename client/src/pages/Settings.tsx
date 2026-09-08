import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { BusinessSettings, PrintersSettings, TaxSettings } from '../types';

type SettingsPayload = { business: BusinessSettings; tax: TaxSettings; printers: PrintersSettings };

export default function SettingsPage() {
  const setSettings = useStore((s) => s.setSettings);
  const [business, setBusiness] = useState<BusinessSettings | null>(null);
  const [tax, setTax] = useState<TaxSettings | null>(null);
  const [printers, setPrinters] = useState<PrintersSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<SettingsPayload>('/api/settings')
      .then((r) => {
        setBusiness(r.business);
        setTax(r.tax);
        setPrinters(r.printers);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (!business || !tax || !printers) return <div className="muted">Loading…</div>;

  const save = async () => {
    setError('');
    setSaved(false);
    try {
      const r = await api.put<SettingsPayload>('/api/settings', { business, tax, printers });
      setBusiness(r.business);
      setTax(r.tax);
      setPrinters(r.printers);
      setSettings(r.business, r.tax, r.printers);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  };

  const test = async (which: 'receipt' | 'kitchen' | 'bar') => {
    setTestMsg('');
    setError('');
    try {
      await api.post(`/api/print/test/${which}`);
      setTestMsg(`${which} printer: test page sent ✓`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed');
    }
  };

  const printerRow = (key: 'receipt' | 'kitchen' | 'bar', label: string) => {
    const t = printers[key];
    const patch = (p: Partial<typeof t>) => setPrinters({ ...printers, [key]: { ...t, ...p } });
    return (
      <div className="row wrap mb" key={key}>
        <button className={t.enabled ? 'primary' : ''} style={{ minWidth: 110 }}
          onClick={() => patch({ enabled: !t.enabled })}>
          {label} {t.enabled ? 'ON' : 'off'}
        </button>
        <input value={t.host} onChange={(e) => patch({ host: e.target.value })} placeholder="IP address" style={{ width: 150 }} />
        <input type="number" value={t.port} onChange={(e) => patch({ port: Number(e.target.value) })} style={{ width: 90 }} />
        {key === 'receipt' && (
          <button className={printers.receipt.drawerKick ? 'primary' : ''}
            onClick={() => setPrinters({ ...printers, receipt: { ...printers.receipt, drawerKick: !printers.receipt.drawerKick } })}>
            Drawer kick
          </button>
        )}
        <button onClick={() => test(key)} disabled={!t.enabled}>Test</button>
      </div>
    );
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

      <div className="panel mb">
        <h2>Thermal printers (ESC/POS over network, port 9100)</h2>
        <p className="muted small">
          Kitchen and bar tickets print automatically when orders are sent (including QR guest
          orders); receipts print from the payment screen. Save before testing.
        </p>
        {printerRow('receipt', 'Receipt')}
        {printerRow('kitchen', 'Kitchen')}
        {printerRow('bar', 'Bar')}
        {testMsg && <div style={{ color: 'var(--accent)' }}>{testMsg}</div>}
      </div>

      <button className="primary" onClick={save}>Save settings</button>
      {saved && <span style={{ color: 'var(--accent)', marginLeft: '0.8rem' }}>Saved ✓</span>}
      {error && <div className="error-text mt">{error}</div>}
    </div>
  );
}
