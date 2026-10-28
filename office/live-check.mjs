// Integration check against the installed Codex, no fixtures or simulated agent.
// Runs only when explicitly invoked; never runs during a frontend build.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { startOffice } from './server.mjs';

const stateDir = await mkdtemp(join(tmpdir(), 'ai-pm-office-live-'));
let office = await startOffice({ port: 14318, stateDir });
const headers = {
  Origin: 'http://127.0.0.1:14318',
  Authorization: `Bearer ${office.token}`,
  'Content-Type': 'application/json',
};
const api = async (route, body) => {
  const response = await fetch(`http://127.0.0.1:14318/api/${route}`, {
    headers,
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
};
try {
  const state = await api('state');
  assert.equal(state.connected, true, state.error);
  assert.equal(state.threads.length, 0);
  console.log('PASS initialize / initialized; dedicated process; no existing session resumed');
  console.log(
    'SKILLS',
    state.skills.map((skill) => ({
      name: skill.name,
      available: !skill.unavailable,
      path: skill.path,
    })),
  );
  console.log('MODELS', state.models);
  const denied = await fetch('http://127.0.0.1:14318/api/state', {
    headers: { ...headers, Origin: 'https://untrusted.example' },
  });
  assert.equal(denied.status, 403);
  const missing = await fetch('http://127.0.0.1:14318/api/state', {
    headers: { Origin: headers.Origin },
  });
  assert.equal(missing.status, 401);
  const invalid = await fetch('http://127.0.0.1:14318/api/resume', {
    method: 'POST',
    headers,
    body: JSON.stringify({ threadId: 'not-owned' }),
  });
  assert.equal(invalid.status, 400);
  console.log('PASS untrusted origin / missing token / unowned thread rejected');
  const thread = await api('threads', {});
  await api('turn', {
    threadId: thread.id,
    text: 'Verifica tecnica AI PM Lab Virtual Office. Non modificare alcun file, non usare connettori, non eseguire skill e non inviare messaggi. Leggi il package.json di questa cartella con uno strumento di sola lettura. Poi rispondi con il nome del package e OFFICE_LIVE_OK.',
  });
  const deadline = Date.now() + 180000;
  let live;
  while (Date.now() < deadline) {
    live = await api('state');
    if (live.events.some((event) => event.method === 'turn/completed')) break;
    await setTimeout(800);
  }
  const completed = live.events.find((event) => event.method === 'turn/completed');
  assert.ok(completed, 'No turn/completed before timeout');
  assert.equal(completed.params.turn.status, 'completed', JSON.stringify(completed));
  assert.ok(
    live.events.some(
      (event) => event.method === 'item/completed' && event.params.item.type === 'commandExecution',
    ),
  );
  const history = await api('history?threadId=' + thread.id);
  const items = history.thread.turns.flatMap((turn) => turn.items);
  assert.ok(
    items.some((item) => item.type === 'agentMessage' && item.text.includes('OFFICE_LIVE_OK')),
  );
  assert.equal(live.threads[0].phase, null);
  console.log(
    'PASS real thread/start, turn/start, commandExecution, agentMessage, turn/completed, thread/read',
  );
  const sheets = await api('sheets');
  console.log('SHEETS', sheets.status, sheets.reason || sheets.readAt);
  assert.ok((await api('journal')).events.length > 0);
  console.log('PASS persisted event journal; test data directory:', stateDir);
  await office.close();
  office = await startOffice({ port: 14318, stateDir });
  headers.Authorization = `Bearer ${office.token}`;
  const restarted = await api('state');
  assert.equal(restarted.threads.length, 1);
  assert.equal(restarted.threads[0].loaded, false);
  await api('resume', { threadId: thread.id });
  const resumed = await api('turn', {
    threadId: thread.id,
    text: 'Test di ripresa della stessa sessione. Non usare strumenti. Rispondi esattamente RESUME_LIVE_OK.',
  });
  let resumedState;
  for (let attempt = 0; attempt < 225; attempt++) {
    resumedState = await api('state');
    if (
      resumedState.events.some(
        (event) => event.method === 'turn/completed' && event.params.turn.id === resumed.turn.id,
      )
    )
      break;
    await setTimeout(800);
  }
  assert.ok(
    resumedState.events.some(
      (event) =>
        event.method === 'item/completed' &&
        event.params.item.type === 'agentMessage' &&
        event.params.item.text.includes('RESUME_LIVE_OK'),
    ),
  );
  console.log('PASS bridge restart / owned thread persistence / thread/resume / real resumed chat');
  const interrupted = await api('turn', {
    threadId: thread.id,
    text: 'Test cancellazione: leggi README.md con uno strumento di sola lettura e descrivi la struttura del progetto. Non modificare alcun dato.',
  });
  await api('interrupt', { threadId: thread.id });
  let cancelled;
  for (let attempt = 0; attempt < 50; attempt++) {
    const current = await api('state');
    cancelled = current.events.find(
      (event) => event.method === 'turn/completed' && event.params.turn.id === interrupted.turn.id,
    );
    if (cancelled) break;
    await setTimeout(200);
  }
  assert.equal(cancelled?.params.turn.status, 'interrupted');
  console.log('PASS real turn/interrupt and interrupted completion');
} finally {
  await office.close();
}
