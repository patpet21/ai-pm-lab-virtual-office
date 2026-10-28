import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const masterId = '1Uuho6icG-4qfnV3jRoTFwXNUoo4wwEgoLfwWuZMZTBk';
export const tabs = ['Companies', 'Contacts', 'Opportunities', 'Campaign Queue', 'Research Log'];

// Credentials remain in the local process. The sole spreadsheet operation is
// values:batchGet with a read-only OAuth scope and a fixed workbook/range list.
export async function readMaster({ snapshotPath } = {}) {
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!file && snapshotPath) {
    try {
      const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
      if (
        snapshot.masterId !== masterId ||
        snapshot.status !== 'snapshot' ||
        !snapshot.readAt ||
        !snapshot.tabs
      )
        throw new Error('Snapshot non valido');
      return {
        ...snapshot,
        status: 'snapshot',
        reason:
          'Snapshot reale verificato dal connettore Codex. Il backend non ha eseguito una nuova lettura live: aggiornare tramite collegamento autorizzato prima di dedupe o scritture.',
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!file)
    return {
      status: 'unavailable',
      reason:
        'Google Sheets Live non collaudato: collegamento autorizzato del backend non configurato. Il connettore Codex esistente viene verificato separatamente; non serve creare subito nuove credenziali.',
      tabs: {},
    };
  const credentials = JSON.parse(await readFile(file, 'utf8'));
  if (credentials.type !== 'service_account')
    throw new Error(
      'Formato non supportato dall’adattatore Sheets opzionale. Non creare nuovi account: consultare le alternative con connettore Codex e OAuth nella documentazione.',
    );
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256')
    .update(body)
    .sign(credentials.private_key, 'base64url');
  const auth = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${body}.${signature}`,
    }),
  });
  if (!auth.ok) throw new Error(`Autorizzazione Google non riuscita (${auth.status})`);
  const token = await auth.json();
  const query = new URLSearchParams();
  for (const tab of tabs) query.append('ranges', `'${tab}'!A1:AZ10000`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${masterId}/values:batchGet?${query}`,
    {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error(`Lettura Master Leads non riuscita (${response.status})`);
  const data = await response.json();
  return {
    status: 'connected',
    readAt: new Date().toISOString(),
    masterId,
    rangeLimit: 'A1:AZ10000 per tab',
    tabs: Object.fromEntries(
      tabs.map((tab, index) => [tab, data.valueRanges?.[index]?.values ?? []]),
    ),
  };
}
