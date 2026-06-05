"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SELECTOR_RANK_MAP = void 0;
exports.escapeCssString = escapeCssString;
exports.rankForPriority = rankForPriority;
exports.extractText = extractText;
exports.findStableClass = findStableClass;
exports.generateXPath = generateXPath;
exports.generateOptimalSelector = generateOptimalSelector;
exports.SELECTOR_RANK_MAP = {
    "data-testid": 1,
    id: 2,
    attribute: 3,
    class: 7,
    text: 8,
    path: 10,
    xpath: 10,
    other: 10,
    chained: 10,
};
function escapeCssString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\A ")
        .replace(/\r/g, "\\D ")
        .replace(/\t/g, "\\9 ");
}
const safeCssEscape = typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape
    : (str) => str.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
function rankForPriority(priority) {
    return exports.SELECTOR_RANK_MAP[priority] ?? 10;
}
function extractText(element, maxTextLength = 50) {
    const text = element.textContent || element.innerText || "";
    return text.trim().replace(/\s+/g, " ").substring(0, maxTextLength) || null;
}
function findStableClass(element) {
    if (!element.classList || element.classList.length === 0)
        return null;
    const classes = Array.from(element.classList);
    const BANNED_PATTERNS = [
        /\d{4,}/,
        /^css-/,
        /^sc-/,
        /^oxd-input$/,
        /^oxd-select-text-input$/,
        /^el-input__inner$/,
        /^ant-input$/,
        /^MuiInputBase-input$/,
    ];
    const stableClasses = classes.filter((cls) => !BANNED_PATTERNS.some((regex) => regex.test(cls)));
    if (stableClasses.length === 0)
        return null;
    const utilityPrefixes = ["mt-", "mb-", "pt-", "pb-", "flex", "text-", "bg-"];
    stableClasses.sort((a, b) => {
        const aIsUtility = utilityPrefixes.some((p) => a.startsWith(p));
        const bIsUtility = utilityPrefixes.some((p) => b.startsWith(p));
        if (aIsUtility && !bIsUtility)
            return 1;
        if (!aIsUtility && bIsUtility)
            return -1;
        return 0;
    });
    return stableClasses[0];
}
function generateXPath(element) {
    if (element.id)
        return `id("${element.id}")`;
    if (element === document.body)
        return "/html/body";
    let path = "";
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
        let index = 0;
        let sibling = current.previousSibling;
        while (sibling) {
            if (sibling.nodeType === Node.ELEMENT_NODE &&
                sibling.nodeName === current.nodeName) {
                index++;
            }
            sibling = sibling.previousSibling;
        }
        const tagName = current.nodeName.toLowerCase();
        const pathIndex = index > 0 ? `[${index + 1}]` : "";
        path = `/${tagName}${pathIndex}${path}`;
        current = current.parentNode;
    }
    return path;
}
function generateOptimalSelector(rawElement, options = {}) {
    const element = rawElement;
    const tagName = element.tagName.toLowerCase();
    const maxTextLength = typeof options.maxTextLength === "number" ? options.maxTextLength : 50;
    if (element.hasAttribute("data-testid")) {
        const testId = element.getAttribute("data-testid");
        return {
            selector: `[data-testid="${escapeCssString(testId)}"]`,
            priority: "data-testid",
            rank: rankForPriority("data-testid"),
        };
    }
    if (element.id) {
        const id = element.id;
        const isDynamic = /^\d/.test(id) ||
            /^react-/i.test(id) ||
            /[0-9a-f]{8}-[0-9a-f]{4}/i.test(id) ||
            /^:[a-z0-9]+:$/i.test(id) ||
            /\d{5,}/.test(id) ||
            /^(?:css|sc)-[a-zA-Z0-9]+$/.test(id);
        if (!isDynamic) {
            return {
                selector: `#${safeCssEscape(id)}`,
                priority: "id",
                rank: rankForPriority("id"),
            };
        }
    }
    if (element.name) {
        return {
            selector: `${tagName}[name="${escapeCssString(element.name)}"]`,
            priority: "attribute",
            rank: rankForPriority("attribute"),
        };
    }
    if (element.getAttribute("aria-label")) {
        return {
            selector: `${tagName}[aria-label="${escapeCssString(element.getAttribute("aria-label"))}"]`,
            priority: "attribute",
            rank: rankForPriority("attribute"),
        };
    }
    if (element.getAttribute("role")) {
        return {
            selector: `[role="${escapeCssString(element.getAttribute("role"))}"]`,
            priority: "attribute",
            rank: rankForPriority("attribute"),
        };
    }
    if (element.type &&
        ["submit", "button", "reset", "checkbox", "radio"].includes(element.type)) {
        return {
            selector: `${tagName}[type="${escapeCssString(element.type)}"]`,
            priority: "attribute",
            rank: rankForPriority("attribute"),
        };
    }
    const stableClass = findStableClass(element);
    if (stableClass) {
        return {
            selector: `.${safeCssEscape(stableClass)}`,
            priority: "class",
            rank: rankForPriority("class"),
        };
    }
    if (["button", "a", "submit"].includes(tagName)) {
        const text = extractText(element, maxTextLength);
        if (text && text.length > 0 && text.length < maxTextLength) {
            return {
                selector: `${tagName}:has-text("${escapeCssString(text)}")`,
                priority: "text",
                rank: rankForPriority("text"),
            };
        }
    }
    {
        const parts = [];
        if (element.name)
            parts.push(`[name="${escapeCssString(element.name)}"]`);
        if (element.getAttribute("aria-label")) {
            parts.push(`[aria-label="${escapeCssString(element.getAttribute("aria-label"))}"]`);
        }
        if (element.type && !["text", "button"].includes(element.type)) {
            parts.push(`[type="${escapeCssString(element.type)}"]`);
        }
        if (element.placeholder) {
            parts.push(`[placeholder="${escapeCssString(element.placeholder)}"]`);
        }
        if (parts.length >= 2) {
            return {
                selector: `${tagName}${parts.join("")}`,
                priority: "attribute",
                rank: rankForPriority("attribute"),
            };
        }
    }
    const parent = element.parentElement;
    if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
        if (siblings.length > 0) {
            const index = siblings.indexOf(element);
            const parentSelector = parent.id && !/^\d/.test(parent.id)
                ? `#${safeCssEscape(parent.id)}`
                : parent.tagName.toLowerCase();
            return {
                selector: `${parentSelector} > ${tagName}:nth-of-type(${index + 1})`,
                priority: "path",
                rank: rankForPriority("path"),
            };
        }
    }
    return {
        selector: generateXPath(element),
        priority: "xpath",
        rank: rankForPriority("xpath"),
    };
}
