import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { BusinessSettings, ModifierSnapshot, Order, ReceiptEinvoice, TaxSettings } from '../types';
import { formatMoney } from '../store';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  ewallet: 'E-Wallet',
  other: 'Other',
};

function EinvoiceBlock({ einvoice }: { einvoice: ReceiptEinvoice }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!einvoice.portal_url) return;
    let cancelled = false;
    QRCode.toDataURL(einvoice.portal_url, { width: 110, margin: 0 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [einvoice.portal_url]);
  return (
    <>
      <hr />
      <div className="center" style={{ fontWeight: 700 }}>LHDN e-Invoice ({einvoice.status})</div>
      <div className="center" style={{ wordBreak: 'break-all', fontSize: 10 }}>{einvoice.uuid}</div>
      {qr && (
        <div className="center" style={{ marginTop: 4 }}>
          <img src={qr} alt="MyInvois validation QR" style={{ width: 110, height: 110 }} />
        </div>
      )}
    </>
  );
}

export default function Receipt({
  order,
  business,
  tax,
  einvoice,
}: {
  order: Order;
  business: BusinessSettings;
  tax: TaxSettings;
  einvoice?: ReceiptEinvoice | null;
}) {
  const money = (c: number | null | undefined) => formatMoney(c, business.currencySymbol);
  const lines = order.items.filter((i) => i.status !== 'cancelled');
  return (
    <div className="receipt">
      <h2>{business.name}</h2>
      {business.address && <div className="center">{business.address}</div>}
      {business.phone && <div className="center">{business.phone}</div>}
      {business.registrationNo && <div className="center">Reg: {business.registrationNo}</div>}
      <hr />
      <div className="rrow">
        <span>#{order.order_no}</span>
        <span>{order.type === 'dine_in' ? `Table ${order.table_name ?? ''}` : order.type.replace('_', ' ')}</span>
      </div>
      <div className="rrow">
        <span>{new Date(order.closed_at ?? order.opened_at).toLocaleString()}</span>
        <span>{order.opened_by_name}</span>
      </div>
      <hr />
      {lines.map((line) => {
        const mods = JSON.parse(line.modifiers_json) as ModifierSnapshot[];
        return (
          <div key={line.id}>
            <div className="rrow">
              <span className="l">
                {line.qty} × {line.name}
              </span>
              <span>{money(line.line_total_cents)}</span>
            </div>
            {mods.map((m) => (
              <div className="rrow" key={m.modifier_id}>
                <span className="l">&nbsp;&nbsp;+ {m.name}</span>
                <span>{m.price_delta_cents ? money(m.price_delta_cents * line.qty) : ''}</span>
              </div>
            ))}
            {line.notes && <div>&nbsp;&nbsp;» {line.notes}</div>}
          </div>
        );
      })}
      <hr />
      <div className="rrow">
        <span>Subtotal</span>
        <span>{money(order.subtotal_cents)}</span>
      </div>
      {order.discount_cents > 0 && (
        <div className="rrow">
          <span>Discount</span>
          <span>-{money(order.discount_cents)}</span>
        </div>
      )}
      {order.service_cents > 0 && (
        <div className="rrow">
          <span>{tax.serviceLabel}</span>
          <span>{money(order.service_cents)}</span>
        </div>
      )}
      {order.tax_cents > 0 && (
        <div className="rrow">
          <span>{tax.taxLabel}</span>
          <span>{money(order.tax_cents)}</span>
        </div>
      )}
      {order.rounding_cents !== 0 && (
        <div className="rrow">
          <span>Rounding</span>
          <span>{money(order.rounding_cents)}</span>
        </div>
      )}
      <div className="rrow grand">
        <span>TOTAL</span>
        <span>{money(order.total_cents)}</span>
      </div>
      <hr />
      {order.payments.map((p) => (
        <div key={p.id}>
          <div className="rrow">
            <span>{p.channel ?? METHOD_LABEL[p.method] ?? p.method}{p.reference ? ` (${p.reference})` : ''}</span>
            <span>{money(p.amount_cents)}</span>
          </div>
          {p.method === 'cash' && p.tendered_cents != null && (
            <>
              <div className="rrow">
                <span>&nbsp;&nbsp;Tendered</span>
                <span>{money(p.tendered_cents)}</span>
              </div>
              <div className="rrow">
                <span>&nbsp;&nbsp;Change</span>
                <span>{money(p.change_cents)}</span>
              </div>
            </>
          )}
        </div>
      ))}
      {order.refunds.length > 0 && (
        <>
          {order.refunds.map((r) => (
            <div className="rrow" key={r.id}>
              <span>REFUND ({METHOD_LABEL[r.method] ?? r.method}) — {r.reason}</span>
              <span>-{money(r.amount_cents)}</span>
            </div>
          ))}
          <hr />
        </>
      )}
      <div className="center">{business.receiptFooter}</div>
      {einvoice && <EinvoiceBlock einvoice={einvoice} />}
    </div>
  );
}
