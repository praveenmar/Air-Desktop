"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUrl = normalizeUrl;
function normalizeUrl(url, base) {
    try {
        const u = new URL(url, base);
        const path = u.pathname.replace(/\/$/, "") || "/";
        return `${u.origin}${path}`;
    }
    catch {
        return url;
    }
}
