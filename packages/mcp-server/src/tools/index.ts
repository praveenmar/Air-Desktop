import type { AirMcpToolHandler } from '../server';
import { listRecordedSessionsTool } from './list-recorded-sessions';

export function getToolHandlers(): AirMcpToolHandler[] {
  return [
    listRecordedSessionsTool,
  ];
}
