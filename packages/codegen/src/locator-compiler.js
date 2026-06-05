"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compilePlaywrightLocator = compilePlaywrightLocator;
/**
 * Escapes a string for use in a Playwright locator expression.
 * Uses JSON.stringify to handle quotes and escape sequences safely.
 */
function escapeString(val) {
    return JSON.stringify(val);
}
/**
 * Compiles a RegexLiteralSpec into a JavaScript regex literal string.
 * Escapes forward slashes in the source and validates flags.
 */
function compileRegex(regex) {
    if (regex.flags && !/^[gimuy]*$/.test(regex.flags)) {
        throw new Error(`Invalid regex flags: ${regex.flags}`);
    }
    const escapedSource = regex.source.replace(/\//g, '\\/');
    return `/${escapedSource}/${regex.flags || ''}`;
}
/**
 * Compiles a value that can be either a string or a regex literal.
 */
function compileValue(val) {
    if (typeof val === 'string') {
        return escapeString(val);
    }
    return compileRegex(val);
}
/**
 * Compiles Playwright locator options into a stringified object literal.
 * Omit 'exact' if name or hasText is a regex.
 */
function compileOptions(options) {
    const parts = [];
    const nameIsRegex = typeof options.name === 'object' && options.name !== null;
    const hasTextIsRegex = typeof options.hasText === 'object' && options.hasText !== null;
    if (options.name !== undefined) {
        parts.push(`name: ${compileValue(options.name)}`);
    }
    // Regex + exact strips exact: exact only applies to string matches
    if (options.exact !== undefined && !nameIsRegex && !hasTextIsRegex) {
        parts.push(`exact: ${options.exact}`);
    }
    if (options.hasText !== undefined) {
        parts.push(`hasText: ${compileValue(options.hasText)}`);
    }
    if (parts.length === 0)
        return null;
    return `{ ${parts.join(', ')} }`;
}
/**
 * Compiles a single Playwright locator node into a method call string.
 * Example: getByRole("button", { name: "Submit" })
 */
function compileNode(node) {
    const args = [escapeString(node.value)];
    if (node.options) {
        const optionsStr = compileOptions(node.options);
        if (optionsStr) {
            args.push(optionsStr);
        }
    }
    return `${node.kind}(${args.join(', ')})`;
}
/**
 * Compiles a full PlaywrightLocatorSpec chain into a Playwright locator expression.
 * Example: getByRole("dialog").getByRole("button", { name: "Close" })
 */
function compilePlaywrightLocator(spec) {
    if (!spec.chain || spec.chain.length === 0) {
        // Fallback to debug selector if chain is missing for some reason
        if (spec.debugSelector) {
            return `locator(${escapeString(spec.debugSelector)})`;
        }
        throw new Error('PlaywrightLocatorSpec chain must not be empty');
    }
    return spec.chain.map(compileNode).join('.');
}
