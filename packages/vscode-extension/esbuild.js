const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const externalDeps = ['vscode', 'better-sqlite3', 'playwright'];

async function build() {
  try {
    // Ensure dist directories exist
    fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, 'dist', 'server'), { recursive: true });

    // 1. Build VS Code Extension Host
    // 1. Build VS Code Extension Host
    await esbuild.build({
      entryPoints: ['src/extension.ts'], // Update this from 'extension.ts' to 'src/extension.ts'
      bundle: true,
      outfile: 'dist/extension.js',
      external: externalDeps,
      platform: 'node',
      format: 'cjs',
      sourcemap: true,
    });
    console.log('[AIR-DEBUG] Extension built.');

    // 2. Build Background Node Server
    await esbuild.build({
      entryPoints: ['server-entry.ts'], // This stays the same as it is in the root
      bundle: true,
      outfile: 'dist/server/index.js',
      external: externalDeps,
      platform: 'node',
      format: 'cjs',
      sourcemap: true,
    });
    console.log('[AIR-DEBUG] Server built.');

    // 3. Copy Interceptor — check multiple candidate locations
    const interceptorCandidates = [
      path.join(__dirname, 'interceptor.js'),                     // already here
      path.join(__dirname, '..', '..', 'interceptor', 'interceptor.js'), // mono-repo root
      path.join(__dirname, '..', '..', 'interceptor.js'),
    ];

    let copied = false;
    for (const src of interceptorCandidates) {
      if (fs.existsSync(src) && src !== path.join(__dirname, 'interceptor.js')) {
        fs.copyFileSync(src, path.join(__dirname, 'interceptor.js'));
        console.log(`[AIR-DEBUG] Interceptor copied from: ${src}`);
        copied = true;
        break;
      } else if (fs.existsSync(src)) {
        console.log(`[AIR-DEBUG] Interceptor already present at: ${src}`);
        copied = true;
        break;
      }
    }

    if (!copied) {
      console.warn('[AIR-DEBUG] Warning: interceptor.js not found — extension will fail at runtime.');
    }

    console.log('[AIR-DEBUG] Build success!');
  } catch (err) {
    console.error('[AIR-DEBUG] Build failed:', err);
    process.exit(1);
  }
}

build();