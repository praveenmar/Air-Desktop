import { PlaywrightLocatorSpec } from './types';
/**
 * Compiles a full PlaywrightLocatorSpec chain into a Playwright locator expression.
 * Example: getByRole("dialog").getByRole("button", { name: "Close" })
 */
export declare function compilePlaywrightLocator(spec: PlaywrightLocatorSpec): string;
