import assert from 'node:assert/strict';
import test from 'node:test';

import { researchBrief, researchInstructions } from './research.mjs';
import { handoffText, officePolicy, requestedSkills, roleFor, roles } from './roles.mjs';

test('roles bind installed skills and all use the same fixed master and outreach restrictions', () => {
  assert.equal(roles.length, 4);
  assert.equal(roleFor('coordinator').skills.length, 3);
  assert.throws(() => roleFor('arbitrary-admin'));
  assert.ok(officePolicy.includes('1Uuho6icG-4qfnV3jRoTFwXNUoo4wwEgoLfwWuZMZTBk'));
  assert.ok(officePolicy.includes('pending_review'));
  assert.ok(officePolicy.includes('read-after-write'));
});

test('a specialist cannot silently execute another role; coordinator keeps all three ordered skills', () => {
  assert.deepEqual(requestedSkills({ role: 'discovery' }), ['ai-pm-lead-discovery']);
  assert.throws(() => requestedSkills({ role: 'discovery' }, 'ai-pm-campaign-readiness'));
  assert.throws(() => requestedSkills({ role: 'coordinator' }, 'ai-pm-lead-discovery'));
  assert.deepEqual(requestedSkills({ role: 'coordinator' }), roles[3].skills);
  assert.deepEqual(requestedSkills({}, 'ai-pm-business-intelligence'), [
    'ai-pm-business-intelligence',
  ]);
});

test('research requires an explicit output target and bounded work; unavailable Sheets must not silently become offline', () => {
  const brief = researchBrief();
  assert.equal(brief.output, 'sheets');
  assert.equal(brief.quality, 'selective');
  assert.throws(() => researchBrief({ count: 31 }));
  assert.throws(() => researchBrief({ count: 15, cap: 10 }));
  assert.throws(() => researchBrief({ area: {} }));
  assert.throws(() => researchBrief({ output: 'send' }));
  assert.ok(researchInstructions(brief).includes('fermati PRIMA'));
  assert.ok(researchInstructions(brief).includes('project_feasibility_score=0'));
  assert.ok(researchInstructions({ output: 'offline' }).includes('pending_sync'));
  assert.ok(researchInstructions({ output: 'chat' }).includes('Non eseguire scritture'));
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
