import { CodegenService } from '@air/codegen';
import { McpServerConfig } from './config';

/**
 * Context holds shared services so tools don't instantiate them repeatedly.
 */
export interface McpContext {
  codegenService: CodegenService;
  config: McpServerConfig;
}

export function createContext(config: McpServerConfig): McpContext {
  // Pass the configured DB path down to the CodegenService.
  // It handles opening it natively in query_only mode.
  const codegenService = new CodegenService({ dbPath: config.dbPath });
  
  return {
    codegenService,
    config
  };
}
