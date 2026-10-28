import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { startOffice } from './server.mjs';

const office = await startOffice({
  port: 14319,
  stateDir: await mkdtemp(join(tmpdir(), 'ai-pm-office-protocol-')),
});
const headers = {
  Origin: 'http://127.0.0.1:14319',
  Authorization: `Bearer ${office.token}`,
  'Content-Type': 'application/json',
};
const api = async (route, data) => {
  const response = await fetch('http://127.0.0.1:14319/api/' + route, {
    headers,
    method: data ? 'POST' : 'GET',
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
};
async function waitTurn(turnId, handle) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const state = await api('state');
    await handle?.(state);
    const done = state.events.find(
      (event) => event.method === 'turn/completed' && event.params.turn.id === turnId,
    );
    if (done) return state;
    await setTimeout(500);
  }
  throw new Error('Turn timeout');
}
try {
  const state = await api('state');
  const thread = await api('threads', {});
  const skill = state.skills.find((row) => !row.unavailable);
  assert.ok(skill);
  const turn = await api('turn', {
    threadId: thread.id,
    text: `Test diagnostico: NON eseguire la skill, NON fare ricerche, NON usare connettori o modificare dati. Usa esclusivamente la shell per leggere le prime quattro righe del file già installato: Get-Content -LiteralPath '${skill.path}' -TotalCount 4. Poi rispondi SKILL_READ_ONLY_OK e fermati.`,
  });
  const observed = await waitTurn(turn.turn.id);
  assert.ok(
    observed.events.some(
      (event) => event.method === 'office/skillObserved' && event.params.name === skill.name,
    ),
    'Skill file read was not observable',
  );
  console.log('PASS real Windows skill-file read recognized; skill workflow NOT executed');
  let approvalObserved = false;
  const approved = await api('turn', {
    threadId: thread.id,
    text: 'Test diagnostico del pannello approvazioni. Richiedi esplicitamente approvazione tramite lo strumento shell con sandbox_permissions=require_escalated per eseguire soltanto Get-Location (comando innocuo di lettura). La motivazione è il test del bridge locale. Non modificare dati e non usare connettori. Se la richiesta viene rifiutata, accetta il rifiuto e fermati senza ritentare.',
  });
  await waitTurn(approved.turn.id, async (current) => {
    for (const request of current.approvals) {
      assert.equal(request.method, 'item/commandExecution/requestApproval');
      approvalObserved = true;
      await api('approval', { id: request.id, decision: 'decline' });
      const duplicate = await fetch('http://127.0.0.1:14319/api/approval', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: request.id, decision: 'accept' }),
      });
      assert.equal(duplicate.status, 400);
    }
  });
  console.log(
    approvalObserved
      ? 'PASS real approval request / decline / stale duplicate rejected'
      : 'NOT VERIFIED: model did not emit an approval request',
  );
} finally {
  await office.close();
}
