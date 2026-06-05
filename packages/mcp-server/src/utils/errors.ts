import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export function createSessionNotFoundError(sessionId: string): McpError {
  return new McpError(
    ErrorCode.InvalidRequest,
    `Session not found: ${sessionId}`
  );
}

export function createDatabaseUnavailableError(message: string): McpError {
  return new McpError(
    ErrorCode.InternalError,
    `Database unavailable: ${message}`
  );
}
