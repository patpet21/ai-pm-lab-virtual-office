import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { chromium } from 'playwright';

import { startOffice } from './server.mjs';

// Real Codex sessions and authorized live Master reads. No fixture
// businesses, intercepted routes, invented tool events, or commercial workflow.
const stateDir = await mkdtemp(join(tmpdir(), 'ai-pm-office-agency-'));
const port = 14320;
const office = await startOffice({ port, stateDir });
const base = `http://127.0.0.1:${port}`;
const headers = {
  Origin: base,
  Authorization: `Bearer ${office.token}`,
  'Content-Type': 'application/json',
};
const api = async (path, data) => {
  const response = await fetch(base + '/api/' + path, {
    headers,
    method: data ? 'POST' : 'GET',
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
};
async function waitCompleted(threadId, allowApproval = false) {
  for (let attempt = 0; attempt < 225; attempt++) {
    const state = await api('state');
    if (allowApproval && state.approvals.some((request) => request.params.threadId === threadId))
      return state;
    if (
      ['completed', 'interrupted'].includes(
        state.threads.find((thread) => thread.id === threadId)?.status,
      )
    )
      return state;
    if (state.threads.find((thread) => thread.id === threadId)?.status === 'failed')
      throw new Error('Actual Codex turn failed');
    await setTimeout(800);
  }
  throw new Error('Actual Codex turn timed out');
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('test-results', { recursive: true });
try {
  await page.goto(base);
  await page.getByLabel('Token di abbinamento').fill(office.token);
  await page.getByRole('button', { name: 'Collega Codex', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Connected' }).waitFor();
  await page.getByRole('button', { name: 'Crea team di 3 sessioni reali' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.role-thread').length === 3);
  let state = await api('state');
  assert.equal(state.threads.length, 3);
  assert.equal(new Set(state.threads.map((thread) => thread.id)).size, 3);
  assert.deepEqual(
    state.threads.map((thread) => thread.role),
    ['discovery', 'intelligence', 'campaign'],
  );
  assert.ok(state.threads.every((thread) => thread.status === 'idle' && !thread.activeTurn));
  assert.equal(await page.getByTitle(/^Agent \d+$/).count(), 3);
  const wrongSkill = await fetch(base + '/api/turn', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      threadId: state.threads[0].id,
      skill: 'ai-pm-campaign-readiness',
      text: 'Test tecnico: nessun tool, ricerca o scrittura.',
    }),
  });
  assert.equal(wrongSkill.status, 400);
  const campaignCard = page
    .locator('.role-card')
    .filter({ has: page.getByRole('heading', { name: 'Campaign Readiness', exact: true }) });
  await campaignCard.getByRole('button', { name: 'Usa prompt d’esempio', exact: true }).click();
  assert.equal(
    await page.getByLabel('Sessione Codex', { exact: true }).inputValue(),
    state.threads.find((thread) => thread.role === 'campaign').id,
  );
  assert.equal(await page.getByLabel('Skill', { exact: true }).count(), 0);
  console.log('PASS three real idle sessions, distinct roles, same team, three real characters');
  const coordinator = page
    .locator('.role-card')
    .filter({ has: page.getByRole('heading', { name: 'Agenzia coordinata', exact: true }) });
  await coordinator.getByRole('button', { name: 'Usa prompt d’esempio' }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Invia a Codex', exact: true }).isDisabled(),
    true,
  );
  assert.ok(
    (await page.getByLabel('Messaggio a Codex').inputValue()).includes('pipeline completa'),
  );
  await coordinator.getByRole('button', { name: 'Crea coordinatore' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.role-thread').length === 4);
  state = await api('state');
  assert.equal(state.threads.filter((thread) => thread.role === 'coordinator').length, 1);
  assert.equal(state.events.filter((event) => event.method === 'turn/started').length, 0);
  console.log(
    'PASS independent prompts and one-session coordinator; creating roles starts no commercial work',
  );
  const source = state.threads.find((thread) => thread.role === 'discovery');
  const target = state.threads.find((thread) => thread.role === 'intelligence');
  await api('turn', {
    threadId: source.id,
    text: 'Test tecnico autenticato del passaggio di risultati. NON eseguire la skill, NON fare ricerche, NON usare connettori, NON modificare file o dati. Rispondi esattamente: Nessun company_id disponibile; pipeline bloccata. Questo è un test tecnico del protocollo.',
  });
  await waitCompleted(source.id);
  const result = await api('handoff', { fromThreadId: source.id, toThreadId: target.id });
  assert.equal(result.threadId, target.id);
  let done = await waitCompleted(target.id, true);
  if (done.approvals.some((request) => request.params.threadId === target.id)) {
    // Windows may require a real approval to read a global skill. Do not
    // auto-grant it. Exercise the global dialog and cancel this technical turn.
    const dialog = page.getByRole('dialog', { name: 'Permesso richiesto', exact: true });
    await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes('Business Intelligence'));
    await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    done = await waitCompleted(target.id);
    console.log(
      'PASS global skill-read approval shown independently of selected chat / cancelled without granting permission',
    );
  }
  assert.ok(
    done.events.some(
      (event) => event.method === 'office/handoff' && event.params.fromThreadId === source.id,
    ),
  );
  assert.equal(
    done.events.filter(
      (event) =>
        event.method === 'item/completed' &&
        event.params.item?.type === 'mcpToolCall' &&
        event.params.item?.tool === 'google_drive.batch_update_spreadsheet',
    ).length,
    0,
  );
  const history = await api('history?threadId=' + target.id);
  assert.ok(
    history.thread.turns.some((turn) =>
      turn.items.some(
        (item) =>
          item.type === 'userMessage' &&
          item.content.some((input) => input.text?.includes('Nessun company_id disponibile')),
      ),
    ),
  );
  const duplicate = await fetch(base + '/api/handoff', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fromThreadId: source.id, toThreadId: target.id }),
  });
  assert.equal(duplicate.status, 400);
  console.log(
    'PASS official history handoff, real target turn, zero Sheet writes, duplicate rejected',
  );
  await page.getByRole('button', { name: 'Master Leads', exact: true }).click();
  await page.getByRole('button', { name: 'Leggi dati reali', exact: true }).click();
  await page.getByText('Live · sola lettura', { exact: true }).waitFor({ timeout: 65000 });
  const sheets = await api('sheets');
  assert.equal(sheets.status, 'connected');
  assert.ok(sheets.tabs.Companies.length > 1);
  assert.equal(
    await page.locator('.data-panel tbody tr').count(),
    Math.min(300, sheets.tabs.Companies.length - 1),
  );
  await page
    .getByRole('region', { name: 'Controlli qualità dei dati caricati', exact: true })
    .waitFor();
  await page.screenshot({ path: 'test-results/agency-master-live.png', fullPage: true });
  await page.getByRole('button', { name: 'Agenzia e agenti', exact: true }).click();
  await page.screenshot({ path: 'test-results/agency-real-team.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    `PASS actual ${sheets.tabs.Companies.length - 1}-row Master live, read only, browser has no exceptions`,
  );
} catch (error) {
  await page.screenshot({ path: 'test-results/agency-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
  await office.close();
}
