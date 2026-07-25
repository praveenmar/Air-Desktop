import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  SELECTOR_RANK_MAP,
  escapeCssString,
  extractText,
  findStableClass,
  generateOptimalSelector,
  generateXPath,
  rankForPriority,
} from '../src/selectors';

type SelectorResult = {
  selector: string;
  priority: string;
  rank: number;
};

// const events = window._airInterceptor.eventQueue;
// events.forEach(e => {
//   if (e.pageUrl && e.normalizedUrl) {
//     const expected = new URL(e.pageUrl).origin + new URL(e.pageUrl).pathname;
//     console.assert(e.normalizedUrl === expected, `Mismatch: ${e.pageUrl} → ${e.normalizedUrl} vs ${expected}`);
//   }
// });

type InterceptorEvalAPI = {
  generateOptimalSelector?: (element: Element) => SelectorResult;
  config?: { maxTextLength?: number };
};

type SharedEvalAPI = {
  generateOptimalSelector?: (
    element: Element,
    options?: { maxTextLength?: number }
  ) => SelectorResult;
};

const interceptorPath = path.resolve(
  __dirname,
  "../../../interceptor/interceptor.js"
);

const interceptorCode = fs.readFileSync(interceptorPath, "utf-8");

const interceptorInitScript = `
window.__AIR_CONFIG__ = { strictMode: true };
${interceptorCode}
`;

const sharedSelectorsInitScript = `
window.AIRSharedSelectors = (() => {
  const SELECTOR_RANK_MAP = ${JSON.stringify(SELECTOR_RANK_MAP)};
  const escapeCssString = ${escapeCssString.toString()};
  const safeCssEscape =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape
      : (str) => str.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  const rankForPriority = ${rankForPriority.toString()};
  const extractText = ${extractText.toString()};
  const findStableClass = ${findStableClass.toString()};
  const generateXPath = ${generateXPath.toString()};
  const generateOptimalSelector = ${generateOptimalSelector.toString()};
  return {
    SELECTOR_RANK_MAP,
    escapeCssString,
    rankForPriority,
    extractText,
    findStableClass,
    generateXPath,
    generateOptimalSelector,
  };
})();
`;

const selectorProbeTypes = [
  {
    type: "button",
    query: 'button, [role="button"], input[type="submit"], input[type="button"]',
  },
  {
    type: "input",
    query: 'input:not([type="hidden"]), textarea, select',
  },
  {
    type: "link",
    query: "a[href]",
  },
  {
    type: "form",
    query: "form",
  },
  {
    type: "heading",
    query: "h1, h2, h3",
  },
] as const;

test.describe("Selector consistency between interceptor and shared utilities", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  const testUrls = [
    "https://opensource-demo.orangehrmlive.com/web/index.php/auth/login",
    "https://www.flipkart.com/",
    "https://github.com/",
  ];

  for (const url of testUrls) {
    test(`selector output matches on ${url}`, async ({ page }) => {
      await page.addInitScript({ content: interceptorInitScript });
      await page.addInitScript({ content: sharedSelectorsInitScript });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      try {
        await page.waitForLoadState("networkidle", { timeout: 15_000 });
      } catch {
        // Some real-world sites keep background network activity alive indefinitely.
        // Continue with DOM-contentloaded state to keep parity checks deterministic.
      }

      const comparisons = await page.evaluate((probes) => {
        const win = window as unknown as {
          _airInterceptor?: InterceptorEvalAPI;
          AIRSharedSelectors?: SharedEvalAPI;
        };

        const interceptor = win._airInterceptor;
        const shared = win.AIRSharedSelectors;
        if (
          !interceptor ||
          typeof interceptor.generateOptimalSelector !== "function"
        ) {
          throw new Error(
            "window._airInterceptor.generateOptimalSelector is unavailable"
          );
        }
        if (!shared || typeof shared.generateOptimalSelector !== "function") {
          throw new Error(
            "window.AIRSharedSelectors.generateOptimalSelector is unavailable"
          );
        }

        const fallbackMaxTextLength = 50;
        const maxTextLength =
          typeof interceptor.config?.maxTextLength === "number"
            ? interceptor.config.maxTextLength
            : fallbackMaxTextLength;

        if (!interceptor.config) {
          interceptor.config = { maxTextLength };
        } else if (typeof interceptor.config.maxTextLength !== "number") {
          interceptor.config.maxTextLength = maxTextLength;
        }
        const maxComparisonsPerUrl = 25;

        const out = [];
        for (const probe of probes) {
          const elements = Array.from(document.querySelectorAll(probe.query)).slice(0, 5);
          for (const element of elements) {
            const interceptorResult = interceptor.generateOptimalSelector.call(
              interceptor,
              element
            );
            const sharedResult = shared.generateOptimalSelector(element, {
              maxTextLength,
            });

            out.push({
              type: probe.type,
              tag: element.tagName,
              preview: (element.textContent || "").trim().slice(0, 80),
              interceptorResult,
              sharedResult,
            });

            if (out.length >= maxComparisonsPerUrl) break;
          }
          if (out.length >= maxComparisonsPerUrl) break;
        }

        return out;
      }, selectorProbeTypes);

      expect(
        comparisons.length,
        `No probe elements found on ${url}`
      ).toBeGreaterThan(0);

      const comparedTypes = new Set(comparisons.map((c) => c.type));
      expect(
        comparedTypes.size,
        `Too few element categories compared on ${url} (types=${[
          ...comparedTypes,
        ].join(", ")})`
      ).toBeGreaterThanOrEqual(3);

      const diffs = comparisons
        .filter((item) => {
          return (
            item.interceptorResult.selector !== item.sharedResult.selector ||
            item.interceptorResult.priority !== item.sharedResult.priority ||
            item.interceptorResult.rank !== item.sharedResult.rank
          );
        })
        .map((item) => {
          return [
            `type=${item.type} tag=${item.tag} preview="${item.preview}"`,
            `interceptor=${JSON.stringify(item.interceptorResult)}`,
            `shared=${JSON.stringify(item.sharedResult)}`,
          ].join("\n");
        });

      expect(
        diffs,
        [
          `Selector mismatch on ${url}`,
          `Compared probes: ${comparisons.length}`,
          ...diffs,
        ].join("\n")
      ).toEqual([]);
    });
  }
});
