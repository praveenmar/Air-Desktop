import { CodegenService } from '@air/codegen';
import { McpServerConfig } from './config';

/**
 * Context holds shared services so tools don't instantiate them repeatedly.
 */
export interface McpContext {
  config: McpServerConfig;
  getCodegenService(): CodegenService;
}

export function createContext(config: McpServerConfig): McpContext {
  let _codegenService: CodegenService | null = null;
  
  return {
    config,
    getCodegenService: () => {
      if (!_codegenService) {
        // Pass the configured DB path down to the CodegenService.
        // It handles opening it natively in query_only mode.
        _codegenService = new CodegenService({ dbPath: config.dbPath });
      }
      return _codegenService;
    }
  };
}
