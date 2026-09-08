/**
 * MyInvois API transport. Three environments:
 *  - mock:       built-in simulator, no network — for demos/tests and dev machines
 *  - sandbox:    LHDN pre-production (preprod-api.myinvois.hasil.gov.my)
 *  - production: live LHDN (api.myinvois.hasil.gov.my)
 *
 * Real environments use OAuth2 client-credentials, then base64+SHA256 document
 * submission per the MyInvois SDK.
 */
import crypto from 'crypto';
import { ApiError } from '../../middleware/errors';
import type { EinvoiceSettings } from '../../types';

const BASE_URLS: Record<'sandbox' | 'production', string> = {
  sandbox: 'https://preprod-api.myinvois.hasil.gov.my',
  production: 'https://api.myinvois.hasil.gov.my',
};

const PORTAL_URLS: Record<string, string> = {
  mock: 'https://preprod.myinvois.hasil.gov.my',
  sandbox: 'https://preprod.myinvois.hasil.gov.my',
  production: 'https://myinvois.hasil.gov.my',
};

export function portalUrl(env: string, uuid: string, longId: string): string {
  return `${PORTAL_URLS[env] ?? PORTAL_URLS.production}/${uuid}/share/${longId}`;
}

export interface SubmitResult {
  submissionUid: string;
  uuid: string | null; // null when the document was rejected outright
  rejectedReason?: string;
}

export interface DocumentDetails {
  status: 'Submitted' | 'Valid' | 'Invalid' | 'Cancelled';
  longId: string | null;
  error?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getToken(settings: EinvoiceSettings): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const base = BASE_URLS[settings.environment as 'sandbox' | 'production'];
  const res = await fetch(`${base}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      scope: 'InvoicingAPI',
    }),
  });
  if (!res.ok) {
    throw new ApiError(502, `MyInvois auth failed (${res.status}) — check client ID/secret`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

// ---- mock simulator ----

const mockDocs = new Map<string, { longId: string }>();

function mockSubmit(documentJson: string): SubmitResult {
  // Basic sanity: the document must parse and carry an Invoice with a payable amount.
  try {
    const doc = JSON.parse(documentJson) as { Invoice?: unknown[] };
    if (!Array.isArray(doc.Invoice) || doc.Invoice.length === 0) throw new Error('no Invoice');
  } catch (e) {
    return {
      submissionUid: 'MOCKSUB' + crypto.randomBytes(6).toString('hex').toUpperCase(),
      uuid: null,
      rejectedReason: `Document rejected by validator: ${e instanceof Error ? e.message : 'parse error'}`,
    };
  }
  const uuid = crypto.randomBytes(13).toString('hex').toUpperCase().slice(0, 26);
  mockDocs.set(uuid, { longId: crypto.randomBytes(20).toString('hex').toUpperCase() });
  return { submissionUid: 'MOCKSUB' + crypto.randomBytes(6).toString('hex').toUpperCase(), uuid };
}

function mockDetails(uuid: string): DocumentDetails {
  const doc = mockDocs.get(uuid);
  if (!doc) return { status: 'Invalid', longId: null, error: 'Unknown document (mock)' };
  return { status: 'Valid', longId: doc.longId };
}

// ---- public API ----

export async function submitDocument(
  settings: EinvoiceSettings,
  internalId: string,
  documentJson: string,
): Promise<SubmitResult> {
  if (settings.environment === 'mock') return mockSubmit(documentJson);

  const base = BASE_URLS[settings.environment];
  const token = await getToken(settings);
  const res = await fetch(`${base}/api/v1.0/documentsubmissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      documents: [
        {
          format: 'JSON',
          document: Buffer.from(documentJson).toString('base64'),
          documentHash: crypto.createHash('sha256').update(documentJson).digest('hex'),
          codeNumber: internalId,
        },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    submissionUid?: string;
    acceptedDocuments?: { uuid: string }[];
    rejectedDocuments?: { invoiceCodeNumber: string; error?: { message?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new ApiError(502, `MyInvois submission failed (${res.status}): ${body.error?.message ?? 'unknown error'}`);
  }
  const accepted = body.acceptedDocuments?.[0];
  const rejected = body.rejectedDocuments?.[0];
  return {
    submissionUid: body.submissionUid ?? '',
    uuid: accepted?.uuid ?? null,
    rejectedReason: rejected ? rejected.error?.message ?? 'Rejected by MyInvois' : undefined,
  };
}

export async function getDocumentDetails(
  settings: EinvoiceSettings,
  uuid: string,
): Promise<DocumentDetails> {
  if (settings.environment === 'mock') return mockDetails(uuid);

  const base = BASE_URLS[settings.environment];
  const token = await getToken(settings);
  const res = await fetch(`${base}/api/v1.0/documents/${uuid}/details`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(502, `MyInvois status check failed (${res.status})`);
  const body = (await res.json()) as {
    status: string;
    longId?: string;
    validationResults?: { status: string; validationSteps?: { error?: { message?: string } }[] };
  };
  const stepError = body.validationResults?.validationSteps?.find((s) => s.error)?.error?.message;
  return {
    status: (body.status as DocumentDetails['status']) ?? 'Submitted',
    longId: body.longId ?? null,
    error: stepError,
  };
}
