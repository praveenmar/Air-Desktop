import esbuild from 'esbuild';
import { resolve } from 'path';

async function build() {
  try {
    await esbuild.build({
      entryPoints: ['src/index.ts', 'src/http.ts'],
      bundle: true,
      outdir: 'dist',
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: [
        '@modelcontextprotocol/sdk',
        'zod'
      ],
      sourcemap: true,
      minify: false,
    });
    console.log('[AIR MCP] Bundled successfully.');
  } catch (error) {
    console.error('[AIR MCP] Bundle failed:', error);
    process.exit(1);
  }
}

build();
