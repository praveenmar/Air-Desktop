const fs = require('fs');

// 1. Update codegen.service.ts
let servicePath = 'packages/codegen/src/codegen.service.ts';
let code = fs.readFileSync(servicePath, 'utf8');

// Add import
if (!code.includes('SelectorResolutionSchema')) {
  code = code.replace(
    /import \{ openSqliteReadonlyDatabase, SqliteDatabase \} from '.\/sqlite-client';/,
    "import { openSqliteReadonlyDatabase, SqliteDatabase } from './sqlite-client';\nimport { SelectorResolutionSchema } from '../../core/types/events';"
  );
}

// Replace the parsing block and fallbackHints typing
const oldParseBlock = `
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
`;

const newParseBlock = `
    for (const row of rows) {
      let selectorResolution;
      try {
        if (row.selectorResolution) {
          const parsed = JSON.parse(row.selectorResolution);
          const validation = SelectorResolutionSchema.safeParse(parsed);
          if (validation.success) {
            selectorResolution = validation.data;
          }
        }
      } catch (e) {
        // Silently ignore invalid JSON per requirements
      }

      const metadata: GenerationEventMetadata = { id: row.id };
      if (selectorResolution) {
        metadata.selectorResolution = selectorResolution;
      }

      const fallbackHints: GenerationEventMetadata['fallbackHints'] = {};
      if (row.legacySelector) fallbackHints.legacySelector = row.legacySelector;
      if (row.elementText) fallbackHints.elementText = row.elementText;
      if (row.tagName) fallbackHints.tagName = row.tagName;
`;

code = code.replace(oldParseBlock.trim(), newParseBlock.trim());
fs.writeFileSync(servicePath, code);

// 2. Update phase3b-metadata.spec.ts
let testPath = 'core/__tests__/phase3b-metadata.spec.ts';
let testCode = fs.readFileSync(testPath, 'utf8');

if (!testCode.includes('Test 4: Event with invalid engine schema in selectorResolution')) {
  // Add test insert
  const oldInserts = `
    const insert = asyncDb.prepare('INSERT INTO events (id, type, timestamp, session_id, payload) VALUES (?, ?, ?, ?, ?)');
    await insert.run('event-1', 'click', 1000, 'session-1', JSON.stringify(event1));
    await insert.run('event-2', 'input', 1001, 'session-1', JSON.stringify(event2));
    await insert.run('event-3', 'scroll', 1002, 'session-1', event3Payload);
`;

  const newInserts = `
    // Insert Test 4: Event with invalid engine schema in selectorResolution
    const event4 = {
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
        selected: {
          selector: '.btn',
          engine: 'text', // Invalid engine according to Phase 1 spec (only css or xpath)
          replaySafe: true
        }
      },
      fingerprint: {
        selector: '.btn'
      }
    };

    const insert = asyncDb.prepare('INSERT INTO events (id, type, timestamp, session_id, payload) VALUES (?, ?, ?, ?, ?)');
    await insert.run('event-1', 'click', 1000, 'session-1', JSON.stringify(event1));
    await insert.run('event-2', 'input', 1001, 'session-1', JSON.stringify(event2));
    await insert.run('event-3', 'scroll', 1002, 'session-1', event3Payload);
    await insert.run('event-4', 'click', 1003, 'session-1', JSON.stringify(event4));
`;
  testCode = testCode.replace(oldInserts.trim(), newInserts.trim());

  // Add the test case
  const testCase = `
  it('selectorResolution object with invalid engine "text" should be ignored', () => {
    const result = service.getGenerationEventMetadataByIds(['event-4']);
    const meta = result.get('event-4');
    
    expect(meta).toBeDefined();
    expect(meta?.selectorResolution).toBeUndefined(); // Schema validation should fail and omit it
    expect(meta?.fallbackHints?.legacySelector).toBe('.btn');
  });
});
`;
  testCode = testCode.replace(/}\);\n}\);\n*$/, testCase.trim() + '\n');
  fs.writeFileSync(testPath, testCode);
}
console.log("Updated files successfully.");
