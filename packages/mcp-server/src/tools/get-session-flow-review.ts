import { z } from 'zod';
import { AirMcpToolHandler } from '../server';
import { wrapWithPrivacy } from '../utils/privacy';
import {
  createDatabaseUnavailableError,
  createInvalidArgumentsError,
  createSessionNotFoundError,
} from '../utils/errors';

const GetSessionFlowReviewArgsSchema = z.object({
  sessionId: z.string().min(1),
});

function getSessionIdFromArgs(args: unknown): string {
  if (
    args &&
    typeof args === 'object' &&
    'sessionId' in args &&
    typeof (args as { sessionId?: unknown }).sessionId === 'string'
  ) {
    return (args as { sessionId: string }).sessionId;
  }
  return 'unknown';
}

export const getSessionFlowReviewTool: AirMcpToolHandler = {
  definition: {
    name: 'get_session_flow_review',
    description: 'Return a human-readable AIR FlowReview for a recorded session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The AIR recorded session ID to review.',
        },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  handle: async (args, context) => {
    try {
      const parsedArgs = GetSessionFlowReviewArgsSchema.parse(args || {});
      const markdown = context
        .getCodegenService()
        .getFlowReviewMarkdown(parsedArgs.sessionId);

      const wrapped = wrapWithPrivacy({ markdown });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(wrapped, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw createInvalidArgumentsError(error.message);
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('Session not found')) {
        throw createSessionNotFoundError(getSessionIdFromArgs(args));
      }
      
      throw createDatabaseUnavailableError(
        error instanceof Error ? error.message : 'Unknown database error'
      );
    }
  },
};
