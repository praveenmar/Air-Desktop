const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const externalDeps = ['vscode', 'playwright'];

async function build() {
  try {
    fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, 'dist', 'server'), { recursive: true });

    await esbuild.build({
      entryPoints: ['src/extension.ts'],
      bundle: true,
      outfile: 'dist/extension.js',
      external: externalDeps,
      platform: 'node',
      format: 'cjs',
      sourcemap: true,
    });
    console.log('[AIR-DEBUG] Extension built.');

    await esbuild.build({
      entryPoints: ['server-entry.ts'],
      bundle: true,
      outfile: 'dist/server/index.js',
      external: externalDeps,
      platform: 'node',
      format: 'cjs',
      sourcemap: true,
    });
    console.log('[AIR-DEBUG] Server built.');

    await esbuild.build({
      entryPoints: [path.join(__dirname, 'interceptor', 'selector-engine', 'index.js')],
      bundle: true,
      outfile: path.join(__dirname, 'dist', 'interceptor-selector-engine.js'),
      platform: 'browser',
      format: 'iife',
      target: ['chrome100'],
      sourcemap: false,
    });
    console.log('[AIR-DEBUG] Interceptor selector engine bundle built.');

    const interceptorCandidates = [
      path.join(__dirname, 'interceptor.js'),
      path.join(__dirname, '..', '..', 'interceptor', 'interceptor.js'),
      path.join(__dirname, '..', '..', 'interceptor.js'),
    ];

    let copied = false;
    for (const src of interceptorCandidates) {
      if (fs.existsSync(src) && src !== path.join(__dirname, 'interceptor.js')) {
        fs.copyFileSync(src, path.join(__dirname, 'interceptor.js'));
        console.log(`[AIR-DEBUG] Interceptor copied from: ${src}`);
        copied = true;
        break;
      }

      if (fs.existsSync(src)) {
        console.log(`[AIR-DEBUG] Interceptor shell already present at: ${src}`);
        copied = true;
        break;
      }
    }

    if (!copied) {
      console.warn('[AIR-DEBUG] Warning: interceptor.js not found - extension will fail at runtime.');
    }

    console.log('[AIR-DEBUG] Build success!');
  } catch (err) {
    console.error('[AIR-DEBUG] Build failed:', err);
    process.exit(1);
  }
}

build();
