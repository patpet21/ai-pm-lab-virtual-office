import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

import { startOffice } from './server.mjs';

// Real local service + real browser + real Codex. No route interception,
// injected activity, fixtures, or simulated agents.
const stateDir = await mkdtemp(join(tmpdir(), 'ai-pm-office-browser-'));
const office = await startOffice({ stateDir });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
await mkdir('test-results', { recursive: true });
const headers = { Origin: 'http://127.0.0.1:4318', Authorization: `Bearer ${office.token}` };
const snapshot = async () => (await fetch('http://127.0.0.1:4318/api/state', { headers })).json();
try {
  await page.goto('http://127.0.0.1:4318');
  await page.getByRole('heading', { name: 'AI PM LAB VIRTUAL OFFICE' }).waitFor();
  await page.getByRole('status').filter({ hasText: 'Disconnected' }).waitFor();
  await page.locator('canvas').first().waitFor();
  assert.equal(await page.getByTitle(/^Agent \d+$/).count(), 0);
  assert.equal(await page.locator('.station-markers span').count(), 3);
  console.log('PASS static office / original canvas / three stations / Disconnected / zero agents');
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Esporta layout', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'x', exact: true }).last().click();
  console.log('PASS original layout editor and office settings open');
  await page.getByLabel('Token di abbinamento').fill(office.token);
  await page.getByRole('button', { name: 'Collega Codex' }).click();
  await page.getByRole('status').filter({ hasText: 'Connected' }).waitFor();
  assert.equal(await page.getByTitle(/^Agent \d+$/).count(), 0);
  await page.getByRole('button', { name: '+ Sessione', exact: true }).click();
  await page
    .getByTitle(/^Agent \d+$/)
    .first()
    .waitFor();
  assert.equal(await page.getByTitle(/^Agent \d+$/).count(), 1);
  console.log('PASS pairing / real thread/start / exactly one character');
  await page
    .getByLabel('Messaggio a Codex')
    .fill(
      'Test tecnico del browser. Rispondi esattamente OFFICE_BROWSER_OK, senza tool e senza modifiche a file o dati.',
    );
  await page.getByRole('button', { name: 'Invia a Codex', exact: true }).click();
  await page
    .locator('.chat-message.agentMessage')
    .filter({ hasText: 'OFFICE_BROWSER_OK' })
    .waitFor({ timeout: 180000 });
  await page.waitForFunction(
    () => document.querySelector('.office-heading')?.textContent?.includes('0 turni attivi'),
    { timeout: 15000 },
  );
  assert.ok(
    (await snapshot()).events.some(
      (event) => event.method === 'turn/completed' && event.params.turn.status === 'completed',
    ),
  );
  await page
    .getByTitle(/^Agent \d+$/)
    .first()
    .click();
  await page
    .getByText(/Sessione [0-9a-f-]+/)
    .first()
    .waitFor();
  console.log('PASS browser chat / real streamed answer / completed turn / character details');
  await page
    .getByLabel('Messaggio a Codex')
    .fill(
      'Test pannello approvazioni: usa lo strumento shell con sandbox_permissions=require_escalated e richiedi approvazione soltanto per Get-Location. La ragione è il test del bridge. Non modificare file o dati. Se viene rifiutato, accetta il rifiuto e fermati senza ritentare.',
    );
  await page.getByRole('button', { name: 'Invia a Codex', exact: true }).click();
  await page.locator('.approval').waitFor({ timeout: 180000 });
  await page.getByRole('button', { name: 'Rifiuta', exact: true }).click();
  await page.locator('.approval').waitFor({ state: 'detached', timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelector('.office-heading')?.textContent?.includes('0 turni attivi'),
    { timeout: 180000 },
  );
  assert.ok(
    (await snapshot()).events.some(
      (event) =>
        event.method === 'office/approvalResolved' && event.params.result.decision === 'decline',
    ),
  );
  console.log('PASS real browser approval panel / decline / turn stopped requesting permission');
  await page.getByRole('button', { name: 'Master Leads', exact: true }).click();
  await page.getByRole('button', { name: 'Leggi dati reali' }).click();
  await page.getByText(/Google Sheets Live non collaudato/).waitFor();
  assert.equal(await page.locator('.data-panel tbody tr').count(), 0);
  console.log('PASS unauthorized Sheets shows unavailable / no substitute rows');
  await page.getByRole('button', { name: 'Storico esecuzioni', exact: true }).click();
  await page.getByRole('button', { name: 'Leggi registro locale' }).click();
  await page.getByText('Turni e risultati della sessione selezionata', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/office-connected.png', fullPage: true });
  await page.getByRole('button', { name: 'Disconnetti browser' }).click();
  await page.getByRole('status').filter({ hasText: 'Disconnected' }).waitFor();
  await page.waitForTimeout(2500);
  assert.equal(await page.getByTitle(/^Agent \d+$/).count(), 0);
  await page.screenshot({ path: 'test-results/office-disconnected.png', fullPage: true });
  assert.deepEqual(failures, []);
  console.log(
    'PASS persisted history / disconnect removes working characters / no browser exceptions',
  );
} catch (error) {
  await page.screenshot({ path: 'test-results/office-browser-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
  await office.close();
}
