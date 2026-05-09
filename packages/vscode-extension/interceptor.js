/**
 * AIR Interceptor - Browser Agent (Standalone)
 * Injected via Tampermonkey blob: URL — do NOT load as ES module directly.
 * The import below is stripped by the injector preamble at runtime.
 */

//import { ContextDriver, EdgeCaseType, EventType } from "./types.js";
const EventType = {
  CLICK: 'click',
  INPUT: 'input',
  SCROLL: 'scroll',
  NAVIGATION: 'navigation',
  CUSTOM: 'custom',
  CUSTOM_CONTROL_OPEN: 'custom-control-open',
  CUSTOM_MENU_SELECT: 'custom-menu-select',
  CUSTOM_SELECT: 'custom-select',
};

// ─────────────────────────────────────────────────────────────────────────────
// SYMBOL SENTINEL — replaces the string key "__air_internal__"
//
// WHY: A string-keyed property on the fetch options object is:
//   • Enumerable  → visible to for..in loops inside app request middlewares
//   • Serializable → JSON.stringify picks it up if anyone clones opts naively
//   • Forgeable    → any script can set { __air_internal__: true } to bypass AIR
//
// A Symbol is:
//   • Non-enumerable in for..in / Object.keys()
//   • Invisible to JSON.stringify
//   • Unforgeable without a reference to the exact Symbol instance
//   • Stripped automatically when the fetch init object is cloned to native code
// ─────────────────────────────────────────────────────────────────────────────
const _AIR_INTERNAL = Symbol('air.internal');

class QuiescenceEngine {
  constructor(config = {}) {
    this.config = {
      domSilenceMs: 300,
      networkIdleMs: 500,
      ignoredUrlPatterns: [
        /google-analytics\.com/, /hotjar\.com/, /sentry\.io/,
        /\.websocket\./, /socket\.io/, /\/api\/v\d+\/heartbeat/, /\/api\/v\d+\/ping/ , /\/api\/collect/
      ],
      ignoredMutationSelectors: [
        '.toast', '.notification', '[data-animation]',
        '.oxd-loading-spinner', '.skeleton-loader', '.spinner'
      ],
      maxWaitMs: 10000,
      minStableChecks: 3,
      debug: true, // Forced true so you can see it working
      ...config
    };

    this.domMutationTimer = null;
    this.activeNetworkCount = 0;
    this.stableCheckCount = 0;
    this.observer = null;
    this.isMonitoring = false;
  }

  log(...args) {
    if (this.config.debug) console.log('🛑 [QuiescenceEngine]', ...args);
  }

  onNetworkStart() {
    this.activeNetworkCount++;
  }

  onNetworkEnd() {
    this.activeNetworkCount = Math.max(0, this.activeNetworkCount - 1);
  }

  monitor() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    if (!this.onNetworkStart || !this.onNetworkEnd) {
      this.log('⚠️ Network callbacks not wired – quiescence may stall');
    }
    this.log('Monitoring started (DOM observer + network callbacks from AIRInterceptor)');
  }

  shouldIgnoreUrl(url) {
    return this.config.ignoredUrlPatterns.some(pattern => pattern.test(url));
  }

  waitForSettle(timeoutOverride = null) {
    this.log('WAIT FOR SETTLE TRIGGERED');
    const startTime = Date.now();
    this.stableCheckCount = 0;
    const maxWait = timeoutOverride || this.config.maxWaitMs;

    return new Promise((resolve) => {
      // Hard Ceiling Timeout
      const hardTimeout = setTimeout(() => {
        this.stopDomObserver();
        if (this.activeNetworkCount > 0) {
          this.log(`⚠️ Network counter stuck at ${this.activeNetworkCount}; forcing reset after timeout`);
          this.activeNetworkCount = 0;
        }
        this.log('TIMEOUT REACHED (Forced Settle)');
        resolve({ stable: false, reason: 'timeout', waitedMs: Date.now() - startTime });
      }, maxWait);

      this.startDomObserver();

      const check = () => {
        const domQuiet = this.domMutationTimer === null;
        const networkQuiet = this.activeNetworkCount === 0;
        if (domQuiet && networkQuiet) {
          this.stableCheckCount++;
          this.log(`Stability check ${this.stableCheckCount}/${this.config.minStableChecks} passed...`);
          
          if (this.stableCheckCount >= this.config.minStableChecks) {
            clearTimeout(hardTimeout);
            this.stopDomObserver();
            this.log(`✅ QUIESCENT! Total wait: ${Date.now() - startTime}ms`);
            resolve({ stable: true, reason: 'quiescent', waitedMs: Date.now() - startTime });
            return;
          }
        } else {
          if (this.stableCheckCount > 0) this.log('Stability broken! Resetting check count.');
          this.stableCheckCount = 0; 
        }

        setTimeout(check, 100); // Poll every 100ms
      };

      // Delay first check to let initial DOM mutations trigger
      setTimeout(check, this.config.domSilenceMs);
    });
  }

  startDomObserver() {
    if (this.observer) this.observer.disconnect();
    
    this.observer = new MutationObserver((mutations) => {
      const significant = mutations.filter((m) => {
        return !this.config.ignoredMutationSelectors.some(sel => m.target.closest?.(sel));
      });

      if (significant.length > 0) {
        if (this.domMutationTimer) clearTimeout(this.domMutationTimer);
        this.domMutationTimer = setTimeout(() => {
          this.domMutationTimer = null; // Mark DOM as quiet
        }, this.config.domSilenceMs);
      }
    });

    this.observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'disabled', 'hidden']
    });
  }

  stopDomObserver() {
    if (this.observer) this.observer.disconnect();
    if (this.domMutationTimer) clearTimeout(this.domMutationTimer);
    this.domMutationTimer = null;
  }
}

// ============================================================
// 🧠 AIR INTELLIGENCE ENGINE (Add before class AIRInterceptor)
// ============================================================

const AIR_CFG = {
  maxCandidates: 50,
  microStabilityMs: 60, // Wait 60ms for DOM to settle
  debugMode: true
};

const SELECTOR_RANK_MAP = {
  'data-testid': 1,
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
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')
    .replace(/\t/g, '\\9 ');
}

function rankForPriority(priority) {
  return SELECTOR_RANK_MAP[priority] ?? 10;
}

// Safe CSS escape - matches @air/shared/src/selectors.ts
const safeCssEscape = (typeof CSS !== 'undefined' && CSS.escape)
  ? CSS.escape
  : (str) => String(str).replace(/[^a-zA-Z0-9_-]/g, '\\$&');

// Cache for DOM indexing
const _rootIndexCache = new WeakMap();

function getRootIndex(root) {
  const cache = _rootIndexCache.get(root);
  if (cache && (Date.now() - cache.timestamp < 2000)) return cache.index; // 2s cache

  const idx = { ids: new Map(), classes: new Map(), roles: new Map(), hrefs: new Map() };
  if (!root.querySelectorAll) return idx;

  root.querySelectorAll('*').forEach(el => {
    if (el.id) idx.ids.set(el.id, (idx.ids.get(el.id) || 0) + 1);
    el.classList?.forEach(c => idx.classes.set(c, (idx.classes.get(c) || 0) + 1));
    if (el.getAttribute('role')) idx.roles.set(el.getAttribute('role'), (idx.roles.get(el.getAttribute('role')) || 0) + 1);
    if (el.getAttribute('href')) idx.hrefs.set(el.getAttribute('href'), (idx.hrefs.get(el.getAttribute('href')) || 0) + 1);
  });

  _rootIndexCache.set(root, { index: idx, timestamp: Date.now() });
  return idx;
}

function waitForMicroStability(root = document) {
  return new Promise(resolve => {
    let lastMut = Date.now();
    const obs = new MutationObserver(() => lastMut = Date.now());
    obs.observe(root, { subtree: true, childList: true, attributes: true });
    
    (function loop() {
      if (Date.now() - lastMut >= AIR_CFG.microStabilityMs) {
        obs.disconnect();
        resolve();
      } else {
        requestAnimationFrame(loop);
      }
    })();
  });
}

function isUniqueCandidate(candidate, element, root) {
  try {
    if (candidate.type === 'text') {
      // XPath validation for text uniqueness
      const xpath = `//${candidate.tag}[contains(text(), "${candidate.rawText}")]`;
      const result = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return result.snapshotLength === 1 && result.snapshotItem(0) === element;
    }
    // CSS validation
    const nodes = root.querySelectorAll(candidate.val);
    return nodes.length === 1 && nodes[0] === element;
  } catch (e) { return false; }
}

class AIRInterceptor {
  constructor(config = {}) {
    // ------------------------------------------------------------
    // 1. SESSION PERSISTENCE (Hardened strict-mode flow)
    // ------------------------------------------------------------
    this.disabled = false;
    this._storageAvailable = true;
    this._storageFailureLogged = false;
    let currentSessionId = config.sessionId;
    let strictMode = false;
    let configServerUrl = null;

    // Read injected runtime config first (set by main process).
    if (typeof window !== "undefined" && window.__AIR_CONFIG__) {
      const cfg = window.__AIR_CONFIG__;
      currentSessionId = cfg.sessionId || currentSessionId;
      strictMode = cfg.strictMode === true;
      configServerUrl = cfg.serverUrl || null;
    }

    // Non-strict only: allow sessionStorage fallback.
    if (!currentSessionId && !strictMode) {
      const storedSessionId = this._safeGetStorage("session", "AIR_SESSION_ID");
      if (storedSessionId) currentSessionId = storedSessionId;
    }

    if (strictMode && !currentSessionId) {
      console.error("[AIR] Session ID required in strict mode - disabling interceptor");
      this.disabled = true;
      return;
    }

    // Generate and persist only for non-strict fallback mode.
    if (!currentSessionId) {
      currentSessionId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
        /[xy]/g,
        (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        },
      );

      if (!strictMode) {
        this._safeSetStorage("session", "AIR_SESSION_ID", currentSessionId);
      }
    } else if (!strictMode) {
      this._safeSetStorage("session", "AIR_SESSION_ID", currentSessionId);
    }

    const resolvedTab = this._resolveTabContext(config);
    this._tabResolution = resolvedTab;

    // ------------------------------------------------------------
    // 2. CONFIGURATION
    // ------------------------------------------------------------
    this.config = {
      capturePageSnapshot: config.capturePageSnapshot || false,
      snapshotDepth: config.snapshotDepth ?? 10,
      snapshotTimeoutMs: config.snapshotTimeoutMs ?? 5000,
      snapshotMaxNodes: config.snapshotMaxNodes ?? 5000,
      snapshotMaxTextLength: config.snapshotMaxTextLength ?? 5000,
      snapshotAdaptiveBoostEnabled: config.snapshotAdaptiveBoostEnabled ?? true,
      snapshotProductMaxNodes: config.snapshotProductMaxNodes ?? 15000,
      snapshotProductMaxTextLength: config.snapshotProductMaxTextLength ?? 15000,
      snapshotUseIdleCallback: config.snapshotUseIdleCallback ?? true,
      snapshotCaptureVueAttrs: config.snapshotCaptureVueAttrs ?? true,
      snapshotCaptureReactAttrs: config.snapshotCaptureReactAttrs ?? true,
      snapshotWaitForSPA: config.snapshotWaitForSPA ?? true,
      snapshotContentReadyTimeoutMs: config.snapshotContentReadyTimeoutMs ?? 8000,
      snapshotContentReadyPollMs: config.snapshotContentReadyPollMs ?? 200,
      snapshotBusyMaxWaitMs: config.snapshotBusyMaxWaitMs ?? 3000,
      snapshotBusyPollMs: config.snapshotBusyPollMs ?? 150,
      snapshotBusyMaxLoggedReasons: config.snapshotBusyMaxLoggedReasons ?? 5,
      hoverIntentBufferTtlMs: config.hoverIntentBufferTtlMs ?? 500,
      hoverIntentBufferMaxEntries: config.hoverIntentBufferMaxEntries ?? 8,
      snapshotMinInteractiveCount: config.snapshotMinInteractiveCount ?? 6,
      snapshotMinTextLength: config.snapshotMinTextLength ?? 120,
      snapshotProductMinInteractiveCount: config.snapshotProductMinInteractiveCount ?? 4,
      snapshotProductMinTextLength: config.snapshotProductMinTextLength ?? 80,
      snapshotProductRootSelectors: config.snapshotProductRootSelectors ?? [
        "main",
        '[role="main"]',
        '[data-testid*="product"]',
        '[class*="product"]',
        '[id*="product"]',
      ],
      snapshotProductReadySelectors: config.snapshotProductReadySelectors ?? [
        '[data-testid*="add-to-cart"]',
        '[data-testid*="addtocart"]',
        '[data-testid*="buy-now"]',
        '[data-testid*="buy"]',
        '[itemprop="price"]',
        '[data-testid*="price"]',
        '[class*="price"]',
        'button[type="submit"]',
      ],
      snapshotProductReadyKeywords: config.snapshotProductReadyKeywords ?? [
        "add to cart",
        "buy now",
        "go to cart",
        "add to bag",
        "wishlist",
        "price",
        "in stock",
      ],
      snapshotInteractiveSelectors: config.snapshotInteractiveSelectors ?? [
        "a[href]",
        "button",
        'input:not([type="hidden"])',
        "select",
        "textarea",
        '[role="button"]',
        '[role="link"]',
        "[data-testid]",
        "[data-id]",
      ],
      snapshotSkeletonSelectors: config.snapshotSkeletonSelectors ?? [
        '[class*="skeleton"]',
        '[class*="placeholder"]',
        '[class*="loading"]',
        '[aria-busy="true"]',
      ],
      snapshotDebugPreviewChars: config.snapshotDebugPreviewChars ?? 220,
      debugEnabled: config.debugMode || false,
      serverUrl: configServerUrl || config.serverUrl || "http://localhost:3000",
      sessionId: currentSessionId, // <--- CRITICAL: Use the resolved ID
      projectId: config.projectId || "default",
      maxTextLength: config.maxTextLength || 50,
      debugMode: config.debugMode || false,
      batchSize: config.batchSize || 10,
      batchInterval: config.batchInterval || 2000,
      corsEnabled: config.corsEnabled ?? true,
      tabId: resolvedTab.tabId,
    };

    // ------------------------------------------------------------
    // 3. INTERNAL STATE & QUEUES (Restored)
    // ------------------------------------------------------------
    this.activeRequests = 0;
    this.eventQueue = []; // Your queue variable
    this.queue = this.eventQueue; // Alias just in case I used 'this.queue' in other methods
    this.batchTimer = null;
    this.isScrolling = false;
    this.lastScrollY = 0;
    this.isProcessing = false;
    this.pendingTraceId = null; // <-- Consolidated from both versions
    this.lastActionTraceId = null;
    this.lastActionTraceAt = 0;
    this._recentSubmitClick = null;
    this.crossTabPendingTtlMs = config.crossTabPendingTtlMs ?? 45000;
    this.crossTabPendingMaxEntries = config.crossTabPendingMaxEntries ?? 20;

    // API Endpoint Construction
    const base = this.config.serverUrl.replace(/\/+$/, "");
    this.apiEndpoint = `${base}/api/events`;

    // ── Fetch resilience ───────────────────────────────────────────────────
    // PRIORITY ORDER for raw fetch (most isolated → least):
    //
    //  1. window.__air_rawFetch  — set by Tampermonkey injector at document-start,
    //     BEFORE any page script ran. Guaranteed to be the native browser fetch.
    //
    //  2. Iframe sandbox         — create a hidden iframe and grab its pristine
    //     contentWindow.fetch. Completely isolated from any page-level patches
    //     that may have already run (e.g. if the injector loaded late).
    //
    //  3. window.fetch snapshot  — whatever is on window right now. Safe only
    //     if we are the first script to run (non-TM, direct <script> injection).
    //
    // The captured reference is used exclusively for AIR's own /api/events POSTs
    // so they don't inflate quiescence counters or interact with page middleware.
    this._rawFetch = (() => {
      // Option 1: Tampermonkey pre-captured native fetch (best)
      if (typeof window.__air_rawFetch === 'function') {
        this.log('🔒 Using TM pre-captured raw fetch');
        return window.__air_rawFetch.bind(window);
      }

      // Option 2: Iframe sandbox (reliable fallback)
      try {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'display:none!important;width:0;height:0;border:0';
        (document.head || document.documentElement).appendChild(iframe);
        const pristine = iframe.contentWindow.fetch.bind(iframe.contentWindow);
        (document.head || document.documentElement).removeChild(iframe);
        this.log('🔒 Using iframe-sandboxed raw fetch');
        return pristine;
      } catch (_) {}

      // Option 3: Snapshot whatever is on window now
      this.log('⚠️ Falling back to window.fetch snapshot (may already be patched)');
      return window.fetch.bind(window);
    })();

    // GM transport bridge — set by Tampermonkey injector.
    // When present, AIR's own flush POSTs go through GM_xmlhttpRequest
    // (extension context, no CORS) instead of fetch.
    // When absent (direct <script> injection), _rawFetch is used instead.
    this._gmSend = (typeof window.__air_gmSend === 'function')
      ? window.__air_gmSend.bind(window)
      : null;

    if (this._gmSend) {
      this.log('🌉 GM transport bridge active — AIR traffic bypasses CORS');
    }

    // Concurrency guard — only one flush flight at a time.
    this._isFlushing = false;

    // Per-event retry state. Key = event.id, Value = { count, nextDelay }
    // Delays follow exponential backoff: 500ms, 1s, 2s, 4s, 8s (cap 30s).
    this._retryState = new Map();

    // Replay dedupe cache for navigation recovery.
    // Persisted across same-tab navigations via sessionStorage.
    this.maxReplaySentIds = 1000;
    this._replaySentEventIds = this._loadSentEventIds();

    // Deduplication
    this.recentEventKeys = new Set();
    this.maxRecentKeys = 50;

    // ------------------------------------------------------------
    // INPUT SESSION TRACKING
    // Tracks the "in-progress" state of a field between focus and blur.
    // Key: a stable field identifier string
    // Value: { traceId, startValue, inputCount, startTimestamp }
    // ------------------------------------------------------------
    this.activeInputSessions = new Map();
    this.inputDebounceTimers = new Map();

    // ------------------------------------------------------------
    // SCROLL STATE (per-target, not just window)
    // Key: scrollable element (or window)
    // Value: { isScrolling, lastScrollTop, lastScrollLeft, startTimestamp, debounceTimer }
    // ------------------------------------------------------------
    this.scrollStates = new WeakMap();

    // ------------------------------------------------------------
    // CUSTOM (DIV-BASED) DROPDOWN TRACKING
    //
    // Problem: Many UI frameworks (Vue Select, Ant Design, Material,
    // Choices.js, Select2, etc.) render dropdowns as plain <div> trees
    // with no <select> element. Clicks on options fire as generic clicks
    // and the selected label is lost.
    //
    // Strategy: two-phase tracking.
    //   Phase 1 – TRIGGER: when a div-dropdown is opened, we record the
    //             trigger element + a fresh traceId and start a
    //             MutationObserver watching for the option panel to appear.
    //   Phase 2 – SELECTION: when an option div is clicked we resolve it
    //             back to Phase 1's traceId and emit a structured
    //             "custom-select" event with label + value.
    //
    // _openDropdown holds the active session while a dropdown is open.
    // _dropdownObserver watches DOM mutations to auto-detect panels.
    // ------------------------------------------------------------
    this._openDropdown    = null;  // { traceId, triggerEl, triggerFingerprint, openTimestamp }
    this._dropdownObserver = null; // MutationObserver instance (one at a time)

    // ── MOUSEDOWN PRE-CAPTURE for DOM-detachment race ──
    // Some frameworks (Vue/OrangeHRM) remove the dropdown option element from
    // the DOM synchronously during the click event's capture/target phase,
    // before AIR's bubble-level click handler can inspect ancestry. We use a
    // capture-phase mousedown to snapshot the option data while the DOM is
    // still live, then validate+consume it in handleClick.
    this._pendingOptionSelection = null; // { optionData, fingerprint, timestamp, ... }
    this._pendingOptionSelectionFallbackTimer = null;

