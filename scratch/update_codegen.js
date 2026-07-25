const fs = require('fs');

let code = fs.readFileSync('packages/codegen/src/codegen.service.ts', 'utf8');

// Insert import
code = code.replace(
  /SelectorSpec,\n} from '\.\/types';/, 
  "SelectorSpec,\n  GenerationEventMetadata,\n} from './types';"
);

// Append method
const methodCode = `
  /**
   * PHASE 3B: Lightweight Metadata Extraction
   * 
   * Fetches only the minimal metadata required to build the public GenerationContext
   * without loading the massive raw payload. Uses SQLite JSON functions to parse
   * only the specific fields needed (selectorResolution, fallback hints).
   */
  public getGenerationEventMetadataByIds(eventIds: string[]): Map<string, GenerationEventMetadata> {
    const result = new Map<string, GenerationEventMetadata>();
    if (!eventIds || eventIds.length === 0) return result;

    const uniqueIds = Array.from(new Set(eventIds));
    const placeholders = uniqueIds.map(() => '?').join(',');
    
    const query = \`
      SELECT
        id,
        json_extract(payload, '$.selectorResolution') as selectorResolution,
        json_extract(payload, '$.fingerprint.selector') as legacySelector,
        json_extract(payload, '$.fingerprint.textExcerpt') as elementText,
        json_extract(payload, '$.fingerprint.tagName') as tagName
      FROM events
      WHERE id IN (\${placeholders})
    \`;

    const rows = this.db.prepare(query).all(...uniqueIds) as any[];

    for (const row of rows) {
      let selectorResolution;
      try {
        if (row.selectorResolution) {
          selectorResolution = JSON.parse(row.selectorResolution);
        }
      } catch (e) {
      }

      const metadata: GenerationEventMetadata = { id: row.id };
      if (selectorResolution) {
        metadata.selectorResolution = selectorResolution;
      }

      const fallbackHints: any = {};
      if (row.legacySelector) fallbackHints.legacySelector = row.legacySelector;
      if (row.elementText) fallbackHints.elementText = row.elementText;
      if (row.tagName) fallbackHints.tagName = row.tagName;

      if (Object.keys(fallbackHints).length > 0) {
        metadata.fallbackHints = fallbackHints;
      }

      result.set(row.id, metadata);
    }
    
    return result;
  }
}
`;

code = code.replace(/}\s*$/, methodCode);

fs.writeFileSync('packages/codegen/src/codegen.service.ts', code);
console.log("Updated codegen.service.ts successfully.");
