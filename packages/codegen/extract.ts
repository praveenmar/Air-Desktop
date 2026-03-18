import { CodegenService } from './src/codegen.service';
import * as path from 'path';
import * as os from 'os';

async function extract() {
  // Point to your exact AIR database
  const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'air-desktop', 'air-data.db');
  
  const service = new CodegenService({ dbPath });
  const targetSessionId = '8e95ad35-1dc0-4754-ba55-20109842aaac';

  try {
    console.log(`🎯 Extracting AIR Timeline for: ${targetSessionId}...\n`);
    
    const timeline = service.buildSession(targetSessionId);
    
    // Print the pure JSON payload ready for the AI
    console.log(JSON.stringify(timeline, null, 2));
    
  } catch (error) {
    console.error('❌ Failed to extract session:', error);
  } finally {
    service.close();
  }
}

extract();