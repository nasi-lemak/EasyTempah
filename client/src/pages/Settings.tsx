import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type {
  BusinessSettings,
  EinvoiceSettings,
  GatewaySettings,
  PaymentsSettings,
  PlatformsSettings,
  PrintersSettings,
  TaxSettings,
} from '../types';

type SettingsPayload = {
  business: BusinessSettings;
  tax: TaxSettings;
  printers: PrintersSettings;
  payments: PaymentsSettings;
  einvoice: EinvoiceSettings;
  gateway: GatewaySettings;
  platforms: PlatformsSettings;
};

export default function SettingsPage() {
  const setSettings = useStore((s) => s.setSettings);
  const [business, setBusiness] = useState<BusinessSettings | null>(null);
  const [tax, setTax] = useState<TaxSettings | null>(null);
  const [printers, setPrinters] = useState<PrintersSettings | null>(null);
  const [payments, setPayments] = useState<PaymentsSettings | null>(null);
  const [einvoice, setEinvoice] = useState<EinvoiceSettings | null>(null);
  const [einvoiceSecret, setEinvoiceSecret] = useState('');
  const [gateway, setGateway] = useState<GatewaySettings | null>(null);
  const [gatewaySecret, setGatewaySecret] = useState('');
  const [platforms, setPlatforms] = useState<PlatformsSettings | null>(null);
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
        setPayments(r.payments);
        setEinvoice(r.einvoice);
        setGateway(r.gateway);
        setPlatforms(r.platforms);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (!business || !tax || !printers || !payments || !einvoice || !gateway || !platforms) {
    return <div className="muted">Loading…</div>;
  }

  const save = async () => {
    setError('');
    setSaved(false);
    try {
      const r = await api.put<SettingsPayload>('/api/settings', {
        business,
        tax,
        printers,
        payments,
        einvoice: { ...einvoice, ...(einvoiceSecret.trim() ? { clientSecret: einvoiceSecret.trim() } : {}) },
        gateway: { ...gateway, ...(gatewaySecret.trim() ? { webhookSecret: gatewaySecret.trim() } : {}) },
        platforms,
      });
      setBusiness(r.business);
      setTax(r.tax);
      setPrinters(r.printers);
      setPayments(r.payments);
      setEinvoice(r.einvoice);
      setGateway(r.gateway);
      setPlatforms(r.platforms);
      setEinvoiceSecret('');
      setGatewaySecret('');
      setSettings(r);
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
        <h2>Payment channels</h2>
        <p className="muted small">
          Channels shown on the payment screen. The kind drives drawer math (cash goes into the
          till; wallets and cards do not).
        </p>
        <div className="row wrap mb">
          {payments.channels.map((ch, i) => (
            <button
              key={ch.key}
              className={ch.enabled ? 'primary' : ''}
              onClick={() => {
                const channels = payments.channels.slice();
                channels[i] = { ...ch, enabled: !ch.enabled };
                setPayments({ ...payments, channels });
              }}
            >
              {ch.label} <span className="small">({ch.kind})</span>
            </button>
          ))}
        </div>
        <label>Static wallet / DuitNow QR payload (from your bank / acquirer)</label>
        <div className="row">
          <input
            value={payments.ewalletQrPayload}
            onChange={(e) => setPayments({ ...payments, ewalletQrPayload: e.target.value })}
            placeholder="Paste your DuitNow QR string here"
            className="grow"
          />
          <a href="/payment-qr">
            <button type="button">Print counter card</button>
          </a>
        </div>
        <div className="muted small mt">
          Powers both the printable counter standee and the on-screen QR shown when a cashier
          selects a wallet. Save before printing.
        </div>
      </div>

      <div className="panel mb">
        <h2>Delivery platforms</h2>
        <p className="muted small">
          For orders re-keyed from GrabFood/foodpanda/ShopeeFood merchant tablets. Platform orders
          settle at menu value under the platform's name, are excluded from your consolidated
          e-invoice (the platform issues those), and report gross vs. estimated net payout using
          the commission rate below.
        </p>
        {platforms.platforms.map((p, i) => (
          <div className="row wrap mb" key={p.key}>
            <button
              className={p.enabled ? 'primary' : ''}
              style={{ minWidth: 130 }}
              onClick={() => {
                const list = platforms.platforms.slice();
                list[i] = { ...p, enabled: !p.enabled };
                setPlatforms({ platforms: list });
              }}
            >
              {p.label} {p.enabled ? 'ON' : 'off'}
            </button>
            <label style={{ margin: 0 }}>Commission %</label>
            <input
              type="number"
              value={p.commissionPct}
              style={{ width: 80 }}
              onChange={(e) => {
                const list = platforms.platforms.slice();
                list[i] = { ...p, commissionPct: Number(e.target.value) };
                setPlatforms({ platforms: list });
              }}
            />
          </div>
        ))}
      </div>

      <div className="panel mb">
        <h2>Payment gateway (webhook auto-confirmation)</h2>
        <p className="muted small">
          When enabled, wallet/card payments create an intent and confirm automatically from the
          gateway's webhook instead of cashier sight-verification. mock simulates a gateway for
          testing; generic works with any acquirer that can POST the documented JSON, signed with
          HMAC-SHA256 of the raw body in the X-Signature header.
        </p>
        <div className="row wrap mb">
          <button className={gateway.enabled ? 'primary' : ''} onClick={() => setGateway({ ...gateway, enabled: !gateway.enabled })}>
            {gateway.enabled ? 'Enabled' : 'Disabled'}
          </button>
          {(['mock', 'generic'] as const).map((p) => (
            <button key={p} className={gateway.provider === p ? 'primary' : ''} onClick={() => setGateway({ ...gateway, provider: p })}>
              {p}
            </button>
          ))}
          <button className={gateway.dynamicQr ? 'primary' : ''} onClick={() => setGateway({ ...gateway, dynamicQr: !gateway.dynamicQr })}>
            {gateway.dynamicQr ? 'Dynamic QR (exact match)' : 'Static QR (amount match)'}
          </button>
        </div>
        <div className="row">
          <div className="grow mb">
            <label>Webhook secret {gateway.hasWebhookSecret ? '(stored — blank keeps it)' : ''}</label>
            <input type="password" value={gatewaySecret} onChange={(e) => setGatewaySecret(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>Webhook URL (configure at your gateway)</label>
            <input readOnly value={`${window.location.origin}/api/payment-webhooks/${gateway.provider}`} style={{ width: '100%' }} onFocus={(e) => e.target.select()} />
          </div>
        </div>
      </div>

      <div className="panel mb">
        <h2>LHDN e-Invoice (MyInvois)</h2>
        <div className="row wrap mb">
          <button className={einvoice.enabled ? 'primary' : ''} onClick={() => setEinvoice({ ...einvoice, enabled: !einvoice.enabled })}>
            {einvoice.enabled ? 'Enabled' : 'Disabled'}
          </button>
          {(['mock', 'sandbox', 'production'] as const).map((env) => (
            <button key={env} className={einvoice.environment === env ? 'primary' : ''}
              onClick={() => setEinvoice({ ...einvoice, environment: env })}>
              {env}
            </button>
          ))}
        </div>
        <p className="muted small">
          mock simulates LHDN locally (for testing); sandbox is MyInvois pre-production; production
          is live. Client ID/secret come from the MyTax ERP registration.
        </p>
        <div className="row">
          <div className="grow mb">
            <label>Client ID</label>
            <input value={einvoice.clientId} onChange={(e) => setEinvoice({ ...einvoice, clientId: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>Client secret {einvoice.hasClientSecret ? '(stored — blank keeps it)' : ''}</label>
            <input type="password" value={einvoiceSecret} onChange={(e) => setEinvoiceSecret(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        <div className="row">
          <div className="grow mb">
            <label>Supplier TIN</label>
            <input value={einvoice.supplierTin} onChange={(e) => setEinvoice({ ...einvoice, supplierTin: e.target.value })} placeholder="C1234567890" style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>BRN / registration no.</label>
            <input value={einvoice.supplierIdValue} onChange={(e) => setEinvoice({ ...einvoice, supplierIdValue: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>SST no.</label>
            <input value={einvoice.supplierSstNo} onChange={(e) => setEinvoice({ ...einvoice, supplierSstNo: e.target.value })} style={{ width: '100%' }} />
          </div>
        </div>
        <div className="row">
          <div className="grow mb">
            <label>MSIC code</label>
            <input value={einvoice.msicCode} onChange={(e) => setEinvoice({ ...einvoice, msicCode: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>State code</label>
            <input value={einvoice.stateCode} onChange={(e) => setEinvoice({ ...einvoice, stateCode: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>Tax type (01 sales / 02 service)</label>
            <input value={einvoice.taxTypeCode} onChange={(e) => setEinvoice({ ...einvoice, taxTypeCode: e.target.value })} style={{ width: '100%' }} />
          </div>
        </div>
        <label>Business address (as registered)</label>
        <input value={einvoice.addressLine} onChange={(e) => setEinvoice({ ...einvoice, addressLine: e.target.value })} style={{ width: '100%' }} />
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
