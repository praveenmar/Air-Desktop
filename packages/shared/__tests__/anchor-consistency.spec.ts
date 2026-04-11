import { test, expect } from '@playwright/test';
import { scanPageAnchors as reporterScan } from '../../reporter/src/capture/anchors';
import fs from 'fs';
import path from 'path';

declare global {
  interface Window {
    _airInterceptor?: {
      scanPageAnchors?: () => string[];
    };
  }
}

const interceptorPath = path.resolve(__dirname, '../../../interceptor/interceptor.js');
const interceptorCode = fs.readFileSync(interceptorPath, 'utf-8');

const interceptorInitScript = `
window.__AIR_CONFIG__ = { strictMode: true };
${interceptorCode}
`;

function firstDifferences(left: string[], right: string[], max = 20): string[] {
  const diffs: string[] = [];
  const maxLen = Math.max(left.length, right.length);
  for (let i = 0; i < maxLen && diffs.length < max; i++) {
    if (left[i] !== right[i]) {
      diffs.push(`idx ${i}: reporter="${left[i] ?? '<missing>'}" interceptor="${right[i] ?? '<missing>'}"`);
    }
  }
  return diffs;
}

test.describe('Anchor consistency between interceptor and reporter', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  const testUrls = [
    'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login',
    'https://www.flipkart.com/',
    'https://github.com/',
  ];

  for (const url of testUrls) {
    test(`anchors match on ${url}`, async ({ page }) => {
      console.log(`Testing anchor consistency on ${url}...`);

      await page.addInitScript({ content: interceptorInitScript });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle');

      const interceptorAnchors = await page.evaluate(() => {
        const instance = window._airInterceptor;
        if (!instance || typeof instance.scanPageAnchors !== 'function') {
          throw new Error('window._airInterceptor.scanPageAnchors is unavailable');
        }
        return instance.scanPageAnchors();
      });

      const reporterAnchors = await page.evaluate(reporterScan as () => string[]) as string[];

      const diffs = firstDifferences(reporterAnchors, interceptorAnchors, 20);
      expect(
        diffs,
        [
          `Anchor mismatch on ${url}`,
          `reporterCount=${reporterAnchors.length}, interceptorCount=${interceptorAnchors.length}`,
          ...diffs,
        ].join('\n')
      ).toEqual([]);

      console.log(`✅ Anchors match on ${url}`);
    });
  }
});

