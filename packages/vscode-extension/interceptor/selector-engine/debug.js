const DEBUG_PREFIX = '[AIR][structural]';
const DEBUG_STATE_KEY = '__AIR_SELECTOR_ENGINE_STRUCTURAL_DEBUG__';

function getHost() {
  return typeof globalThis !== 'undefined' ? globalThis : null;
}

function getSessionId() {
  const host = getHost();
  if (!host) return 'unknown-session';
  return host.__AIR_CONFIG__?.sessionId
    || host._airInterceptor?.config?.sessionId
    || 'unknown-session';
}

function getDebugState() {
  const host = getHost();
  if (!host) return { seen: new Set() };
  if (!host[DEBUG_STATE_KEY]) {
    host[DEBUG_STATE_KEY] = { seen: new Set() };
  }
  return host[DEBUG_STATE_KEY];
}

export function isStructuralDebugEnabled() {
  const host = getHost();
  return host?._airInterceptor?.config?.debugMode === true;
}

export function debugLog(message, data) {
  if (!isStructuralDebugEnabled()) return;
  if (data === undefined) {
    console.log(`${DEBUG_PREFIX} ${message}`);
    return;
  }
  console.log(`${DEBUG_PREFIX} ${message}`, data);
}

export function debugLogOnce(key, message, data) {
  if (!isStructuralDebugEnabled()) return;
  const state = getDebugState();
  const compositeKey = `${getSessionId()}::${String(key || '').trim()}`;
  if (state.seen.has(compositeKey)) return;
  state.seen.add(compositeKey);
  debugLog(message, data);
}
