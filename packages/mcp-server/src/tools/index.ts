import type { AirMcpToolHandler } from '../server';
import { listRecordedSessionsTool } from './list-recorded-sessions';
import { getSessionFlowReviewTool } from './get-session-flow-review';

export function getToolHandlers(): AirMcpToolHandler[] {
  return [
    listRecordedSessionsTool,
    getSessionFlowReviewTool,
  ];
}
