import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { applyAccent } from '../theme';
import type {
  BusinessSettings,
  EinvoiceSettings,
  GatewaySettings,
  GuestSettings,
  KdsSettings,
  LoyaltySettings,
  PaymentsSettings,
  PlatformsSettings,
  PrintersSettings,
  ReceiptsSettings,
  TaxSettings,
  TerminalSettings,
} from '../types';

type SettingsPayload = {
  business: BusinessSettings;
  tax: TaxSettings;
  printers: PrintersSettings;
  payments: PaymentsSettings;
  einvoice: EinvoiceSettings;
  gateway: GatewaySettings;
  platforms: PlatformsSettings;
  loyalty: LoyaltySettings;
  guest: GuestSettings;
  kds: KdsSettings;
  terminals: TerminalSettings;
  receipts: ReceiptsSettings;
  logo: string;
};

const LANG_NAMES: Record<string, string> = { en: 'English', ms: 'Bahasa Melayu', zh: '中文' };

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
  const [loyalty, setLoyalty] = useState<LoyaltySettings | null>(null);
  const [guest, setGuest] = useState<GuestSettings | null>(null);
  const [kds, setKds] = useState<KdsSettings | null>(null);
  const [terminals, setTerminals] = useState<TerminalSettings | null>(null);
  const [receipts, setReceipts] = useState<ReceiptsSettings | null>(null);
  const [logo, setLogo] = useState('');
  const [saved, setSaved] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [backupMsg, setBackupMsg] = useState('');
  const [error, setError] = useState('');

  const backupNow = async () => {
    setBackupMsg('');
    setError('');
    try {
      const r = await api.post<{ file: string }>('/api/settings/backup');
      setBackupMsg(`Saved ${r.file} ✓`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed');
    }
  };

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
        setLoyalty(r.loyalty);
        setGuest(r.guest);
        setKds(r.kds);
        setTerminals(r.terminals);
        setReceipts(r.receipts);
        setLogo(r.logo ?? '');
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (!business || !tax || !printers || !payments || !einvoice || !gateway || !platforms || !loyalty || !guest || !kds || !terminals || !receipts) {
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
        loyalty,
        guest,
        kds,
        terminals,
        receipts,
      });
      setBusiness(r.business);
      setTax(r.tax);
      setPrinters(r.printers);
      setPayments(r.payments);
      setEinvoice(r.einvoice);
      setGateway(r.gateway);
      setPlatforms(r.platforms);
      setLoyalty(r.loyalty);
      setGuest(r.guest);
      setKds(r.kds);
      setTerminals(r.terminals);
      setReceipts(r.receipts);
      setLogo(r.logo ?? '');
      setEinvoiceSecret('');
      setGatewaySecret('');
      setSettings(r);
      applyAccent(r.business.accentColor);
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
        <select value={t.charset ?? 'ascii'} onChange={(e) => patch({ charset: e.target.value as 'ascii' | 'gbk' })} title="Character set: GBK for printers with Chinese firmware">
          <option value="ascii">ASCII</option>
          <option value="gbk">GBK 中文</option>
        </select>
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

  const applyPreset = (preset: 'MY' | 'SG') => {
    if (preset === 'MY') {
      setBusiness({ ...business, country: 'MY', currency: 'MYR', currencySymbol: 'RM' });
      setTax({
        ...tax,
        taxRate: 6,
        taxLabel: 'SST 6%',
        taxOnService: true,
        serviceOrderTypes: ['dine_in'],
        cashRoundingCents: 5,
      });
    } else {
      setBusiness({ ...business, country: 'SG', currency: 'SGD', currencySymbol: 'S$' });
      setTax({
        ...tax,
        taxRate: 9,
        taxLabel: 'GST 9%',
        taxOnService: true,
        serviceOrderTypes: ['dine_in'],
        cashRoundingCents: 5,
      });
      setEinvoice({ ...einvoice, enabled: false }); // MyInvois is Malaysia-only
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Settings</h1>
      <div className="panel mb">
        <h2>Country preset</h2>
        <p className="muted small">
          Fills currency, tax and service-charge conventions below — review, then Save. Everything
          stays individually editable for other markets.
        </p>
        <div className="row wrap">
          <button className={business.country === 'MY' ? 'primary' : ''} onClick={() => applyPreset('MY')}>
            🇲🇾 Malaysia — RM, SST 6%, 5 sen rounding
          </button>
          <button className={business.country === 'SG' ? 'primary' : ''} onClick={() => applyPreset('SG')}>
            🇸🇬 Singapore — S$, GST 9%, 5¢ rounding
          </button>
        </div>
      </div>

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
        <div className="row wrap mb" style={{ alignItems: 'center' }}>
          <button
            className={business.usePagers ? 'primary' : ''}
            onClick={() => setBusiness({ ...business, usePagers: !business.usePagers })}
          >
            📟 Collection pagers {business.usePagers ? 'ON' : 'off'}
          </button>
          <span className="muted small grow" style={{ minWidth: 220 }}>
            Counter venues: key the pager number on each order — it shows on the kitchen screen and
            ticket so the pass knows which pager to ring when the food is up.
          </span>
        </div>
        <label>Brand color (buttons and highlights on every terminal)</label>
        <div className="row wrap" style={{ alignItems: 'center' }}>
          {['#2dd4a7', '#4aa8ff', '#a78bfa', '#ff9d5c', '#f2635c', '#e8b93e'].map((c) => (
            <button
              key={c}
              onClick={() => setBusiness({ ...business, accentColor: c })}
              title={c}
              aria-label={`Brand color ${c}`}
              style={{
                width: 34, height: 34, borderRadius: '50%', padding: 0, background: c,
                border: business.accentColor === c ? '3px solid var(--text)' : '1px solid var(--border)',
              }}
            />
          ))}
          <input
            type="color"
            id="brand-color-custom"
            value={/^#[0-9a-fA-F]{6}$/.test(business.accentColor) ? business.accentColor : '#2dd4a7'}
            onChange={(e) => setBusiness({ ...business, accentColor: e.target.value })}
            title="Custom color"
            style={{ width: 44, height: 34, padding: 2 }}
          />
          <span className="muted small">Terminals pick it up at next sign-in or reload.</span>
        </div>
      </div>

      <div className="panel mb">
        <h2>Receipts</h2>
        <p className="muted small">
          Pick the receipt languages for your audience — e.g. 中文 primary with English secondary.
          Labels print as "primary / secondary"; menu item names print exactly as entered in the menu.
          For Chinese on paper, also set the thermal printer's charset to GBK below.
        </p>
        <div className="row wrap mb">
          <div>
            <label>Primary language</label><br />
            <select value={receipts.langPrimary}
              onChange={(e) => setReceipts({ ...receipts, langPrimary: e.target.value as ReceiptsSettings['langPrimary'] })}>
              {(['en', 'ms', 'zh'] as const).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
            </select>
          </div>
          <div>
            <label>Secondary (optional)</label><br />
            <select value={receipts.langSecondary}
              onChange={(e) => setReceipts({ ...receipts, langSecondary: e.target.value as ReceiptsSettings['langSecondary'] })}>
              <option value="">None</option>
              {(['en', 'ms', 'zh'] as const).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
            </select>
          </div>
        </div>
        <div className="row wrap mb">
          <button className={receipts.serialEnabled ? 'primary' : ''}
            onClick={() => setReceipts({ ...receipts, serialEnabled: !receipts.serialEnabled })}>
            Receipt serial numbers {receipts.serialEnabled ? 'ON' : 'off'}
          </button>
          <input value={receipts.serialPrefix} style={{ width: 110 }} placeholder="Prefix"
            onChange={(e) => setReceipts({ ...receipts, serialPrefix: e.target.value })} />
          <span className="muted small">e.g. {receipts.serialPrefix || ''}000123 — assigned when a bill settles</span>
        </div>
        <label>Logo (PNG, max 200 KB — prints at the top of receipts)</label>
        <div className="row wrap" style={{ alignItems: 'center' }}>
          {logo && <img src={logo} alt="logo" style={{ maxHeight: 60, maxWidth: 160, background: '#fff', borderRadius: 4, padding: 2 }} />}
          <input type="file" accept="image/png"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = async () => {
                setError('');
                try {
                  const r = await api.put<SettingsPayload>('/api/settings/logo', { dataUrl: reader.result });
                  setLogo(r.logo);
                  setSettings(r);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Logo upload failed');
                }
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }} />
          {logo && (
            <button className="ghost" onClick={async () => {
              const r = await api.delete<SettingsPayload>('/api/settings/logo');
              setLogo(r.logo);
              setSettings(r);
            }}>Remove</button>
          )}
        </div>
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
        <label>Service charge applies to</label>
        <div className="row wrap mb">
          {([['dine_in', 'Dine-in'], ['takeaway', 'Takeaway'], ['delivery', 'Delivery']] as const).map(([key, label]) => {
            const on = tax.serviceOrderTypes.includes(key);
            return (
              <button
                key={key}
                className={on ? 'primary' : ''}
                onClick={() =>
                  setTax({
                    ...tax,
                    serviceOrderTypes: on
                      ? tax.serviceOrderTypes.filter((t) => t !== key)
                      : [...tax.serviceOrderTypes, key],
                  })
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="muted small mb">
          Turn all three off (or set the rate to 0) to never charge it. QR guest orders follow the
          dine-in rule.
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
        <h2>Loyalty (points)</h2>
        <div className="row wrap mb">
          <button className={loyalty.enabled ? 'primary' : ''} onClick={() => setLoyalty({ ...loyalty, enabled: !loyalty.enabled })}>
            {loyalty.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        <div className="row">
          <div className="grow mb">
            <label>Points earned per RM1</label>
            <input type="number" value={loyalty.earnPointsPerRm} onChange={(e) => setLoyalty({ ...loyalty, earnPointsPerRm: Number(e.target.value) })} style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>Points per RM1 redeemed</label>
            <input type="number" value={loyalty.redeemPointsPerRm} onChange={(e) => setLoyalty({ ...loyalty, redeemPointsPerRm: Number(e.target.value) })} style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>Minimum points to redeem</label>
            <input type="number" value={loyalty.minRedeemPoints} onChange={(e) => setLoyalty({ ...loyalty, minRedeemPoints: Number(e.target.value) })} style={{ width: '100%' }} />
          </div>
        </div>
        <div className="muted small mb">
          Members join by phone number at payment. Points are earned on net spend (excluding points
          tender) once the bill settles, and redeem as tender against the balance.
        </div>
        <div className="row">
          <div className="grow mb" style={{ minWidth: 220 }}>
            <label>Auto-delete inactive members after (months, 0 = keep forever)</label>
            <input
              type="number"
              min={0}
              value={loyalty.retentionMonths}
              onChange={(e) => setLoyalty({ ...loyalty, retentionMonths: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <label>Privacy notice (read to the customer when they join — BM + English)</label>
        <textarea
          value={loyalty.privacyNotice}
          onChange={(e) => setLoyalty({ ...loyalty, privacyNotice: e.target.value })}
          rows={3}
          style={{ width: '100%' }}
        />
        <div className="muted small mt">
          PDPA: consent is recorded when a member joins; managers can show, correct or erase a
          member's data from the Members page. The retention setting anonymises members with no
          visits in the chosen window, once a day.
        </div>
      </div>

      <div className="panel mb">
        <h2>Guest QR ordering</h2>
        <div className="row wrap mb">
          <button
            className={guest.orderGuardEnabled ? 'primary' : ''}
            onClick={() => setGuest({ ...guest, orderGuardEnabled: !guest.orderGuardEnabled })}
          >
            Order guard {guest.orderGuardEnabled ? 'ON' : 'off'}
          </button>
          <div className="grow" style={{ minWidth: 220 }}>
            <label>Max orders per table in 2 minutes</label>
            <input
              type="number"
              min={2}
              max={50}
              value={guest.orderBurst}
              onChange={(e) => setGuest({ ...guest, orderBurst: Math.floor(Number(e.target.value) || 0) })}
              disabled={!guest.orderGuardEnabled}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div className="muted small">
          Stops a photographed QR code from flooding the kitchen. Set it comfortably above your
          biggest table — every phone at the table sending at once counts. When a table hits the
          limit, the guests see "staff is on the way" and the 🔔 bell rings on the Tables screen
          automatically; nobody's cart is ever lost. Turn it off only if your network is fully
          trusted.
        </div>
      </div>

      <div className="panel mb">
        <h2>Kitchen display timing</h2>
        <div className="row">
          <div className="grow mb">
            <label>Turn amber after (minutes)</label>
            <input type="number" min={1} value={kds.warnMinutes}
              onChange={(e) => setKds({ ...kds, warnMinutes: Math.floor(Number(e.target.value) || 0) })}
              style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>Turn red after (minutes)</label>
            <input type="number" min={2} max={120} value={kds.lateMinutes}
              onChange={(e) => setKds({ ...kds, lateMinutes: Math.floor(Number(e.target.value) || 0) })}
              style={{ width: '100%' }} />
          </div>
        </div>
        <div className="muted small">
          Match your service promise: a noodle stall might use 5/10, a grill 12/20. The whole
          ticket card changes colour, so pace is readable from across the kitchen.
        </div>
      </div>

      <div className="panel mb">
        <h2>Terminals</h2>
        <div className="row">
          <div className="grow mb">
            <label>Sign-in stays valid for (hours)</label>
            <input type="number" min={1} max={48} value={terminals.sessionHours}
              onChange={(e) => setTerminals({ ...terminals, sessionHours: Math.floor(Number(e.target.value) || 0) })}
              style={{ width: '100%' }} />
          </div>
          <div className="grow mb">
            <label>Idle lock default (minutes, 0 = off)</label>
            <input type="number" min={0} max={120} value={terminals.idleLockDefaultMinutes}
              onChange={(e) => setTerminals({ ...terminals, idleLockDefaultMinutes: Math.floor(Number(e.target.value) || 0) })}
              style={{ width: '100%' }} />
          </div>
        </div>
        <div className="muted small">
          A 24-hour venue can stretch sign-ins past a mall unit's day; the idle lock returns
          untouched terminals to the PIN screen venue-wide (each device's own 🔒 choice in the
          sidebar still overrides it). Kitchen screens never auto-lock.
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

      <div className="panel mb">
        <h2>Backups</h2>
        <p className="muted small">
          A snapshot of the database is taken automatically at startup and daily (14 kept, in
          <code> server/data/backups/</code>). Copy them off this machine regularly.
        </p>
        <button onClick={backupNow}>Back up now</button>
        {backupMsg && <span style={{ color: 'var(--accent)', marginLeft: '0.8rem' }}>{backupMsg}</span>}
      </div>

      <button className="primary" onClick={save}>Save settings</button>
      {saved && <span style={{ color: 'var(--accent)', marginLeft: '0.8rem' }}>Saved ✓</span>}
      {error && <div className="error-text mt">{error}</div>}
    </div>
  );
}