    // PII Redaction
    // ⚠️ FIX (BUG): Removed /g flag. RegExp with /g maintains stateful `lastIndex`
    // across .test() calls on the same instance, causing alternating true/false
    // results → every other PII check would PASS, leaking data. /g is only needed
    // for matchAll/exec iteration; plain .test() must use flag-less patterns.
    this.piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/,                                     // SSN
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,               // Credit card
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i,     // Email
    ];

    // Explicit Outcome / Quiescence (New Logic)
    this.quiescence = null;

    // ------------------------------------------------------------
    // 4. KICKOFF
    // ------------------------------------------------------------
    this.init();
  }

  _markStorageUnavailable(error) {
    if (this._storageAvailable === false) return;
    this._storageAvailable = false;

    if (!this._storageFailureLogged) {
      this._storageFailureLogged = true;
      const reason = error && error.message ? error.message : String(error);
      console.debug("[AIR] Storage unavailable; disabling persistence for this page.", reason);
    }
  }

  _safeGetStorage(type, key) {
    if (this._storageAvailable === false) return null;
    try {
      const storage = type === "local" ? window.localStorage : window.sessionStorage;
      return storage.getItem(key);
    } catch (error) {
      this._markStorageUnavailable(error);
      return null;
    }
  }

  _safeSetStorage(type, key, value) {
    if (this._storageAvailable === false) return false;
    try {
      const storage = type === "local" ? window.localStorage : window.sessionStorage;
      storage.setItem(key, value);
      return true;
    } catch (error) {
      this._markStorageUnavailable(error);
      return false;
    }
  }

  _safeRemoveStorage(type, key) {
    if (this._storageAvailable === false) return false;
    try {
      const storage = type === "local" ? window.localStorage : window.sessionStorage;
      storage.removeItem(key);
      return true;
    } catch (error) {
      this._markStorageUnavailable(error);
      return false;
    }
  }

  _getTabIdStorageKey() {
    return "AIR_TAB_ID";
  }

  _looksLikeTabId(value) {
    return typeof value === "string" && /^tab-[a-f0-9-]+$/i.test(value);
  }

  _generateTabId() {
    return `tab-${this.generateUUID()}`;
  }

  _hasWindowOpener() {
    try {
      return typeof window !== "undefined" && !!window.opener;
    } catch (_) {
      return false;
    }
  }

  _getNavigationType() {
    try {
      const navEntry = performance.getEntriesByType?.("navigation")?.[0];
      if (navEntry && typeof navEntry.type === "string") {
        return navEntry.type;
      }
      if (performance?.navigation) {
        if (performance.navigation.type === performance.navigation.TYPE_RELOAD) {
          return "reload";
        }
        if (performance.navigation.type === performance.navigation.TYPE_BACK_FORWARD) {
          return "back_forward";
        }
      }
    } catch (_) {}
    return "navigate";
  }

  _shouldRotateTabIdForNewTab(storedTabId) {
    if (!this._looksLikeTabId(storedTabId)) return false;
    const hasOpener = this._hasWindowOpener();
    if (!hasOpener) return false;
    const navigationType = this._getNavigationType();
    if (navigationType !== "navigate") return false;
    try {
      return Number(window.history?.length || 0) <= 1;
    } catch (_) {
      return false;
    }
  }

  _resolveTabContext(config = {}) {
    const configuredTabId = this._looksLikeTabId(config?.tabId)
      ? config.tabId
      : this._looksLikeTabId(window.__AIR_CONFIG__?.tabId)
        ? window.__AIR_CONFIG__.tabId
        : null;
    const storageKey = this._getTabIdStorageKey();
    const storedTabId = this._safeGetStorage("session", storageKey);
    const shouldRotate = !configuredTabId && this._shouldRotateTabIdForNewTab(storedTabId);
    let tabId = configuredTabId || storedTabId;
    let source = configuredTabId ? "config" : "session_storage";
    let rotatedFrom = null;

    if (shouldRotate) {
      rotatedFrom = storedTabId;
      tabId = this._generateTabId();
      source = "rotated_new_tab";
    } else if (!this._looksLikeTabId(tabId)) {
      tabId = this._generateTabId();
      source = "generated";
    }

    this._safeSetStorage("session", storageKey, tabId);
    return {
      tabId,
      source,
      rotated: rotatedFrom !== null,
      rotatedFrom,
      hasOpener: this._hasWindowOpener(),
      navigationType: this._getNavigationType(),
    };
  }

  _getCrossTabPendingKey() {
    return `air_pending_trace_cross_tab_${this.config?.sessionId || "unknown"}`;
  }

  _pruneCrossTabPendingEntries(entries, now = Date.now()) {
    if (!Array.isArray(entries)) return [];
    const ttlMs = Math.max(1000, Number(this.crossTabPendingTtlMs) || 45000);
    return entries.filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      if (typeof entry.traceId !== "string" || !entry.traceId) return false;
      if (typeof entry.targetNormalizedUrl !== "string" || !entry.targetNormalizedUrl) {
        return false;
      }
      if (typeof entry.createdAt !== "number") return false;
      return now - entry.createdAt <= ttlMs;
    });
  }

  _readCrossTabPendingEntries() {
    const key = this._getCrossTabPendingKey();
    const raw = this._safeGetStorage("local", key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      this._safeRemoveStorage("local", key);
      return [];
    }
  }

  _writeCrossTabPendingEntries(entries) {
    const key = this._getCrossTabPendingKey();
    const maxEntries = Math.max(1, Number(this.crossTabPendingMaxEntries) || 20);
    const pruned = this._pruneCrossTabPendingEntries(entries).slice(-maxEntries);
    return this._safeSetStorage("local", key, JSON.stringify(pruned));
  }

  _stashCrossTabPendingTrace(traceId, targetUrl, sourceUrl) {
    if (typeof traceId !== "string" || !traceId) return false;
    if (typeof targetUrl !== "string" || !targetUrl) return false;

    const now = Date.now();
    const targetNormalizedUrl = this.normalizeUrl(targetUrl);
    const sourcePageUrl = sourceUrl || window.location.href;
    const sourceNormalizedUrl = this.normalizeUrl(sourcePageUrl);

    const entries = this._pruneCrossTabPendingEntries(
      this._readCrossTabPendingEntries(),
      now,
    ).filter((entry) => entry.traceId !== traceId);

    entries.push({
      traceId,
      targetUrl,
      targetNormalizedUrl,
      sourceUrl: sourcePageUrl,
      sourceNormalizedUrl,
      createdAt: now,
    });

    const saved = this._writeCrossTabPendingEntries(entries);
    if (saved) {
      this.log("↗️ Cross-tab trace handoff stored", {
        traceId,
        targetNormalizedUrl,
        sourceNormalizedUrl,
        queueSize: entries.length,
      });
    }
    return saved;
  }

  _isCrossTabTargetMatch(targetNormalizedUrl, currentNormalizedUrl) {
    if (!targetNormalizedUrl || !currentNormalizedUrl) return false;
    if (targetNormalizedUrl === currentNormalizedUrl) return true;
    if (currentNormalizedUrl.startsWith(targetNormalizedUrl)) return true;
    if (targetNormalizedUrl.startsWith(currentNormalizedUrl)) return true;
    return false;
  }

  _consumeCrossTabPendingTrace() {
    const now = Date.now();
    const rawEntries = this._readCrossTabPendingEntries();
    const entries = this._pruneCrossTabPendingEntries(rawEntries, now);
    const currentNormalizedUrl = this.normalizeUrl(window.location.href);
    const matchIndex = entries.findIndex((entry) =>
      this._isCrossTabTargetMatch(entry.targetNormalizedUrl, currentNormalizedUrl),
    );

    if (matchIndex === -1) {
      if (entries.length !== rawEntries.length) {
        this._writeCrossTabPendingEntries(entries);
      }
      return null;
    }

    const [match] = entries.splice(matchIndex, 1);
    this._writeCrossTabPendingEntries(entries);
    this.log("↘️ Cross-tab trace handoff consumed", {
      traceId: match.traceId,
      targetNormalizedUrl: match.targetNormalizedUrl,
      currentNormalizedUrl,
      sourceNormalizedUrl: match.sourceNormalizedUrl || null,
    });
    return match;
  }

  _getSentEventIdsStorageKey() {
    return `air_sent_event_ids_${this.config?.sessionId || "unknown"}`;
  }

  _loadSentEventIds() {
    const key = this._getSentEventIdsStorageKey();
    const raw = this._safeGetStorage("session", key);
    if (!raw) return new Set();

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      const valid = parsed.filter((id) => typeof id === "string" && id.length > 0);
      return new Set(valid.slice(-this.maxReplaySentIds));
    } catch (_) {
      this._safeRemoveStorage("session", key);
      return new Set();
    }
  }

  _persistSentEventIds() {
    const key = this._getSentEventIdsStorageKey();
    const ids = Array.from(this._replaySentEventIds).slice(-this.maxReplaySentIds);
    this._safeSetStorage("session", key, JSON.stringify(ids));
  }

  _rememberSentEventId(eventId) {
    if (typeof eventId !== "string" || !eventId) return;
    this._replaySentEventIds.add(eventId);
    while (this._replaySentEventIds.size > this.maxReplaySentIds) {
      const oldest = this._replaySentEventIds.values().next().value;
      if (!oldest) break;
      this._replaySentEventIds.delete(oldest);
    }
    this._persistSentEventIds();
  }

  _wasEventSent(eventId) {
    if (typeof eventId !== "string" || !eventId) return false;
    return this._replaySentEventIds.has(eventId);
  }

  init() {
    if (this.disabled) return;
    this.log("🚀 AIR Interceptor initializing...", {
      sessionId: this.config.sessionId,
      tabId: this.config.tabId,
    });
    this.log("AIR_TAB_RESOLVED", {
      sessionId: this.config.sessionId,
      tabId: this.config.tabId,
      source: this._tabResolution?.source || "unknown",
      navigationType: this._tabResolution?.navigationType || "unknown",
      hasOpener: this._tabResolution?.hasOpener === true,
    });
    if (this._tabResolution?.rotated) {
      this.log("AIR_TAB_ROTATED_NEW_TAB", {
        sessionId: this.config.sessionId,
        oldTabId: this._tabResolution.rotatedFrom,
        newTabId: this.config.tabId,
      });
    }
    console.log('[AIR_INTERCEPTOR] Initialized', {
      sessionId: window.__AIR_CONFIG__?.sessionId,
      serverUrl: window.__AIR_CONFIG__?.serverUrl,
      tabId: this.config.tabId,
    });
    this.monitorNetwork();
    this.attachEventListeners();
    this.startBatchProcessor();

    // Initialize Quiescence Watcher once
    this.quiescence = new QuiescenceEngine();
    this.quiescence.monitor();

    // Recover any events stashed to localStorage during a previous page navigation.
    // MUST run before checkPendingOutcome() to guarantee correct event ordering:
    // stashed click → outcome (from checkPendingOutcome) → edge created correctly.
    // See _recoverStashedEvents() for full ordering rationale.
    this._recoverStashedEvents();

    // ✅ FIXED: Establish Baseline State on Load
    const hasPending = this.checkPendingOutcome();
    if (!hasPending) {
      this.log("✨ No pending trace. Capturing baseline snapshot.");
      this.captureBaseline();
    }

    // FIX (BUG): beforeunload must ALSO flush the queue, not just save pendingTraceId.
    // Old code only wrote to sessionStorage; any queued events that hadn't been sent
    // yet were silently discarded. Now we beacon-flush first, then persist the trace.
    window.addEventListener("beforeunload", () => {
      // Step 1 — send everything in the queue while we still can
      this._beaconFlushAll();

      // Step 2 — persist the pending traceId so the next page can emit its outcome
      if (this.pendingTraceId) {
        this.log("💾 Saving pending action to storage before unload", {
          traceId: this.pendingTraceId,
        });
        this._safeSetStorage(
          "session",
          "air_pending_trace",
          JSON.stringify({
            traceId: this.pendingTraceId,
            timestamp: Date.now(),
          }),
        );
      }
    });

    this.log("✅ AIR Interceptor ready");

    // Item 1.1 + 1.2: Wire up SPA route change detection (pushState/popstate + hashchange)
    // Must run AFTER quiescence is initialised so the settler is available immediately.
    this._monitorSPARoutes();
  }

  // ============================================================
  // DOM CAPTURE (SPA-aware, performance-safeguarded)
  // ============================================================

  /** Detect SPA framework and whether mount root has content. */
  detectSPA() {
    const app =
      document.getElementById("app") ||
      document.querySelector("[data-app]") ||
      document.body;
    const hasVue = !!document.querySelector("[data-v-]") || !!app?.__vue__;
    const hasReact =
      !!document.querySelector("[data-reactroot]") ||
      !!document.querySelector("[data-reactid]") ||
      app?.__reactContainer$ != null;
    const isEmptyRoot =
      app &&
      app.children.length === 0 &&
      (!app.textContent || !app.textContent.trim());
    return { hasVue, hasReact, isEmptyRoot, app };
  }

  // IMPORTANT: Must stay identical to @air/shared/src/anchor-utils.ts
  // Keep in sync until interceptor can import shared package
  normalizeAnchor(text) {
    if (!text) return "";
    return String(text)
      .replace(/\(\s*\d+\s*\)/g, "") // "Inbox (5)" -> "Inbox"
      .replace(/\b\d+\s*(new|items?|results?|unread)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // MUST stay in sync with packages/shared/src/url-utils.ts::normalizeUrl
  normalizeUrl(url) {
    try {
      const u = new URL(url, window.location.href);
      const path = u.pathname.replace(/\/$/, "") || "/";
      return `${u.origin}${path}`;
    } catch {
      return url;
    }
  }

  getPrimaryHeading(root = document) {
    const h1 = root.querySelector?.("h1");
    if (!h1) return null;
    const text = this.normalizeAnchor(h1.textContent || "").slice(0, 50);
    return text || null;
  }

  computeControlSignature(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    const forms = scope.querySelectorAll("form").length;

    const inputs = new Set();
    scope.querySelectorAll("input, select, textarea").forEach((el) => {
      const name =
        el.getAttribute("name") ||
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("type") ||
        "unnamed";
      const normalized = this.normalizeAnchor(name).toLowerCase();
      if (normalized) inputs.add(normalized);
    });

    const buttons = new Set();
    scope
      .querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']")
      .forEach((el) => {
        const label =
          (el.textContent || "").trim() ||
          el.getAttribute("aria-label") ||
          el.getAttribute("value") ||
          "unlabeled";
        const normalized = this.normalizeAnchor(label).toLowerCase().slice(0, 40);
        if (normalized) buttons.add(normalized);
      });

    const links = new Set();
    scope.querySelectorAll("a[href]").forEach((el) => {
      const label = this.normalizeAnchor((el.textContent || "").trim()).toLowerCase().slice(0, 40);
      if (label) links.add(label);
    });
    const topLinks = [...links].sort().slice(0, 10);

    const raw = `forms:${forms}|inputs:${[...inputs].sort().join(",")}|buttons:${[...buttons].sort().join(",")}|links:${topLinks.join(",")}`;
    return raw.length > 0 ? this.simpleHash(raw) : null;
  }

  _collapseAnchorWhitespace(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  _normalizeCompositeTokenValue(text) {
    return this._collapseAnchorWhitespace(text).toLowerCase();
  }

  _isLikelyVolatileAnchorValue(value) {
    const normalized = this._collapseAnchorWhitespace(value);
    if (!normalized) return true;
    if (normalized.length > 80) return true;
    if (/\b\d{6,}\b/.test(normalized)) return true;
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(normalized)) return true;
    if (/[A-Za-z0-9_-]{20,}/.test(normalized)) return true;
    return false;
  }

  _isStableTextAnchorValue(value) {
    const normalized = this._collapseAnchorWhitespace(value);
    if (!normalized) return false;
    if (normalized.length < 2 || normalized.length > 40) return false;
    if (this._isLikelyVolatileAnchorValue(normalized)) return false;
    return true;
  }

  _compositeToken(prefix, value) {
    const normalized = this._normalizeCompositeTokenValue(value);
    if (!normalized) return null;
    return `${prefix}:${normalized}`;
  }

  _safeAnchorAttr(el, name) {
    try {
      return el.getAttribute(name);
    } catch {
      return null;
    }
  }

  _stableAttributeToken(el, tagName = null) {
    const tag = String(tagName || el.tagName || "node").toLowerCase();
    const testId = this.normalizeAnchor(
      this._safeAnchorAttr(el, "data-testid") ||
      this._safeAnchorAttr(el, "data-cy") ||
      this._safeAnchorAttr(el, "data-qa"),
    );
    if (testId && !this._isLikelyVolatileAnchorValue(testId)) {
      return this._compositeToken(`${tag}.testid`, testId);
    }

    const id = this.normalizeAnchor(el.id || "");
    if (id && !/\d{5,}/.test(id) && !this._isLikelyVolatileAnchorValue(id)) {
      return this._compositeToken(`${tag}.id`, id);
    }

    const name = this.normalizeAnchor(this._safeAnchorAttr(el, "name"));
    if (name && !this._isLikelyVolatileAnchorValue(name)) {
      return this._compositeToken(`${tag}.name`, name);
    }

    const ariaLabel = this.normalizeAnchor(this._safeAnchorAttr(el, "aria-label"));
    if (ariaLabel && this._isStableTextAnchorValue(ariaLabel)) {
      return this._compositeToken(`${tag}.aria`, ariaLabel);
    }

    const role = this.normalizeAnchor(this._safeAnchorAttr(el, "role"));
    if (role && !this._isLikelyVolatileAnchorValue(role)) {
      return this._compositeToken(`${tag}.role`, role);
    }

    return null;
  }

  _stableTextToken(el, prefix) {
    const text = this.normalizeAnchor(el.textContent || "");
    if (!this._isStableTextAnchorValue(text)) return null;
    return this._compositeToken(prefix, text);
  }

  _sortAndDedupeCompositeTokens(tokens) {
    return [...new Set(tokens.filter((token) => typeof token === "string" && token.length > 0))]
      .sort((left, right) => left.localeCompare(right));
  }

  _buildCompositeDescriptor(kind, scopeToken, tokens) {
    const parts = [kind];
    if (scopeToken) parts.push(`scope=${scopeToken}`);
    if (tokens.length > 0) parts.push(`tokens=${tokens.join("|")}`);
    return parts.join("|");
  }

  _extractHeadingText(container) {
    const headings = container.querySelectorAll("h1, h2, h3, legend, [role='heading']");
    for (const heading of headings) {
      const text = this.normalizeAnchor(heading.textContent || "");
      if (this._isStableTextAnchorValue(text)) return text;
    }
    return null;
  }

  _deriveCompositeScope(container) {
    const scopeTag = container.tagName ? container.tagName.toLowerCase() : null;
    const scopeRole = this._normalizeCompositeTokenValue(this._safeAnchorAttr(container, "role")) || null;
    const scopeId = this._normalizeCompositeTokenValue(container.id || "") || null;
    const scopeName = this._normalizeCompositeTokenValue(this._safeAnchorAttr(container, "name")) || null;
    const labelSource =
      this._safeAnchorAttr(container, "aria-label") ||
      this._safeAnchorAttr(container, "aria-labelledby") ||
      ((scopeTag === "dialog" || scopeRole === "dialog") ? this._extractHeadingText(container) : null);
    const scopeLabel = this._isStableTextAnchorValue(labelSource)
      ? this._normalizeCompositeTokenValue(labelSource)
      : null;

    const scopeToken =
      this._stableAttributeToken(container, scopeTag || "scope") ||
      (scopeLabel ? this._compositeToken(`${scopeTag || "scope"}.label`, scopeLabel) : null) ||
      (scopeRole ? this._compositeToken(`${scopeTag || "scope"}.role`, scopeRole) : null);

    return {
      scopeTag,
      scopeRole,
      scopeId,
      scopeName,
      scopeLabel,
      scopeToken,
    };
  }

  _countContainerNodes(container, maxNodes = 220) {
    let count = 0;
    const stack = [container];
    while (stack.length > 0 && count <= maxNodes) {
      const current = stack.pop();
      if (!current) continue;
      count++;
      for (let i = current.children.length - 1; i >= 0; i--) {
        const child = current.children.item(i);
        if (child instanceof Element) stack.push(child);
      }
    }
    return count;
  }

  _collectCompositeControls(container, selector, maxItems = 12, maxDepth = 6) {
    const collected = [];
    const seen = new Set();
    const stack = [{ node: container, depth: 0 }];

    while (stack.length > 0 && collected.length < maxItems) {
      const current = stack.pop();
      if (!current) continue;

      if (current.depth > 0 && current.node.matches(selector) && !seen.has(current.node)) {
        collected.push(current.node);
        seen.add(current.node);
      }

      if (current.depth >= maxDepth) continue;
      for (let i = current.node.children.length - 1; i >= 0; i--) {
        const child = current.node.children.item(i);
        if (child instanceof Element) {
          stack.push({ node: child, depth: current.depth + 1 });
        }
      }
    }

    return collected;
  }

  _firstStableTextToken(elements, prefix) {
    for (const element of elements) {
      const token = this._stableTextToken(element, prefix);
      if (token) return token;
      const attrToken = this._stableAttributeToken(element);
      if (attrToken) return attrToken;
    }
    return null;
  }

  _getStableRowIdentifier(row) {
    const rowToken = this._stableAttributeToken(row, "tr");
    if (rowToken) return rowToken;

    const directCells = Array.from(row.children || [])
      .filter((child) => child && typeof child.tagName === "string")
      .filter((child) => /^(td|th)$/i.test(child.tagName));
    if (directCells.length === 0) return null;

    const firstCell = directCells[0];
    return (
      this._stableAttributeToken(firstCell, firstCell.tagName.toLowerCase()) ||
      this._stableTextToken(firstCell, "row")
    );
  }

  _chooseStableControlToken(el) {
    return (
      this._stableAttributeToken(el) ||
      this._stableTextToken(el, `${el.tagName.toLowerCase()}.text`) ||
      (el.tagName.toLowerCase() === "input"
        ? this._compositeToken("input.type", this.normalizeAnchor(this._safeAnchorAttr(el, "type") || "text"))
        : null)
    );
  }

  _buildCompositeAnchor(kind, container, tokens, confidence) {
    const normalizedTokens = this._sortAndDedupeCompositeTokens(tokens);
    if (normalizedTokens.length === 0) return null;

    const scope = this._deriveCompositeScope(container);
    const descriptor = this._buildCompositeDescriptor(kind, scope.scopeToken, normalizedTokens);
    return {
      kind,
      scopeTag: scope.scopeTag,
      scopeRole: scope.scopeRole,
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeLabel: scope.scopeLabel,
      tokens: normalizedTokens,
      descriptor,
      confidence,
      _sortScore: confidence * 100 + normalizedTokens.length,
    };
  }

  _scanCompositeContainers(root, selector, limit) {
    const found = root.querySelectorAll(selector);
    const results = [];
    for (const element of found) {
      if (results.length >= limit) break;
      if (element instanceof Element) results.push(element);
    }
    return results;
  }

  _generateFormCompositeAnchor(form) {
    const controls = this._collectCompositeControls(
      form,
      'input, select, textarea, button, [role="button"], [data-testid], [name]',
    );
    const fieldTokens = controls
      .map((control) => {
        const tag = control.tagName.toLowerCase();
        if (tag === "button" || this._safeAnchorAttr(control, "role") === "button") {
          return this._chooseStableControlToken(control);
        }
        return (
          this._compositeToken(`${tag}.name`, this.normalizeAnchor(this._safeAnchorAttr(control, "name"))) ||
          this._stableAttributeToken(control, tag) ||
          this._compositeToken(`${tag}.type`, this.normalizeAnchor(this._safeAnchorAttr(control, "type")))
        );
      })
      .filter(Boolean)
      .slice(0, 12);

    const formAction = this.normalizeAnchor(this._safeAnchorAttr(form, "action"));
    const formActionToken =
      formAction && !this._isLikelyVolatileAnchorValue(formAction)
        ? this._compositeToken("form.action", formAction.toLowerCase())
        : null;
    const headingToken = this._compositeToken("form.label", this._extractHeadingText(form));

    return this._buildCompositeAnchor(
      "form_cluster",
      form,
      [formActionToken, headingToken, ...fieldTokens],
      0.95,
    );
  }

  _generateTableRowCompositeAnchors(table) {
    const headerCells = Array.from(table.querySelectorAll("thead th, th[scope='col'], tr:first-child th"))
      .map((cell) => this.normalizeAnchor(cell.textContent || ""))
      .filter((text) => text.length >= 2 && text.length <= 30 && !this._isLikelyVolatileAnchorValue(text))
      .slice(0, 6);
    const headerTokens = headerCells.map((header) => this._compositeToken("header", header));
    if (headerTokens.length === 0) return [];

    const rows = Array.from(table.querySelectorAll("tbody tr, tr"))
      .filter((row) => row.querySelector("td,th"))
      .slice(0, 6);
    const anchors = [];

    for (const row of rows) {
      const rowControls = this._collectCompositeControls(
        row,
        'button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"], a[href]',
        6,
        3,
      );
      if (rowControls.length === 0) continue;

      const rowIdentifier = this._getStableRowIdentifier(row);
      if (!rowIdentifier) continue;

      const actionTokens = rowControls
        .map((control) => this._chooseStableControlToken(control))
        .filter(Boolean)
        .slice(0, 4);
      if (actionTokens.length === 0) continue;

      const anchor = this._buildCompositeAnchor(
        "table_row",
        row,
        [...headerTokens, rowIdentifier, ...actionTokens],
        0.96,
      );
      if (anchor) anchors.push(anchor);
    }

    return anchors;
  }

  _generateDialogCompositeAnchor(dialog) {
    const titleToken =
      this._compositeToken("dialog.title", this._extractHeadingText(dialog)) ||
      this._compositeToken("dialog.label", this.normalizeAnchor(this._safeAnchorAttr(dialog, "aria-label")));
    const actionTokens = this._collectCompositeControls(
      dialog,
      'button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"], a[href]',
      8,
      5,
    )
      .map((control) => this._chooseStableControlToken(control))
      .filter(Boolean)
      .slice(0, 6);

    return this._buildCompositeAnchor(
      "dialog_actions",
      dialog,
      [titleToken, ...actionTokens],
      0.93,
    );
  }

  _generateMenuCompositeAnchor(container) {
    const labelToken =
      this._compositeToken("menu.label", this.normalizeAnchor(this._safeAnchorAttr(container, "aria-label"))) ||
      this._compositeToken("menu.heading", this._extractHeadingText(container));
    const optionTokens = this._collectCompositeControls(
      container,
      '[role="menuitem"], [role="option"], option, button, [role="button"], a[href], li',
      10,
      4,
    )
      .map((control) => this._chooseStableControlToken(control))
      .filter(Boolean)
      .slice(0, 8);

    return this._buildCompositeAnchor(
      "menu_group",
      container,
      [labelToken, ...optionTokens],
      0.9,
    );
  }

  _generateContainerCompositeAnchor(container) {
    const controlTokens = this._collectCompositeControls(
      container,
      'button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"], a[href]',
      8,
      4,
    )
      .map((control) => this._chooseStableControlToken(control))
      .filter(Boolean)
      .slice(0, 6);
    const labelToken =
      this._compositeToken("container.label", this.normalizeAnchor(this._safeAnchorAttr(container, "aria-label"))) ||
      this._compositeToken("container.heading", this._extractHeadingText(container));

    return this._buildCompositeAnchor(
      "container_controls",
      container,
      [labelToken, ...controlTokens],
      0.82,
    );
  }

  _selectCompositeAnchors(candidates) {
    const byKind = new Map();
    for (const candidate of candidates) {
      const list = byKind.get(candidate.kind) || [];
      list.push(candidate);
      byKind.set(candidate.kind, list);
    }

    const keptPerKind = [];
    let droppedCompositeCount = 0;

    byKind.forEach((list) => {
      const sorted = [...list].sort(
        (left, right) =>
          right._sortScore - left._sortScore ||
          right.confidence - left.confidence ||
          left.descriptor.localeCompare(right.descriptor),
      );
      keptPerKind.push(...sorted.slice(0, 3));
      droppedCompositeCount += Math.max(0, sorted.length - 3);
    });

    const finalAnchors = keptPerKind
      .sort(
        (left, right) =>
          right._sortScore - left._sortScore ||
          right.confidence - left.confidence ||
          left.descriptor.localeCompare(right.descriptor),
      )
      .slice(0, 8);

    droppedCompositeCount += Math.max(0, keptPerKind.length - finalAnchors.length);

    return {
      anchors: finalAnchors.map(({ _sortScore, ...anchor }) => anchor),
      droppedCompositeCount,
      skippedCompositeCount: 0,
      finalCompositeCount: finalAnchors.length,
      formScanMs: 0,
      dialogScanMs: 0,
      tableScanMs: 0,
      menuScanMs: 0,
      containerScanMs: 0,
    };
  }

  _anchorNowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  scanCompositeAnchorsDetailed(root = document) {
    const candidates = [];
    const skippedCompositeReasons = [];
    let inspectedContainerCount = 0;
    let skippedCompositeCount = 0;
    let formScanMs = 0;
    let dialogScanMs = 0;
    let tableScanMs = 0;
    let menuScanMs = 0;
    let containerScanMs = 0;

    const inspectContainer = (kind, container, build) => {
      inspectedContainerCount++;
      if (this._countContainerNodes(container, 221) > 220) {
        skippedCompositeReasons.push("container_too_large");
        skippedCompositeCount += 1;
        return;
      }
      const built = build(container);
      if (!built) return;
      if (Array.isArray(built)) candidates.push(...built);
      else candidates.push(built);
    };

    let scanStartedAt = this._anchorNowMs();
    const forms = this._scanCompositeContainers(root, "form", 6);
    forms.forEach((form) => inspectContainer("form_cluster", form, (container) => this._generateFormCompositeAnchor(container)));
    formScanMs = this._anchorNowMs() - scanStartedAt;

    scanStartedAt = this._anchorNowMs();
    const dialogs = this._scanCompositeContainers(root, 'dialog, [role="dialog"]', 6);
    dialogs.forEach((dialog) => inspectContainer("dialog_actions", dialog, (container) => this._generateDialogCompositeAnchor(container)));
    dialogScanMs = this._anchorNowMs() - scanStartedAt;

    scanStartedAt = this._anchorNowMs();
    const tables = this._scanCompositeContainers(root, "table", 6);
    tables.forEach((table) => inspectContainer("table_row", table, (container) => this._generateTableRowCompositeAnchors(container)));
    tableScanMs = this._anchorNowMs() - scanStartedAt;

    scanStartedAt = this._anchorNowMs();
    const menus = this._scanCompositeContainers(root, '[role="menu"], [role="listbox"], [role="list"], nav, [role="group"]', 6);
    menus.forEach((menu) => inspectContainer("menu_group", menu, (container) => this._generateMenuCompositeAnchor(container)));
    menuScanMs = this._anchorNowMs() - scanStartedAt;

    scanStartedAt = this._anchorNowMs();
    const containers = this._scanCompositeContainers(
      root,
      'section, [role="region"], [role="group"], [role="toolbar"], [role="navigation"], main, aside',
      6,
    );
    containers.forEach((container) => inspectContainer("container_controls", container, (current) => this._generateContainerCompositeAnchor(current)));
    containerScanMs = this._anchorNowMs() - scanStartedAt;

    const uniqueCandidates = candidates.filter(
      (candidate, index, arr) =>
        arr.findIndex((other) => other.descriptor === candidate.descriptor) === index,
    );
    const selected = this._selectCompositeAnchors(uniqueCandidates);
    return {
      anchors: selected.anchors,
      inspectedContainerCount,
      droppedCompositeCount: selected.droppedCompositeCount,
      skippedCompositeReasons: [...new Set(skippedCompositeReasons)].sort(),
      skippedCompositeCount,
      finalCompositeCount: selected.anchors.length,
      formScanMs,
      dialogScanMs,
      tableScanMs,
      menuScanMs,
      containerScanMs,
    };
  }

  // IMPORTANT: Must stay identical to @air/shared/src/anchor-utils.ts
  // Keep in sync until interceptor can import shared package
  scanCompositeAnchors(root = document) {
    return this.scanCompositeAnchorsDetailed(root).anchors;
  }

  _nextSnapshotBuildId() {
    this._snapshotBuildSeq = (this._snapshotBuildSeq || 0) + 1;
    return `snapshot-build-${this._snapshotBuildSeq}`;
  }

  _trackRepeatedAnchorScan(traceId = null, normalizedUrl = null) {
    const key = traceId || normalizedUrl || "untracked";
    const now = Date.now();
    const windowMs = 5000;
    const maxEntries = 20;
    if (!this._recentAnchorScans) {
      this._recentAnchorScans = new Map();
    }

    for (const [existingKey, record] of this._recentAnchorScans.entries()) {
      if (!record || (now - record.lastSeenAt) > windowMs) {
        this._recentAnchorScans.delete(existingKey);
      }
    }

    const current = this._recentAnchorScans.get(key);
    const repeatedScanCount = current && (now - current.lastSeenAt) <= windowMs
      ? current.count
      : 0;
    this._recentAnchorScans.set(key, {
      count: repeatedScanCount + 1,
      lastSeenAt: now,
    });

    while (this._recentAnchorScans.size > maxEntries) {
      const firstKey = this._recentAnchorScans.keys().next().value;
      if (!firstKey) break;
      this._recentAnchorScans.delete(firstKey);
    }

    return repeatedScanCount;
  }

  _buildAnchorSnapshotData(root = document, meta = {}) {
    let anchors = [];
    let compositeAnchors = [];
    let compositeResult = {
      inspectedContainerCount: 0,
      droppedCompositeCount: 0,
      skippedCompositeReasons: [],
      skippedCompositeCount: 0,
      finalCompositeCount: 0,
      formScanMs: 0,
      dialogScanMs: 0,
      tableScanMs: 0,
      menuScanMs: 0,
      containerScanMs: 0,
    };
    const snapshotBuildId = this._nextSnapshotBuildId();
    const traceId = typeof meta.traceId === "string" && meta.traceId.length > 0
      ? meta.traceId
      : (this.pendingTraceId || this.lastActionTraceId || null);
    const normalizedUrl = typeof meta.normalizedUrl === "string" && meta.normalizedUrl.length > 0
      ? meta.normalizedUrl
      : this.normalizeUrl(window.location.href);
    const stage = typeof meta.stage === "string" && meta.stage.length > 0
      ? meta.stage
      : "snapshot";
    const totalStartedAt = this._anchorNowMs();
    const flatStartedAt = this._anchorNowMs();
    let flatAnchorScanMs = 0;
    let compositeAnchorScanMs = 0;

    try {
      anchors = this.scanPageAnchors(root);
    } catch (_) {}
    flatAnchorScanMs = this._anchorNowMs() - flatStartedAt;

    const compositeStartedAt = this._anchorNowMs();
    try {
      compositeResult = this.scanCompositeAnchorsDetailed(root);
      compositeAnchors = Array.isArray(compositeResult.anchors) ? compositeResult.anchors : [];
    } catch (_) {}
    compositeAnchorScanMs = this._anchorNowMs() - compositeStartedAt;
    const totalAnchorScanMs = this._anchorNowMs() - totalStartedAt;
    const repeatedScanCount = this._trackRepeatedAnchorScan(traceId, normalizedUrl);

    if (this.config.debugMode) {
      this.log("[ANCHOR_SCAN]", {
        stage,
        snapshotBuildId,
        traceId,
        normalizedUrl,
        anchorScanTotalMs: Math.round(totalAnchorScanMs * 100) / 100,
        totalAnchorScanMs: Math.round(totalAnchorScanMs * 100) / 100,
        flatScanMs: Math.round(flatAnchorScanMs * 100) / 100,
        flatAnchorScanMs: Math.round(flatAnchorScanMs * 100) / 100,
        compositeScanMs: Math.round(compositeAnchorScanMs * 100) / 100,
        compositeAnchorScanMs: Math.round(compositeAnchorScanMs * 100) / 100,
        formScanMs: Math.round((compositeResult.formScanMs || 0) * 100) / 100,
        dialogScanMs: Math.round((compositeResult.dialogScanMs || 0) * 100) / 100,
        tableScanMs: Math.round((compositeResult.tableScanMs || 0) * 100) / 100,
        menuScanMs: Math.round((compositeResult.menuScanMs || 0) * 100) / 100,
        containerScanMs: Math.round((compositeResult.containerScanMs || 0) * 100) / 100,
        inspectedContainerCount: compositeResult.inspectedContainerCount || 0,
        skippedCompositeCount: compositeResult.skippedCompositeCount || 0,
        finalCompositeCount: compositeResult.finalCompositeCount || compositeAnchors.length,
        droppedCompositeCount: compositeResult.droppedCompositeCount || 0,
        repeatedScanCount,
      });
    }

    return {
      anchors,
      compositeAnchors,
      anchorMetrics: {
        snapshotBuildId,
        traceId,
        repeatedScanCount,
        anchorScanTotalMs: totalAnchorScanMs,
        totalAnchorScanMs,
        flatScanMs: flatAnchorScanMs,
        flatAnchorScanMs,
        compositeScanMs: compositeAnchorScanMs,
        compositeAnchorScanMs,
        formScanMs: compositeResult.formScanMs || 0,
        dialogScanMs: compositeResult.dialogScanMs || 0,
        tableScanMs: compositeResult.tableScanMs || 0,
        menuScanMs: compositeResult.menuScanMs || 0,
        containerScanMs: compositeResult.containerScanMs || 0,
        flatAnchorCount: anchors.length,
        compositeAnchorCount: compositeAnchors.length,
        finalCompositeCount: compositeResult.finalCompositeCount || compositeAnchors.length,
        compositeSample: compositeAnchors.slice(0, 3).map((anchor) => anchor.descriptor),
        droppedCompositeCount: compositeResult.droppedCompositeCount || 0,
        inspectedContainerCount: compositeResult.inspectedContainerCount || 0,
        skippedCompositeCount: compositeResult.skippedCompositeCount || 0,
        skippedCompositeReason: Array.isArray(compositeResult.skippedCompositeReasons) &&
          compositeResult.skippedCompositeReasons.includes("container_too_large")
          ? "container_too_large"
          : null,
      },
    };
  }

  // IMPORTANT: Must stay identical to @air/shared/src/anchor-utils.ts
  // Keep in sync until interceptor can import shared package
  scanPageAnchors(root = document) {
    const anchors = [];
    // 1. URL Path (Strongest Anchor)
    anchors.push(`URL:${window.location.pathname}`);

    // 2. Interactive Elements & Landmarks
    // We only care about things that define the "Function" of the page.
    const elements = root.querySelectorAll(
      'input, button, select, textarea, form, h1, h2, h3, [role="button"]',
    );

    elements.forEach((el) => {
      if (el.type === "hidden" || el.style.display === "none") return;

      const tag = el.tagName.toUpperCase();

      // Prioritize Stable Attributes
      // Logic: ID > Name > TestID > Role > Text (if short)
      if (el.getAttribute("data-testid")) {
        const normalizedTestId = this.normalizeAnchor(el.getAttribute("data-testid"));
        if (normalizedTestId.length > 1) anchors.push(`${tag}:testid=${normalizedTestId}`);
      } else if (el.id && !/\d{5,}/.test(el.id)) {
        // Ignore IDs with long numbers
        const normalizedId = this.normalizeAnchor(el.id);
        if (normalizedId.length > 1) anchors.push(`${tag}:id=${normalizedId}`);
      } else if (el.name) {
        const normalizedName = this.normalizeAnchor(el.name);
        if (normalizedName.length > 1) anchors.push(`${tag}:name=${normalizedName}`);
      } else if (el.getAttribute("role")) {
        const normalizedRole = this.normalizeAnchor(el.getAttribute("role"));
        if (normalizedRole.length > 1) anchors.push(`${tag}:role=${normalizedRole}`);
      } else if (tag === "BUTTON" || tag === "H1" || tag === "H2") {
        const text = this.normalizeAnchor(el.textContent || "");
        if (text.length > 2 && text.length < 30) {
          anchors.push(`${tag}:text=${text}`);
        }
      } else if (tag === "INPUT") {
        const inputType = this.normalizeAnchor(el.type || "text").toLowerCase();
        if (inputType.length > 1) anchors.push(`${tag}:type=${inputType}`);
      }
    });

    // Remove duplicates and sort for deterministic hashing
    return [...new Set(anchors)].sort();
  }

  /** * Wait for SPA to render and stabilize (Hydration Check)
   * VERSION: 7.0 (Quiescence Engine Integration)
   */
  async waitForSPAContent(timeoutMs = 5000) {
    const { app } = this.detectSPA();
    if (!app) return null; // Not an SPA, proceed immediately

    const budget = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : this.config.snapshotContentReadyTimeoutMs;

    this.log("⏳ SPA detected. Waiting for hydration/quiescence...");

    if (this.quiescence) {
      const readiness = await this._waitForSettleAndReady("spa-hydration", budget);
      this.log("✅ SPA Hydrated", {
        settleReason: readiness?.settleResult?.reason || "unknown",
        settleStable: readiness?.settleResult?.stable ?? null,
        contentReady: readiness?.readinessResult?.ready ?? null,
        busy: readiness?.busyResult?.busy ?? null,
        forcedCapture: readiness?.busyResult?.forcedCapture ?? null,
        matchedProductSignal: readiness?.readinessResult?.matchedProductSignal || null,
      });
      return readiness;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(2000, budget)));
    this.log("⚠️ SPA Hydration fallback timeout reached");
    return null;
  }

  _isLikelyProductPage(url = window.location.href) {
    const text = String(url || "").toLowerCase();
    return (
      /\/product(s)?\//.test(text) ||
      /\/p\//.test(text) ||
      /\/dp\//.test(text) ||
      /[?&]pid=/.test(text) ||
      /[?&]sku=/.test(text) ||
      /[?&]product/.test(text)
    );
  }

  _isElementVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    try {
      if (el.hidden) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (_) {
      return false;
    }
  }

  _pushBusyReason(reasons, reason) {
    if (!Array.isArray(reasons) || typeof reason !== "string") return;
    const normalized = reason.trim();
    if (!normalized || reasons.includes(normalized)) return;
    const maxReasons = Math.max(1, this.config.snapshotBusyMaxLoggedReasons || 5);
    if (reasons.length < maxReasons) {
      reasons.push(normalized);
    }
  }

  _matchesBusySignalHint(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return false;
    return /(^|[\s:_-])(spinner|loader|skeleton)(?=$|[\s:_-])/.test(normalized);
  }

  _matchesBusySignalText(value) {
    const normalized = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!normalized) return false;
    return /\b(loading|please wait|processing|saving|submitting|fetching|retrieving|syncing|updating)\b/.test(normalized);
  }

  _isBusyCandidateVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    try {
      if (el.hidden) return false;
      const rect = el.getBoundingClientRect();
      return el.offsetParent !== null || (rect.width > 0 && rect.height > 0);
    } catch (_) {
      return false;
    }
  }

  _describeBusyText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  _detectBusySignals(root = document) {
    const queryRoot =
      root && typeof root.querySelectorAll === "function"
        ? root
        : document;
    const reasons = [];
    const maxCandidatesToCheck = 24;
    const selectors = [
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[role="status"]',
      '[aria-live]',
      '[class*="spinner"]',
      '[class*="loader"]',
      '[class*="skeleton"]',
      '[id*="spinner"]',
      '[id*="loader"]',
      '[id*="skeleton"]',
      '[data-testid*="spinner"]',
      '[data-testid*="loader"]',
      '[data-testid*="skeleton"]',
    ];
    let candidates = [];
    try {
      candidates = Array.from(
        queryRoot.querySelectorAll(selectors.join(",")),
      ).slice(0, maxCandidatesToCheck);
    } catch (_) {
      candidates = [];
    }

    let busyVisibleCount = 0;
    let busyIgnoredHiddenCount = 0;

    for (const el of candidates) {
      if (!this._isBusyCandidateVisible(el)) {
        busyIgnoredHiddenCount++;
        continue;
      }
      busyVisibleCount++;

      const ariaBusy = String(el.getAttribute?.("aria-busy") || "").toLowerCase();
      if (ariaBusy === "true") {
        this._pushBusyReason(reasons, 'aria-busy="true"');
        continue;
      }

      const role = String(el.getAttribute?.("role") || "").toLowerCase();
      if (role === "progressbar") {
        this._pushBusyReason(reasons, 'role="progressbar"');
        continue;
      }

      const hintValues = [
        el.className,
        el.id,
        el.getAttribute?.("data-testid"),
      ];
      const hintValue = hintValues.find((value) => this._matchesBusySignalHint(value));
      if (hintValue) {
        this._pushBusyReason(
          reasons,
          `loader-hint:${String(hintValue).replace(/\s+/g, " ").trim().slice(0, 60)}`,
        );
        continue;
      }

      const text = this._describeBusyText(el.textContent || el.getAttribute?.("aria-label") || "");
      if (
        text &&
        this._matchesBusySignalText(text) &&
        (role === "status" || el.hasAttribute?.("aria-live"))
      ) {
        this._pushBusyReason(reasons, `loading-text:${text}`);
      }
    }

    this.log("[BUSY_DETECT]", {
      busyCandidatesFound: candidates.length,
      busyVisibleCount,
      busyIgnoredHiddenCount,
      busyReasons: reasons,
    });

    return {
      busy: reasons.length > 0,
      reasons,
      forcedCapture: false,
    };
  }

  async _waitForBusySignalsToClear(reason = "snapshot", timeoutMs = null) {
    const maxWait = Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : this.config.snapshotBusyMaxWaitMs;
    const pollMs = Math.max(50, this.config.snapshotBusyPollMs || 150);
    const start = Date.now();
    let attempts = 0;
    let last = this._detectBusySignals(document);

    while (Date.now() - start <= maxWait) {
      attempts++;
      last = this._detectBusySignals(document);
      if (!last.busy) {
        return {
          ...last,
          forcedCapture: false,
          attempts,
          waitedMs: Date.now() - start,
          reason,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return {
      ...last,
      forcedCapture: last.busy === true,
      attempts,
      waitedMs: Date.now() - start,
      reason,
    };
  }

  _buildSnapshotStability(waitResult = null) {
    const fallbackBusy = waitResult?.busyResult || this._detectBusySignals(document);
    const busyReasons = Array.isArray(fallbackBusy?.reasons)
      ? fallbackBusy.reasons.slice(0, Math.max(1, this.config.snapshotBusyMaxLoggedReasons || 5))
      : [];
    const settleStable = waitResult?.settleResult
      ? waitResult.settleResult.stable === true
      : !this.quiescence ||
        (this.quiescence.activeNetworkCount === 0 &&
          this.quiescence.domMutationTimer === null);
    const contentReady = waitResult?.readinessResult
      ? waitResult.readinessResult.ready === true
      : true;
    const forcedCapture = waitResult?.busyResult?.forcedCapture === true;
    const busy = waitResult?.busyResult
      ? waitResult.busyResult.busy === true
      : fallbackBusy.busy === true;
    const isStable = settleStable && contentReady && !busy && !forcedCapture;

    return {
      isStable,
      settleStable,
      contentReady,
      busy,
      busyReasons,
      forcedCapture,
    };
  }

  _buildOutcomeCaptureMeta(pageSnapshot, interactionContext) {
    const pageMetrics = pageSnapshot?.metrics || {};
    const icMetrics = interactionContext?.metrics || {};
    const forcedCapture =
      pageMetrics.forcedCapture === true || icMetrics.forcedCapture === true;
    const busyAtCapture =
      pageMetrics.busyAtCapture === true || icMetrics.busyAtCapture === true;
    const busyReasons = [
      ...(Array.isArray(pageMetrics.busyReasons) ? pageMetrics.busyReasons : []),
      ...(Array.isArray(icMetrics.busyReasons) ? icMetrics.busyReasons : []),
    ].filter((value, index, arr) => typeof value === "string" && arr.indexOf(value) === index);

    return {
      forcedCapture,
      busyAtCapture,
      busyReasons: busyReasons.slice(
        0,
        Math.max(1, this.config.snapshotBusyMaxLoggedReasons || 5),
      ),
    };
  }

  _findFirstVisibleMatch(selectors, root = document) {
    const list = Array.isArray(selectors) ? selectors : [];
    const queryRoot = root && typeof root.querySelector === "function" ? root : document;
    for (const selector of list) {
      if (typeof selector !== "string" || !selector.trim()) continue;
      try {
        const el = queryRoot.querySelector(selector);
        if (el && this._isElementVisible(el)) {
          return { selector, element: el };
        }
      } catch (_) {
        // Ignore invalid selectors in runtime config.
      }
    }
    return null;
  }

  _resolveReadinessRoot(isProductPage) {
    const fallback = document.body || document.documentElement;
    if (!isProductPage) return fallback;
    const rootMatch = this._findFirstVisibleMatch(this.config.snapshotProductRootSelectors, document);
    return rootMatch?.element || fallback;
  }

  _findProductReadySignal(root) {
    const queryRoot = root && typeof root.querySelector === "function" ? root : document;
    const selectorList = Array.isArray(this.config.snapshotProductReadySelectors)
      ? this.config.snapshotProductReadySelectors
      : [];
    for (const selector of selectorList) {
      if (typeof selector !== "string" || !selector.trim()) continue;
      try {
        const candidate = queryRoot.querySelector(selector);
        if (!candidate || !this._isElementVisible(candidate)) continue;
        const candidateText = (candidate.textContent || candidate.getAttribute?.("content") || "")
          .replace(/\s+/g, " ")
          .trim();
        if (selector.toLowerCase().includes("price")) {
          const looksLikePrice = /(\d{2,}|rs\.?|inr|usd|\$)/i.test(candidateText);
          if (!looksLikePrice) continue;
        }
        return {
          matched: true,
          signal: selector,
          source: "selector",
        };
      } catch (_) {}
    }

    const keywords = Array.isArray(this.config.snapshotProductReadyKeywords)
      ? this.config.snapshotProductReadyKeywords
      : [];
    const textCandidates = queryRoot.querySelectorAll(
      'button, a[href], [role="button"], [role="link"], [aria-label], [class*="price"]',
    );
    for (const candidate of textCandidates) {
      if (!this._isElementVisible(candidate)) continue;
      const text = (candidate.textContent || candidate.getAttribute?.("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!text) continue;
      const matchedKeyword = keywords.find((keyword) =>
        typeof keyword === "string" &&
        keyword.trim() &&
        text.includes(keyword.trim().toLowerCase()),
      );
      if (matchedKeyword) {
        return {
          matched: true,
          signal: matchedKeyword,
          source: "keyword",
        };
      }
    }

    return {
      matched: false,
      signal: null,
      source: null,
    };
  }

  _collectSnapshotReadiness() {
    const isProductPage = this._isLikelyProductPage(window.location.href);
    const root = this._resolveReadinessRoot(isProductPage);
    const interactiveSelector = Array.isArray(this.config.snapshotInteractiveSelectors)
      ? this.config.snapshotInteractiveSelectors.join(",")
      : "a[href],button,input,select,textarea";
    const skeletonSelector = Array.isArray(this.config.snapshotSkeletonSelectors)
      ? this.config.snapshotSkeletonSelectors.join(",")
      : '[class*="skeleton"],[class*="loading"]';

    let interactiveCount = 0;
    let skeletonCount = 0;
    try {
      interactiveCount = root?.querySelectorAll?.(interactiveSelector)?.length || 0;
    } catch (_) {}
    try {
      skeletonCount = root?.querySelectorAll?.(skeletonSelector)?.length || 0;
    } catch (_) {}

    const textLength = (root?.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .length;

    const minInteractive = isProductPage
      ? this.config.snapshotProductMinInteractiveCount
      : this.config.snapshotMinInteractiveCount;
    const minTextLength = isProductPage
      ? this.config.snapshotProductMinTextLength
      : this.config.snapshotMinTextLength;

    const genericReady =
      interactiveCount >= minInteractive && textLength >= minTextLength;

    const productSignal = isProductPage
      ? this._findProductReadySignal(root)
      : { matched: true, signal: null, source: null };

    const ready = genericReady && productSignal.matched;
    return {
      ready,
      isProductPage,
      genericReady,
      interactiveCount,
      textLength,
      skeletonCount,
      minInteractive,
      minTextLength,
      matchedProductSignal: productSignal.signal,
      productSignalSource: productSignal.source,
    };
  }

  async _waitForSnapshotReadiness(reason = "snapshot", timeoutMs = null) {
    const maxWait = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : this.config.snapshotContentReadyTimeoutMs;
    const pollMs = Math.max(75, this.config.snapshotContentReadyPollMs || 200);
    const start = Date.now();
    let attempts = 0;
    let last = this._collectSnapshotReadiness();

    while (Date.now() - start <= maxWait) {
      attempts++;
      last = this._collectSnapshotReadiness();
      if (last.ready) {
        this.log("[SNAPSHOT_READY] ready", {
          reason,
          attempts,
          waitedMs: Date.now() - start,
          isProductPage: last.isProductPage,
          interactiveCount: last.interactiveCount,
          textLength: last.textLength,
          skeletonCount: last.skeletonCount,
          productSignal: last.matchedProductSignal,
        });
        return {
          ...last,
          ready: true,
          attempts,
          waitedMs: Date.now() - start,
          reason,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    this.log("[SNAPSHOT_READY] timeout", {
      reason,
      attempts,
      waitedMs: Date.now() - start,
      isProductPage: last?.isProductPage ?? null,
      interactiveCount: last?.interactiveCount ?? null,
      textLength: last?.textLength ?? null,
      skeletonCount: last?.skeletonCount ?? null,
      productSignal: last?.matchedProductSignal ?? null,
    });
    return {
      ...(last || {}),
      ready: false,
      attempts,
      waitedMs: Date.now() - start,
      reason,
    };
  }

  async _waitForSettleAndReady(reason = "snapshot", timeoutMs = null) {
    const budget = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : this.config.snapshotContentReadyTimeoutMs;
    const startedAt = Date.now();
    let settleResult = { stable: true, reason: "no-quiescence", waitedMs: 0 };

    if (this.quiescence) {
      const settleBudget = Math.max(500, Math.floor(budget * 0.6));
      try {
        settleResult = await this.quiescence.waitForSettle(settleBudget);
      } catch (err) {
        settleResult = {
          stable: false,
          reason: "quiescence-error",
          waitedMs: Date.now() - startedAt,
          error: err?.message || String(err),
        };
      }
    }

    const elapsed = Date.now() - startedAt;
    const readinessBudget = Math.max(
      this.config.snapshotContentReadyPollMs || 200,
      budget - elapsed,
    );
    const readinessResult = await this._waitForSnapshotReadiness(
      reason,
      readinessBudget,
    );
    const busyResult = await this._waitForBusySignalsToClear(reason);

    if (busyResult?.forcedCapture) {
      const warningPayload = {
        reason,
        waitedMs: busyResult.waitedMs,
        busyReasons: Array.isArray(busyResult.reasons)
          ? busyResult.reasons.slice(
              0,
              Math.max(1, this.config.snapshotBusyMaxLoggedReasons || 5),
            )
          : [],
      };
      console.warn("forced_unstable_capture", warningPayload);
      this.log("[SNAPSHOT_READY] forced unstable capture", warningPayload);
    }

    return {
      settleResult,
      readinessResult,
      busyResult,
      waitedMs: Date.now() - startedAt,
    };
  }

  _getAdaptiveSnapshotCaptureLimits() {
    const baseNodes = this.config.snapshotMaxNodes ?? 5000;
    const baseTextLength = this.config.snapshotMaxTextLength ?? 5000;
    if (!this.config.snapshotAdaptiveBoostEnabled || !this._isLikelyProductPage(window.location.href)) {
      return {
        maxNodes: baseNodes,
        maxTextLength: baseTextLength,
        profile: "default",
      };
    }

    return {
      maxNodes: Math.max(baseNodes, this.config.snapshotProductMaxNodes ?? 15000),
      maxTextLength: Math.max(
        baseTextLength,
        this.config.snapshotProductMaxTextLength ?? 15000,
      ),
      profile: "product",
    };
  }

  _snapshotPreview(html, maxChars = null) {
    const previewSize = Number.isFinite(maxChars) && maxChars > 0
      ? maxChars
      : this.config.snapshotDebugPreviewChars;
    return String(html || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, previewSize);
  }

  _logSnapshotDiagnostics(stage, snapshot) {
    if (!this.config.debugMode || !snapshot || typeof snapshot !== "object") return;
    const html = typeof snapshot.html === "string" ? snapshot.html : "";
    const bytes = new Blob([html]).size;
    this.log("[SNAPSHOT_CAPTURE]", {
      stage,
      url: snapshot.url || window.location.href,
      normalizedUrl: snapshot.normalizedUrl || this.normalizeUrl(window.location.href),
      htmlChars: html.length,
      htmlBytes: bytes,
      preview: this._snapshotPreview(html),
      metrics: snapshot.metrics || null,
    });
  }

  /** Capture DOM with depth limit, node limit, timeout, Shadow DOM, Vue/React attrs. */
  captureDOM(depth, opts = {}) {
    const maxDepth = depth ?? this.config.snapshotDepth ?? 10;
    const maxNodes = opts.maxNodes ?? this.config.snapshotMaxNodes ?? 5000;
    const timeoutMs = opts.timeoutMs ?? this.config.snapshotTimeoutMs ?? 5000;
    const maxTextLen =
      opts.maxTextLength ?? this.config.snapshotMaxTextLength ?? 5000;
    const captureVue =
      opts.captureVueAttrs ?? this.config.snapshotCaptureVueAttrs ?? true;
    const captureReact =
      opts.captureReactAttrs ?? this.config.snapshotCaptureReactAttrs ?? true;

    let nodesProcessed = 0;
    let depthReached = 0;
    const startTime = performance.now();
    const timedOut = () => performance.now() - startTime > timeoutMs;

    const shouldIncludeAttr = (name, value) => {
      if (!name || value == null) return false;
      if (name === "style") {
        // D3.5 checks display/visibility for visible-match counting.
        // Keep style only when it carries visibility-related hints.
        return /display\s*:|visibility\s*:|opacity\s*:\s*0|hidden/i.test(String(value));
      }
      if (captureVue && name.startsWith("data-v-")) return true;
      if (captureReact && name.startsWith("data-react")) return true;
      if (name === "data-testid" || name === "data-test-id") return true;
      if (name.startsWith("data-") && !name.startsWith("data-react-"))
        return true;
      return !name.startsWith("data-react-");
    };

    const captureNode = (node, currentDepth) => {
      if (timedOut() || nodesProcessed >= maxNodes) return "";
      if (currentDepth > maxDepth) return "";
      depthReached = Math.max(depthReached, currentDepth);

      if (node.nodeType === Node.ELEMENT_NODE) {
        nodesProcessed++;
        const tag = node.tagName.toLowerCase();
        if (tag === "iframe") return "<iframe></iframe>"; // Skip cross-origin content
        let out = `<${tag}`;
        try {
          for (const attr of node.attributes || []) {
            if (!shouldIncludeAttr(attr.name, attr.value)) continue;
            const safe = String(attr.value)
              .replace(/"/g, "&quot;")
              .slice(0, 200);
            out += ` ${attr.name}="${safe}"`;
          }

          // 🛠️ FIX: Explicitly Capture Input Values (Blind Spot Fix)
          if (tag === "input" || tag === "textarea") {
            const liveValue = node.value;
            // Only capture if it differs from the attribute and isn't a password
            if (
              liveValue &&
              node.type !== "password" &&
              node.getAttribute("value") !== liveValue
            ) {
              out += ` value="${String(liveValue).replace(/"/g, "&quot;")}"`;
            }
          }
        } catch (e) {
          this.log("DOM capture attr error", e);
        }
        out += ">";

        const children = node.childNodes;
        if (children && children.length) {
          for (const child of children) {
            out += captureNode(child, currentDepth + 1);
            if (timedOut() || nodesProcessed >= maxNodes) break;
          }
        }

        if (node.shadowRoot) {
          try {
            out += captureNode(node.shadowRoot, currentDepth + 1);
          } catch (e) {
            this.log("Shadow DOM capture skipped", e);
          }
        }
        out += `</${tag}>`;
        return out;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        if (text.length > maxTextLen) return text.slice(0, maxTextLen) + "…";
        return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }
      return "";
    };

    let startNode = document.body || document.documentElement;
    const { app } = this.detectSPA();
    if (app && app !== document.body && app.children?.length > 0) {
      startNode = app;
    }
    const html = captureNode(startNode, 0);
    const captureTime = Math.round(performance.now() - startTime);
    this.log("DOM capture", {
      nodesProcessed,
      depthReached,
      captureTimeMs: captureTime,
      htmlLength: html.length,
    });
    return {
      html,
      metrics: { nodesProcessed, depthReached, captureTimeMs: captureTime },
    };
  }

  /** Fallback: shallow capture when main capture fails or times out. */
  captureDOMFallback(depth = 5) {
    let html = "";
    const capture = (node, d) => {
      if (d > depth) return "";
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        let out = `<${tag}`;
        for (const attr of node.attributes || []) {
          if (
            attr.name === "id" ||
            attr.name === "class" ||
            attr.name === "name" ||
            attr.name === "type" ||
            attr.name === "data-testid"
          ) {
            out += ` ${attr.name}="${String(attr.value).slice(0, 100)}"`;
          }
        }
        out += ">";
        for (const child of node.childNodes) {
          out += capture(child, d + 1);
        }
        if (node.shadowRoot)
          try {
            out += capture(node.shadowRoot, d + 1);
          } catch (_) {}
        out += `</${tag}>`;
        return out;
      }
      if (node.nodeType === Node.TEXT_NODE)
        return (node.textContent || "").slice(0, 200);
      return "";
    };
    const start = document.body || document.documentElement;
    html = capture(start, 0);
    this.log("DOM capture fallback used", { depth, length: html.length });
    return { html, metrics: { fallback: true } };
  }

  /** Run capture (optionally in requestIdleCallback) and return snapshot with metrics. */
  capturePageSnapshot(depth, skipWait = false, options = {}) {
    if (!this.config.capturePageSnapshot) return Promise.resolve(null);
    const effectiveDepth = depth ?? this.config.snapshotDepth ?? 10;
    const { precomputedWaitResult = null } = options || {};
    const useIdle =
      !skipWait &&
      this.config.snapshotUseIdleCallback &&
      typeof requestIdleCallback !== "undefined";

    const runCapture = async () => {
      const start = performance.now();
      const captureLimits = this._getAdaptiveSnapshotCaptureLimits();
      let result = null;

      try {
        let waitResult = precomputedWaitResult;
        if (this.config.snapshotWaitForSPA && !skipWait && !waitResult) {
          waitResult = await this.waitForSPAContent(this.config.snapshotTimeoutMs);
        }

        try {
          result = this.captureDOM(effectiveDepth, captureLimits);
          if (!result?.html) {
            result = this.captureDOMFallback(Math.min(5, effectiveDepth));
          }
        } catch (e) {
          result = this.captureDOMFallback(Math.min(5, effectiveDepth));
        }

        const controlSignature = this.computeControlSignature(document);
        const pageUrl = window.location.href;
        const normalizedUrl = this.normalizeUrl(pageUrl);
        const anchorData = this._buildAnchorSnapshotData(document, {
          stage: "page-snapshot",
          traceId: this.pendingTraceId || this.lastActionTraceId || null,
          normalizedUrl,
        });
        const stabilityState = this._buildSnapshotStability(waitResult);

        const snapshot = {
          html: result?.html || "",
          anchors: anchorData.anchors,
          compositeAnchors: anchorData.compositeAnchors,
          controlSignature,
          normalizedUrl,
          isStable: stabilityState.isStable,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          url: pageUrl,
          timestamp: Date.now(),
          metrics: {
            ...(result?.metrics || {}),
            captureProfile: captureLimits.profile,
            captureMaxNodes: captureLimits.maxNodes,
            captureMaxTextLength: captureLimits.maxTextLength,
            contentReady: stabilityState.contentReady,
            settleStable: stabilityState.settleStable,
            busyAtCapture: stabilityState.busy,
            busyReasons: stabilityState.busyReasons,
            forcedCapture: stabilityState.forcedCapture,
            ...anchorData.anchorMetrics,
            totalMs: Math.round(performance.now() - start),
          },
        };
        this._logSnapshotDiagnostics("page-snapshot", snapshot);
        return snapshot;
      } catch (err) {
        return null;
      }
    };

    if (useIdle) {
      return new Promise((resolve) => {
        requestIdleCallback(
          () => {
            runCapture().then(resolve);
          },
          { timeout: this.config.snapshotTimeoutMs + 100 },
        );
      });
    }
    return runCapture();
  }

  /**
   * Capture a full-page snapshot for InteractionContext (IC) validation.
   * Captured once per unique page-state (normalizedUrl + controlSignature).
   */
  async _captureFullPageForIC(options = {}) {
    const {
      skipReadinessWait = false,
      readinessReason = "ic-full-page",
      readinessTimeoutMs = this.config.snapshotContentReadyTimeoutMs,
      precomputedWaitResult = null,
    } = options || {};

    const controlSig = this.computeControlSignature(document);
    const normalizedUrl = this.normalizeUrl(window.location.href);
    const cacheKey = `${normalizedUrl}|${controlSig}`;

    if (
      !this._icCaptureCache ||
      typeof this._icCaptureCache.get !== "function" ||
      typeof this._icCaptureCache.set !== "function"
    ) {
      this._icCaptureCache = new Map();
    }
    const cachedState = this._icCaptureCache.get(cacheKey);
    const cachedStatus = typeof cachedState === "string" ? cachedState : cachedState?.state;
    const cachedContentReady =
      typeof cachedState === "object" ? cachedState.contentReady !== false : true;
    if (cachedStatus === "stable" && cachedContentReady) {
      return null;
    }

    let waitResult = precomputedWaitResult;
    if (this.config.snapshotWaitForSPA && !skipReadinessWait && !waitResult) {
      try {
        waitResult = await this._waitForSettleAndReady(
          readinessReason,
          readinessTimeoutMs,
        );
      } catch (err) {
        this.log("[SNAPSHOT_CAPTURE] readiness wait failed", {
          stage: "ic-full-page",
          error: err?.message || String(err),
        });
      }
    }

    const captureLimits = this._getAdaptiveSnapshotCaptureLimits();
    let result;
    try {
      result = this.captureDOM(this.config.snapshotDepth, captureLimits);
      if (!result?.html) result = this.captureDOMFallback(5);
    } catch (_) {
      result = this.captureDOMFallback(5);
    }

    if (!result?.html) return null;

    const stabilityState = this._buildSnapshotStability(waitResult);
    if (
      cachedStatus === "unstable" &&
      !stabilityState.isStable &&
      (!stabilityState.contentReady || stabilityState.busy || stabilityState.forcedCapture)
    ) {
      return null;
    }

    const shouldMarkStable =
      stabilityState.isStable &&
      stabilityState.contentReady &&
      !stabilityState.forcedCapture;
    this._icCaptureCache.set(cacheKey, {
      state: shouldMarkStable ? "stable" : "unstable",
      contentReady: shouldMarkStable,
      capturedAt: Date.now(),
      htmlLength: result.html.length,
      forcedCapture: stabilityState.forcedCapture === true,
      busy: stabilityState.busy === true,
    });

    const anchorData = this._buildAnchorSnapshotData(document, {
      stage: "ic-full-page",
      traceId: this.pendingTraceId || this.lastActionTraceId || null,
      normalizedUrl,
    });
    const snapshot = {
      html: result.html,
      anchors: anchorData.anchors,
      compositeAnchors: anchorData.compositeAnchors,
      controlSignature: controlSig,
      normalizedUrl,
      isStable: stabilityState.isStable,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url: window.location.href,
      timestamp: Date.now(),
      metrics: {
        ...result.metrics,
        fullPage: true,
        captureProfile: captureLimits.profile,
        captureMaxNodes: captureLimits.maxNodes,
        captureMaxTextLength: captureLimits.maxTextLength,
        contentReady: stabilityState.contentReady,
        readinessReason,
        settleStable: stabilityState.settleStable,
        busyAtCapture: stabilityState.busy,
        busyReasons: stabilityState.busyReasons,
        forcedCapture: stabilityState.forcedCapture,
        ...anchorData.anchorMetrics,
      },
    };
    this._logSnapshotDiagnostics("ic-full-page", snapshot);
    return snapshot;
  }

  _captureSubtreeSnapshot(element, maxChars = 50000) {
    if (!element) return null;

    // Try to get a meaningful container first
    let container = element.closest('form, section, article, div') || element.parentElement;
    let bestHtml = element.outerHTML;

    if (container && container.outerHTML && container.outerHTML.length <= maxChars) {
      bestHtml = container.outerHTML;
    }

    // Keep existing behavior: only attempt parent expansion when current html is too large.
    if (bestHtml.length > maxChars) {
      // Try to expand to parent (up to 2 levels) for more context
      let depth = 0;
      let current = element.parentElement;
      while (current && depth < 2) {
        const parentHtml = current.outerHTML;
        if (parentHtml.length <= maxChars) {
          bestHtml = parentHtml;
        } else {
          break;
        }
        current = current.parentElement;
        depth++;
      }

      // If still too large, truncate
      if (bestHtml.length > maxChars) {
        bestHtml = bestHtml.slice(0, maxChars) + '<!-- truncated -->';
      }
    }

    let anchors = [];
    let compositeAnchors = [];
    let anchorMetrics = {
      flatAnchorCount: 0,
      compositeAnchorCount: 0,
      compositeSample: [],
      droppedCompositeCount: 0,
      inspectedContainerCount: 0,
      skippedCompositeReason: null,
    };
    let controlSignature = null;

    try {
      const anchorData = this._buildAnchorSnapshotData(document, {
        stage: "subtree-snapshot",
        traceId: this.pendingTraceId || this.lastActionTraceId || null,
        normalizedUrl,
      });
      anchors = anchorData.anchors;
      compositeAnchors = anchorData.compositeAnchors;
      anchorMetrics = anchorData.anchorMetrics;
    } catch (_) {}

    try {
      controlSignature = this.computeControlSignature(document);
    } catch (_) {}

    const pageUrl = window.location.href;
    const normalizedUrl = this.normalizeUrl(pageUrl);

    const stabilityState = this._buildSnapshotStability();

    return {
      html: bestHtml,
      anchors,
      compositeAnchors,
      controlSignature,
      normalizedUrl,
      isStable: stabilityState.isStable,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url: pageUrl,
      timestamp: Date.now(),
      metrics: {
        subtree: true,
        maxChars,
        ...anchorMetrics,
        contentReady: stabilityState.contentReady,
        settleStable: stabilityState.settleStable,
        busyAtCapture: stabilityState.busy,
        busyReasons: stabilityState.busyReasons,
        forcedCapture: stabilityState.forcedCapture,
      },
    };
  }

  _getPayloadBytes(payloadValue) {
    const normalized =
      typeof payloadValue === "string"
        ? payloadValue
        : JSON.stringify(payloadValue ?? null);
    return new Blob([normalized]).size;
  }

  _isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  _getSnapshotTransportFieldNames() {
    return ["pageSnapshot", "pageState", "interactionContext"];
  }

  _getSnapshotFieldDropOrder() {
    return ["pageSnapshot", "pageState", "interactionContext"];
  }

  _getEventTransportContext(event, transportKind = "flush") {
    return {
      eventId: typeof event?.id === "string" ? event.id : null,
      type: typeof event?.type === "string" ? event.type : "unknown",
      traceId: typeof event?.traceId === "string" ? event.traceId : null,
      sessionId: typeof event?.sessionId === "string" ? event.sessionId : null,
      tabId: typeof event?.tabId === "string" ? event.tabId : null,
      transportKind,
    };
  }

  _ensureEventTransportMeta(eventCopy) {
    if (!this._isPlainObject(eventCopy.meta)) {
      eventCopy.meta = {};
    }
    if (!this._isPlainObject(eventCopy.meta.transport)) {
      eventCopy.meta.transport = {};
    }
    if (!this._isPlainObject(eventCopy.meta.transport.fields)) {
      eventCopy.meta.transport.fields = {};
    }
    return eventCopy.meta.transport;
  }

  _attachTransportFieldMeta(eventCopy, fieldName, fieldMeta) {
    if (!fieldMeta) return;
    const transportMeta = this._ensureEventTransportMeta(eventCopy);
    transportMeta.fields[fieldName] = {
      ...(this._isPlainObject(transportMeta.fields[fieldName])
        ? transportMeta.fields[fieldName]
        : {}),
      ...fieldMeta,
    };
  }

  _updateTransportSummary(eventCopy, summary) {
    const transportMeta = this._ensureEventTransportMeta(eventCopy);
    Object.assign(transportMeta, summary);
  }

  _logTransportFieldMeta(fieldName, eventContext, fieldMeta) {
    if (!eventContext || !fieldMeta) return;
    this.log("TRANSPORT_SNAPSHOT_FIELD_NORMALIZED", {
      ...eventContext,
      fieldName,
      ...fieldMeta,
    });
  }

  stripScriptsStylesNoscript(html) {
    let sanitized = typeof html === "string" ? html : "";
    let scriptsRemoved = 0;
    let stylesRemoved = 0;
    let noscriptRemoved = 0;

    sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, () => {
      scriptsRemoved += 1;
      return "";
    });

    sanitized = sanitized.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, () => {
      stylesRemoved += 1;
      return "";
    });

    sanitized = sanitized.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, () => {
      noscriptRemoved += 1;
      return "";
    });

    return { html: sanitized, scriptsRemoved, stylesRemoved, noscriptRemoved };
  }

  collapseBase64DataUrls(html) {
    let sanitized = typeof html === "string" ? html : "";
    let base64Collapsed = 0;

    sanitized = sanitized.replace(
      /\s(?:src|href|poster|xlink:href|srcset)\s*=\s*(["'])(data:[^"']+)\1/gi,
      (match, _quote, dataUrl) => {
        if (!/;base64,/i.test(dataUrl) && dataUrl.length < 512) {
          return match;
        }
        base64Collapsed += 1;
        return ' data-air-blob="collapsed"';
      }
    );

    sanitized = sanitized.replace(
      /url\((["']?)data:[^)]+\1\)/gi,
      (match) => {
        if (!/;base64,/i.test(match) && match.length < 512) {
          return match;
        }
        base64Collapsed += 1;
        return 'url("data-air-blob:collapsed")';
      }
    );

    return { html: sanitized, base64Collapsed };
  }

  collapseLargeSvgBlocks(html, options = {}) {
    let sanitized = typeof html === "string" ? html : "";
    let svgCollapsed = 0;
    const sizeThreshold = Number.isFinite(options.sizeThreshold)
      ? options.sizeThreshold
      : 4096;
    const shapeThreshold = Number.isFinite(options.shapeThreshold)
      ? options.shapeThreshold
      : 20;

    sanitized = sanitized.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svgBlock) => {
      const svgBytes = this._getPayloadBytes(svgBlock);
      const shapeCount = (svgBlock.match(/<(path|circle|rect|polygon|polyline|ellipse|line|use|g)\b/gi) || []).length;
      if (svgBytes <= sizeThreshold && shapeCount < shapeThreshold) {
        return svgBlock;
      }
      svgCollapsed += 1;
      return '<svg data-air="icon"></svg>';
    });

    return { html: sanitized, svgCollapsed };
  }

  sanitizeSnapshotHtmlForTransport(html) {
    const stripped = this.stripScriptsStylesNoscript(html);
    const collapsedBase64 = this.collapseBase64DataUrls(stripped.html);
    const collapsedSvg = this.collapseLargeSvgBlocks(collapsedBase64.html);

    return {
      html: collapsedSvg.html,
      scriptsRemoved: stripped.scriptsRemoved,
      stylesRemoved: stripped.stylesRemoved,
      noscriptRemoved: stripped.noscriptRemoved,
      base64Collapsed: collapsedBase64.base64Collapsed,
      svgCollapsed: collapsedSvg.svgCollapsed,
    };
  }

  _buildSnapshotTransportObject(snapshotValue) {
    if (typeof snapshotValue === "string") {
      return {
        html: snapshotValue,
        metrics: { coercedFromString: true },
      };
    }

    if (this._isPlainObject(snapshotValue)) {
      return { ...snapshotValue };
    }

    return null;
  }

  _normalizeCompositeAnchorsForTransport(compositeAnchors) {
    if (!Array.isArray(compositeAnchors)) {
      return undefined;
    }

    return compositeAnchors
      .filter((anchor) => this._isPlainObject(anchor))
      .map((anchor) => {
        const normalizedAnchor = { ...anchor };
        if (Array.isArray(anchor.tokens)) {
          normalizedAnchor.tokens = anchor.tokens.filter((token) => typeof token === "string");
        }
        return normalizedAnchor;
      })
      .filter(
        (anchor) =>
          typeof anchor.kind === "string" &&
          typeof anchor.descriptor === "string" &&
          typeof anchor.confidence === "number" &&
          Array.isArray(anchor.tokens)
      );
  }

  _getTrackedSnapshotSubfields(snapshotValue) {
    if (!this._isPlainObject(snapshotValue)) {
      return [];
    }

    const tracked = [];
    if (Array.isArray(snapshotValue.compositeAnchors) && snapshotValue.compositeAnchors.length > 0) {
      tracked.push("compositeAnchors");
    }
    if (this._isPlainObject(snapshotValue.metrics) && Object.keys(snapshotValue.metrics).length > 0) {
      tracked.push("metrics");
    }
    return tracked;
  }

  _logSnapshotSubfieldDrop(
    fieldName,
    eventContext,
    reason,
    subfields,
    extra = {}
  ) {
    if (!eventContext || !Array.isArray(subfields) || subfields.length === 0) {
      return;
    }

    this.log("TRANSPORT_SNAPSHOT_SUBFIELD_DROPPED", {
      ...eventContext,
      fieldName,
      reason,
      droppedSubfields: subfields,
      ...extra,
    });
  }

  _buildSchemaCompatibleSnapshot(snapshotObject, sanitizedHtml) {
    const normalizedSnapshot = {
      ...snapshotObject,
      html: sanitizedHtml,
      url:
        typeof snapshotObject.url === "string"
          ? snapshotObject.url
          : window.location.href,
      normalizedUrl:
        typeof snapshotObject.normalizedUrl === "string"
          ? snapshotObject.normalizedUrl
          : this.normalizeUrl(window.location.href),
      viewport:
        this._isPlainObject(snapshotObject.viewport) &&
        typeof snapshotObject.viewport.width === "number" &&
        typeof snapshotObject.viewport.height === "number"
          ? {
              width: snapshotObject.viewport.width,
              height: snapshotObject.viewport.height,
            }
          : { width: window.innerWidth, height: window.innerHeight },
      timestamp:
        typeof snapshotObject.timestamp === "number"
          ? snapshotObject.timestamp
          : Date.now(),
      metrics:
        this._isPlainObject(snapshotObject.metrics)
          ? { ...snapshotObject.metrics }
          : undefined,
    };

    if (Array.isArray(snapshotObject.anchors)) {
      normalizedSnapshot.anchors = snapshotObject.anchors.filter(
        (anchor) => typeof anchor === "string"
      );
    } else {
      delete normalizedSnapshot.anchors;
    }

    const compositeAnchors = this._normalizeCompositeAnchorsForTransport(
      snapshotObject.compositeAnchors
    );
    if (Array.isArray(compositeAnchors) && compositeAnchors.length > 0) {
      normalizedSnapshot.compositeAnchors = compositeAnchors;
    } else {
      delete normalizedSnapshot.compositeAnchors;
    }

    if (
      snapshotObject.controlSignature === null ||
      typeof snapshotObject.controlSignature === "string"
    ) {
      normalizedSnapshot.controlSignature = snapshotObject.controlSignature;
    } else {
      delete normalizedSnapshot.controlSignature;
    }

    if (typeof snapshotObject.isStable === "boolean") {
      normalizedSnapshot.isStable = snapshotObject.isStable;
    } else {
      delete normalizedSnapshot.isStable;
    }

    if (!normalizedSnapshot.metrics) {
      delete normalizedSnapshot.metrics;
    }

    return normalizedSnapshot;
  }

  normalizeSnapshotFieldForTransport(
    snapshotValue,
    fieldName,
    maxBytes,
    eventContext = null,
    options = {}
  ) {
    const suppressLogs = options.suppressLogs === true;

    if (snapshotValue === undefined) {
      return { value: undefined, meta: null };
    }

    if (snapshotValue === null) {
      return { value: null, meta: null };
    }

    const originalBytes = this._getPayloadBytes(snapshotValue);

    try {
      const snapshotObject = this._buildSnapshotTransportObject(snapshotValue);
      if (!snapshotObject) {
        const meta = {
          scriptsRemoved: 0,
          stylesRemoved: 0,
          noscriptRemoved: 0,
          base64Collapsed: 0,
          svgCollapsed: 0,
          transportTruncated: true,
          transportReductionReason: "unsupported_snapshot_type",
          originalBytes,
          finalBytes: 0,
        };
        if (!suppressLogs) {
          this._logTransportFieldMeta(fieldName, eventContext, meta);
          this._logSnapshotSubfieldDrop(
            fieldName,
            eventContext,
            "unsupported_snapshot_type",
            this._getTrackedSnapshotSubfields(snapshotValue)
          );
        }
        return { value: null, meta };
      }

      const html = typeof snapshotObject.html === "string" ? snapshotObject.html : "";
      const sanitized = this.sanitizeSnapshotHtmlForTransport(html);
      const normalizedSnapshot = this._buildSchemaCompatibleSnapshot(
        snapshotObject,
        sanitized.html
      );
      const finalBytes = this._getPayloadBytes(normalizedSnapshot);
      const meta = {
        scriptsRemoved: sanitized.scriptsRemoved,
        stylesRemoved: sanitized.stylesRemoved,
        noscriptRemoved: sanitized.noscriptRemoved,
        base64Collapsed: sanitized.base64Collapsed,
        svgCollapsed: sanitized.svgCollapsed,
        transportTruncated: false,
        transportReductionReason: null,
        originalBytes,
        finalBytes,
      };

      const droppedSubfields = this._getTrackedSnapshotSubfields(snapshotObject).filter(
        (subfield) => !(subfield in normalizedSnapshot)
      );

      if (!suppressLogs) {
        this._logTransportFieldMeta(fieldName, eventContext, meta);
        this._logSnapshotSubfieldDrop(
          fieldName,
          eventContext,
          "normalization_trimmed_subfield",
          droppedSubfields
        );
      }

      return { value: normalizedSnapshot, meta };
    } catch (error) {
      if (!suppressLogs) {
        this.log("TRANSPORT_SANITIZATION_FAILED", {
          ...eventContext,
          fieldName,
          error: error?.message || String(error),
          originalBytes,
        });
      }

      if (originalBytes <= maxBytes) {
        const meta = {
          scriptsRemoved: 0,
          stylesRemoved: 0,
          noscriptRemoved: 0,
          base64Collapsed: 0,
          svgCollapsed: 0,
          transportTruncated: false,
          transportReductionReason: "sanitization_failed_original_retained",
          originalBytes,
          finalBytes: originalBytes,
        };
        if (!suppressLogs) {
          this._logTransportFieldMeta(fieldName, eventContext, meta);
        }
        return { value: snapshotValue, meta };
      }

      const meta = {
        scriptsRemoved: 0,
        stylesRemoved: 0,
        noscriptRemoved: 0,
        base64Collapsed: 0,
        svgCollapsed: 0,
        transportTruncated: true,
        transportReductionReason: "sanitization_failed_field_removed",
        originalBytes,
        finalBytes: 0,
      };
      if (!suppressLogs) {
        this._logTransportFieldMeta(fieldName, eventContext, meta);
        this._logSnapshotSubfieldDrop(
          fieldName,
          eventContext,
          "sanitization_failed_field_removed",
          this._getTrackedSnapshotSubfields(snapshotValue)
        );
      }
      return { value: null, meta };
    }
  }

  dropSnapshotFieldForTransport(eventCopy, fieldName, reason, eventContext = null) {
    const droppedSubfields = this._getTrackedSnapshotSubfields(eventCopy[fieldName]);
    eventCopy[fieldName] = null;
    const meta = {
      transportTruncated: true,
      transportReductionReason: reason,
      finalBytes: 0,
    };
    this._attachTransportFieldMeta(eventCopy, fieldName, meta);
    if (eventContext) {
      this.log("TRANSPORT_SNAPSHOT_FIELD_DROPPED", {
        ...eventContext,
        fieldName,
        droppedSubfields,
        ...meta,
      });
    }
  }

  enforceSnapshotTransportBudget(eventCopy, maxBytes, eventContext = null) {
    let payload = JSON.stringify(eventCopy);
    let payloadBytes = this._getPayloadBytes(payload);
    const reducedFields = [];

    for (const fieldName of this._getSnapshotFieldDropOrder()) {
      if (payloadBytes <= maxBytes) break;
      if (eventCopy[fieldName] === undefined || eventCopy[fieldName] === null) {
        continue;
      }
      this.dropSnapshotFieldForTransport(
        eventCopy,
        fieldName,
        "budget_exceeded",
        eventContext
      );
      reducedFields.push(fieldName);
      payload = JSON.stringify(eventCopy);
      payloadBytes = this._getPayloadBytes(payload);
    }

    return {
      event: eventCopy,
      payload,
      payloadBytes,
      reducedFields,
      overBudget: payloadBytes > maxBytes,
    };
  }

  _prepareEventForTransport(event, options = {}) {
    const maxPayloadBytes = Number.isFinite(options.maxPayloadBytes)
      ? options.maxPayloadBytes
      : 60000;
    const transportKind = options.transportKind || "flush";
    const eventContext = this._getEventTransportContext(event, transportKind);
    const eventCopy = { ...event };

    if (this._isPlainObject(event.meta)) {
      eventCopy.meta = { ...event.meta };
    }

    const originalPayloadBytes = this._getPayloadBytes(event);

    for (const fieldName of this._getSnapshotTransportFieldNames()) {
      const normalized = this.normalizeSnapshotFieldForTransport(
        event[fieldName],
        fieldName,
        maxPayloadBytes,
        eventContext
      );
      if (normalized.value !== undefined || fieldName in eventCopy) {
        eventCopy[fieldName] = normalized.value;
      }
      this._attachTransportFieldMeta(eventCopy, fieldName, normalized.meta);
    }

    let payload = JSON.stringify(eventCopy);
    let payloadBytes = this._getPayloadBytes(payload);
    let reducedFields = [];

    if (payloadBytes > maxPayloadBytes) {
      const budgetResult = this.enforceSnapshotTransportBudget(
        eventCopy,
        maxPayloadBytes,
        eventContext
      );
      payload = budgetResult.payload;
      payloadBytes = budgetResult.payloadBytes;
      reducedFields = budgetResult.reducedFields;
    }

    this._updateTransportSummary(eventCopy, {
      transportKind,
      originalPayloadBytes,
      finalPayloadBytes: payloadBytes,
      transportTruncated: reducedFields.length > 0,
      transportReductionReason:
        reducedFields.length > 0 ? "budget_exceeded" : null,
      reducedFields,
    });

    payload = JSON.stringify(eventCopy);
    payloadBytes = this._getPayloadBytes(payload);

    return {
      event: eventCopy,
      payload,
      payloadBytes,
      originalPayloadBytes,
      reducedFields,
      overBudget: payloadBytes > maxPayloadBytes,
      eventContext,
    };
  }

  _normalizeSnapshotForTransport(snapshotValue, maxBytes = 30000) {
    const result = this.normalizeSnapshotFieldForTransport(
      snapshotValue,
      "snapshot",
      maxBytes,
      null,
      { suppressLogs: true }
    );
    return result.value;
  }

  // ============================================================
  // NETWORK MONITORING — Unified (fetch + XHR)
  // FIX (BUG): Single entry point. Old code had two separate wrappers
  // (monitorNetwork + QuiescenceWatcher.monitor) each independently patching
  // window.fetch, causing double-counting and duplicate event emission.
  // Now: ONE sentinel (__air_patched__) covers both concerns.
  // Item 3.7: Also hooks XHR which was entirely missing before.
  // ============================================================

  monitorNetwork() {
    if (this.disabled) return;
    this._patchFetch();
    this._patchXHR();
  }

  _patchFetch() {
    // Single unified sentinel — prevents any re-entry from any code path
    if (window.fetch.__air_patched__) return;

    const origFetch = window.fetch;
    const self = this;

    const patched = function (...args) {
      // ── Read Symbol sentinel WITHOUT mutating caller’s options ──────────────────
      // args[1] belongs to the calling application. We read it, then build a
      // CLEAN CLONE that strips the AIR Symbol before forwarding to native fetch.
      // Native fetch in Firefox 120+ throws on unknown init properties in strict mode.
      const opts       = args[1];
      const isInternal = opts?.[_AIR_INTERNAL] === true;

      // Strip AIR-only Symbol key before forwarding to the real fetch.
      // Also correctly handles Request objects passed as args[0].
      let cleanArgs = args;
      if (opts !== undefined && opts !== null && typeof opts === 'object') {
        const { [_AIR_INTERNAL]: _dropped, ...cleanOpts } = opts;
        cleanArgs = [args[0], cleanOpts, ...args.slice(2)];
      }

      if (!isInternal) {
        self.activeRequests++;
        self.quiescence?.onNetworkStart();
      }

      const startTime = Date.now();
      // Resolve URL safely — handles both string and Request object
      const reqUrl = typeof args[0] === 'string'      ? args[0]
                   : args[0] instanceof Request         ? args[0].url
                   : (args[0]?.url || '');
      const method = (opts?.method || 'GET').toUpperCase();

      return origFetch.apply(this, cleanArgs)   // ← clean args, Symbol stripped
        .then(response => {
          if (!isInternal) {
            self._captureNetworkEvent({
              transport:   'fetch',
              method,
              url:         reqUrl,
              status:      response.status,
              ok:          response.ok,
              durationMs:  Date.now() - startTime,
              contentType: response.headers?.get('content-type') || null,
            });
          }
          return response;
        })
        .finally(() => {
          if (!isInternal) {
            self.activeRequests = Math.max(0, self.activeRequests - 1);
            self.quiescence?.onNetworkEnd();
            self.checkQuiescence();
          }
        });
    };

    // Set ALL known sentinels so legacy guards in any stale code stay quiet
    patched.__air_patched__     = true;
    patched.__air_qw_patched__  = true;
    patched.__air_mon_patched__ = true;
    window.fetch = patched;
  }

  // ────────────────────────────────────────────────────────────────
  // Item 3.7 — XHR tracking (was entirely missing before)
  // ────────────────────────────────────────────────────────────────
  _patchXHR() {
    if (XMLHttpRequest.prototype.open.__air_patched__) return;

    const self = this;
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._airMethod = (method || 'GET').toUpperCase();
      this._airUrl    = String(url || '');
      return origOpen.apply(this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.open.__air_patched__ = true;

    XMLHttpRequest.prototype.send = function (body) {
      const startTime = Date.now();
      const method    = this._airMethod || 'GET';
      const url       = this._airUrl    || '';

      self.activeRequests++;
      self.quiescence?.onNetworkStart();

      this.addEventListener('loadend', () => {
        self.activeRequests = Math.max(0, self.activeRequests - 1);
        self.quiescence?.onNetworkEnd();
        self.checkQuiescence();

        self._captureNetworkEvent({
          transport:   'xhr',
          method,
          url,
          status:      this.status,
          ok:          this.status >= 200 && this.status < 300,
          durationMs:  Date.now() - startTime,
          contentType: this.getResponseHeader?.('content-type') || null,
        });
      });

      return origSend.apply(this, arguments);
    };
  }

  /**
   * Emit a structured network event. Skips AIR's own flush endpoint
   * and extremely noisy favicon/analytics pings.
   */
  _captureNetworkEvent(info) {
    if (!info.url) return;
    // Don't record AIR's own traffic back to itself
    try {
      const serverBase = new URL(this.config.serverUrl).hostname;
      if (new URL(info.url, window.location.href).hostname === serverBase) return;
    } catch (_) { /* relative URLs are fine to capture */ }

    this.log('🌐 Network captured', info);

    const pageUrl = window.location.href;
    const normalizedUrl = this.normalizeUrl(pageUrl);
    this.queueEvent({
      id:            this.generateUUID(),
      type:          'network',
      timestamp:     Date.now(),
      pageUrl,
      normalizedUrl,
      sessionId:     this.config.sessionId,
      schemaVersion: 'air:v2',
      traceId:       this.pendingTraceId || undefined,
      network: {
        transport:   info.transport,    // 'fetch' | 'xhr'
        method:      info.method,
        url:         info.url,
        status:      info.status,
        ok:          info.ok,
        durationMs:  info.durationMs,
        contentType: info.contentType,
      },
    });
  }

  checkQuiescence() {
    if (this.activeRequests === 0) {
      setTimeout(() => {
        if (this.activeRequests === 0) {
          this.dispatchEvent("air:quiescence", { timestamp: Date.now() });
        }
      }, 5000);
    }
  }

  // ============================================================
  // EVENT LISTENERS
  // ============================================================

  attachEventListeners() {
    if (this.disabled) return;
    // --- Explicit bound references stored on instance so they can be removed ---
    this._boundHandleClick  = this.handleClick.bind(this);
    this._boundHandleInput  = this.handleInput.bind(this);
    this._boundHandleScroll = this.handleScroll.bind(this);
    this._boundHandleSubmit = this.handleSubmit.bind(this);
    this._boundHandleBlur   = this.handleBlur.bind(this);
    this._boundHandleChange = this.handleChange.bind(this);
    this._boundHandleFocus  = this.handleFocus.bind(this);

    document.addEventListener("click",  this._boundHandleClick,  true);
    document.addEventListener("focus",  this._boundHandleFocus,  true);
    document.addEventListener("input",  this._boundHandleInput,  true);
    document.addEventListener("scroll", this._boundHandleScroll, { passive: true, capture: true });
    document.addEventListener("submit", this._boundHandleSubmit, true);
    document.addEventListener("blur",   this._boundHandleBlur,   true);
    document.addEventListener("change", this._boundHandleChange, true);

    // Mousedown pre-capture: snapshots option data BEFORE the framework can
    // remove the element from the DOM. Must fire before click.
    this._boundHandleMousedownForOption = this._handleMousedownForOption.bind(this);
    document.addEventListener("mousedown", this._boundHandleMousedownForOption, true);

    // Item 3.1: Hover detection — mouseenter fires when cursor enters an element.
    // We watch for DOM mutations in a 300ms window afterward; if the page
    // reacts (tooltip, dropdown, sub-menu revealed) we emit a hover action.
    // This is the ONLY way to record interactions with hover-only UI components
    // (e.g. mega-nav dropdowns, tooltip-triggered wizards).
    this._attachHoverDetection();

    // Navigation-resilient flush: pagehide fires even when the page is killed
    // (bfcache scenarios, mobile swipe-away, fast tab close).
    window.addEventListener("pagehide", () => this._beaconFlushAll(), { capture: true });
  }

  // ============================================================
  // Item 3.1 — Hover detection engine
  // ============================================================

  _attachHoverDetection() {
    this._boundHandleHover = this._handleHover.bind(this);
    this._recentHovers     = new Set();
    this._hoverIntentBuffer = [];
    // passive: true — we never call preventDefault, so the browser can optimise.
    // Use pointerenter so we buffer hover candidates synchronously even when
    // visibility changes are driven by CSS :hover and never mutate the DOM.
    document.addEventListener('pointerenter', this._boundHandleHover, { capture: true, passive: true });
  }

  _pruneHoverIntentBuffer(now = Date.now()) {
    const ttlMs = this.config.hoverIntentBufferTtlMs || 500;
    this._hoverIntentBuffer = (this._hoverIntentBuffer || []).filter(
      (entry) => entry && (now - entry.timestamp) <= ttlMs
    );
  }

  _recordHoverIntentBuffer(target, nestedContext, hoverKey) {
    if (!target) return null;
    const now = Date.now();
    this._pruneHoverIntentBuffer(now);

    const entry = {
      timestamp: now,
      target,
      hoverKey,
      fingerprint: this.generateFingerprint(target),
      nestedContext,
      hadDomMutation: false,
      hasPopupHint: !!target.getAttribute?.('aria-haspopup'),
      hasExpandedHint: target.getAttribute?.('aria-expanded') != null,
      targetTag: target.tagName?.toLowerCase?.() || null,
    };

    this._hoverIntentBuffer.push(entry);
    const maxEntries = Math.max(1, this.config.hoverIntentBufferMaxEntries || 8);
    if (this._hoverIntentBuffer.length > maxEntries) {
      this._hoverIntentBuffer = this._hoverIntentBuffer.slice(-maxEntries);
    }

    this.log('HOVER_BUFFER_RECORDED', {
      hoverKey,
      targetTag: entry.targetTag,
      hasPopupHint: entry.hasPopupHint,
      hasExpandedHint: entry.hasExpandedHint,
      sessionId: this.config.sessionId,
      tabId: this.config.tabId,
    });

    return entry;
  }

  _isClickInsideRevealContainer(target) {
    if (!target || typeof target.closest !== 'function') return false;
    const roleSelector = Array.from(AIRInterceptor.CONTAINER_ROLES)
      .map((role) => `[role="${role}"]`)
      .join(', ');
    return !!(
      target.closest(roleSelector || '__air_no_role__') ||
      target.closest('[aria-haspopup], [aria-expanded], [aria-controls]') ||
      target.closest('[class*="menu"], [class*="popup"], [class*="popover"], [class*="flyout"], [class*="dropdown"]')
    );
  }

  _isPlausiblyRelatedHoverTarget(hoverEntry, clickTarget) {
    const hoverTarget = hoverEntry?.target;
    if (!hoverTarget || !clickTarget) return false;

    if (hoverTarget === clickTarget) return true;
    if (typeof hoverTarget.contains === 'function' && hoverTarget.contains(clickTarget)) return true;
    if (typeof clickTarget.contains === 'function' && clickTarget.contains(hoverTarget)) return true;

    const ariaControls = hoverTarget.getAttribute?.('aria-controls');
    if (ariaControls) {
      const controlled = document.getElementById(ariaControls);
      if (controlled && typeof controlled.contains === 'function' && controlled.contains(clickTarget)) {
        return true;
      }
    }

    const hoverParent = hoverTarget.parentElement;
    if (hoverParent && hoverParent === clickTarget.parentElement) {
      return true;
    }

    return false;
  }

  _findSyntheticHoverCandidate(clickTarget) {
    this._pruneHoverIntentBuffer();
    const entries = Array.isArray(this._hoverIntentBuffer)
      ? [...this._hoverIntentBuffer].reverse()
      : [];

    for (const entry of entries) {
      const revealLikely = entry.hasPopupHint || entry.hasExpandedHint || entry.hadDomMutation;
      const clickInsideRevealContainer = this._isClickInsideRevealContainer(clickTarget);
      const related = this._isPlausiblyRelatedHoverTarget(entry, clickTarget);

      if (revealLikely && clickInsideRevealContainer && related) {
        return entry;
      }
    }

    return null;
  }

  _emitSyntheticHover(entry, traceId) {
    if (!entry?.target || !traceId) return false;

    const pageUrl = window.location.href;
    const normalizedUrl = this.normalizeUrl(pageUrl);
    this.queueEvent({
      id: this.generateUUID(),
      type: 'hover',
      timestamp: Date.now(),
      traceId,
      pageUrl,
      normalizedUrl,
      pageTitle: document.title,
      sessionId: this.config.sessionId,
      nestedContext: entry.nestedContext,
      schemaVersion: 'air:v2',
      fingerprint: entry.fingerprint || this.generateFingerprint(entry.target),
      meta: {
        domChanged: !!entry.hadDomMutation,
        nodesAdded: 0,
        nodesRemoved: 0,
        synthetic: true,
        synthesizedForClick: true,
        source: 'trailing_hover_buffer',
      },
    });

    this.log('SYNTHETIC_HOVER_EMITTED', {
      hoverKey: entry.hoverKey,
      targetTag: entry.targetTag,
      traceId,
      sessionId: this.config.sessionId,
      tabId: this.config.tabId,
    });
    this._hoverIntentBuffer = (this._hoverIntentBuffer || []).filter((candidate) => candidate !== entry);
    return true;
  }

  _handleHover(e) {
    // Item 2.5: composedPath for Shadow DOM
    const eventId = this.generateUUID();
    const resolvedTargetInfo = this._resolveNestedContext(e, this._getComposedEventTarget(e), eventId);
    const target = resolvedTargetInfo.target;
    const nestedContext = resolvedTargetInfo.nestedContext;
    if (!target || target === document.body || target === document.documentElement) return;

    const tag = target.tagName || '';
    // Only watch elements that are likely to trigger reactive UI changes on hover
    const HOVER_TAGS  = new Set(['BUTTON', 'A', 'LI', 'TR', 'TD', 'SUMMARY']);
    const role        = target.getAttribute?.('role') || '';
    const HOVER_ROLES = new Set(['button', 'menuitem', 'tab', 'option', 'row', 'treeitem']);

    const isInteresting =
      HOVER_TAGS.has(tag)                                ||
      HOVER_ROLES.has(role)                              ||
      !!target.getAttribute?.('data-testid')             ||
      !!target.getAttribute?.('aria-haspopup')           ||
      (target.getAttribute?.('aria-expanded') != null);

    if (!isInteresting) return;

    // Debounce — same element no more than once per 500 ms to avoid storm
    const hoverKey = [tag, target.id || '', target.getAttribute?.('data-testid') || ''].join('|');
    const hoverBufferEntry = this._recordHoverIntentBuffer(target, nestedContext, hoverKey);
    if (this._recentHovers.has(hoverKey)) return;
    this._recentHovers.add(hoverKey);
    setTimeout(() => this._recentHovers.delete(hoverKey), 500);

    // Observe DOM for reactive changes triggered by this hover
    const observer = new MutationObserver((mutations) => {
      observer.disconnect();

      // Only emit if there was a meaningful structural change (new nodes added/removed)
      const significant = mutations.some(m => m.addedNodes.length > 0 || m.removedNodes.length > 0);
      if (!significant) return;
      if (hoverBufferEntry) hoverBufferEntry.hadDomMutation = true;

      this.log('🖱️ Hover triggered DOM change', { tag, hoverKey });
      const pageUrl = window.location.href;
      const normalizedUrl = this.normalizeUrl(pageUrl);
      this.queueEvent({
        id:            eventId,
        type:          'hover',
        timestamp:     Date.now(),
        pageUrl,
        normalizedUrl,
        pageTitle:     document.title,
        sessionId:     this.config.sessionId,
        nestedContext,
        schemaVersion: 'air:v2',
        fingerprint:   this.generateFingerprint(target),
        meta: {
          domChanged:    true,
          nodesAdded:    mutations.reduce((n, m) => n + m.addedNodes.length, 0),
          nodesRemoved:  mutations.reduce((n, m) => n + m.removedNodes.length, 0),
        },
      });
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: false });
    // Auto-disconnect — hover reactions are immediate; 300 ms is generous
    setTimeout(() => observer.disconnect(), 300);
  }

  /**
   * Flush the entire pending queue during page teardown (beforeunload / pagehide).
   *
   * Strategy (Belt and Suspenders):
   *   1. STASH  — write full events (including heavy snapshots) to session-scoped
   *               localStorage so _recoverStashedEvents() can send them lazily on
   *               the next page load via stable fetch. Zero size limit, full quality.
   *   2. BEACON — always fire a stripped beacon (no snapshots) immediately regardless
   *               of stash success. Guarantees the critical tracing data (id, traceId,
   *               fingerprint, pageUrl) survives even if the user never returns to this
   *               origin (cross-origin navigation, closed tab, PayPal etc.).
   *   3. DEDUP  — if both paths succeed, the backend deduplication in processEvent()
   *               safely ignores the duplicate when the heavy stash arrives.
   *
   * Why strip snapshots from beacon:
   *   sendBeacon has a 64KB hard limit. A single DOM snapshot is 100KB-500KB.
   *   One unstripped event silently causes the ENTIRE batch to be rejected,
   *   losing ALL events. Stripping snapshots keeps the beacon under 10KB.
   *
   * Why session-scoped stash key:
   *   Multiple tabs on the same origin would overwrite each other with a
   *   global key. Session-scoping isolates each recording session completely.
   *
   * Why per-event TTL (not stash-level):
   *   A stash-level timestamp resets every time new events are merged,
   *   allowing events to live up to 59 minutes (30+30). Per-event TTL uses
   *   the event's own timestamp — accurate and tamper-proof.
   */
  _beaconFlushAll() {
    if (this.eventQueue.length === 0) return;

    const STASH_TTL_MS = 30 * 60 * 1000; // 30 minutes
    const stashKey = `air_heavy_stash_${this.config.sessionId}`;
    const now = Date.now();

    // ── STEP 1: Prepare slim events (strip snapshots for beacon) ──────────────
    // Snapshots are preserved in the stash (Step 2). The beacon carries only
    // the critical fields needed to create the edge: id, traceId, type,
    // fingerprint, pageUrl, sessionId, timestamp.
    const sentIds = new Set(this._replaySentEventIds);
    const queueSeenIds = new Set();
    const replayableQueueEvents = [];
    for (const ev of this.eventQueue) {
      const eventId = typeof ev?.id === "string" ? ev.id : null;
      if (!eventId) {
        replayableQueueEvents.push(ev);
        continue;
      }
      if (queueSeenIds.has(eventId)) continue;
      if (sentIds.has(eventId)) continue;
      queueSeenIds.add(eventId);
      replayableQueueEvents.push(ev);
    }

    const slimEvents = replayableQueueEvents.map(ev => ({
      ...ev,
      pageSnapshot: null,
      pageState:    null,
      interactionContext: null,
    }));

    // ── STEP 2: Stash full events to localStorage (The Gold Standard) ─────────
    // Merges with any existing stash for this session (e.g. multiple rapid
    // navigations). Filters expired events individually using each event's own
    // timestamp — prevents stale snapshots from being sent after TTL.
    let stashSuccess = false;
    // Read existing stash for this session (may have events from prior navigation)
    let existingEvents = [];
    const raw = this._safeGetStorage("local", stashKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.events)) {
          // Filter out individually expired events — per-event TTL check
          existingEvents = parsed.events.filter(
            ev => ev.timestamp && (now - ev.timestamp) < STASH_TTL_MS
          );
        }
      } catch (e) {
        this.log("⚠️ localStorage stash parse failed — ignoring previous stash", e.message);
      }
    }

    // Merge: existing non-expired events + current queue events, deduped by event.id
    const mergedEvents = [];
    const mergedIds = new Set();
    for (const ev of [...existingEvents, ...replayableQueueEvents]) {
      const eventId = typeof ev?.id === "string" ? ev.id : null;
      if (!eventId) {
        mergedEvents.push(ev);
        continue;
      }
      if (mergedIds.has(eventId)) continue;
      if (sentIds.has(eventId)) continue;
      mergedIds.add(eventId);
      mergedEvents.push(ev);
    }

    const stored = this._safeSetStorage("local", stashKey, JSON.stringify({
        events:    mergedEvents,
        sessionId: this.config.sessionId,
        // No stash-level timestamp — per-event timestamps used for TTL
      }));

    if (stored) {
      stashSuccess = true;
      this.log(`📦 Stashed ${replayableQueueEvents.length} events to localStorage (total in stash: ${mergedEvents.length})`);
    }

    // ── STEP 3: Always fire stripped beacon (Belt and Suspenders) ─────────────
    // Fired unconditionally — not just as a stash fallback. Reason: if the user
    // never returns to this origin, the stash rots. The beacon guarantees the
    // critical click/action event (id, traceId, fingerprint) is always recorded.
    // If stash also succeeds and heavy version arrives later, dedup handles it.
    const lightPayload = JSON.stringify({ events: slimEvents });
    try {
      if (typeof window.__air_gmBeacon === 'function') {
        // GM beacon (Tampermonkey extension context — bypasses ad blockers)
        const accepted = window.__air_gmBeacon(this.apiEndpoint, lightPayload);
        if (accepted !== false) {
          slimEvents.forEach((ev) => this._rememberSentEventId(ev.id));
          this.log(`🚀 GM stripped beacon dispatched (${slimEvents.length} events)`);
        } else {
          this.log("⚠️ GM stripped beacon rejected payload");
        }
      } else {
        // Native sendBeacon — slim payload guaranteed under 64KB after snapshot strip
        const lightPayloadBytes = this._getPayloadBytes(lightPayload);
        if (lightPayloadBytes <= 60_000) {
          const blob = new Blob([lightPayload], { type: "application/json" });
          const sent = navigator.sendBeacon(this.apiEndpoint, blob);
          if (sent) {
            slimEvents.forEach((ev) => this._rememberSentEventId(ev.id));
            this.log(`🚀 Stripped beacon dispatched (${slimEvents.length} events)`);
          } else {
            // Extremely unlikely after stripping — payload would need to be >64KB
            // of pure event metadata with no snapshots
            this.log("⚠️ Stripped beacon rejected — payload too large even without snapshots");
          }
        } else {
          this.log("⚠️ Stripped beacon rejected — payload too large even without snapshots");
        }
      }
    } catch (e) {
      this.log("⚠️ Stripped beacon failed", e.message);
    }

    // ── STEP 4: Clear the queue ────────────────────────────────────────────────
    // Both delivery paths have fired. Queue is cleared regardless of outcome —
    // events are either in localStorage stash, in-flight via beacon, or both.
    this.eventQueue = [];
  }

  /**
   * Recover stashed events from localStorage and prepend them to the front
   * of the event queue so they are sent before any new events on this page.
   *
   * Called at the TOP of init() — before checkPendingOutcome() — to guarantee
   * correct event ordering:
   *
   *   [stash: click_submit] → [outcome: navigation] → edge created ✅
   *
   * If called AFTER checkPendingOutcome(), the outcome queues first and the
   * click arrives after it — pendingRepo.find() returns null → orphaned outcome
   * → navigation edge never created.
   *
   * Why unshift onto queue (not async fetch):
   *   Async fetch returns immediately. The outcome from checkPendingOutcome()
   *   would still queue before the fetch completes, breaking ordering.
   *   Unshifting is synchronous — ordering is guaranteed before any async work.
   */
  _recoverStashedEvents() {
    const STASH_TTL_MS = 30 * 60 * 1000; // 30 minutes — must match _beaconFlushAll
    const stashKey = `air_heavy_stash_${this.config.sessionId}`;
    const now = Date.now();

    let recovered = 0;
    try {
      const raw = this._safeGetStorage("local", stashKey);
      if (!raw) return 0; // Nothing stashed for this session

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.events) || parsed.events.length === 0) {
        this._safeRemoveStorage("local", stashKey);
        return 0;
      }

      // Filter out individually expired events using per-event timestamp
      const validEvents = parsed.events.filter(
        ev => ev.timestamp && (now - ev.timestamp) < STASH_TTL_MS
      );

      const expiredCount = parsed.events.length - validEvents.length;
      if (expiredCount > 0) {
        this.log(`⏰ Discarded ${expiredCount} expired stashed event(s) (TTL exceeded)`);
      }

      if (validEvents.length === 0) {
        this._safeRemoveStorage("local", stashKey);
        this.log('🧹 Stash cleared — all events expired');
        return 0;
      }

      // Unshift onto FRONT of queue (not append) — critical for ordering.
      // These events happened BEFORE this page loaded. They must be processed
      // before the outcome that checkPendingOutcome() is about to queue.
      const queuedIds = new Set(
        this.eventQueue
          .map((ev) => (typeof ev?.id === "string" ? ev.id : null))
          .filter((id) => typeof id === "string")
      );
      const localSeen = new Set();
      const acceptedEvents = [];

      for (const ev of validEvents) {
        const eventId = typeof ev?.id === "string" ? ev.id : null;

        if (eventId && (queuedIds.has(eventId) || localSeen.has(eventId))) {
          this.log("recovered event skipped because already queued", { eventId });
          continue;
        }

        if (eventId && this._wasEventSent(eventId)) {
          this.log("recovered event skipped because already sent", { eventId });
          continue;
        }

        acceptedEvents.push(ev);
        if (eventId) {
          localSeen.add(eventId);
          queuedIds.add(eventId);
        }
        this.log("recovered event accepted for replay", { eventId });
      }

      for (const ev of acceptedEvents) {
        if (
          this._isPlainObject(ev) &&
          (ev.tabId === undefined || ev.tabId === null) &&
          typeof this.config?.tabId === "string" &&
          this.config.tabId
        ) {
          ev.tabId = this.config.tabId;
          this.log("RECOVERED_EVENT_TABID_STAMPED", {
            eventId: typeof ev.id === "string" ? ev.id : null,
            type: typeof ev.type === "string" ? ev.type : null,
            tabId: ev.tabId,
            sessionId: typeof ev.sessionId === "string" ? ev.sessionId : this.config.sessionId,
            traceId: typeof ev.traceId === "string" ? ev.traceId : null,
          });
        }
      }

      this.eventQueue.unshift(...acceptedEvents);
      recovered = acceptedEvents.length;

      // Clear stash immediately — events are now in queue and will be sent
      // via normal flushQueue on stable network. If page unloads again before
      // they flush, _beaconFlushAll will re-stash them.
      this._safeRemoveStorage("local", stashKey);

      this.log(`📬 Recovered ${recovered} stashed event(s) — prepended to queue`, {
        sessionId: this.config.sessionId,
        oldestEvent: acceptedEvents[0] ? new Date(acceptedEvents[0].timestamp).toISOString() : null,
        newestEvent: acceptedEvents[acceptedEvents.length - 1] ? new Date(acceptedEvents[acceptedEvents.length - 1].timestamp).toISOString() : null,
      });

    } catch (e) {
      // localStorage unavailable or stash corrupted — safe to ignore,
      // beacon already sent the slim version of these events
      this.log('⚠️ Failed to recover stashed events', e.message);
    }

    return recovered;
  }

  // ============================================================
  // FOCUS — opens an input session when a user enters a field
  // ============================================================
  handleFocus(e) {
    if (this.disabled) return;
    // Item 2.5: composedPath()[0] pierces Shadow DOM — e.target stops at the shadow host.
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!target || !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

    const key = this._fieldKey(target);
    if (this.activeInputSessions.has(key)) return; // already tracking

    this.activeInputSessions.set(key, {
      traceId:         this._getRecentActionTrace() || this.generateUUID(),
      startValue:      target.value || "",
      inputCount:      0,
      startTimestamp:  Date.now(),
    });
    this.log("🎯 Input session opened", { key, type: target.type });
  }

  // ============================================================
  // BLUR — commits the final field value as a single event
  // ============================================================
  handleBlur(e) {
    if (this.disabled) return;
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!target || !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

    const key = this._fieldKey(target);

    // Cancel any still-pending debounce for this field
    const debounceTimer = this.inputDebounceTimers.get(key);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      this.inputDebounceTimers.delete(key);
    }

    const session = this.activeInputSessions.get(key);
    this.activeInputSessions.delete(key);

    // Only emit if the value actually changed during the session
    const finalValue  = target.value || "";
    const startValue  = session ? session.startValue : "";
    if (finalValue === startValue && session && session.inputCount === 0) {
      this.log("⏭️ Skipping blur — value unchanged", { key });
      return;
    }

    this.log("📝 Input session closed — emitting final state", { key });
    this._emitInputEvent(target, session ? session.traceId : null, "blur");
  }

  // ============================================================
  // CHANGE — handles <select> (and checkboxes / radio buttons)
  // that don't reliably fire 'input' in all browsers.
  // We do NOT call handleInput here to avoid duplicate events.
  // ============================================================
  handleChange(e) {
    if (this.disabled) return;
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!target) return;

    if (target.tagName === "SELECT") {
      const key     = this._fieldKey(target);
      const session = this.activeInputSessions.get(key);
      this.log("🔽 Select changed", { value: target.value });
      this._emitInputEvent(target, session ? session.traceId : null, "change");
      // Close the session immediately — the user's choice is final
      this.activeInputSessions.delete(key);
    } else if (target.type === "checkbox" || target.type === "radio") {
      this._emitInputEvent(target, this.pendingTraceId, "change");
    }
  }

  // ============================================================
  // INPUT — debounced keystroke tracker.
  // Increments session counter but does NOT emit its own event;
  // handleBlur will emit the single authoritative event on exit.
  // ============================================================
  handleInput(e) {
    if (this.disabled) return;
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!target || !["INPUT", "TEXTAREA"].includes(target.tagName)) return;

    const key = this._fieldKey(target);

    // Ensure a session exists (covers cases where focus was missed)
    if (!this.activeInputSessions.has(key)) {
      this.activeInputSessions.set(key, {
        traceId:        this._getRecentActionTrace() || this.generateUUID(),
        startValue:     "",
        inputCount:     0,
        startTimestamp: Date.now(),
      });
    }

    const session = this.activeInputSessions.get(key);
    session.inputCount++;

    // Debounce: send a "typing in progress" heartbeat every 1500 ms of idle
    // This gives real-time visibility without generating per-keystroke noise.
    clearTimeout(this.inputDebounceTimers.get(key));
    this.inputDebounceTimers.set(
      key,
      setTimeout(() => {
        this.inputDebounceTimers.delete(key);
        // Only emit heartbeat if the session is still active (not yet blurred)
        if (this.activeInputSessions.has(key)) {
          this.log("💬 Input heartbeat", { key, count: session.inputCount });
          this._emitInputEvent(target, session.traceId, "input:progress");
        }
      }, 1500),
    );
  }

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  _markActionTrace(traceId) {
    if (!traceId || typeof traceId !== "string") return;
    this.pendingTraceId = traceId;
    this.lastActionTraceId = traceId;
    this.lastActionTraceAt = Date.now();
  }

  _createActionTraceId() {
    const traceId = this.generateUUID();
    this._markActionTrace(traceId);
    return traceId;
  }

  _getRecentActionTrace(maxAgeMs = 15000) {
    if (this.pendingTraceId && typeof this.pendingTraceId === "string") {
      return this.pendingTraceId;
    }

    if (!this.lastActionTraceId || typeof this.lastActionTraceId !== "string") {
      return null;
    }

    if (!this.lastActionTraceAt || (Date.now() - this.lastActionTraceAt) > maxAgeMs) {
      return null;
    }

    return this.lastActionTraceId;
  }

  _isSubmitLikeElement(element) {
    if (!element || typeof element.tagName !== "string") return false;
    const tagName = element.tagName.toUpperCase();
    const inputType = String(element.type || "").toLowerCase();

    if (tagName === "BUTTON") {
      return inputType !== "button" && inputType !== "reset";
    }

    if (tagName === "INPUT") {
      return inputType === "submit" || inputType === "image";
    }

    return false;
  }

  _rememberRecentSubmitClick(form, traceId) {
    if (!form || !traceId) return;
    this._recentSubmitClick = {
      form,
      traceId,
      createdAt: Date.now(),
    };
  }

  _consumeRecentSubmitTrace(form, maxAgeMs = 2000) {
    const recent = this._recentSubmitClick;
    if (!recent) return null;

    this._recentSubmitClick = null;

    if (!form || recent.form !== form) return null;
    if (!recent.traceId || typeof recent.traceId !== "string") return null;
    if (!recent.createdAt || (Date.now() - recent.createdAt) > maxAgeMs) return null;

    return recent.traceId;
  }

  /** Build a stable string key that identifies a specific form field. */
  _fieldKey(element) {
    return [
      element.tagName,
      element.id     || "",
      element.name   || "",
      element.type   || "",
      element.getAttribute("data-testid") || "",
    ].join("|");
  }

  _getComposedEventTarget(event) {
    return (event?.composedPath && event.composedPath()[0]) || event?.target || null;
  }

  _elementHasActionableDetail(element) {
    if (!element || typeof element.getAttribute !== "function") return false;
    const text = (element.textContent || "").trim().replace(/\s+/g, " ");
    return !!(
      element.id ||
      element.name ||
      element.getAttribute("data-testid") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("role") ||
      text.length > 0
    );
  }

  _isProbableClosedShadowHost(element) {
    if (!element || typeof element.tagName !== "string") return false;
    const tagName = element.tagName.toLowerCase();
    if (!tagName.includes("-")) return false;
    if (element.shadowRoot) return false;
    return !this._elementHasActionableDetail(element);
  }

  _resolveNestedContext(event, target, eventId = null) {
    if (!target || typeof target !== "object") {
      return { target, nestedContext: undefined };
    }

    const nestedContext = {};
    const sessionId = this.config?.sessionId || null;
    const tabId = this.config?.tabId || null;
    const effectiveTarget = target;
    const rootNode = typeof effectiveTarget.getRootNode === "function"
      ? effectiveTarget.getRootNode()
      : null;

    if (rootNode && typeof ShadowRoot !== "undefined" && rootNode instanceof ShadowRoot) {
      nestedContext.isShadowDom = true;
      nestedContext.shadowHostTag = rootNode.host?.tagName?.toLowerCase?.() || null;
      this.log("SHADOW_DOM_TARGET_USED", {
        eventId,
        tagName: effectiveTarget.tagName?.toLowerCase?.() || null,
        shadowHostTag: nestedContext.shadowHostTag,
        sessionId,
        tabId,
      });
    } else if (this._isProbableClosedShadowHost(effectiveTarget)) {
      nestedContext.isShadowDom = true;
      nestedContext.shadowHostTag = effectiveTarget.tagName?.toLowerCase?.() || null;
      nestedContext.degraded = true;
      nestedContext.degradedReason = "probable_closed_shadow_host";
      this.log("SHADOW_DOM_CLOSED_DEGRADED", {
        eventId,
        hostTag: nestedContext.shadowHostTag,
        hasShadowRootHint: null,
        sessionId,
        tabId,
      });
    }

    // Important limitation:
    // The parent document cannot capture inner click/input events from iframe documents.
    // This metadata only applies when the event target is the iframe element itself, or
    // when same-origin iframe metadata is safely readable without injecting into the frame.
    const iframeElement = effectiveTarget.tagName === "IFRAME"
      ? effectiveTarget
      : (typeof effectiveTarget.closest === "function" ? effectiveTarget.closest("iframe") : null);

    if (iframeElement) {
      nestedContext.isIframe = true;
      nestedContext.iframeSrc = iframeElement.getAttribute("src") || null;
      nestedContext.iframeName = iframeElement.getAttribute("name") || iframeElement.name || null;

      let iframeSameOrigin = null;
      try {
        // Metadata-only enrichment. Do not inject into iframe documents here.
        iframeSameOrigin = !!iframeElement.contentDocument;
      } catch (_) {
        iframeSameOrigin = false;
      }
      nestedContext.iframeSameOrigin = iframeSameOrigin;

      if (iframeSameOrigin) {
        this.log("SAME_ORIGIN_IFRAME_CONTEXT_CAPTURED", {
          eventId,
          iframeSrc: nestedContext.iframeSrc,
          iframeName: nestedContext.iframeName,
          sessionId,
          tabId,
        });
      } else {
        nestedContext.degraded = true;
        nestedContext.degradedReason = nestedContext.degradedReason || "cross_origin_iframe_unavailable";
        this.log("IFRAME_CONTEXT_DEGRADED", {
          eventId,
          iframeSrc: nestedContext.iframeSrc,
          iframeName: nestedContext.iframeName,
          iframeSameOrigin,
          sessionId,
          tabId,
        });
      }
    }

    if (Object.keys(nestedContext).length > 0) {
      this.log("NESTED_CONTEXT_DETECTED", {
        eventId,
        tagName: effectiveTarget.tagName?.toLowerCase?.() || null,
        nestedContext,
        sessionId,
        tabId,
      });
      return { target: effectiveTarget, nestedContext };
    }

    return { target: effectiveTarget, nestedContext: undefined };
  }

  /**
   * Emit a single structured input event.
   * @param {HTMLElement} target
   * @param {string|null} traceId
   * @param {"blur"|"change"|"input:progress"} trigger  — what caused this emission
   */
  _emitInputEvent(target, traceId, trigger) {
    const eventId = this.generateUUID();
    const resolvedTargetInfo = this._resolveNestedContext(null, target, eventId);
    const effectiveTarget = resolvedTargetInfo.target || target;
    const nestedContext = resolvedTargetInfo.nestedContext;
    const fingerprint = this.generateFingerprint(effectiveTarget);
    const rawValue    = effectiveTarget.value || "";
    const isSensitive = this.isSensitiveField(effectiveTarget);
    const hasPII      = this.containsPII(rawValue);

    // For non-sensitive fields we record value LENGTH as a signal (not the text).
    // For sensitive / PII fields we record nothing beyond "entered".
    const maskedValue = (isSensitive || hasPII)
      ? "[REDACTED]"
      : "*".repeat(Math.min(rawValue.length, 20));

    // SELECT: also record which option was chosen (text label only, not value, for safety)
    let selectedLabel = undefined;
    if (effectiveTarget.tagName === "SELECT" && !isSensitive) {
      selectedLabel = effectiveTarget.options[effectiveTarget.selectedIndex]?.text || undefined;
    }

    const isHeartbeat = trigger === "input:progress";
    let resolvedTraceId = traceId || this._getRecentActionTrace();
    if (!resolvedTraceId && !isHeartbeat) {
      resolvedTraceId = this._createActionTraceId();
    } else if (resolvedTraceId && !isHeartbeat) {
      this._markActionTrace(resolvedTraceId);
    }

    const pageUrl = window.location.href;
    const normalizedUrl = this.normalizeUrl(pageUrl);
    const subtreeSnapshot = effectiveTarget
      ? this._captureSubtreeSnapshot(effectiveTarget)
      : null;

    this.queueEvent({
      id:            eventId,
      type:          "input",
      trigger,                          // blur | change | input:progress
      timestamp:     Date.now(),
      pageUrl,
      normalizedUrl,
      pageTitle:     document.title,
      viewport:      { width: window.innerWidth, height: window.innerHeight },
      fingerprint,
      nestedContext,
      inputValueMasked: maskedValue,
      inputLength:   rawValue.length,   // useful signal for analytics
      selectedLabel,                    // SELECT-only
      traceId:       resolvedTraceId || undefined,
      sessionId:     this.config.sessionId,
      schemaVersion: "air:v2",
      pageSnapshot: subtreeSnapshot || undefined,
      pageState: subtreeSnapshot || undefined,
      interactionContext: undefined,
    });
  }
  // ═══════════════════════════════════════════════════════════════════
  // CUSTOM (DIV-BASED) DROPDOWN ENGINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * ARIA roles that mark an element as a selectable option.
   * Covers menus, listboxes, trees, and compound-widget items.
   */
  static get OPTION_ROLES() {
    return new Set([
      "option", "menuitem", "menuitemradio", "menuitemcheckbox",
      "treeitem", "tab", "gridcell",
    ]);
  }

  /**
   * CSS class fragments (lowercased) used by popular libraries for option rows.
   * Matched via substring so partial class names like "ant-select-item-option-content"
   * still resolve correctly.
   */
  static get OPTION_CLASS_PATTERNS() {
    return [
      // Generic / hand-rolled
      "dropdown-item", "dropdown-option", "select-option", "option-item",
      "list-option", "list-item--option",
      // Choices.js
      "choices__item--choice",
      // Vue Select
      "vs__dropdown-option",
      // Vue Multiselect
      "multiselect__option",
      // Ant Design
      "ant-select-item-option",
      // Angular Material / CDK
      "mat-option", "mat-mdc-option",
      // Angular ng-select
      "ng-option",
      // Select2 / Select2-Bootstrap
      "select2-results__option",
      // react-select
      "select__option",
      // Headless UI / Radix (usually role-based, but class fallback)
      "headlessui-listbox-option", "radix-option",
      // Bootstrap Select
      "bs-select-option",
      // PrimeNG / PrimeFaces
      "p-dropdown-item", "ui-dropdown-item",
      // OrangeHRM
      "oxd-select-option", "oxd-userdropdown-link", "oxd-autocomplete-option",
    ];
  }

  /**
   * ARIA roles that identify a dropdown container (the panel holding options).
   */
  static get CONTAINER_ROLES() {
    return new Set(["listbox", "menu", "tree", "group", "presentation", "grid"]);
  }

  static get CONTAINER_CLASS_PATTERNS() {
    return [
      "dropdown-menu", "dropdown-list", "select-dropdown", "options-list",
      "choices__list--dropdown",
      "vs__dropdown-menu",
      "multiselect__content-wrapper",
      "ant-select-dropdown",
      "mat-select-panel", "mat-mdc-select-panel", "cdk-overlay-pane",
      "ng-dropdown-panel",
      "select2-results",
      "select__menu",
      "p-dropdown-panel",
      // OrangeHRM
      "oxd-select-dropdown", "oxd-userdropdown", "oxd-autocomplete-dropdown",
    ];
  }

  /**
   * ARIA roles / attributes that mark an element as a dropdown trigger.
   */
  static get TRIGGER_CLASS_PATTERNS() {
    return [
      "dropdown-toggle", "select-trigger", "dropdown-trigger",
      "custom-select__trigger", "choices__inner",
      "vs__search", "vs__selected",
      "multiselect__select",
      "ant-select-selector",
      "mat-select-trigger", "mat-mdc-select-trigger",
      "ng-select",
      "select2-selection",
      "select__control", "select__dropdown-indicator",
      "p-dropdown-trigger",
      // OrangeHRM
      "oxd-select-text", "oxd-select-wrapper", "oxd-select-text-input",
      "oxd-userdropdown-tab", "oxd-userdropdown-name",
    ];
  }

  static get MENU_OPTION_ROLES() {
    return new Set(["menuitem", "menuitemradio", "menuitemcheckbox"]);
  }

  static get OPTION_FALLBACK_DELAY_MS() {
    return 100;
  }

  static get OPTION_FALLBACK_MAX_AGE_MS() {
    return 500;
  }

  static get ORANGEHRM_TRIGGER_SELECTORS() {
    return [
      ".oxd-select-text",
      ".oxd-select-wrapper",
      ".oxd-userdropdown-tab",
      ".oxd-userdropdown-name",
    ];
  }

  _isElementVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.hidden) return false;
    if (el.getAttribute?.("aria-hidden") === "true") return false;

    const style = window.getComputedStyle?.(el);
    if (style) {
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (style.opacity === "0") return false;
    }

    const rect = el.getBoundingClientRect?.();
    if (!rect) return true;
    return rect.width > 0 && rect.height > 0;
  }

  _looksLikeOrangeHrmTrigger(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const cls = (el.className || "").toLowerCase();
    const matchesKnownClass = AIRInterceptor.TRIGGER_CLASS_PATTERNS.some(p => cls.includes(p));
    if (matchesKnownClass) return true;

    if (el.matches?.(".oxd-select-text, .oxd-select-wrapper")) {
      const hasReadonlyInput = !!el.querySelector?.('input[readonly], .oxd-select-text-input');
      const hasChevron = !!el.querySelector?.(
        '.oxd-select-text--after, [class*="caret"], [class*="chevron"], [class*="dropdown"], .oxd-icon'
      );
      return hasReadonlyInput || hasChevron;
    }

    if (el.matches?.(".oxd-userdropdown-tab, .oxd-userdropdown-name")) {
      const userDropdownRoot = el.closest?.(".oxd-userdropdown");
      const hasChevron = !!(userDropdownRoot || el).querySelector?.('[class*="caret"], [class*="dropdown"], .oxd-icon');
      return hasChevron || !!userDropdownRoot;
    }

    return false;
  }

  _resolveOrangeHrmTrigger(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

    for (const selector of AIRInterceptor.ORANGEHRM_TRIGGER_SELECTORS) {
      const candidate = el.matches?.(selector) ? el : el.closest?.(selector);
      if (candidate && this._looksLikeOrangeHrmTrigger(candidate)) {
        return candidate;
      }
    }

    const readonlyInput = el.matches?.('input[readonly], .oxd-select-text-input')
      ? el
      : el.closest?.('input[readonly], .oxd-select-text-input');
    if (readonlyInput) {
      const wrapped = readonlyInput.closest?.('.oxd-select-text, .oxd-select-wrapper');
      if (wrapped && this._looksLikeOrangeHrmTrigger(wrapped)) {
        return wrapped;
      }
    }

    return null;
  }

  _inferCustomControlFamily(triggerEl, panelEl = null) {
    const triggerRole = (triggerEl?.getAttribute?.("role") || "").toLowerCase();
    const triggerCls = (triggerEl?.className || "").toLowerCase();
    const panelRole = (panelEl?.getAttribute?.("role") || "").toLowerCase();

    if (panelRole === "menu" || triggerCls.includes("userdropdown")) return "menu";
    if (triggerRole === "combobox" || panelRole === "listbox") return "combobox";
    if (triggerCls.includes("select")) return "dropdown";
    return "dropdown";
  }

  _collectVisibleOptionEntries(panelEl, limit = 8) {
    if (!panelEl || panelEl.nodeType !== Node.ELEMENT_NODE) return [];
    const optionSelector = [
      ...Array.from(AIRInterceptor.OPTION_ROLES).map(role => `[role="${role}"]`),
      ...AIRInterceptor.OPTION_CLASS_PATTERNS.map(pattern => `[class*="${pattern}"]`),
    ].join(", ");

    const entries = [];
    for (const el of Array.from(panelEl.querySelectorAll(optionSelector))) {
      if (!this._isElementVisible(el)) continue;
      const option = this._extractOptionData(el);
      if (!option?.label) continue;
      entries.push({
        label: option.label,
        value: option.value,
        role: (el.getAttribute("role") || "").toLowerCase() || null,
      });
      if (entries.length >= limit) break;
    }
    return entries;
  }

  _findVisibleDropdownPanel(triggerEl = null) {
    const controlledId = triggerEl?.getAttribute?.("aria-controls");
    if (controlledId) {
      const directPanel = document.getElementById(controlledId);
      if (directPanel && this._isElementVisible(directPanel)) {
        return directPanel;
      }
    }

    const selector = [
      ...Array.from(AIRInterceptor.CONTAINER_ROLES).map(role => `[role="${role}"]`),
      ...AIRInterceptor.CONTAINER_CLASS_PATTERNS.map(pattern => `[class*="${pattern}"]`),
    ].join(", ");

    const candidates = Array.from(document.querySelectorAll(selector))
      .filter(el => this._isElementVisible(el));

    if (candidates.length === 0) return null;

    const triggerRect = triggerEl?.getBoundingClientRect?.() || null;
    const scored = candidates
      .map(panel => {
        const optionCount = this._collectVisibleOptionEntries(panel).length;
        const rect = panel.getBoundingClientRect?.();
        const distance = triggerRect && rect
          ? Math.abs(rect.top - triggerRect.bottom) + Math.abs(rect.left - triggerRect.left)
          : 10_000;
        return { panel, score: optionCount * 100 - distance };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0]?.panel || null;
  }

  async _awaitCustomControlOpenEvidence(triggerEl, timeoutMs = 250) {
    const start = Date.now();

    while ((Date.now() - start) <= timeoutMs) {
      const expanded = (triggerEl?.getAttribute?.("aria-expanded") || "").toLowerCase() === "true";
      const panelEl = this._findVisibleDropdownPanel(triggerEl);
      const optionPreview = panelEl ? this._collectVisibleOptionEntries(panelEl) : [];

      if (expanded || panelEl || optionPreview.length > 0) {
        return {
          handled: true,
          expanded,
          panelEl,
          optionPreview,
          observedAfterMs: Date.now() - start,
        };
      }

      await new Promise(resolve => setTimeout(resolve, 40));
    }

    return {
      handled: false,
      expanded: false,
      panelEl: null,
      optionPreview: [],
      observedAfterMs: Date.now() - start,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // DETECTION HELPERS
  // ──────────────────────────────────────────────────────────────

  /**
   * Walk up from `el` (max 5 steps) and return the first element
   * that looks like a custom dropdown OPTION. Returns null if not found.
   *
   * @param {Element} el — the raw click target
   * @returns {{ el: Element, label: string, value: string, index: number }|null}
   */
  _detectCustomDropdownOption(el) {
    if (!el) return null;
    let cursor = el;
    for (let depth = 0; depth < 5; depth++) {
      if (!cursor || cursor === document.body) break;

      const role = (cursor.getAttribute("role") || "").toLowerCase();
      const cls  = (cursor.className  || "").toLowerCase();

      const matchesRole  = AIRInterceptor.OPTION_ROLES.has(role);
      const matchesClass = AIRInterceptor.OPTION_CLASS_PATTERNS.some(p => cls.includes(p));

      if (matchesRole || matchesClass) {
        // Confirm it is inside a recognisable dropdown container
        if (this._findDropdownContainer(cursor)) {
          return this._extractOptionData(cursor);
        }
      }
      cursor = cursor.parentElement;
    }
    return null;
  }

  /**
   * Walk up from `el` (max 5 steps) and return the element that is
   * a custom dropdown TRIGGER, or null if this click is unrelated.
   *
   * @param {Element} el
   * @returns {Element|null}
   */
  _resolveCustomDropdownTrigger(el) {
    if (!el) return null;
    let cursor = el;
    for (let depth = 0; depth < 5; depth++) {
      if (!cursor || cursor === document.body) break;

      const orangeHrmTrigger = this._resolveOrangeHrmTrigger(cursor);
      if (orangeHrmTrigger) return orangeHrmTrigger;

      const role    = (cursor.getAttribute("role")         || "").toLowerCase();
      const popup   =  cursor.getAttribute("aria-haspopup");
      const cls     = (cursor.className                    || "").toLowerCase();

      const hasAriaSignal = popup != null || role === "combobox";
      const matchesClass  = AIRInterceptor.TRIGGER_CLASS_PATTERNS.some(p => cls.includes(p));

      if (hasAriaSignal || matchesClass) return cursor;
      cursor = cursor.parentElement;
    }
    return null;
  }

  /**
   * Walk up from `optionEl` and return the first element that looks
   * like a dropdown panel/container, or null.
   *
   * @param {Element} optionEl
   * @returns {Element|null}
   */
  _findDropdownContainer(optionEl) {
    let cursor = optionEl.parentElement;
    for (let depth = 0; depth < 8; depth++) {
      if (!cursor || cursor === document.body) break;
      const role = (cursor.getAttribute("role") || "").toLowerCase();
      const cls  = (cursor.className            || "").toLowerCase();
      if (
        AIRInterceptor.CONTAINER_ROLES.has(role) ||
        AIRInterceptor.CONTAINER_CLASS_PATTERNS.some(p => cls.includes(p))
      ) return cursor;
      cursor = cursor.parentElement;
    }
    return null;
  }

  /**
   * Extract human-readable label + machine value from an option element.
   *
   * Label priority: aria-label → visible text content
   * Value priority: data-value → value attr → data-key → label
   */
  _extractOptionData(el) {
    const label = (
      el.getAttribute("aria-label") ||
      el.getAttribute("title")      ||
      (el.textContent || el.innerText || "").trim().replace(/\s+/g, " ")
    ).slice(0, 200);

    const value = (
      el.getAttribute("data-value") ||
      el.getAttribute("value")      ||
      el.getAttribute("data-key")   ||
      el.getAttribute("data-id")    ||
      label
    ).slice(0, 200);

    // Determine position among sibling options (0-based)
    const container = this._findDropdownContainer(el);
    let index = -1;
    if (container) {
      const optionRole = el.getAttribute("role") || "";
      const optionCls  = el.className || "";
      // Match siblings that share the same role OR at least one class token
      const siblings = Array.from(container.querySelectorAll(
        optionRole ? `[role="${optionRole}"]` : "*",
      ));
      index = siblings.indexOf(el);
    }

    return { el, label, value, index };
  }

  // ──────────────────────────────────────────────────────────────
  // PHASE 1 — DROPDOWN OPENED
  // ──────────────────────────────────────────────────────────────

  /**
   * Called (via rAF) after a trigger click.
   * If aria-expanded is now "true" (or a panel appeared in the DOM),
   * we open a tracking session and watch for the option panel.
   */
  async _onDropdownOpened(triggerEl, triggerFingerprint, nestedContext, traceId, openEvidence = null) {
    const expanded = triggerEl.getAttribute("aria-expanded");
    const evidence = openEvidence || await this._awaitCustomControlOpenEvidence(triggerEl);
    const controlFamily = this._inferCustomControlFamily(triggerEl, evidence?.panelEl || null);

    // If expanded didn't flip to "true", this wasn't really a dropdown open
    // (could be a button click that does something else). Still proceed for
    // class-only dropdowns where aria-expanded may not be used.
    this.log("🔽 Custom dropdown trigger activated", {
      selector:  triggerFingerprint?.selector,
      expanded,
      handled: evidence?.handled ?? false,
      controlFamily,
    });

    // Close any previously orphaned session
    if (this._openDropdown) {
      this.log("⚠️ Orphaned dropdown session replaced", { old: this._openDropdown.traceId });
    }
    if (this._dropdownObserver) {
      this._dropdownObserver.disconnect();
      this._dropdownObserver = null;
    }

    this._openDropdown = {
      traceId,
      triggerEl,
      triggerFingerprint,
      controlFamily,
      openTimestamp: Date.now(),
    };

    // Auto-expire the session after 30 s to prevent memory leaks on
    // dropdowns that are opened but the user clicks away without selecting.
    this._openDropdown._expireTimer = setTimeout(() => {
      if (this._openDropdown?.traceId === traceId) {
        this.log("⏰ Dropdown session expired without selection");
        this._closeDropdownSession();
      }
    }, 30_000);

    let afterOpenSnapshot = undefined;
    if (this.config.capturePageSnapshot) {
      try {
        afterOpenSnapshot = await this.capturePageSnapshot(
          this.config.snapshotDepth,
          false,
        );
      } catch (err) {
        this.log("Failed to capture custom control open snapshot", err);
      }
    }

    const pageUrl = window.location.href;
    const normalizedUrl = this.normalizeUrl(pageUrl);
    const panelRole = (evidence?.panelEl?.getAttribute?.("role") || "").toLowerCase() || null;
    const panelClass = typeof evidence?.panelEl?.className === "string"
      ? evidence.panelEl.className.slice(0, 200)
      : null;

    this.lastActionTraceId = traceId;
    this.lastActionTraceAt = Date.now();

    this.queueEvent({
      id: this.generateUUID(),
      type: EventType.CUSTOM_CONTROL_OPEN,
      trigger: "click",
      timestamp: Date.now(),
      traceId,
      pageUrl,
      normalizedUrl,
      pageTitle: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      sessionId: this.config.sessionId,
      nestedContext,
      schemaVersion: "air:v2", // custom-control-open
      controlFamily,
      triggerText: this.extractText(triggerEl) || undefined,
      triggerRole: (triggerEl.getAttribute("role") || "").toLowerCase() || undefined,
      fingerprint: triggerFingerprint,
      triggerFingerprint,
      pageSnapshot: afterOpenSnapshot || undefined,
      pageState: afterOpenSnapshot || undefined,
      meta: {
        expanded: evidence?.expanded ?? false,
        observedAfterMs: evidence?.observedAfterMs ?? null,
        popupDetected: !!evidence?.panelEl,
        popupRole: panelRole,
        popupClass: panelClass,
        optionPreview: evidence?.optionPreview || [],
      },
    });
    this.flushQueue();

    if (!evidence?.panelEl) {
      // Watch for option panels injected after the initial open-state check.
      this._watchForDropdownPanel(traceId);
    }
  }

  async _handlePotentialCustomControlTrigger(triggerEl, triggerFingerprint, nestedContext) {
    if (!triggerEl || !triggerFingerprint) return false;

    const traceId = this.generateUUID();
    const evidence = await this._awaitCustomControlOpenEvidence(triggerEl);
    if (!evidence?.handled) {
      return false;
    }

    await this._onDropdownOpened(triggerEl, triggerFingerprint, nestedContext, traceId, evidence);
    return true;
  }
  // ──────────────────────────────────────────────────────────────
  // PHASE 2 — OPTION SELECTED
  // ──────────────────────────────────────────────────────────────

  /**
   * Called by handleClick when we confirm the click target is an option.
   * Emits a structured "custom-select" event and closes the session.
   */
  _handleCustomDropdownSelection(optionData, clickEvent, explicitTraceId = null, explicitControlFamily = null) {
    const { label, value, index, el } = optionData;
    const session = this._openDropdown;
    const eventId = this.generateUUID();
    const optionRole = (el?.getAttribute?.("role") || "").toLowerCase();
    const optionContainer = this._findDropdownContainer(el);
    const containerRole = (optionContainer?.getAttribute?.("role") || "").toLowerCase();
    const controlFamily = explicitControlFamily || session?.controlFamily || this._inferCustomControlFamily(session?.triggerEl || null, optionContainer);
    const isMenuSelection =
      AIRInterceptor.MENU_OPTION_ROLES.has(optionRole) ||
      containerRole === "menu" ||
      controlFamily === "menu";
    const eventType = isMenuSelection ? EventType.CUSTOM_MENU_SELECT : EventType.CUSTOM_SELECT;

    this.log("✅ Custom dropdown option selected", { label, value, index });

    // Stop observing — selection is final
    if (this._dropdownObserver) {
      this._dropdownObserver.disconnect();
      this._dropdownObserver = null;
    }

    const traceId          = explicitTraceId || session?.traceId || this._getRecentActionTrace() || this._createActionTraceId();
    const optionSelectorForLog = this.generateFingerprint(el)?.selector || null;
    this.log("CUSTOM_SELECT_EMIT_ATTEMPT", {
      eventType,
      label,
      value,
      traceId,
      controlFamily,
      triggerSelector: session?.triggerFingerprint?.selector || null,
      optionSelector: optionSelectorForLog,
    });
    this._markActionTrace(traceId);
    const triggerFp        = session?.triggerFingerprint || null;
    const durationMs       = session ? Date.now() - session.openTimestamp : null;
    const resolvedTargetInfo = this._resolveNestedContext(
      clickEvent,
      el || session?.triggerEl || this._getComposedEventTarget(clickEvent) || null,
      eventId
    );
    const nestedContext = resolvedTargetInfo.nestedContext;
    const optionTarget = resolvedTargetInfo.target || el;
    const optionFingerprint = this.generateFingerprint(optionTarget);
    const snapshotTarget = optionTarget || session?.triggerEl || this._getComposedEventTarget(clickEvent) || null;
    const subtreeSnapshot = snapshotTarget
      ? this._captureSubtreeSnapshot(snapshotTarget)
      : null;

    const pageUrl = window.location.href;
    const normalizedUrl = this.normalizeUrl(pageUrl);
    this.queueEvent({
      id:            eventId,
      type:          eventType,                // distinct from native "input" / "change"
      trigger:       "option-click",
      timestamp:     Date.now(),
      traceId,
      pageUrl,
      normalizedUrl,
      pageTitle:     document.title,
      viewport:      { width: window.innerWidth, height: window.innerHeight },
      sessionId:     this.config.sessionId,
      nestedContext,
      schemaVersion: "air:v2",
      controlFamily,
      optionRole: optionRole || undefined,
      // ── Relationship back to the trigger element ──
      triggerFingerprint: triggerFp,
      // ── Option element identity ──
      fingerprint: optionFingerprint,
      // ── Timing ──
      meta: {
        durationMs,                            // time between open and select
        hadExplicitSession: !!session,         // did we track the trigger click?
        triggerSelector: triggerFp?.selector || null,
        containerRole: containerRole || null,
      },
      pageSnapshot: subtreeSnapshot || undefined,
      pageState: subtreeSnapshot || undefined,
      interactionContext: undefined,
    });

    this.log("CUSTOM_SELECT_EMITTED", {
      eventType,
      eventId,
      traceId,
      selector: optionFingerprint?.selector || null,
      label,
    });
    this.flushQueue();
    this._closeDropdownSession();
  }

  _clearPendingOptionSelection() {
    if (this._pendingOptionSelectionFallbackTimer) {
      clearTimeout(this._pendingOptionSelectionFallbackTimer);
      this._pendingOptionSelectionFallbackTimer = null;
    }
    this._pendingOptionSelection = null;
  }

  _schedulePendingOptionSelectionFallback() {
    if (this._pendingOptionSelectionFallbackTimer) {
      clearTimeout(this._pendingOptionSelectionFallbackTimer);
    }

    this._pendingOptionSelectionFallbackTimer = setTimeout(() => {
      this._pendingOptionSelectionFallbackTimer = null;
      this._consumePendingOptionSelectionFromFallback('timer');
    }, AIRInterceptor.OPTION_FALLBACK_DELAY_MS);

    this.log("PENDING_OPTION_FALLBACK_SCHEDULED", {
      delayMs: AIRInterceptor.OPTION_FALLBACK_DELAY_MS,
      traceId: this._pendingOptionSelection?.traceId || null,
      controlFamily: this._pendingOptionSelection?.controlFamily || null,
      optionRole: this._pendingOptionSelection?.optionRole || null,
      containerRole: this._pendingOptionSelection?.containerRole || null,
    });
  }

  _consumePendingOptionSelectionFromFallback(reason = 'timer') {
    const pending = this._pendingOptionSelection;
    if (!pending) {
      this.log("PENDING_OPTION_FALLBACK_SKIPPED", { reason: 'already_consumed', source: reason });
      return false;
    }

    const ageMs = Date.now() - pending.timestamp;
    const optionData = pending.optionData;
    const optionRole = pending.optionRole || '';
    const containerRole = pending.containerRole || '';
    const controlFamily = pending.controlFamily || '';
    const listboxLike =
      optionRole === 'option' ||
      containerRole === 'listbox' ||
      controlFamily === 'combobox' ||
      controlFamily === 'autocomplete';
    const validOption =
      !!optionData &&
      typeof optionData.label === 'string' &&
      optionData.label.trim().length > 0 &&
      typeof optionData.value === 'string' &&
      optionData.value.trim().length > 0;
    const hasInputContext = controlFamily === 'autocomplete' && !!pending.traceId;
    const validContext = !!pending.hasOpenDropdown || hasInputContext;

    if (AIRInterceptor.MENU_OPTION_ROLES.has(optionRole) || containerRole === 'menu' || controlFamily === 'menu') {
      this.log("PENDING_OPTION_FALLBACK_SKIPPED", {
        reason: 'menuitem_click_path_preferred',
        source: reason,
        traceId: pending.traceId || null,
      });
      this._clearPendingOptionSelection();
      return false;
    }

    if (ageMs > AIRInterceptor.OPTION_FALLBACK_MAX_AGE_MS) {
      this.log("PENDING_OPTION_FALLBACK_SKIPPED", {
        reason: 'stale',
        source: reason,
        ageMs,
      });
      this._clearPendingOptionSelection();
      return false;
    }

    if (!validOption) {
      this.log("PENDING_OPTION_FALLBACK_SKIPPED", {
        reason: 'invalid_option',
        source: reason,
        ageMs,
      });
      this._clearPendingOptionSelection();
      return false;
    }

    if (!listboxLike || !validContext) {
      this.log("PENDING_OPTION_FALLBACK_SKIPPED", {
        reason: 'invalid_context',
        source: reason,
        ageMs,
        optionRole,
        containerRole,
        controlFamily,
        hasOpenDropdown: !!pending.hasOpenDropdown,
        hasInputContext,
      });
      this._clearPendingOptionSelection();
      return false;
    }

    this.log("PENDING_OPTION_FALLBACK_CONSUMED", {
      label: optionData.label,
      value: optionData.value,
      traceId: pending.traceId || null,
      controlFamily,
      ageMs,
      source: reason,
    });

    this._clearPendingOptionSelection();
    this._handleCustomDropdownSelection(
      optionData,
      { target: optionData.el || null },
      pending.traceId,
      controlFamily
    );
    return true;
  }

  /**
   * Tear down the open dropdown session cleanly.
   */
  _closeDropdownSession() {
    this._clearPendingOptionSelection();
    if (this._openDropdown?._expireTimer) {
      clearTimeout(this._openDropdown._expireTimer);
    }
    this._openDropdown = null;
    if (this._dropdownObserver) {
      this._dropdownObserver.disconnect();
      this._dropdownObserver = null;
    }
  }

  // ──────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────
  // MOUSEDOWN PRE-CAPTURE (DOM detachment race guard)
  // ─────────────────────────────────────────────────────────────

  /**
   * Capture-phase mousedown handler that snapshots option data while the DOM
   * is still live. Fires BEFORE the framework's own click handler can remove
   * the option element from the DOM.
   *
   * Does NOT emit any event — only stores a pending snapshot.
   * The actual custom-select is emitted by handleClick which validates the
   * pending data and confirms the user actually completed the click.
   */
  _handleMousedownForOption(e) {
    if (this.disabled) return;

    const target = this._getComposedEventTarget(e);
    if (!target) return;

    this.log("MOUSEDOWN_OPTION_HANDLER_ENTER", {
      hasOpenDropdown: !!this._openDropdown,
      activeInputSessionCount: this.activeInputSessions.size,
      targetTag: target.tagName || null,
      targetRole: target.getAttribute?.('role') || null,
      targetClass: typeof target.className === 'string' ? target.className : null,
      targetText: (this.extractText(target) || '').trim().slice(0, 80) || null,
      x: e.clientX || 0,
      y: e.clientY || 0,
    });

    const optionData = this._detectCustomDropdownOption(target);
    if (!optionData) {
      let reason = 'no_option_match';
      if (this._openDropdown) {
        reason = 'open_dropdown_but_target_not_option';
      } else if (this.activeInputSessions.size > 0) {
        reason = 'input_context_but_target_not_option';
      }
      this.log("MOUSEDOWN_OPTION_NOT_DETECTED", {
        targetRole: target.getAttribute?.('role') || null,
        targetClass: typeof target.className === 'string' ? target.className : null,
        targetText: (this.extractText(target) || '').trim().slice(0, 80) || null,
        hasOpenDropdown: !!this._openDropdown,
        activeInputSessionCount: this.activeInputSessions.size,
        reason,
      });
      this._clearPendingOptionSelection();
      return;
    }

    const optionFingerprint = this.generateFingerprint(optionData.el);
    const optionContainer = this._findDropdownContainer(optionData.el);
    const containerRole = (optionContainer?.getAttribute?.('role') || '').toLowerCase();
    const optionRole = (optionData.el?.getAttribute?.('role') || '').toLowerCase();

    let traceId = null;
    let controlFamily = null;
    let triggerFingerprint = null;
    let hasOpenDropdown = false;

    if (this._openDropdown) {
      hasOpenDropdown = true;
      traceId = this._openDropdown.traceId;
      controlFamily = this._openDropdown.controlFamily;
      triggerFingerprint = this._openDropdown.triggerFingerprint;
    } else {
      if (this.activeInputSessions.size > 0) {
        const sessions = Array.from(this.activeInputSessions.values());
        traceId = sessions[sessions.length - 1].traceId;
      }
      controlFamily = 'autocomplete';
    }

    this._clearPendingOptionSelection();
    this._pendingOptionSelection = {
      optionData,
      optionFingerprint,
      optionRole,
      containerRole,
      containerEl: optionContainer,
      timestamp: Date.now(),
      mousedownClientX: e.clientX,
      mousedownClientY: e.clientY,
      hasOpenDropdown,
      traceId,
      controlFamily,
      triggerFingerprint,
    };
    this.log("MOUSEDOWN_OPTION_CAPTURED", {
      label: optionData.label,
      value: optionData.value,
      optionRole,
      optionSelector: optionFingerprint?.selector || null,
      containerRole: containerRole || null,
      containerClass: typeof optionContainer?.className === 'string' ? optionContainer.className : null,
      traceId,
      controlFamily,
      hasOpenDropdown,
      timestamp: this._pendingOptionSelection.timestamp,
    });

    this.log('🖱️ Mousedown pre-captured option for pending custom-select', {
      label: optionData.label,
      value: optionData.value,
      selector: optionFingerprint?.selector,
      traceId,
      controlFamily,
    });
    this._schedulePendingOptionSelectionFallback();
  }

  // ─────────────────────────────────────────────────────────────
  // CLICK HANDLER
  // ─────────────────────────────────────────────────────────────
  async handleClick(e) {
    if (this.disabled) return;
    // Item 2.5: Resolve the TRUE click target through Shadow DOM boundaries.
    // e.target is retargeted to the shadow host; composedPath()[0] is the real element.
    const actionEventId = this.generateUUID();
    const resolvedTargetInfo = this._resolveNestedContext(e, this._getComposedEventTarget(e), actionEventId);
    const clickTarget = resolvedTargetInfo.target;
    const nestedContext = resolvedTargetInfo.nestedContext;

    // ══════════════════════════════════════════════════════════════
    // CUSTOM DROPDOWN INTERCEPT — must run FIRST, before dedup logic,
    // because option clicks are intentionally short-circuited below.
    // ══════════════════════════════════════════════════════════════

    // ── Phase 2a: Consume mousedown pre-captured option (DOM detachment race guard) ──
    // If mousedown pre-captured an option while the DOM was live, validate and
    // consume it here. This handles frameworks that remove the dropdown from the
    // DOM synchronously during the click target/capture phase.
    if (this._pendingOptionSelection) {
      const pending = this._pendingOptionSelection;
      this._clearPendingOptionSelection(); // always consume, even if invalid

      const ageMs = Date.now() - pending.timestamp;
      const sessionValid = pending.hasOpenDropdown ? (this._openDropdown && pending.traceId === this._openDropdown.traceId) : true;

      // Spatial validation: click coordinates must be near the mousedown location.
      // Prevents ghost selections if the user pressed mousedown on an option but
      // dragged their mouse away and released elsewhere.
      const dx = Math.abs((e.clientX || 0) - (pending.mousedownClientX || 0));
      const dy = Math.abs((e.clientY || 0) - (pending.mousedownClientY || 0));
      const spatiallyValid = dx <= 30 && dy <= 30;
      const hasOpenDropdownNow = !!this._openDropdown;
      this.log("PENDING_OPTION_FOUND_ON_CLICK", {
        ageMs,
        sessionValid: !!sessionValid,
        spatiallyValid,
        dx,
        dy,
        hasOpenDropdownNow,
        pendingHasOpenDropdown: !!pending.hasOpenDropdown,
        pendingTraceId: pending.traceId || null,
        openDropdownTraceId: this._openDropdown?.traceId || null,
      });

      if (ageMs <= 500 && sessionValid && spatiallyValid) {
        this.log("PENDING_OPTION_CONSUMED", {
          label: pending.optionData?.label || null,
          value: pending.optionData?.value || null,
          traceId: pending.traceId || null,
          controlFamily: pending.controlFamily || null,
        });
        this.log("✅ Consuming mousedown pre-captured option as custom-select", {
          label: pending.optionData.label,
          ageMs,
          dx, dy,
        });
        this._handleCustomDropdownSelection(pending.optionData, e, pending.traceId, pending.controlFamily);
        return;
      } else {
        this.log("⚠️ Discarding stale/invalid pending option", {
          ageMs, sessionValid, spatiallyValid, dx, dy,
        });
        let reason = 'invalid_option_data';
        if (ageMs > 500) {
          reason = 'stale';
        } else if (!sessionValid) {
          reason = 'session_invalid';
        } else if (!spatiallyValid) {
          reason = 'spatial_invalid';
        } else if (pending.hasOpenDropdown && !hasOpenDropdownNow && this.activeInputSessions.size === 0) {
          reason = 'missing_open_or_input_context';
        }
        this.log("PENDING_OPTION_DISCARDED", {
          reason,
          ageMs,
          dx,
          dy,
        });
        // Fall through to normal click handling
      }
    }

    // ── Phase 2b: Direct option detection (for elements still in DOM) ──
    const optionData = this._detectCustomDropdownOption(clickTarget);
    if (optionData) {
      this._handleCustomDropdownSelection(optionData, e);
      // Option clicks don't navigate — skip the heavy quiescence/snapshot flow.
      return;
    }

    // ── Phase 1: Is this click opening a custom dropdown trigger? ──
    // We check AFTER letting the click propagate (the element's expanded state
    // flips asynchronously), so we defer the observation by one frame.
    const probableTrigger = this._resolveCustomDropdownTrigger(clickTarget);
    if (probableTrigger) {
      // Capture the trigger fingerprint NOW, before the DOM mutates
      const triggerFingerprint = this.generateFingerprint(probableTrigger);
      const handledAsCustomControl = await this._handlePotentialCustomControlTrigger(
        probableTrigger,
        triggerFingerprint,
        nestedContext,
      );
      if (handledAsCustomControl) {
        return;
      }
    }
    // ══════════════════════════════════════════════════════════════
    // END CUSTOM DROPDOWN INTERCEPT — continue with generic click flow
    // ══════════════════════════════════════════════════════════════

    // --- EXISTING DEDUPLICATION LOGIC ---
    const timestampKey = Math.floor(Date.now() / 1000);
    const eventKey = [
      clickTarget.tagName,
      clickTarget.id || "",
      clickTarget.getAttribute?.("data-testid") || "",
      timestampKey,
    ].join("|");

    if (this.recentEventKeys.has(eventKey)) {
      this.log("Skipping duplicate click");
      return;
    }

    this.recentEventKeys.add(eventKey);
    if (this.recentEventKeys.size > this.maxRecentKeys) {
      const keys = Array.from(this.recentEventKeys);
      this.recentEventKeys = new Set(keys.slice(-this.maxRecentKeys));
    }

    // --- EXISTING TARGET NORMALIZATION ---
    let target = clickTarget;
    const interactiveTags = ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"];
    while (
      target &&
      target !== document.body &&
      !interactiveTags.includes(target.tagName)
    ) {
      if (target.parentElement) target = target.parentElement;
      else break;
    }
    if (!interactiveTags.includes(target.tagName) || target === document.body) {
      target = clickTarget;
    }

    // --- NEW LOGIC STARTS HERE ---

    // 2. Generate ONE Shared Trace ID for both events
    const traceId = this._createActionTraceId();
    const submitForm = this._isSubmitLikeElement(target) && typeof target.closest === "function"
      ? target.closest("form")
      : null;
    if (submitForm) {
      this._rememberRecentSubmitClick(submitForm, traceId);
    }
    const syntheticHoverCandidate = this._findSyntheticHoverCandidate(target);
    if (syntheticHoverCandidate) {
      this._emitSyntheticHover(syntheticHoverCandidate, traceId);
    } else {
      this.log('SYNTHETIC_HOVER_SKIPPED', {
        reason: (this._hoverIntentBuffer && this._hoverIntentBuffer.length > 0)
          ? 'no_plausible_hover_relationship'
          : 'no_recent_hover_buffer',
        clickTag: target?.tagName?.toLowerCase?.() || null,
        traceId,
        sessionId: this.config.sessionId,
        tabId: this.config.tabId,
      });
    }

    const fingerprint = this.generateFingerprint(target);
    const seek = this.detectSeekStrategy(target);
    const startUrl = window.location.href;

    // 3. Capture Initial State (Snapshot A - "Where we are")
    let initialSnapshot = undefined;
    if (this.config.capturePageSnapshot) {
      try {
        initialSnapshot = target
          ? this._captureSubtreeSnapshot(target)
          : await this.capturePageSnapshot(
              this.config.snapshotDepth,
              true,
            );
      } catch (err) {
        this.log("Failed to capture initial snapshot", err);
      }
    }

    // 4. Send ACTION Event (Immediate User Intent)
    const actionNormalizedUrl = this.normalizeUrl(startUrl);
    const actionEvent = {
      id: actionEventId,
      type: EventType.CLICK,
      timestamp: Date.now(),
      traceId: traceId, // <--- SHARED ID
      pageUrl: startUrl,
      normalizedUrl: actionNormalizedUrl,
      pageTitle: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fingerprint,
      nestedContext,
      seek,
      sessionId: this.config.sessionId,
      schemaVersion: "air:v2",
      meta: {
        stateCapture: this.config.capturePageSnapshot,
        snapshotDepth: this.config.snapshotDepth,
        debugMode: this.config.debugEnabled,
      },
      pageSnapshot: initialSnapshot, // State A
      pageState: initialSnapshot, // Used by DB to identify "From Node"
    };

    this.queueEvent(actionEvent);
    this.flushQueue();

    // Check A: Is it a Submit Button?
    const isSubmit =
      clickTarget.type === "submit" || clickTarget.closest?.('button[type="submit"]');

    // Check B: Is it a Standard Link? (Ignore #anchors and javascript:)
    const anchor = clickTarget.closest?.("a");
    const isNewTabLink =
      anchor &&
      anchor.href &&
      !anchor.href.startsWith("javascript:") &&
      !anchor.href.includes("#") &&
      anchor.target === "_blank";
    const isLink =
      anchor &&
      anchor.href &&
      !anchor.href.startsWith("javascript:") &&
      !anchor.href.includes("#") &&
      anchor.target !== "_blank"; // New tabs don't change current URL

    // Critical: for target="_blank", the outcome snapshot belongs to the new tab.
    // Stash the trace+URL and let checkPendingOutcome() recover on destination tab.
    if (isNewTabLink) {
      const saved = this._stashCrossTabPendingTrace(traceId, anchor.href, startUrl);
      if (saved) {
        this.log("↗️ New-tab navigation detected; deferring outcome to destination tab", {
          traceId,
          targetUrl: anchor.href,
          saved,
        });
        this.pendingTraceId = null;
        return;
      }

      this.log("⚠️ New-tab trace handoff failed; falling back to source-tab outcome", {
        traceId,
        targetUrl: anchor.href,
      });
    }

    // Check C: Is it explicitly marked as a link?
    const isRoleLink = clickTarget.closest?.('[role="link"]');

    const isLikelyNavigation = isSubmit || isLink || isRoleLink;

    // FIX (Full-Page Nav Detection): Capture the return value of waitForUrlChange.
    // Previously this was discarded — `await this.waitForUrlChange(...)` with no assignment.
    // urlChanged=true  → SPA-style nav or fast redirect (URL flipped on same page)
    // urlChanged=false → full-page POST navigation (old page is about to unload)
    //                    OR AJAX form (page stays alive, JS handles the response)
    // We need to distinguish these two false cases — see isFullPageNav branch below.
    let urlChanged = false;
    if (isLikelyNavigation) {
      this.log("⏳ Potential Navigation detected. Waiting for URL change...");
      urlChanged = await this.waitForUrlChange(startUrl, 3000);
      this.log(urlChanged ? "✅ URL changed on same page (SPA/redirect)" : "⏳ URL did not change — full-page nav or AJAX form");
    }

    // Hoist isFullPageNav above the try block so the finally clause can read it.
    // const/let inside try{} are block-scoped and invisible to finally{}.
    const isFullPageNav = isLikelyNavigation && !urlChanged;

    // 5. WAIT for Quiescence (Network/DOM Settle)
    try {
      let settleResult = { stable: true, reason: "immediate", waitedMs: 0 };
      let captureWaitResult = null;
      const settleTimeout = isLikelyNavigation
        ? this.config.snapshotContentReadyTimeoutMs
        : 2000;
      if (isLikelyNavigation) {
        captureWaitResult = await this._waitForSettleAndReady(
          "click-outcome",
          this.config.snapshotContentReadyTimeoutMs,
        );
        settleResult = captureWaitResult?.settleResult || settleResult;
      } else if (this.quiescence) {
        settleResult = await this.quiescence.waitForSettle(settleTimeout);
      }

      // 6. Capture Final State (Snapshot B - "Where we ended up")
      let finalSnapshot = undefined;
      if (this.config.capturePageSnapshot) {
        try {
          finalSnapshot = target && !isLikelyNavigation
            ? this._captureSubtreeSnapshot(target)
            : await this.capturePageSnapshot(
                this.config.snapshotDepth,
                false,
                { precomputedWaitResult: captureWaitResult },
              );
        } catch (err) {
          this.log("Failed to capture final snapshot", err);
        }
      }
      let icSnapshot = null;
      try {
        icSnapshot = await this._captureFullPageForIC({
          precomputedWaitResult: captureWaitResult,
        });
      } catch (_) {}

    // 7. Build OUTCOME Event (The Result)
    const controlSignature = this.computeControlSignature(document);
    const primaryHeading   = this.getPrimaryHeading(document);
    const outcomePageUrl = window.location.href;
    const outcomeNormalizedUrl = this.normalizeUrl(outcomePageUrl);
    const normalizedIcSnapshot = this._normalizeSnapshotForTransport(
      icSnapshot,
      200000
    );
    const captureMeta = this._buildOutcomeCaptureMeta(finalSnapshot, icSnapshot);
    const outcomeEvent = {
      id: this.generateUUID(),
      type: "outcome",
      traceId: traceId,
      timestamp: Date.now(),
      sessionId: this.config.sessionId,
      pageUrl: outcomePageUrl,
      normalizedUrl: outcomeNormalizedUrl,
      meta: {
        settleType: settleResult,
        urlAfter: outcomePageUrl,
        titleAfter: document.title,
        controlSignature,
        primaryHeading,
        forcedCapture: captureMeta.forcedCapture,
        busyAtCapture: captureMeta.busyAtCapture,
        busyReasons: captureMeta.busyReasons,
      },
      interactionContext: normalizedIcSnapshot, // full-page context for D3.5 validation
      pageSnapshot: finalSnapshot, // State B
      pageState: finalSnapshot,    // Used by DB to identify "To Node"
    };


    if (isFullPageNav) {
    this.log("🚀 Full-page nav suspected — deferring outcome to next page via checkPendingOutcome()");

    // Track whether pagehide fires (case A) vs. quiescence re-settles (case B).
    // pageUnloaded prevents a double-send if both signals somehow race.
    let pageUnloaded = false;

    window.addEventListener("pagehide", () => {
      pageUnloaded = true;
      // Page is confirmed navigating away. pendingTraceId is still set.
      // beforeunload has already (or is about to) save it to sessionStorage.
      this.log("📦 pagehide confirmed — pendingTraceId preserved for next page");
    }, { once: true, capture: true });

    // AJAX fallback: QuiescenceEngine re-monitors DOM+network.
    // When the AJAX response renders, quiescence will settle naturally —
    // no fixed timer, driven entirely by network activity and DOM mutations.
    if (this.quiescence) {
      this.quiescence.waitForSettle(8000).then(() => {
        if (!pageUnloaded && this.pendingTraceId === traceId) {
          this.log("↩️ Quiescence settled without pagehide — AJAX form confirmed, sending outcome now");
          this.queueEvent(outcomeEvent);
          this.flushQueue();
          this.pendingTraceId = null;
        }
        
        // If pageUnloaded=true, beforeunload already handled it — do nothing.
      }).catch(() => {
        if (!pageUnloaded && this.pendingTraceId === traceId) {
          this.log("⚠️ Quiescence timed out — sending outcome as last resort");
          this.queueEvent(outcomeEvent);
          this.flushQueue();
          this.pendingTraceId = null;
        }
      });
    } else {
      // FAILSAFE: QuiescenceEngine is null (strict CSP, iframe boundary, init failure).
      // Cannot use the event-driven path. Fall back to setTimeout as last resort.
      // This is the ONLY acceptable timer in this file — only reachable when
      // QuiescenceEngine itself failed to initialise, which is abnormal.
      setTimeout(() => {
        if (!pageUnloaded && this.pendingTraceId === traceId) {
          this.log("⚠️ Quiescence unavailable — setTimeout fallback sending outcome");
          this.queueEvent(outcomeEvent);
          this.flushQueue();
          this.pendingTraceId = null;
        }
      }, 8000);
    }

    } else {
      // Normal case: SPA nav (urlChanged=true) or non-navigation click.
      // Outcome URL is correct. Send immediately.
      this.queueEvent(outcomeEvent);
    }

    } catch (err) {
      this.log("Error in click flow", err);
    } finally {
      // Only null pendingTraceId here for the normal (non-full-page-nav) path.
      // For isFullPageNav, the pagehide listener or quiescence callback owns the cleanup.
      if (this.pendingTraceId === traceId && !isFullPageNav) {
        this.pendingTraceId = null;
      }
    }
  }
  // 🌟 ADD THIS METHOD TO YOUR CLASS
  waitForUrlChange(oldUrl, timeout = 5000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        // If URL has changed, we are done!
        if (window.location.href !== oldUrl) return resolve(true);
        // If timeout reached, stop waiting
        if (Date.now() - start > timeout) return resolve(false);
        requestAnimationFrame(check);
      };
      check();
    });
  }

  // ============================================================
  // Item 1.1 — SPA route change (pushState / popstate + DOM diff)
  // Item 1.2 — Hash navigation (hashchange)
  //
  // WHY THIS MATTERS: Single-page apps mutate the URL via history.pushState /
  // replaceState and the browser's popstate event — none of which fire a real
  // page load, so every SPA navigation was previously invisible to AIR.
  // Result: the entire app appeared as ONE giant node in the graph.
  //
  // APPROACH:
  //  1. Wrap history.pushState + history.replaceState to intercept programmatic nav.
  //  2. Listen to popstate (back/forward) and hashchange (hash-only nav).
  //  3. On each change, wait for DOM to settle then diff the anchor fingerprints
  //     to produce a lightweight "what changed" payload for the Graph Builder.
  // ============================================================
  _monitorSPARoutes() {
    if (this._spaRoutesPatched) return;
    this._spaRoutesPatched = true;

    let lastUrl     = window.location.href;
    let lastAnchors = this.scanPageAnchors();
    const self      = this;

    const onRouteChange = async (changeType) => {
      const newUrl = window.location.href;

      // For non-hash changes, skip if the URL is identical (replaceState called
      // with same URL, or a popstate that didn't actually move).
      if (newUrl === lastUrl && changeType !== 'hashchange') return;

      // Wait for SPA route content (network + DOM + readiness checks)
      await self.waitForSPAContent(self.config.snapshotContentReadyTimeoutMs);

      const newAnchors     = self.scanPageAnchors();
      const addedAnchors   = newAnchors.filter(a => !lastAnchors.includes(a));
      const removedAnchors = lastAnchors.filter(a => !newAnchors.includes(a));
      const domChanged     = addedAnchors.length > 0 || removedAnchors.length > 0;
      const controlSignature = self.computeControlSignature(document);
      const primaryHeading   = self.getPrimaryHeading(document);

      self.log(`🗺️ SPA route change [${changeType}]`, { from: lastUrl, to: newUrl, domChanged });

      const snapshot = self.config.capturePageSnapshot
        ? await self.capturePageSnapshot(self.config.snapshotDepth, false).catch(() => null)
        : null;

      const normalizedUrl = self.normalizeUrl(newUrl);
      self.queueEvent({
        id:            self.generateUUID(),
        type:          'spa-route-change',
        changeType,                        // pushState | replaceState | popstate | hashchange
        timestamp:     Date.now(),
        pageUrl:       newUrl,
        normalizedUrl,
        pageTitle:     document.title,
        sessionId:     self.config.sessionId,
        schemaVersion: 'air:v2',
        traceId: self._getRecentActionTrace() || ('baseline-' + self.generateUUID()),
        navigation: {
          from:    lastUrl,
          to:      newUrl,
          domDiff: {
            added: addedAnchors,
            removed: removedAnchors,
            changed: domChanged,
            controlSignature,
            primaryHeading,
          },
        },
        pageSnapshot: snapshot,
        pageState:    snapshot,
      });

      // Update baseline for the NEXT change
      lastUrl     = newUrl;
      lastAnchors = newAnchors;
    };

    // ── Intercept programmatic navigation ──────────────────────────────────
    const origPushState    = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      origPushState(...args);
      onRouteChange('pushState');
    };

    history.replaceState = (...args) => {
      origReplaceState(...args);
      onRouteChange('replaceState');
    };

    // ── Browser back / forward ─────────────────────────────────────────────
    window.addEventListener('popstate',   () => onRouteChange('popstate'),   { capture: true });

    // ── Item 1.2: Hash-only navigation ────────────────────────────────────
    // hashchange fires for #anchor links, hash-router SPAs (Vue Router hash
    // mode, React HashRouter). Very common in older SPAs.
    window.addEventListener('hashchange', () => onRouteChange('hashchange'), { capture: true });

    this.log('📡 SPA route monitoring active (pushState/popstate/hashchange)');
  }

  // ─── handleScroll ──────────────────────────────────────────

  /**
   * handleScroll — redesigned for "micro-scroll" (seek) capture.
   *
   * ROOT CAUSE OF 80% LOSS (old implementation):
   *   1. Always read `window.scrollY` — completely missed scrollable containers
   *      (overflow:auto/scroll divs). Any scroll inside a modal, sidebar, or
   *      data-table fired its event on the container element, but the handler
   *      discarded that and read the top-level window position instead, which
   *      was often 0 or unchanged → distance check failed → event dropped.
   *   2. Single global `isScrolling` flag meant concurrent scrolls (e.g. user
   *      scrolls a list while the page also loads/animates) would collide.
   *   3. `lastScrollY` was only reset at scroll-start, so a series of small
   *      scrolls within one gesture could accumulate, but a new gesture that
   *      scrolled BACK a small amount (< 30 px net) was silently dropped even
   *      though the user made a clear intentional movement.
   *
   * FIX STRATEGY:
   *   - Per-target state via WeakMap so window + N scrollable containers are
   *     all tracked independently with no cross-contamination.
   *   - Read `scrollTop / scrollLeft` from `e.target` directly; fall back to
   *     `window.scrollY` only when target is `document` or `window`.
   *   - Threshold: 30 px (captures "peek" scrolls to reveal off-screen elements).
   *   - Debounce: 250 ms per target (fast enough to not miss intent).
   */
  handleScroll(e) {
    if (this.disabled) return;
    // Resolve the scrolling element and its current position
    const scrollTarget = (e.target === document || e.target === window)
      ? window
      : e.target;

    const currentX = scrollTarget === window ? window.scrollX : scrollTarget.scrollLeft;
    const currentY = scrollTarget === window ? window.scrollY : scrollTarget.scrollTop;

    // Initialise per-target state if first scroll on this element
    if (!this.scrollStates.has(scrollTarget)) {
      this.scrollStates.set(scrollTarget, {
        isScrolling:      false,
        startX:           currentX,
        startY:           currentY,
        startTimestamp:   Date.now(),
        debounceTimer:    null,
      });
    }

    const state = this.scrollStates.get(scrollTarget);

    if (!state.isScrolling) {
      // Beginning of a new scroll gesture — snapshot the start position
      state.isScrolling    = true;
      state.startX         = currentX;
      state.startY         = currentY;
      state.startTimestamp = Date.now();
    }

    // Reset debounce on every scroll tick
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      const deltaX   = Math.abs(currentX - state.startX);
      const deltaY   = Math.abs(currentY - state.startY);
      const distance = Math.max(deltaX, deltaY);  // dominant axis
      const duration = Date.now() - state.startTimestamp;

      state.isScrolling = false;

      // ─── THRESHOLD: 30 px captures "element-seeking" micro-scrolls ───
      if (distance >= 30) {
        // Determine direction intent
        const direction = deltaY >= deltaX
          ? (currentY > state.startY ? "down" : "up")
          : (currentX > state.startX ? "right" : "left");

        // Build a fingerprint for the scroll container (not window)
        const containerInfo = scrollTarget === window
          ? { tag: "window", selector: "window" }
          : {
              tag: scrollTarget.tagName?.toLowerCase() || "unknown",
              selector: scrollTarget.id
                ? `#${safeCssEscape(scrollTarget.id)}`
                : (scrollTarget.getAttribute("data-testid")
                    ? `[data-testid="${escapeCssString(scrollTarget.getAttribute("data-testid"))}"]`
                    : scrollTarget.className?.split(" ")[0] 
                        ? `.${safeCssEscape(scrollTarget.className.split(" ")[0])}`
                        : "unknown"),
            };

        const pageUrl = window.location.href;
        const normalizedUrl = this.normalizeUrl(pageUrl);
        this.queueEvent({
          id:        this.generateUUID(),
          type:      "scroll",
          timestamp: Date.now(),
          pageUrl,
          normalizedUrl,
          viewport:  { width: window.innerWidth, height: window.innerHeight },
          scroll: {
            x:           currentX,
            y:           currentY,
            deltaX,
            deltaY,
            distance,
            direction,
            container:   containerInfo,
            isContainer: scrollTarget !== window,
          },
          seek: {
            method:   "scroll",
            metadata: { duration, distance, direction },
          },
          sessionId:     this.config.sessionId,
          schemaVersion: "air:v2",
        });

        this.log("📜 Scroll captured", { distance, direction, duration, container: containerInfo.selector });
      } else {
        this.log("⏭️ Scroll below threshold — skipped", { distance });
      }

      // Reset start position so the NEXT gesture measures from where we stopped
      state.startX = currentX;
      state.startY = currentY;
    }, 250); // 250 ms debounce — balances noise reduction vs. micro-scroll detection
  }

  handleSubmit(e) {
    if (this.disabled) return;

    const eventId = this.generateUUID();
    const resolvedTargetInfo = this._resolveNestedContext(e, this._getComposedEventTarget(e), eventId);
    const target = resolvedTargetInfo.target;
    const nestedContext = resolvedTargetInfo.nestedContext;
    const formTarget = target && typeof target.closest === "function"
      ? (target.closest("form") || target)
      : target;
    const captureTarget = formTarget && formTarget.tagName ? formTarget : null;
    const fingerprint = this.generateFingerprint(captureTarget);
    const reusedTraceId = captureTarget && captureTarget.tagName === "FORM"
      ? this._consumeRecentSubmitTrace(captureTarget)
      : null;
    const traceId = reusedTraceId || this._createActionTraceId();
    if (reusedTraceId) {
      this._markActionTrace(traceId);
    }

    const pageUrl = window.location.href;
    const normalizedUrl = this.normalizeUrl(pageUrl);
    const baseEvent = {
      id: eventId,
      type: "submit",
      timestamp: Date.now(),
      traceId: traceId,
      pageUrl,
      normalizedUrl,
      pageTitle: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fingerprint,
      nestedContext,
      sessionId: this.config.sessionId,
      schemaVersion: "air:v2",
      meta: { eventType: "formSubmit", formId: captureTarget && captureTarget.id ? captureTarget.id : undefined },
      interactionContext: undefined,
    };
    if (!this.config.capturePageSnapshot) {
      this.queueEvent({ ...baseEvent });
      return;
    }
    const subtreeSnapshot = captureTarget
      ? this._captureSubtreeSnapshot(captureTarget)
      : null;

    if (subtreeSnapshot) {
      this.queueEvent({
        ...baseEvent,
        pageSnapshot: subtreeSnapshot,
        pageState: subtreeSnapshot,
      });
      return;
    }

    this.capturePageSnapshot(this.config.snapshotDepth, true)
      .then((pageSnapshot) => {
        const snapshot = pageSnapshot || undefined;
        this.queueEvent({
          ...baseEvent,
          pageSnapshot: snapshot,
          pageState: snapshot, // UI state for state-based node identity
        });
      })
      .catch(() => {
        this.queueEvent({ ...baseEvent });
      });
  }

  // ============================================================
  // FINGERPRINT GENERATION (4-Layer)
  // ============================================================

  generateFingerprint(element) {
    if (!element) return null;

    // Debug logging
    if (this.config.debugMode) {
      console.group("[AIR Fingerprint Generation]");
      console.log("Element:", element.tagName, element.id || "no-id");
    }

    const selectorResult = this.generateOptimalSelector(element);
    const textExcerpt = this.extractText(element);
    const context = this.extractContext(element);
    const attributes = this.extractAttributes(element);
    const attributesHash = this.hashAttributes(attributes);

    if (this.config.debugMode) {
      console.log("Selector generated:", selectorResult.selector);
      console.log("Priority:", selectorResult.priority);
      console.log("Text excerpt:", textExcerpt);
      console.log("Context:", context);
      console.log("Attributes:", attributes);
      console.log("Attributes hash:", attributesHash);
      console.groupEnd();
    }

    return {
      selector: selectorResult.selector,
      selectorPriority: selectorResult.priority,
      selectorRank: selectorResult.rank,
      tagName: element.tagName.toLowerCase(),
      parentSelector: context.parentSelector,
      textExcerpt,
      context,
      attributes,
      attributesHash,
    };
  }

  generateOptimalSelector(element) {
    const tagName = element.tagName.toLowerCase();

    // Priority 1: data-testid (most stable)
    if (element.hasAttribute("data-testid")) {
      const testId = element.getAttribute("data-testid");
      return {
        selector: `[data-testid="${escapeCssString(testId)}"]`,
        priority: "data-testid",
        rank: rankForPriority("data-testid"),
      };
    }

    // Priority 2: id — only if it is semantically stable.
    // Hardened multi-pattern check (Item 2.1 — Dynamic ID Resilience):
    //   • starts with digit               → dynamic (HTML4 invalid but common in generated UIs)
    //   • react- prefix                   → React internal
    //   • UUID pattern (8-4-4-4-12)       → generated at runtime
    //   • React 18 :r0: / :ra: pattern    → concurrent-mode fiber IDs
    //   • 5+ consecutive digits anywhere  → likely an auto-increment PK or timestamp
    //   • Emotion / styled-components hash → css-XXXXXXXX / sc-XXXXXXXX
    if (element.id) {
      const id         = element.id;
      const isDynamic  = (
        /^\d/.test(id)                          ||   // starts with digit
        /^react-/i.test(id)                     ||   // React internal
        /[0-9a-f]{8}-[0-9a-f]{4}/i.test(id)    ||   // UUID segment
        /^:[a-z0-9]+:$/i.test(id)               ||   // React 18 :r0:
        /\d{5,}/.test(id)                       ||   // long numeric run
        /^(?:css|sc)-[a-zA-Z0-9]+$/.test(id)        // CSS-in-JS hash
      );
      if (!isDynamic) {
        return {
          selector: `#${safeCssEscape(id)}`,
          priority: "id",
          rank: rankForPriority("id"),
        };
      }
    }

    // Priority 3: name attribute
    if (element.name) {
      return {
        selector: `${tagName}[name="${escapeCssString(element.name)}"]`,
        priority: "attribute",
        rank: rankForPriority("attribute"),
      };
    }

    // Priority 4: aria-label (very stable for buttons/links)
    if (element.getAttribute("aria-label")) {
      return {
        selector: `${tagName}[aria-label="${escapeCssString(element.getAttribute("aria-label"))}"]`,
        priority: "attribute",
        rank: rankForPriority("attribute"),
      };
    }

    // Priority 5: role attribute
    if (element.getAttribute("role")) {
      return {
        selector: `[role="${escapeCssString(element.getAttribute("role"))}"]`,
        priority: "attribute",
        rank: rankForPriority("attribute"),
      };
    }

    // Priority 6: type attribute (for inputs/buttons)
    if (element.type && ["submit", "button", "reset", "checkbox", "radio"].includes(element.type)) {
      return {
        selector: `${tagName}[type="${escapeCssString(element.type)}"]`,
        priority: "attribute",
        rank: rankForPriority("attribute"),
      };
    }

    // Priority 7: Stable class
    const stableClass = this.findStableClass(element);
    if (stableClass) {
      return {
        selector: `.${safeCssEscape(stableClass)}`,
        priority: "class",
        rank: rankForPriority("class"),
      };
    }

    // Priority 8: Compound selector (tag + text for buttons/links)
    if (["button", "a", "submit"].includes(tagName)) {
      const text = this.extractText(element);
      if (text && text.length > 0 && text.length < 50) {
        return {
          selector:`text=${text}`,
          priority: "text",
          rank: rankForPriority("text"),
        };
      }
    }

    // Priority 8.5: Multi-attribute compound selector (Item 2.1 hardening)
    // When no single stable attribute exists, combine 2+ attributes to create
    // a highly specific but still resilient selector. This covers the common
    // case where generated IDs are unstable but name+type+placeholder are stable.
    {
      const parts = [];
      if (element.name) parts.push(`[name="${escapeCssString(element.name)}"]`);
      if (element.getAttribute("aria-label")) parts.push(`[aria-label="${escapeCssString(element.getAttribute("aria-label"))}"]`);
      if (element.type && !["text", "button"].includes(element.type)) parts.push(`[type="${escapeCssString(element.type)}"]`);
      if (element.placeholder) parts.push(`[placeholder="${escapeCssString(element.placeholder)}"]`);

      if (parts.length >= 2) {
        return {
          selector: `${tagName}${parts.join("")}`,
          priority: "attribute",
          rank: rankForPriority("attribute"),
        };
      }
    }

    // Priority 9: Parent context + nth-child (better than full path)
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === element.tagName,
      );
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

    // Priority 10: XPath (last resort)
    return {
      selector: this.generateXPath(element),
      priority: "xpath",
      rank: rankForPriority("xpath"),
    };
  }

  findStableClass(element) {
    if (!element.classList || element.classList.length === 0) return null;

    const classes = Array.from(element.classList);

    // 1. Filter out known utility/generic classes that cause Playwright collisions
    const BANNED_PATTERNS = [
      /\d{4,}/,                   // Long numbers
      /^css-/, /^sc-/,            // CSS-in-JS hashes (Emotion, Styled Components)
      /^oxd-input$/,              // OrangeHRM generic inputs
      /^oxd-select-text-input$/,  // OrangeHRM generic selects
      /^el-input__inner$/,        // Element UI generics
      /^ant-input$/,              // Ant Design generics
      /^MuiInputBase-input$/      // Material UI generics
    ];

    const stableClasses = classes.filter(cls => !BANNED_PATTERNS.some(regex => regex.test(cls)));

    // 2. If all classes were banned, return null. This forces generateOptimalSelector 
    // to safely drop to Priority 8.5 (Multi-attribute) or Priority 9 (Path).
    if (stableClasses.length === 0) return null;

    // 3. Prioritize semantically meaningful classes (e.g., 'username-field' over 'mt-4')
    const utilityPrefixes = ['mt-', 'mb-', 'pt-', 'pb-', 'flex', 'text-', 'bg-'];
    stableClasses.sort((a, b) => {
      const aIsUtility = utilityPrefixes.some(p => a.startsWith(p));
      const bIsUtility = utilityPrefixes.some(p => b.startsWith(p));
      if (aIsUtility && !bIsUtility) return 1;
      if (!aIsUtility && bIsUtility) return -1;
      return 0;
    });

    return stableClasses[0];
  }

  generateXPath(element) {
    if (element.id) return `id("${element.id}")`;
    if (element === document.body) return "/html/body";

    let path = "";
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling = current.previousSibling;

      while (sibling) {
        if (
          sibling.nodeType === Node.ELEMENT_NODE &&
          sibling.nodeName === current.nodeName
        ) {
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

  extractText(element) {
    // Use textContent instead of innerText for consistency.
    const rawText = element.textContent || element.innerText || "";
    const normalizedText = rawText.trim().replace(/\s+/g, " ");
    if (normalizedText) {
      return normalizedText.substring(0, this.config.maxTextLength);
    }

    // Icon-only controls often carry the visible intent via aria-label/title/alt.
    const fallbackLabel = (
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("alt") ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ");

    return fallbackLabel
      ? fallbackLabel.substring(0, this.config.maxTextLength)
      : null;
  }

  extractContext(element) {
    const parentTag = element.parentElement?.tagName?.toLowerCase() || null;

    let parentSelector = null;
    const parent = element.parentElement;
    if (parent) {
      if (parent.id && !/^\d/.test(parent.id) && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(parent.id)) {
        parentSelector = `#${safeCssEscape(parent.id)}`;
      }else if (parent.getAttribute("data-testid")) {
        parentSelector = `[data-testid="${escapeCssString(parent.getAttribute("data-testid"))}"]`;
      } else {
        parentSelector = parent.tagName.toLowerCase();
      }
    }

    const containers = ["form", "nav", "section", "article", "main"];
    let current = element.parentElement;
    let nearestContainerTag = null;

    while (current && !nearestContainerTag) {
      if (containers.includes(current.tagName.toLowerCase())) {
        nearestContainerTag = current.tagName.toLowerCase();
        break;
      }
      current = current.parentElement;
    }

    return { parentTag, parentSelector, nearestContainerTag: nearestContainerTag || "div" };
  }

  extractAttributes(element) {
    const dataTestId = element.getAttribute("data-testid") || null;
    const dataCy = element.getAttribute("data-cy") || null;
    const dataQa = element.getAttribute("data-qa") || null;
    const ariaLabel = element.getAttribute("aria-label") || null;
    const classTokens = [];
    const rawClassTokens =
      typeof element.className === "string"
        ? element.className.split(/\s+/)
        : Array.isArray(element.classList)
          ? element.classList
          : Array.from(element.classList || []);
    let totalClassChars = 0;
    for (const token of rawClassTokens) {
      if (typeof token !== "string") continue;
      const normalized = token.trim();
      if (!normalized || classTokens.includes(normalized)) continue;
      const bounded = normalized.slice(0, 40);
      const nextLength = totalClassChars + bounded.length + (classTokens.length > 0 ? 1 : 0);
      if (classTokens.length >= 8 || nextLength > 160) break;
      classTokens.push(bounded);
      totalClassChars = nextLength;
    }
    const boundedClassName = classTokens.length > 0 ? classTokens.join(" ") : null;
    const attrs = {
      dataTestId,
      "data-testid": dataTestId,
      dataCy,
      "data-cy": dataCy,
      dataQa,
      "data-qa": dataQa,
      id: element.id || null,
      name: element.name || null,
      role: element.getAttribute("role") || null,
      ariaLabel,
      "aria-label": ariaLabel,
      type: element.type || null,
      placeholder: element.placeholder || null,
      value: element.value || null,
      href: element.href || null,
      title: element.title || null,
      alt: element.alt || null,
      class: boundedClassName,
      classList: boundedClassName,
    };

    // Filter out null/empty values and sort keys for consistency
    const filtered = Object.fromEntries(
      Object.entries(attrs).filter(([_, v]) => v !== null && v !== ""),
    );

    // Sort keys for deterministic output
    const sorted = {};
    Object.keys(filtered)
      .sort()
      .forEach((key) => {
        sorted[key] = filtered[key];
      });

    return sorted;
  }

  hashAttributes(attrs) {
    const str = JSON.stringify(attrs, Object.keys(attrs).sort());
    return this.simpleHash(str);
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  // ============================================================
  // SEEK STRATEGY DETECTION
  // ============================================================

  detectSeekStrategy(element) {
    const rect = element.getBoundingClientRect();
    const isVisible = rect.top >= 0 && rect.top <= window.innerHeight;

    if (!isVisible) {
      return {
        method: "scroll",
        metadata: {
          scrollY: window.scrollY,
          elementOffsetTop: element.offsetTop,
        },
      };
    }

    return { method: "direct", metadata: {} };
  }

  // ============================================================
  // PII DETECTION
  // ============================================================

  isSensitiveField(element) {
    const sensitiveAttrs = [
      "password",
      "token",
      "cvv",
      "ssn",
      "credit",
      "card",
      "secret",
    ];
    const name = (element.name || "").toLowerCase();
    const type = (element.type || "").toLowerCase();
    const placeholder = (element.placeholder || "").toLowerCase();
    return sensitiveAttrs.some(
      (attr) =>
        name.includes(attr) ||
        type.includes(attr) ||
        placeholder.includes(attr),
    );
  }

  containsPII(value) {
    return this.piiPatterns.some((pattern) => pattern.test(value));
  }

  // ============================================================
  // EVENT BATCHING & SENDING
  // ============================================================

  queueEvent(event) {
    if (this.disabled) return;
    const queuedEvent = this._isPlainObject(event) ? { ...event } : event;
    if (
      this._isPlainObject(queuedEvent) &&
      (queuedEvent.tabId === undefined || queuedEvent.tabId === null) &&
      typeof this.config?.tabId === "string" &&
      this.config.tabId
    ) {
      queuedEvent.tabId = this.config.tabId;
    }
    this.eventQueue.push(queuedEvent);

    if (["click", "input", "submit"].includes(queuedEvent.type)) {
      const snapshotText = typeof queuedEvent.pageSnapshot === "string"
        ? queuedEvent.pageSnapshot
        : (queuedEvent.pageSnapshot ? JSON.stringify(queuedEvent.pageSnapshot) : "");
      console.log("[AIR_SNAPSHOT_SIZE]", {
        type: queuedEvent.type,
        id: queuedEvent.id,
        tabId: queuedEvent.tabId || null,
        snapshotChars: snapshotText.length,
      });
    }

    const debugInfo = {
      type: queuedEvent.type,
      queueLength: this.eventQueue.length,
      hasSnapshot: !!queuedEvent.pageSnapshot,
      traceId: queuedEvent.traceId,
      tabId: queuedEvent.tabId || null,
    };

    this.log("📋 Event queued", debugInfo);

    if (this.eventQueue.length >= this.config.batchSize) {
      this.flushQueue();
    }
  }

  startBatchProcessor() {
    if (this.disabled) return;
    this.batchTimer = setInterval(() => {
      if (this.eventQueue.length > 0) {
        this.flushQueue();
      }
    }, this.config.batchInterval);
  }

  async flushQueue(options = {}) {
    if (this.disabled) return;
    // Concurrency guard:
    // Prevents timer, batch-size trigger, and fast-forward retries from racing the same head event.
    if (this._isFlushing) return;
    if (this.eventQueue.length === 0) return;

    this._isFlushing = true;

    try {
      const currentEvent = this.eventQueue[0];
      const maxTransportBytes = 60_000;
      const traceLabel =
        currentEvent.traceId && typeof currentEvent.traceId === "string"
          ? `trace:${currentEvent.traceId.slice(0, 8)}`
          : "trace:none";

      // Navigation-resilience path: fire-and-forget for pre-navigation outcome events.
      const isNavigation =
        options.navigation === true ||
        (currentEvent.type === "outcome" &&
          currentEvent.meta?.settleType === "navigation" &&
          !currentEvent.meta?.isRecovery);

      const preparedTransport = this._prepareEventForTransport(currentEvent, {
        maxPayloadBytes: maxTransportBytes,
        transportKind: isNavigation ? "navigation" : "flush",
      });
      let payload = preparedTransport.payload;

      if (isNavigation) {
        this.log("NAV_BEACON_REDUCED", {
          ...preparedTransport.eventContext,
          originalBytes: preparedTransport.originalPayloadBytes,
          finalBytes: preparedTransport.payloadBytes,
          reducedFields: preparedTransport.reducedFields,
          wasReduced:
            preparedTransport.reducedFields.length > 0 ||
            preparedTransport.originalPayloadBytes !== preparedTransport.payloadBytes,
        });

        if (preparedTransport.payloadBytes > maxTransportBytes) {
          this.log("NAV_BEACON_PAYLOAD_TOO_LARGE", {
            ...preparedTransport.eventContext,
            originalBytes: preparedTransport.originalPayloadBytes,
            finalBytes: preparedTransport.payloadBytes,
            reducedFields: preparedTransport.reducedFields,
          });
        } else {
          // Priority 1: GM beacon (extension context, ad-blocker immune)
          if (typeof window.__air_gmBeacon === "function") {
            const accepted = window.__air_gmBeacon(this.apiEndpoint, payload);
            if (accepted) {
              this._rememberSentEventId(currentEvent.id);
              this._retryState.delete(currentEvent.id);
              this.eventQueue.shift();
              this.log(`[NAV] Dispatched via GM beacon (${traceLabel})`);
              if (this.eventQueue.length > 0) setTimeout(() => this.flushQueue(), 10);
              return;
            }
            this.log(`[NAV] GM beacon rejected event; falling back to sendBeacon (${traceLabel})`);
          } else {
            this.log(`[NAV] GM beacon unavailable; trying native sendBeacon (${traceLabel})`);
          }

          // Priority 2: native sendBeacon (fallback)
          const blob = new Blob([payload], { type: "application/json" });
          const beaconBytes = this._getPayloadBytes(payload);
          if (beaconBytes <= maxTransportBytes) {
            const sent = navigator.sendBeacon(this.apiEndpoint, blob);
            if (sent) {
              this._rememberSentEventId(currentEvent.id);
              this._retryState.delete(currentEvent.id);
              this.eventQueue.shift();
              this.log(`[NAV] Dispatched via sendBeacon (${traceLabel})`);
              if (this.eventQueue.length > 0) setTimeout(() => this.flushQueue(), 10);
              return;
            }
            this.log("NAV_BEACON_REJECTED_FALLBACK_FETCH", {
              ...preparedTransport.eventContext,
              originalBytes: preparedTransport.originalPayloadBytes,
              finalBytes: beaconBytes,
              reducedFields: preparedTransport.reducedFields,
            });
          } else {
            this.log("NAV_BEACON_PAYLOAD_TOO_LARGE", {
              ...preparedTransport.eventContext,
              originalBytes: preparedTransport.originalPayloadBytes,
              finalBytes: beaconBytes,
              reducedFields: preparedTransport.reducedFields,
            });
          }
        }
      }

      this.log(
        `[FLUSH] Sending ${currentEvent.type} via ${this._gmSend ? "GM transport" : "fetch"} (${new Blob([payload]).size} bytes) - ${traceLabel}`,
        { tabId: currentEvent.tabId || null },
      );
      console.log('[AIR_SEND]', {
        type: currentEvent.type,
        id: currentEvent.id,
        tabId: currentEvent.tabId || null,
        size: payload.length,
      });

      // Send via GM transport (no CORS) or native raw fetch.
      let response;
      try {
        const keepaliveSafe =
          !currentEvent.meta?.isRecovery &&
          this._getPayloadBytes(payload) <= maxTransportBytes;
        if (this._gmSend) {
          response = await this._gmSend(this.apiEndpoint, payload);
        } else {
          response = await this._rawFetch(this.apiEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            mode: "cors",
            keepalive: keepaliveSafe,
            [_AIR_INTERNAL]: true,
          });
        }
      } catch (networkErr) {
        this.log(`[FLUSH] Transport failure (${traceLabel}) - scheduling retry`, {
          type: currentEvent.type,
          id: currentEvent.id,
          error: networkErr?.message || String(networkErr),
        });
        this.eventQueue.shift(); // 🔥 VERY IMPORTANT
        this._scheduleRetry(currentEvent, networkErr, "network");
        return;
      }

      // HTTP-level error handling.
      if (!response.ok) {
        let rejectionReason = response.statusText || "";
        if (!rejectionReason && typeof response.text === "function") {
          try {
            const responseText = await response.clone().text(); 
            if (responseText) rejectionReason = responseText.slice(0, 240);
          } catch (_) {}
        } else if (!rejectionReason && response.body !== undefined) {
          try {
            const bodyText = typeof response.body === "string"
              ? response.body
              : JSON.stringify(response.body);
            if (bodyText) rejectionReason = bodyText.slice(0, 240);
          } catch (_) {}
        }
        if (!rejectionReason) rejectionReason = "No response body";

        if (response.status >= 500) {
          this.log(
            `[FLUSH] Server rejected ${currentEvent.type} (HTTP ${response.status}) - ${rejectionReason}. Retrying (${traceLabel})`,
            { type: currentEvent.type, id: currentEvent.id, status: response.status },
          );
          this._scheduleRetry(
            currentEvent,
            new Error(`HTTP ${response.status}: ${rejectionReason}`),
            "server",
          );
        } else {
          this.log(
            `[FLUSH] Event dropped (HTTP ${response.status} - permanent rejection: ${rejectionReason}) (${traceLabel})`,
            { type: currentEvent.type, id: currentEvent.id, status: response.status },
          );
          this._retryState.delete(currentEvent.id);
          this.eventQueue.shift();
          if (this.eventQueue.length > 0) setTimeout(() => this.flushQueue(), 10);
        }
        return;
      }

      this._retryState.delete(currentEvent.id);
      this._rememberSentEventId(currentEvent.id);
      this.eventQueue.shift();
      this.log(`[FLUSH] Event sent successfully (${traceLabel})`);

      if (this.eventQueue.length > 0) setTimeout(() => this.flushQueue(), 10);
    } finally {
      // Always release the lock, even if an unexpected exception escapes.
      this._isFlushing = false;
    }
  }

  /**
   * Schedule a retry for `event` after an exponential backoff delay.
   *
   * Backoff schedule (capped at 30 s):
   *   Attempt 1 →  500 ms
   *   Attempt 2 →  1 000 ms
   *   Attempt 3 →  2 000 ms
   *   Attempt 4 →  4 000 ms
   *   Attempt 5 →  8 000 ms
   *   Attempt 6+ → 30 000 ms (hard cap, event is dropped after 6 attempts)
   *
   * @param {object} event        — the queued event object
   * @param {Error}  err          — the error that triggered this retry
   * @param {"network"|"server"} reason
   */
  _scheduleRetry(event, err, reason) {
    const MAX_ATTEMPTS = 6;

    const state = this._retryState.get(event.id) || { count: 0 };
    state.count++;

    if (state.count > MAX_ATTEMPTS) {
      this.log(
        `💀 Event permanently dropped after ${MAX_ATTEMPTS} retries`,
        { type: event.type, id: event.id, reason },
      );
      this._retryState.delete(event.id);
      this.eventQueue.shift();
      if (this.eventQueue.length > 0)
        setTimeout(() => this.flushQueue(), 10);
      return;
    }

    // Exponential backoff: 500 * 2^(attempt-1), capped at 30 000 ms
    const delayMs = Math.min(500 * Math.pow(2, state.count - 1), 30_000);
    this._retryState.set(event.id, state);

    this.log(
      `⏳ Retry ${state.count}/${MAX_ATTEMPTS} for event "${event.type}" in ${delayMs} ms`,
      { reason, error: err?.message },
    );

    setTimeout(() => this.flushQueue(), delayMs);
  }

  // ============================================================
  // UTILITIES
  // ============================================================

  getStatus() {
    if (this.disabled) {
      return { disabled: true, eventsQueued: 0 };
    }
    return {
      sessionId: this.config.sessionId,
      eventsQueued: this.eventQueue.length,
      recentEventKeys: Array.from(this.recentEventKeys).slice(-5),
      config: {
        capturePageSnapshot: this.config.capturePageSnapshot,
        debugEnabled: this.config.debugEnabled,
        batchSize: this.config.batchSize,
      },
    };
  }

  // Simple backend health check for real-site testing
  async checkBackendHealth() {
    if (this.disabled) return { ok: false, error: "Interceptor disabled" };
    const healthUrl = this.apiEndpoint.replace(/\/api\/events$/, "/api/health");
    try {
      this.log("🩺 Checking backend health at", healthUrl);
      const res = await fetch(healthUrl, {
        method: "GET",
        mode: this.config.corsEnabled ? "cors" : "same-origin",
        credentials: this.config.corsEnabled ? "include" : "same-origin",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      this.log("✅ Backend health OK", data);
      this.dispatchEvent("air:backend-status", { ok: true, details: data });
      return { ok: true, details: data };
    } catch (error) {
      console.error("[AIR] Backend health check failed:", error);
      this.dispatchEvent("air:backend-status", {
        ok: false,
        error: error?.message || String(error),
      });
      return { ok: false, error: error?.message || String(error) };
    }
  }

  generateUUID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  dispatchEvent(name, detail) {
    if (this.disabled) return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

 checkPendingOutcome() {
  if (this.disabled) return false;

  let traceId = null;
  let recoverySource = null; // navigation | cross-tab
  let crossTabPending = null;

  const pending = this._safeGetStorage("session", "air_pending_trace");
  if (pending) {
    try {
      const data = JSON.parse(pending);
      if (data && typeof data.traceId === "string" && data.traceId) {
        traceId = data.traceId;
        recoverySource = "navigation";
        this._safeRemoveStorage("session", "air_pending_trace");
      } else {
        this._safeRemoveStorage("session", "air_pending_trace");
      }
    } catch (err) {
      this.log("⚠️ Corrupted pending trace; clearing it", err?.message || err);
      this._safeRemoveStorage("session", "air_pending_trace");
    }
  }

  if (!traceId) {
    crossTabPending = this._consumeCrossTabPendingTrace();
    if (crossTabPending && typeof crossTabPending.traceId === "string" && crossTabPending.traceId) {
      traceId = crossTabPending.traceId;
      recoverySource = "cross-tab";
    }
  }

  if (!traceId) return false;

  this.lastActionTraceId = traceId;
  this.lastActionTraceAt = Date.now();
  this.log("🔄 Recovering pending outcome", {
    traceId,
    recoverySource,
    targetNormalizedUrl: crossTabPending?.targetNormalizedUrl || null,
  });

  this.capturePageSnapshot(this.config.snapshotDepth, false).then(async (snapshot) => {
    const controlSignature = this.computeControlSignature(document);
    const primaryHeading = this.getPrimaryHeading(document);
    const pageUrl = window.location.href;
    const normalizedUrl = this.normalizeUrl(pageUrl);
    let icSnapshot = null;
    try {
      icSnapshot = await this._captureFullPageForIC();
    } catch (_) {}
    const normalizedIcSnapshot = this._normalizeSnapshotForTransport(
      icSnapshot,
      200000
    );
    const captureMeta = this._buildOutcomeCaptureMeta(snapshot, icSnapshot);

    this.queueEvent({
      id: this.generateUUID(),
      type: "outcome",
      traceId,
      timestamp: Date.now(),
      sessionId: this.config.sessionId,
      meta: {
        settleType: recoverySource === "cross-tab" ? "cross-tab-navigation" : "navigation",
        urlAfter: window.location.href,
        controlSignature,
        primaryHeading,
        forcedCapture: captureMeta.forcedCapture,
        busyAtCapture: captureMeta.busyAtCapture,
        busyReasons: captureMeta.busyReasons,
        isRecovery: true,
        isCrossTabRecovery: recoverySource === "cross-tab",
        crossTabTargetNormalizedUrl: crossTabPending?.targetNormalizedUrl || null,
        crossTabSourceNormalizedUrl: crossTabPending?.sourceNormalizedUrl || null,
      },
      interactionContext: normalizedIcSnapshot, // full-page context for D3.5 validation
      pageSnapshot: snapshot,
      pageState: snapshot,
      pageUrl,
      normalizedUrl,
    });
  });

  return true;
}

async flushPending() {
  this._beaconFlushAll();
  await this.flushQueue();
}

  captureBaseline() {
    if (this.disabled) return;
    // ✅ NEW: Fresh start? Capture the page so we have a node to anchor input events to.
    this.capturePageSnapshot(this.config.snapshotDepth, false).then(
      async (snapshot) => {
        const controlSignature = this.computeControlSignature(document);
        const primaryHeading   = this.getPrimaryHeading(document);
        const pageUrl = window.location.href;
        const normalizedUrl = this.normalizeUrl(pageUrl);
        let icSnapshot = null;
        try {
          icSnapshot = await this._captureFullPageForIC();
        } catch (_) {}
        const normalizedIcSnapshot = this._normalizeSnapshotForTransport(
          icSnapshot,
          200000
        );
        const captureMeta = this._buildOutcomeCaptureMeta(snapshot, icSnapshot);
        this.queueEvent({
          id: this.generateUUID(),
          type: "outcome",
          traceId: "baseline-" + this.generateUUID(),
          timestamp: Date.now(),
          sessionId: this.config.sessionId,
          meta: {
            settleType: "baseline",
            controlSignature,
            primaryHeading,
            forcedCapture: captureMeta.forcedCapture,
            busyAtCapture: captureMeta.busyAtCapture,
            busyReasons: captureMeta.busyReasons,
          },
          interactionContext: normalizedIcSnapshot, // full-page context for D3.5 validation
          pageSnapshot: snapshot,
          pageState: snapshot,
          pageUrl,
          normalizedUrl,
        });
      },
    );
  }

  log(...args) {
    if (this.disabled || !this.config) return;
    if (this.config.debugMode) {
      console.log("[AIR]", ...args);
    }
  }

  async destroy() {
  if (this.disabled) return;
  clearInterval(this.batchTimer);

  try {
    await this.flushPending();
  } catch (err) {
    this.log("⚠️ Flush during destroy failed", err);
  }

  if (this.quiescence) {
    if(this.quiescence.domMutationTimer) clearTimeout(this.quiescence.domMutationTimer);
    if(this.quiescence.observer) this.quiescence.observer.disconnect();
  }
}
}

// Node/Vitest test access (no effect in browser injection runtime)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AIRInterceptor,
    SELECTOR_RANK_MAP,
    escapeCssString,
    rankForPriority,
  };
}

// Auto-initialize if not in module context
if (typeof window !== "undefined" && !window._airInterceptor) {
  window._airInterceptor = new AIRInterceptor({
    debugMode: true,
    capturePageSnapshot: true,
    snapshotDepth: 10,
    snapshotWaitForSPA: true,
    snapshotTimeoutMs: 5000,
    snapshotMaxNodes: 5000,
    serverUrl: "http://localhost:3000",
  });
  // Expose a simple helper for real-site testing
  window.AIR_checkBackend = () => window._airInterceptor.checkBackendHealth();
  console.log("🎯 AIR Interceptor loaded and active");
}

