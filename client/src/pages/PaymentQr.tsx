import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';

/**
 * Printable counter standee card for the static DuitNow / wallet QR —
 * the laminated "scan to pay" card every Malaysian/Singaporean counter has.
 */
export default function PaymentQr() {
  const business = useStore((s) => s.business);
  const payments = useStore((s) => s.payments);
  const navigate = useNavigate();
  const [qr, setQr] = useState<string | null>(null);

  const payload = payments?.ewalletQrPayload ?? '';
  const wallets = (payments?.channels ?? []).filter((c) => c.kind === 'ewallet' && c.enabled);

  useEffect(() => {
    let cancelled = false;
    if (payload) {
      QRCode.toDataURL(payload, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'H',
        color: { dark: '#0f1419', light: '#ffffff' },
      }).then((url) => {
        if (!cancelled) setQr(url);
      });
    } else {
      setQr(null);
    }
    return () => {
      cancelled = true;
    };
  }, [payload]);

  return (
    <div>
      <div className="row mb no-print">
        <h1 className="grow">Counter Payment QR</h1>
        <button className="primary" onClick={() => window.print()} disabled={!qr}>Print card</button>
      </div>
      <p className="muted small no-print">
        Print, laminate, and stand this at the counter. One DuitNow QR accepts all participating
        wallets and banking apps. The same payload also shows on the payment screen with the exact
        amount when a cashier selects a wallet.
      </p>

      {!payload && (
        <div className="panel no-print" style={{ borderColor: 'var(--warn)' }}>
          No wallet QR payload configured yet. An admin can paste the DuitNow QR string from your
          bank / acquirer under <button className="ghost" onClick={() => navigate('/settings')}>Settings → Payment channels</button>.
        </div>
      )}

      {qr && (
        <div className="qr-sheet" style={{ maxWidth: 420 }}>
          <div className="qr-card" style={{ padding: '1.6rem' }}>
            <div className="qr-biz" style={{ fontSize: '1rem' }}>{business?.name ?? 'EasyTempah'}</div>
            <div className="qr-table" style={{ fontSize: '1.7rem' }}>SCAN TO PAY</div>
            <div className="qr-zone">DuitNow QR</div>
            <img src={qr} alt="Counter payment QR" style={{ width: 280, height: 280 }} />
            {wallets.length > 0 && (
              <div className="qr-zone" style={{ marginTop: '0.4rem' }}>
                {wallets.map((w) => w.label).join(' · ')}
              </div>
            )}
            <div className="qr-hint">Show the payment confirmation to our cashier</div>
          </div>
        </div>
      )}
    </div>
  );
}
