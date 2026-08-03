import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  console.log('Starting AIR MCP Client Test...');
  
  // Use tsx to bypass all the broken 'dist' linking in the workspace
  const transport = new StdioClientTransport({
    command: 'npx',
    args: [
      'tsx',
      'packages/mcp-server/src/index.ts',
      '--db',
      'C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db'
    ],
  });

  const client = new Client({
    name: 'air-tester',
    version: '1.0.0'
  }, { capabilities: {} });

  await client.connect(transport);
  console.log('✅ Connected to MCP Server over STDIO!\n');

  console.log('--- 1. Calling list_recorded_sessions ---');
  const listResult = await client.callTool({
    name: 'list_recorded_sessions',
    arguments: { limit: 1 }
  });
  
  const listData = JSON.parse(listResult.content[0].text);
  const sessionId = listData.data.sessions[0]?.sessionId;
  
  if (!sessionId) {
    console.error('❌ No sessions found in DB.');
    process.exit(1);
  }
  
  console.log(`✅ Picked Session ID: ${sessionId}\n`);

  console.log('--- 2. Calling get_session_generation_context ---');
  const genContextResult = await client.callTool({
    name: 'get_session_generation_context',
    arguments: { sessionId, limit: 2 }
  });
  
  const genData = JSON.parse(genContextResult.content[0].text);
  console.log(`✅ Schema: ${genData.data.schemaVersion}`);
  console.log(`✅ Total Steps: ${genData.data.totalSteps}`);
  console.log(`✅ Summary:`, genData.data.summary);

  console.log('\n🎉 All tests passed. The LLM boundary is perfectly healthy.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
