import { isBrowserRuntime } from '../runtime';
import { OfficeTransport } from './officeTransport';
import { PostMessageTransport } from './postMessageTransport';
import type { MessageTransport } from './types';
export const transport: MessageTransport = isBrowserRuntime
  ? new OfficeTransport()
  : new PostMessageTransport();
export type { MessageTransport } from './types';
