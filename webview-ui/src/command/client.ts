export interface OfficeEvent {
  seq: number;
  at: string;
  method: string;
  params: Record<string, unknown>;
  id?: string | number;
}
export interface OfficeThread {
  id: string;
  createdAt: string;
  loaded: boolean;
  status: string;
  activeTurn?: string | null;
  sandbox: string;
  phase?: { name: string; evidence: string; itemId: string } | null;
}
export interface OfficeSkill {
  name: string;
  path?: string;
  description?: string;
  unavailable?: boolean;
}
export interface Approval {
  id: string | number;
  method: string;
  params: {
    threadId: string;
    command?: string;
    reason?: string;
    questions?: Array<{
      id: string;
      question: string;
      options?: Array<{ label: string; description: string }>;
    }>;
  };
}
export interface OfficeSnapshot {
  connected: boolean;
  error?: string | null;
  cwd?: string;
  bootId?: string;
  cursor: number;
  threads: OfficeThread[];
  skills: OfficeSkill[];
  models?: Array<{ model: string; displayName: string; isDefault: boolean }>;
  approvals: Approval[];
  events: OfficeEvent[];
}
const listeners = new Set<() => void>();
let snapshot: OfficeSnapshot = {
  connected: false,
  cursor: 0,
  threads: [],
  skills: [],
  approvals: [],
  events: [],
};
let secret = '';
let running = false;
let generation = 0;
const endpoint = 'http://127.0.0.1:4318';
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getSnapshot = () => snapshot;
function publish(next: OfficeSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(endpoint + '/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(path.startsWith('state?') ? 5000 : 35000),
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value as T;
}
export function disconnect() {
  running = false;
  generation++;
  secret = '';
  publish({
    ...snapshot,
    connected: false,
    approvals: [],
    threads: snapshot.threads.map((thread) => ({
      ...thread,
      loaded: false,
      status: 'offline',
      phase: null,
    })),
  });
}
export async function connect(token: string) {
  if (running) disconnect();
  secret = token.trim();
  running = true;
  const current = ++generation;
  async function poll() {
    try {
      const result = await api<OfficeSnapshot>(
        'state?after=' + snapshot.cursor + '&bootId=' + (snapshot.bootId || ''),
      );
      if (current !== generation) return;
      const reset = result.bootId !== snapshot.bootId;
      publish({
        ...result,
        events: [...(reset ? [] : snapshot.events), ...result.events].slice(-1000),
      });
    } catch (error) {
      if (current !== generation) return;
      publish({
        ...snapshot,
        connected: false,
        error: error instanceof Error ? error.message : 'Disconnected',
        approvals: [],
        threads: snapshot.threads.map((thread) => ({
          ...thread,
          loaded: false,
          status: 'offline',
          phase: null,
        })),
      });
    }
    if (running && current === generation)
      setTimeout(() => {
        void poll();
      }, 800);
  }
  await poll();
}
