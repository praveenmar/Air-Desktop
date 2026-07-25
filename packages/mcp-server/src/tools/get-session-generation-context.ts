import { z } from 'zod';
import { AirMcpToolHandler } from '../server';
import { wrapWithPrivacy } from '../utils/privacy';
import {
  createDatabaseUnavailableError,
  createInvalidArgumentsError,
  createSessionNotFoundError,
} from '../utils/errors';

const GetSessionGenerationContextArgsSchema = z.object({
  sessionId: z.string().min(1),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

function normalizePagination(args: { offset?: number; limit?: number }) {
  const rawOffset = args.offset ?? 0;
  const offset = Math.max(Math.floor(rawOffset), 0);

  const rawLimit = args.limit ?? 25;
  const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 100);

  return { offset, limit };
}

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

export const getSessionGenerationContextTool: AirMcpToolHandler = {
  definition: {
    name: 'get_session_generation_context',
    description: 'Return a paginated machine-readable AIR GenerationContext for a recorded session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The AIR recorded session ID.',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset. Default 0.',
        },
        limit: {
          type: 'number',
          description: 'Pagination limit. Default 25, max 100.',
        },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  handle: async (args, context) => {
    try {
      const parsedArgs = GetSessionGenerationContextArgsSchema.parse(args || {});
      const { offset, limit } = normalizePagination(parsedArgs);

      const service = context.getCodegenService();
      const generationContext = service.buildGenerationContext(parsedArgs.sessionId);

      const totalSteps = generationContext.steps.length;
      const steps = generationContext.steps.slice(offset, offset + limit);
      const hasMore = offset + limit < totalSteps;

      const resolvedSteps = generationContext.steps.filter(s => s.locatorStatus === 'resolved').length;
      const unresolvedSteps = generationContext.steps.filter(s => s.locatorStatus === 'unresolved').length;
      const notApplicableSteps = generationContext.steps.filter(s => s.locatorStatus === 'not_applicable').length;
      const assertionCount = generationContext.steps.reduce((sum, step) => sum + (step.assertions?.length || 0), 0);
      const ignoredStepsCount = generationContext.ignoredSteps?.length ?? 0;

      const response = {
        schemaVersion: 'air:mcp-generation-context-response:v1' as const,
        generationContextSchemaVersion: generationContext.schemaVersion,
        sessionId: generationContext.sessionId,
        url: generationContext.url,
        recordedAt: generationContext.recordedAt,
        metadata: generationContext.metadata,

        totalSteps,
        offset,
        limit,
        hasMore,

        summary: {
          resolvedSteps,
          unresolvedSteps,
          notApplicableSteps,
          assertionCount,
          ignoredStepsCount,
        },

        steps,

        /**
         * Recorded steps not recommended for replay.
         * The LLM must NOT generate code from these unless explicitly requested.
         * Use for context, diagnostics, and fallback explanation only.
         */
        ignoredSteps: generationContext.ignoredSteps ?? [],

        /**
         * Typed generation rules for the IDE LLM.
         * Follow these rules in addition to any user-provided instructions.
         */
        generationGuidance: generationContext.generationGuidance,
      };


      const wrapped = wrapWithPrivacy(response);

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
