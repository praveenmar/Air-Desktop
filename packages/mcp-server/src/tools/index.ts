import type { AirMcpToolHandler } from '../server';
import { listRecordedSessionsTool } from './list-recorded-sessions';
import { getSessionFlowReviewTool } from './get-session-flow-review';
import { getSessionGenerationContextTool } from './get-session-generation-context';

export function getToolHandlers(): AirMcpToolHandler[] {
  return [
    listRecordedSessionsTool,
    getSessionFlowReviewTool,
    getSessionGenerationContextTool,
  ];
}
