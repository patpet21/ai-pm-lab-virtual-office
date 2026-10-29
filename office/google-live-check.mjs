import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startOffice } from './server.mjs';
import { masterId, readMaster, tabs } from './sheets.mjs';

// Real authorized connector through the actual local API. No model task,
// credential export, fixture data, business research or Sheet write.
const stateDir = await mkdtemp(join(tmpdir(), 'ai-pm-office-google-live-'));
const port = 14322;
const office = await startOffice({ port, stateDir });
const headers = {
  Origin: `http://127.0.0.1:${port}`,
  Authorization: `Bearer ${office.token}`,
  'Content-Type': 'application/json',
};
const api = async (route, data) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
    headers,
    ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(65000),
  });
  assert.equal(response.status, 200);
  return response.json();
};
try {
  const checked = await api('google-status', {});
  assert.equal(checked.state, 'Accesso Master verificato in lettura', JSON.stringify(checked));
  const result = await api('sheets');
  assert.equal(result.status, 'connected', result.reason);
  assert.equal(result.masterId, masterId);
  assert.equal(result.source, 'codex_app_server_mcp_tool_call');
  assert.ok(tabs.every((tab) => Array.isArray(result.tabs[tab]) && result.tabs[tab].length >= 1));
  const state = await api('state');
  assert.equal(state.threads.length, 0);
  assert.equal(state.events.filter((event) => event.method === 'turn/started').length, 0);
  const fallback = await readMaster({ snapshotPath: join(stateDir, 'master-snapshot.json') });
  assert.equal(fallback.status, 'snapshot');
  assert.equal(fallback.readAt, result.readAt);
  assert.deepEqual(fallback.tabs, result.tabs);
  console.log(
    'PASS actual local API / authorized Codex connector / fixed Master / all five tabs / no new credential / zero business tasks',
  );
  console.log(
    JSON.stringify(Object.fromEntries(tabs.map((tab) => [tab, result.tabs[tab].length - 1]))),
  );
} finally {
  await office.close();
}
