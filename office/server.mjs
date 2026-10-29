import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CodexProvider } from './codex.mjs';
import { masterReader } from './google.mjs';
import { researchBrief, researchInstructions } from './research.mjs';
import { handoffText, officePolicy, requestedSkills, roleFor, roles } from './roles.mjs';
import { readMaster } from './sheets.mjs';
import { observedSkill, skillNames } from './skills.mjs';

function requestOrigin(req, port) {
  return (
    req.headers.origin ||
    (req.headers['sec-fetch-site'] === 'same-origin' ? `http://127.0.0.1:${port}` : undefined)
  );
}

export function authorized(req, { port, origins, token }) {
  if (req.headers.host !== `127.0.0.1:${port}`) return false;
  if (!origins.has(requestOrigin(req, port))) return false;
  const value = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? '');
  const expected = Buffer.from(token);
  return value.length === expected.length && timingSafeEqual(value, expected);
}

export async function startOffice(options = {}) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const cwd = resolve(options.cwd || process.env.CODEX_OFFICE_WORKSPACE || root);
  const port = Number(options.port || process.env.CODEX_OFFICE_PORT || 4318);
  const token = options.token || process.env.CODEX_OFFICE_TOKEN || randomBytes(32).toString('hex');
  if (token.length < 32) throw new Error('Pairing token must contain at least 32 characters');
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  for (const origin of (process.env.CODEX_OFFICE_ORIGINS || '').split(',').filter(Boolean)) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin)
      throw new Error('Allowed remote origins must be exact HTTPS origins');
    origins.add(origin);
  }
  const stateDir = resolve(options.stateDir || join(root, '.office'));
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const manifestPath = join(stateDir, 'threads.json');
  const owned = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  const save = () => {
    writeFileSync(manifestPath + '.tmp', JSON.stringify(owned, null, 2), { mode: 0o600 });
    renameSync(manifestPath + '.tmp', manifestPath);
  };
  const logPath = join(stateDir, 'events.jsonl');
  const events = [];
  let seq = 0;
  let bootError = null;
  let skills = [];
  let models = [];
  const approvals = new Map();
  const loaded = new Set();
  const turnsStarting = new Set();
  const bootId = randomBytes(16).toString('hex');
  const record = (message) => {
    const event = { seq: ++seq, at: new Date().toISOString(), ...message };
    events.push(event);
    if (events.length > 1000) events.shift();
    appendFileSync(logPath, JSON.stringify(event) + '\n', { mode: 0o600 });
  };
  const provider = new CodexProvider({ cwd, executable: options.executable });
  provider.on('disconnected', () => {
    approvals.clear();
    loaded.clear();
  });
  provider.on('event', (message) => {
    const params = message.params ?? {};
    const pending =
      message.method === 'serverRequest/resolved' ? approvals.get(String(params.requestId)) : null;
    const id = params.threadId ?? params.thread?.id ?? pending?.params.threadId;
    const thread = owned.find((row) => row.id === id);
    if (!thread) {
      if (message.id !== undefined)
        provider.send({
          id: message.id,
          error: { code: -32601, message: 'Unowned or unsupported server request' },
        });
      return;
    }
    if (message.id !== undefined) {
      const supported = [
        'item/commandExecution/requestApproval',
        'item/fileChange/requestApproval',
        'item/tool/requestUserInput',
      ];
      if (!supported.includes(message.method)) {
        provider.send({
          id: message.id,
          error: { code: -32601, message: 'Unsupported request; no permission granted' },
        });
        record({
          method: 'office/unsupportedRequest',
          params: { threadId: id, method: message.method },
        });
        return;
      }
      approvals.set(String(message.id), message);
    }
    if (message.method === 'serverRequest/resolved') approvals.delete(String(params.requestId));
    if (message.method === 'turn/started') {
      thread.hasHistory = true;
      thread.activeTurn = params.turn.id;
      thread.status = 'inProgress';
      thread.phase = null;
    }
    if (message.method === 'turn/completed') {
      thread.activeTurn = null;
      thread.status = params.turn.status;
      thread.phase = null;
      for (const [key, pending] of approvals)
        if (pending.params.threadId === id) approvals.delete(key);
    }
    if (message.method === 'item/completed') {
      const phase = observedSkill(params.item, skills);
      if (phase) {
        thread.phase = phase;
        record({
          method: 'office/skillObserved',
          params: {
            threadId: id,
            ...phase,
            note: 'Lettura del file osservata; non prova completamento della skill.',
          },
        });
      }
    }
    record(message);
    if (['turn/started', 'turn/completed', 'item/completed'].includes(message.method)) save();
  });
  try {
    await provider.initialize({ experimentalApi: true });
    const result = await provider.request('skills/list', { cwds: [cwd] });
    skills = result.data
      .flatMap((entry) => entry.skills)
      .filter((skill) => skillNames.includes(skill.name) && skill.enabled !== false);
    const available = await provider.request('model/list', {});
    models = available.data
      .filter((model) => !model.hidden)
      .map((model) => ({
        id: model.id,
        model: model.model,
        displayName: model.displayName,
        isDefault: model.isDefault,
      }));
  } catch (error) {
    bootError = error.message;
  }
  const google = masterReader(provider, {
    cwd,
    model: models.find((model) => model.isDefault)?.model || models[0]?.model,
  });
  async function body(req) {
    let buffer = '';
    for await (const chunk of req) {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 65536) throw new Error('Request too large');
    }
    return JSON.parse(buffer || '{}');
  }
  const threadFor = (id) => {
    const thread = owned.find((row) => row.id === id);
    if (!thread) throw new Error('Sessione non appartenente a questo ufficio');
    return thread;
  };
  async function createThread(data) {
    const role = roleFor(data.role);
    const sandbox =
      data.sandbox ||
      (process.env.CODEX_OFFICE_SANDBOX === 'workspace-write' ? 'workspace-write' : 'read-only');
    if (!['read-only', 'workspace-write'].includes(sandbox)) throw new Error('Permessi non validi');
    for (const name of role?.skills || (role?.skill ? [role.skill] : []))
      if (!skills.some((skill) => skill.name === name))
        throw new Error('Skill non disponibile: ' + name);
    const selected =
      data.model ||
      process.env.CODEX_OFFICE_MODEL ||
      models.find((model) => model.isDefault)?.model ||
      models[0]?.model;
    if (!selected || !models.some((model) => model.model === selected))
      throw new Error('Selezionare un modello disponibile in model/list');
    const result = await provider.request('thread/start', {
      cwd,
      model: selected,
      sandbox,
      approvalPolicy: 'on-request',
      developerInstructions:
        officePolicy + (role ? ` Ruolo assegnato: ${role.name}. ${role.description}` : ''),
    });
    const thread = {
      id: result.thread.id,
      createdAt: new Date().toISOString(),
      status: 'idle',
      cwd,
      sandbox,
      model: result.model,
      role: role?.id || null,
      label: role?.name || 'Codex',
      teamId: data.teamId || null,
    };
    owned.push(thread);
    loaded.add(thread.id);
    save();
    return thread;
  }
  async function startTurn(thread, data) {
    if (!loaded.has(thread.id)) throw new Error('Ricollegare prima la sessione');
    if (thread.activeTurn || turnsStarting.has(thread.id))
      throw new Error('Un turno è già in esecuzione');
    if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 32000)
      throw new Error('Messaggio non valido');
    const requested = requestedSkills(thread, data.skill);
    const brief = researchBrief(data.research);
    const input = [
      { type: 'text', text: data.text + researchInstructions(brief), text_elements: [] },
    ];
    for (const name of requested) {
      const skill = skills.find((skill) => skill.name === name);
      if (!skill) throw new Error('Skill non disponibile');
      input.push({ type: 'skill', name: skill.name, path: skill.path });
    }
    turnsStarting.add(thread.id);
    try {
      const result = await provider.request('turn/start', { threadId: thread.id, input });
      record({
        method: 'office/userMessage',
        params: {
          threadId: thread.id,
          turnId: result.turn.id,
          text: data.text,
          requestedSkills: requested,
          research: brief,
        },
      });
      thread.lastBrief = brief;
      if (
        !events.some(
          (event) => event.method === 'turn/completed' && event.params.turn.id === result.turn.id,
        )
      ) {
        thread.activeTurn = result.turn.id;
        thread.status = result.turn.status;
        save();
      }
      return result;
    } finally {
      turnsStarting.delete(thread.id);
    }
  }
  const server = createServer(async (req, res) => {
    const json = (code, value) => {
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.headers.host !== `127.0.0.1:${port}`) return json(403, { error: 'Invalid Host' });
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
        const base = join(root, 'dist', 'webview');
        const file = resolve(
          base,
          '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
        );
        if (!file.startsWith(base + sep)) return json(403, { error: 'Forbidden' });
        const data = await readFile(file);
        const mime = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.ttf': 'font/ttf',
          '.woff2': 'font/woff2',
          '.ico': 'image/x-icon',
        };
        res.writeHead(200, {
          'Content-Type': mime[extname(file)] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        });
        return res.end(data);
      }
      const origin = requestOrigin(req, port);
      if (!origins.has(origin)) return json(403, { error: 'Origin denied' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.writeHead(204);
        return res.end();
      }
      if (!authorized(req, { port, origins, token }))
        return json(401, { error: 'Pairing richiesto' });
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const after =
          url.searchParams.get('bootId') === bootId
            ? Number(url.searchParams.get('after') || 0)
            : 0;
        return json(200, {
          bootId,
          connected: provider.connected,
          error: bootError,
          cwd,
          threads: owned.map((thread) => ({
            ...thread,
            loaded: loaded.has(thread.id),
            status: provider.connected && loaded.has(thread.id) ? thread.status : 'offline',
            phase: loaded.has(thread.id) ? thread.phase : null,
          })),
          skills: skillNames.map((name) => {
            const skill = skills.find((skill) => skill.name === name);
            return skill
              ? { name, path: skill.path, description: skill.description }
              : { name, unavailable: true };
          }),
          models,
          roles,
          approvals: [...approvals.values()],
          events: events.filter((event) => event.seq > after),
          cursor: seq,
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        const thread = threadFor(url.searchParams.get('threadId'));
        return json(
          200,
          await provider.request('thread/read', { threadId: thread.id, includeTurns: true }),
        );
      }
      if (req.method === 'GET' && url.pathname === '/api/journal') {
        const lines = existsSync(logPath)
          ? readFileSync(logPath, 'utf8')
              .trim()
              .split('\n')
              .filter(Boolean)
              .slice(-2000)
              .map((line) => JSON.parse(line))
          : [];
        return json(200, { events: lines });
      }
      if (req.method === 'GET' && url.pathname === '/api/sheets') {
        try {
          if (!provider.connected) throw new Error('Codex Disconnected');
          const live = await google.read();
          const snapshotPath = join(stateDir, 'master-snapshot.json');
          writeFileSync(
            snapshotPath + '.tmp',
            JSON.stringify({ ...live, status: 'snapshot' }, null, 2),
            { mode: 0o600 },
          );
          renameSync(snapshotPath + '.tmp', snapshotPath);
          return json(200, live);
        } catch (error) {
          const fallback = await readMaster({
            snapshotPath: join(stateDir, 'master-snapshot.json'),
          });
          return json(200, {
            ...fallback,
            reason: `Lettura tramite Codex non riuscita: ${error.message}. ${fallback.reason || ''}`,
          });
        }
      }
      if (req.method !== 'POST') return json(404, { error: 'Not found' });
      const data = await body(req);
      if (!provider.connected) return json(503, { error: 'Codex Disconnected' });
      if (url.pathname === '/api/google-status') {
        try {
          return json(200, await google.check());
        } catch (error) {
          return json(200, {
            state: 'Accesso Master non verificato',
            checkedAt: new Date().toISOString(),
            details: [error.message, 'Nessuna scrittura eseguita.'],
          });
        }
      }
      if (url.pathname === '/api/threads') return json(200, await createThread(data));
      if (url.pathname === '/api/team') {
        const teamId = randomBytes(16).toString('hex');
        const threads = [];
        try {
          for (const role of roles.slice(0, 3))
            threads.push(
              await createThread({
                model: data.model,
                sandbox: data.sandbox,
                role: role.id,
                teamId,
              }),
            );
        } catch (error) {
          return json(400, {
            error: error.message,
            createdThreadIds: threads.map((thread) => thread.id),
          });
        }
        return json(200, { teamId, threads });
      }
      if (url.pathname === '/api/resume') {
        const thread = threadFor(data.threadId);
        if (loaded.has(thread.id)) throw new Error('Sessione già collegata');
        // Only threads created by this bridge are eligible, never desktop chats.
        const result = await provider.request('thread/resume', {
          threadId: thread.id,
          model: thread.model,
          cwd: thread.cwd,
          sandbox: thread.sandbox,
          approvalPolicy: 'on-request',
          developerInstructions:
            officePolicy + (thread.role ? ` Ruolo assegnato: ${roleFor(thread.role).name}.` : ''),
        });
        loaded.add(thread.id);
        thread.hasHistory = Boolean(result.thread?.turns?.length) || thread.hasHistory;
        thread.status = 'idle';
        thread.activeTurn = null;
        thread.phase = null;
        save();
        return json(200, result);
      }
      if (url.pathname === '/api/turn')
        return json(200, await startTurn(threadFor(data.threadId), data));
      if (url.pathname === '/api/handoff') {
        const source = threadFor(data.fromThreadId);
        const target = threadFor(data.toThreadId);
        if (source.activeTurn || turnsStarting.has(source.id))
          throw new Error('Attendere il completamento del mittente');
        const history = await provider.request('thread/read', {
          threadId: source.id,
          includeTurns: true,
        });
        const turn = history.thread.turns?.at(-1);
        if (!turn) throw new Error('Nessun turno reale da trasferire');
        const text = handoffText(source, target, turn);
        if (
          target.handoffs?.some((row) => row.sourceId === source.id && row.sourceTurnId === turn.id)
        )
          throw new Error('Questo risultato è già stato trasferito a questa sessione');
        const result = await startTurn(target, { text, research: source.lastBrief });
        (target.handoffs ??= []).push({
          sourceId: source.id,
          sourceTurnId: turn.id,
          turnId: result.turn.id,
        });
        record({
          method: 'office/handoff',
          params: {
            threadId: target.id,
            fromThreadId: source.id,
            sourceTurnId: turn.id,
            turnId: result.turn.id,
          },
        });
        save();
        return json(200, { threadId: target.id, turnId: result.turn.id });
      }
      if (url.pathname === '/api/interrupt') {
        const thread = threadFor(data.threadId);
        if (!loaded.has(thread.id) || !thread.activeTurn) throw new Error('Nessun turno attivo');
        return json(
          200,
          await provider.request('turn/interrupt', {
            threadId: thread.id,
            turnId: thread.activeTurn,
          }),
        );
      }
      if (url.pathname === '/api/approval') {
        const request = approvals.get(String(data.id));
        if (!request) throw new Error('Richiesta scaduta o già risolta');
        let result;
        if (request.method === 'item/tool/requestUserInput') {
          const answers = {};
          for (const question of request.params.questions) {
            const answer = data.answers?.[question.id];
            if (typeof answer !== 'string' || !answer.trim() || answer.length > 8000)
              throw new Error('Risposta richiesta');
            answers[question.id] = { answers: [answer] };
          }
          result = { answers };
        } else {
          if (!['accept', 'decline', 'cancel'].includes(data.decision))
            throw new Error('Decisione non valida');
          result = { decision: data.decision };
        }
        provider.send({ id: request.id, result });
        approvals.delete(String(data.id));
        record({
          method: 'office/approvalResolved',
          params: { threadId: request.params.threadId, requestId: request.id, result },
        });
        return json(200, { ok: true });
      }
      return json(404, { error: 'Not found' });
    } catch (error) {
      json(400, { error: error.message });
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    await provider.close();
    throw error;
  }
  return {
    server,
    provider,
    token,
    port,
    close: async () => {
      await provider.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const office = await startOffice();
  console.log(
    `AI PM Lab Virtual Office: http://127.0.0.1:${office.port}\nPairing token (solo locale): ${office.token}`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      void office.close().then(() => process.exit(0));
    });
}
