import { z } from 'zod';
import { AirMcpToolHandler } from '../server';
import { wrapWithPrivacy } from '../utils/privacy';
import { createDatabaseUnavailableError, createInvalidArgumentsError } from '../utils/errors';

const ListRecordedSessionsArgsSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  recentDays: z.number().optional(),
}).default({});

export const listRecordedSessionsTool: AirMcpToolHandler = {
  definition: {
    name: 'list_recorded_sessions',
    description: 'List available AIR recorded sessions by recording start time, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of sessions to return. Default 10, max 50.'
        },
        offset: {
          type: 'number',
          description: 'Number of sessions to skip. Default 0.'
        },
        recentDays: {
          type: 'number',
          description: 'Optional filter for sessions started in the last N days. Max 365.'
        }
      },
      additionalProperties: false
    }
  },
  handle: async (args, context) => {
    try {
      const parsedArgs = ListRecordedSessionsArgsSchema.parse(args || {});
      const service = context.getCodegenService();
      
      const result = service.listRecordedSessions(parsedArgs);
      const wrapped = wrapWithPrivacy(result);
      
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
      throw createDatabaseUnavailableError(
        error instanceof Error ? error.message : 'Unknown database error'
      );
    }
  }
};
