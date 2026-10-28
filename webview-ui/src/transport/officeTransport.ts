import type { ClientMessage, ServerMessage } from '../../../core/src/messages';
import { getSnapshot, subscribe } from '../command/client';
import { dispatchOfficeAssets } from '../officeAssets';
import type { MessageTransport, TransportState } from './types';

export class OfficeTransport implements MessageTransport {
  private handlers = new Set<(message: ServerMessage) => void>();
  private stateHandlers = new Set<(state: TransportState) => void>();
  private ids = new Map<string, number>();
  private visible = new Set<string>();
  private activity = new Map<string, string>();
  private nextId = 1;
  private lastCursor = 0;
  private bootId?: string;
  private unsubscribe = subscribe(() => this.sync());
  readonly ready = Promise.resolve();
  state: TransportState = 'disconnected';
  emit(message: ServerMessage) {
    this.handlers.forEach((handler) => handler(message));
  }
  idFor(threadId: string) {
    if (!this.ids.has(threadId)) this.ids.set(threadId, this.nextId++);
    return this.ids.get(threadId)!;
  }
  private sync() {
    const state = getSnapshot();
    const nextState = state.connected ? 'connected' : 'disconnected';
    if (this.state !== nextState) {
      this.state = nextState;
      this.stateHandlers.forEach((handler) => handler(this.state));
    }
    const live = state.connected ? state.threads.filter((thread) => thread.loaded) : [];
    const visible = new Set(live.map((thread) => thread.id));
    for (const id of this.visible) {
      if (!visible.has(id)) {
        this.activity.delete(id);
        this.emit({ type: 'agentClosed', id: this.idFor(id) });
      }
    }
    for (const thread of live) {
      const id = this.idFor(thread.id);
      if (!this.visible.has(thread.id))
        this.emit({ type: 'agentCreated', id, directoryName: 'Codex ' + thread.id.slice(0, 8) });
    }
    if (this.bootId !== state.bootId) {
      this.bootId = state.bootId;
      this.lastCursor = 0;
    }
    const started = new Set<string>();
    for (const event of state.events.filter((event) => event.seq > this.lastCursor)) {
      const threadId = String(event.params.threadId || '');
      if (!visible.has(threadId)) continue;
      const id = this.idFor(threadId);
      const item = event.params.item as
        | {
            id: string;
            type: string;
            command?: string;
            tool?: string;
            commandActions?: Array<{ type: string }>;
          }
        | undefined;
      if (
        item &&
        event.method === 'item/started' &&
        ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'dynamicToolCall'].includes(
          item.type,
        )
      ) {
        const reading = item.commandActions?.some((action) => action.type === 'read');
        started.add(threadId);
        this.emit({
          type: 'agentToolStart',
          id,
          toolId: item.id,
          status: item.command || item.tool || item.type,
          toolName: reading ? 'Read' : item.type,
        });
      }
      if (item && event.method === 'item/completed')
        this.emit({ type: 'agentToolDone', id, toolId: item.id });
    }
    // Apply current status after item replay: a short turn can start and finish
    // within one polling interval. Historical tools must not restart typing.
    for (const thread of live) {
      const id = this.idFor(thread.id);
      const waiting = state.approvals.some((request) => request.params.threadId === thread.id);
      const status = thread.status === 'inProgress' && !waiting ? 'active' : 'waiting';
      const signature = `${status}:${waiting}`;
      if (
        this.activity.get(thread.id) !== signature ||
        (started.has(thread.id) && status === 'waiting')
      ) {
        this.emit({ type: 'agentStatus', id, status, awaitingInput: false });
        this.emit({ type: waiting ? 'agentToolPermission' : 'agentToolPermissionClear', id });
        this.activity.set(thread.id, signature);
        if (thread.status !== 'inProgress') this.emit({ type: 'agentToolsClear', id });
      }
    }
    this.lastCursor = state.cursor;
    this.visible = visible;
  }
  send(message: ClientMessage) {
    if (message.type === 'webviewReady') {
      queueMicrotask(() => {
        dispatchOfficeAssets((value) => this.emit(value as ServerMessage));
        this.emit({ type: 'providerCapabilities', readingTools: ['Read'], subagentToolNames: [] });
        this.emit({
          type: 'terminalAvailability',
          available: false,
          reason: 'Usa la chat Codex del Command Center.',
        });
        this.visible.clear();
        this.activity.clear();
        this.sync();
      });
    } else if (message.type === 'saveLayout') {
      localStorage.setItem('ai-pm-office-layout', JSON.stringify(message.layout));
    } else if (message.type === 'focusAgent') {
      const threadId = [...this.ids].find(([, id]) => id === message.id)?.[0];
      window.dispatchEvent(new CustomEvent('office-select-thread', { detail: threadId }));
    }
  }
  onMessage(handler: (message: ServerMessage) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
  onStateChange(handler: (state: TransportState) => void) {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }
  dispose() {
    this.unsubscribe();
    this.handlers.clear();
    this.stateHandlers.clear();
  }
}
