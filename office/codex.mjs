import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

export class CodexProvider extends EventEmitter {
  pending = new Map();
  sequence = 0;
  connected = false;
  constructor({ cwd, executable = process.env.CODEX_BIN || 'codex', enableApps = true }) {
    super();
    this.process = spawn(
      executable,
      ['app-server', '--listen', 'stdio://', ...(enableApps ? ['--enable', 'apps'] : [])],
      {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.method) this.emit('event', message);
      else {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      }
    });
    // Drain stderr; never forward config, tokens, or unrelated diagnostics.
    this.process.stderr.on('data', () => {});
    const disconnected = () => {
      this.connected = false;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Codex Disconnected'));
      }
      this.pending.clear();
      this.emit('disconnected');
    };
    this.process.on('error', disconnected);
    this.process.on('exit', disconnected);
    this.process.stdin.on('error', () => {});
  }
  send(message) {
    if (!this.process.stdin.writable || this.process.exitCode !== null)
      throw new Error('Codex Disconnected');
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async initialize({ experimentalApi = false } = {}) {
    const result = await this.request('initialize', {
      clientInfo: {
        name: 'ai_pm_lab_virtual_office',
        title: 'AI PM Lab Virtual Office',
        version: '1.0.0',
      },
      ...(experimentalApi ? { capabilities: { experimentalApi: true } } : {}),
    });
    this.send({ method: 'initialized', params: {} });
    this.connected = true;
    return result;
  }
  async close() {
    this.connected = false;
    this.process.stdin.end();
    if (this.process.exitCode === null && this.process.pid) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.process.kill();
          resolve();
        }, 2000);
        this.process.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    // A configured MCP descendant can retain inherited pipes on Windows.
    // Close only our transport handles; never kill other Codex processes.
    this.process.stdout.destroy();
    this.process.stderr.destroy();
    this.process.stdin.destroy();
  }
}
