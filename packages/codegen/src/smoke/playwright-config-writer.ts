import * as fs from 'fs';
import * as path from 'path';

export interface ControlledPlaywrightConfig {
  configPath: string;
  rawResultPath: string;
  runDir: string;
  outputDir: string;
}

export function writeControlledPlaywrightConfig(params: {
  runId: string;
  runRoot?: string;
  specFile: string;
  reporterFile: string;
  cwd?: string;
}): ControlledPlaywrightConfig {
  const cwd = params.cwd ? path.resolve(params.cwd) : process.cwd();
  const runDir = path.resolve(params.runRoot ?? path.join(cwd, '.air', 'smoke', params.runId));
  const outputDir = path.join(runDir, 'artifacts');
  const rawResultPath = path.join(runDir, 'raw-playwright-result.json');
  const configPath = path.join(runDir, 'playwright.smoke.config.cjs');
  const specFile = path.resolve(params.specFile);
  const reporterFile = path.resolve(params.reporterFile);

  fs.mkdirSync(runDir, { recursive: true });

  const configContents = [
    `const { defineConfig } = require('@playwright/test');`,
    ``,
    `module.exports = defineConfig({`,
    `  testDir: ${JSON.stringify(path.dirname(specFile))},`,
    `  testMatch: [${JSON.stringify(path.basename(specFile))}],`,
    `  fullyParallel: false,`,
    `  workers: 1,`,
    `  retries: 0,`,
    `  reporter: [[${JSON.stringify(reporterFile)}, { outputFile: ${JSON.stringify(rawResultPath)}, outputDir: ${JSON.stringify(outputDir)} }]],`,
    `  outputDir: ${JSON.stringify(outputDir)},`,
    `  use: {`,
    `    headless: true,`,
    `    actionTimeout: 5000,`,
    `    navigationTimeout: 10000,`,
    `    trace: 'retain-on-failure',`,
    `    screenshot: 'only-on-failure',`,
    `    video: 'off',`,
    `  },`,
    `});`,
    ``,
  ].join('\n');

  fs.writeFileSync(configPath, configContents, 'utf8');

  return {
    configPath,
    rawResultPath,
    runDir,
    outputDir,
  };
}
