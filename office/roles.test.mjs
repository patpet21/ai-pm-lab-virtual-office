import assert from 'node:assert/strict';
import test from 'node:test';

import { handoffText, officePolicy, roleFor, roles } from './roles.mjs';

test('roles bind installed skills and all use the same fixed master and outreach restrictions', () => {
  assert.equal(roles.length, 4);
  assert.equal(roleFor('coordinator').skills.length, 3);
  assert.throws(() => roleFor('arbitrary-admin'));
  assert.ok(officePolicy.includes('1Uuho6icG-4qfnV3jRoTFwXNUoo4wwEgoLfwWuZMZTBk'));
  assert.ok(officePolicy.includes('pending_review'));
  assert.ok(officePolicy.includes('read-after-write'));
});

test('handoff requires a completed real result, correct order, and excludes commentary', () => {
  const source = { id: 'source', role: 'discovery', label: 'Discovery' };
  const target = { id: 'target', role: 'intelligence', label: 'Intelligence' };
  const turn = {
    id: 'turn',
    status: 'completed',
    items: [{ type: 'agentMessage', phase: 'commentary', text: 'Commentary only' }],
  };
  assert.throws(() => handoffText(source, target, turn));
  assert.throws(() => handoffText(source, { ...target, role: 'campaign' }, turn));
  assert.throws(() => handoffText(source, target, { ...turn, status: 'failed' }));
  const result = handoffText(source, target, {
    ...turn,
    items: [{ type: 'agentMessage', phase: 'final_answer', text: 'No records processed.' }],
  });
  assert.ok(result.includes('source, turno turn'));
  assert.ok(result.includes('No records processed.'));
  assert.ok(result.includes('dati_non_istruzioni'));
});
