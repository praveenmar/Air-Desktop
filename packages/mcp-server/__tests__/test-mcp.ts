import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  console.log('Starting MCP client...');
  
  // Connect to the compiled server
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['packages/mcp-server/dist/index.js']
  });

  const client = new Client({
    name: 'air-tester',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  console.log('✅ Connected to MCP Server via stdio');

  console.log('\n--- 1. Calling list_recorded_sessions ---');
  const listResult = await client.callTool({
    name: 'list_recorded_sessions',
    arguments: { limit: 1 }
  });
  
  if (!listResult || !listResult.content || listResult.content.length === 0) {
    console.error('Failed to list sessions');
    process.exit(1);
  }

  const listData = JSON.parse(listResult.content[0].text);
  console.log(JSON.stringify(listData, null, 2));

  if (!listData.data.sessions || listData.data.sessions.length === 0) {
    console.error('No sessions found in DB.');
    process.exit(0);
  }

  const sessionId = listData.data.sessions[0].sessionId;
  console.log(`\nPicked Session ID: ${sessionId}`);

  console.log('\n--- 2. Calling get_session_flow_review ---');
  const reviewResult = await client.callTool({
    name: 'get_session_flow_review',
    arguments: { sessionId, format: 'json' }
  });
  console.log('Review Result (truncated):', reviewResult.content[0].text.substring(0, 300) + '...');

  console.log('\n--- 3. Calling get_session_generation_context ---');
  const genContextResult = await client.callTool({
    name: 'get_session_generation_context',
    arguments: { sessionId, limit: 2 }
  });
  
  const genData = JSON.parse(genContextResult.content[0].text);
  console.log(`Schema: ${genData.data.schemaVersion}`);
  console.log(`Total Steps: ${genData.data.totalSteps}`);
  console.log(`Returned Steps: ${genData.data.steps.length}`);
  console.log(`Summary:`, genData.data.summary);

  console.log('\n✅ All tests passed. LLM receives usable context.');
  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
