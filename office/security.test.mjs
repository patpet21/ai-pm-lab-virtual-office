import assert from 'node:assert/strict';
import test from 'node:test';

import { authorized } from './server.mjs';
import { masterId, readMaster } from './sheets.mjs';
import { observedSkill } from './skills.mjs';

test('local API rejects untrusted origins, rebinding hosts, missing or incorrect pairing', () => {
  const token = 'a'.repeat(64);
  const config = { port: 4318, origins: new Set(['https://office.example.test']), token };
  const headers = {
    host: '127.0.0.1:4318',
    origin: 'https://office.example.test',
    authorization: `Bearer ${token}`,
  };
  assert.equal(authorized({ headers }, config), true);
  for (const change of [
    { host: 'attacker.test:4318' },
    { origin: 'https://evil.test' },
    { origin: 'null' },
    { authorization: '' },
    { authorization: `Bearer ${'b'.repeat(64)}` },
    { origin: undefined },
  ]) {
    assert.equal(authorized({ headers: { ...headers, ...change } }, config), false);
  }
});

test('skill mention or request is not an observed execution phase', () => {
  const skills = [
    {
      name: 'ai-pm-lead-discovery',
      path: 'C:\\Users\\operator\\.agents\\skills\\discovery\\SKILL.md',
    },
  ];
  assert.equal(observedSkill({ type: 'userMessage', text: '$ai-pm-lead-discovery' }, skills), null);
  assert.equal(
    observedSkill(
      {
        type: 'commandExecution',
        status: 'completed',
        exitCode: 0,
        command: 'echo ai-pm-lead-discovery',
      },
      skills,
    ),
    null,
  );
  const item = {
    type: 'commandExecution',
    id: 'read-item',
    status: 'completed',
    exitCode: 0,
    commandActions: [{ type: 'read', path: 'C:/Users/operator/.agents/skills/discovery/SKILL.md' }],
  };
  assert.equal(observedSkill(item, skills)?.name, skills[0].name);
  assert.equal(observedSkill({ ...item, exitCode: 1 }, skills), null);
  assert.equal(observedSkill({ ...item, status: 'inProgress' }, skills), null);
  const readCommand = `Get-Content -LiteralPath '${skills[0].path}' -TotalCount 4`;
  assert.equal(
    observedSkill({ ...item, commandActions: [{ type: 'unknown', command: readCommand }] }, skills)
      ?.evidence,
    'completed_literal_get_content',
  );
  for (const command of [
    readCommand + '; echo hi',
    'echo ' + readCommand,
    readCommand + ' | Select-Object -First 2',
    `Get-Content -LiteralPath $skillPath`,
  ]) {
    assert.equal(
      observedSkill({ ...item, commandActions: [{ type: 'unknown', command }] }, skills),
      null,
    );
  }
  assert.equal(
    observedSkill(
      { ...item, commandActions: [{ type: 'read', path: skills[0].path + '.backup' }] },
      skills,
    ),
    null,
  );
});

test('missing Google credentials yield unavailable with no substitute rows', async () => {
  const previous = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    const result = await readMaster();
    assert.equal(masterId, '1Uuho6icG-4qfnV3jRoTFwXNUoo4wwEgoLfwWuZMZTBk');
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.tabs, {});
  } finally {
    if (previous !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = previous;
  }
});
