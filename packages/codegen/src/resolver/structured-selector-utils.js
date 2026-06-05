"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeStructuredSelectorText = normalizeStructuredSelectorText;
exports.getVisibleInputLikeControls = getVisibleInputLikeControls;
exports.getVisibleTriggerLikeControls = getVisibleTriggerLikeControls;
exports.findExactVisibleLabelLikeDescendants = findExactVisibleLabelLikeDescendants;
exports.findTightFieldContainer = findTightFieldContainer;
exports.findTightTriggerContainer = findTightTriggerContainer;
exports.isGenericContainerSelector = isGenericContainerSelector;
const visibility_1 = require("./visibility");
function normalizeStructuredSelectorText(value) {
    if (!value)
        return '';
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[:*]\s*$/, '') // Remove trailing colons or asterisks (common in forms)
        .trim()
        .toLowerCase();
}
function getVisibleInputLikeControls(root) {
    try {
        return Array.from(root.querySelectorAll('input,textarea,select,[role="textbox"],[role="combobox"],[role="searchbox"],[role="spinbutton"],[contenteditable="true"],[aria-haspopup="listbox"],[aria-haspopup="combobox"]')).filter(visibility_1.isVisibleElement);
    }
    catch {
        return [];
    }
}
function getVisibleTriggerLikeControls(root) {
    try {
        return Array.from(root.querySelectorAll('select,[role="combobox"],[role="button"][aria-haspopup],[aria-haspopup="listbox"],[aria-haspopup="combobox"],button[aria-haspopup],input[role="combobox"],[contenteditable="true"]')).filter(visibility_1.isVisibleElement);
    }
    catch {
        return [];
    }
}
function findExactVisibleLabelLikeDescendants(root, labelText) {
    const normalizedLabel = normalizeStructuredSelectorText(labelText);
    try {
        const candidates = Array.from(root.querySelectorAll('label,legend,span,div,p')).filter(element => (0, visibility_1.isVisibleElement)(element) &&
            normalizeStructuredSelectorText(element.textContent || '') === normalizedLabel);
        return candidates.filter(element => !candidates.some(other => other !== element && element.contains(other)));
    }
    catch {
        return [];
    }
}
function findTightFieldContainer(label, target) {
    let current = label;
    let depth = 0;
    while (current && depth < 5) {
        const tagName = current.tagName?.toLowerCase() || '';
        if (['body', 'html', 'main', 'section', 'article', 'table', 'tbody', 'thead', 'form'].includes(tagName)) {
            break;
        }
        const controls = getVisibleInputLikeControls(current);
        if (controls.length === 1 && controls[0] === target) {
            return { container: current };
        }
        if (controls.length > 1 && controls.includes(target)) {
            return { container: null, blockedReason: 'multiple_input_like_targets' };
        }
        current = current.parentElement;
        depth += 1;
    }
    return { container: null, blockedReason: 'broad_container_only' };
}
function findTightTriggerContainer(target, labelText) {
    let current = target;
    let depth = 0;
    while (current && depth < 5) {
        const tagName = current.tagName?.toLowerCase() || '';
        if (['body', 'html', 'main', 'section', 'article', 'table', 'tbody', 'thead', 'form'].includes(tagName)) {
            break;
        }
        const labels = findExactVisibleLabelLikeDescendants(current, labelText);
        if (labels.length > 1) {
            return { container: null, labelElement: null, blockedReason: 'duplicate_label_text' };
        }
        const controls = getVisibleTriggerLikeControls(current);
        if (labels.length === 1 && controls.length === 1 && controls[0] === target) {
            return { container: current, labelElement: labels[0] };
        }
        if (labels.length === 1 && controls.length > 1 && controls.includes(target)) {
            return { container: null, labelElement: labels[0], blockedReason: 'multiple_input_like_targets' };
        }
        current = current.parentElement;
        depth += 1;
    }
    return { container: null, labelElement: null, blockedReason: 'broad_container_only' };
}
function isGenericContainerSelector(selector) {
    if (!selector)
        return true;
    const normalized = selector.trim().toLowerCase();
    // Tag-only generic selectors
    if (['div', 'span', 'body', 'html', 'main', 'section', 'article', 'form', 'table'].includes(normalized)) {
        return true;
    }
    // Common broad class names (case-insensitive)
    const genericClassPatterns = [
        /\.container\b/i,
        /\.wrapper\b/i,
        /\.content\b/i,
        /\.row\b/i,
        /\.form\b/i,
    ];
    if (genericClassPatterns.some(pattern => pattern.test(normalized))) {
        return true;
    }
    return false;
}
