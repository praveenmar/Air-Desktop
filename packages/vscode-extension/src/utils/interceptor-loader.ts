/**
 * Placeholder: shared interceptor loader utility.
 *
 * When you paste implementation from the Implementation doc, ensure production builds
 * read the interceptor from `process.resourcesPath` and dev uses the project-relative path.
 * On Electron use `app.isPackaged` to switch paths. In non-Electron runtimes, consider
 * using `process.env.AIR_INTERCEPTOR_PATH` to override.
 */

import path from 'path';
import fs from 'fs';

export interface InterceptorAssetPaths {
  shellPath: string;
  selectorEnginePath: string | null;
}

export function resolveGeneratedSelectorEnginePath(extensionRoot: string): string | null {
  const envPath = process.env.AIR_SELECTOR_ENGINE_PATH;
  const candidates = [
    envPath,
    path.join(extensionRoot, 'dist', 'interceptor-selector-engine.js'),
    path.join(extensionRoot, 'interceptor-selector-engine.js'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveInterceptorPath(extensionRoot: string): string {
  const envPath = process.env.AIR_INTERCEPTOR_PATH;
  const candidates = [
    envPath,
    path.join(extensionRoot, 'interceptor.js'),
    path.join(extensionRoot, '..', 'interceptor.js'),
    path.join(extensionRoot, '..', '..', 'interceptor', 'interceptor.js'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`interceptor.js not found. Checked: ${candidates.join(', ')}`);
}

export function resolveInterceptorAssetPaths(extensionRoot: string): InterceptorAssetPaths {
  return {
    shellPath: resolveInterceptorPath(extensionRoot),
    selectorEnginePath: resolveGeneratedSelectorEnginePath(extensionRoot),
  };
}

export function readInterceptorCode(extensionRoot: string): string {
  const p = resolveInterceptorPath(extensionRoot);
  return fs.readFileSync(p, 'utf-8');
}
