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
  CUSTOM: 'custom'
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
    this.log('Monitoring started (Network hooked)');
  }

  startNetworkObserver() {
    const self = this;

    // 1. Hook Fetch
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (self.shouldIgnoreUrl(url)) {
        self.log('Ignoring background fetch:', url);
        return originalFetch(...args);
      }

      const requestId = Math.random().toString(36).substring(7);
      self.pendingRequests.add(requestId);
      self.log(`Fetch started. Active requests: ${self.pendingRequests.size}`);
      try {
        return await originalFetch(...args);
      } finally {
        self.pendingRequests.delete(requestId);
        self.log(`Fetch finished. Active requests: ${self.pendingRequests.size}`);
      }
    };

    // 2. Hook XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__airUrl = url;
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      const url = this.__airUrl || '';
      if (self.shouldIgnoreUrl(url)) {
        self.log('Ignoring background XHR:', url);
        return originalSend.apply(this, args);
      }

      const requestId = Math.random().toString(36).substring(7);
      self.pendingRequests.add(requestId);
      self.log(`XHR started. Active requests: ${self.pendingRequests.size}`);
      
      this.addEventListener('loadend', () => {
        self.pendingRequests.delete(requestId);
        self.log(`XHR finished. Active requests: ${self.pendingRequests.size}`);
      });
      return originalSend.apply(this, args);
    };
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
    // 1. SESSION PERSISTENCE (The New Fix)
    // ------------------------------------------------------------
    let currentSessionId = config.sessionId;

    // Check storage if not provided
    if (!currentSessionId && typeof sessionStorage !== "undefined") {
      try {
        currentSessionId = sessionStorage.getItem("AIR_SESSION_ID");
      } catch (e) {}
    }

    // Generate & Save if strictly new
    if (!currentSessionId) {
      // Browser-safe UUID v4
      currentSessionId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
        /[xy]/g,
        (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        },
      );

      if (typeof sessionStorage !== "undefined") {
        try {
          sessionStorage.setItem("AIR_SESSION_ID", currentSessionId);
          console.log(
            "[AIR] 💾 New Session Created & Saved:",
            currentSessionId,
          );
        } catch (e) {}
      }
    } else {
      console.log("[AIR] 🔄 Session Recovered:", currentSessionId);
    }

    // ------------------------------------------------------------
    // 2. CONFIGURATION
    // ------------------------------------------------------------
    this.config = {
      capturePageSnapshot: config.capturePageSnapshot || false,
      snapshotDepth: config.snapshotDepth ?? 10,
      snapshotTimeoutMs: config.snapshotTimeoutMs ?? 5000,
      snapshotMaxNodes: config.snapshotMaxNodes ?? 5000,
      snapshotMaxTextLength: config.snapshotMaxTextLength ?? 5000,
      snapshotUseIdleCallback: config.snapshotUseIdleCallback ?? true,
      snapshotCaptureVueAttrs: config.snapshotCaptureVueAttrs ?? true,
      snapshotCaptureReactAttrs: config.snapshotCaptureReactAttrs ?? true,
      snapshotWaitForSPA: config.snapshotWaitForSPA ?? true,
      debugEnabled: config.debugMode || false,
      serverUrl: config.serverUrl || "http://localhost:3000",
      sessionId: currentSessionId, // <--- CRITICAL: Use the resolved ID
      projectId: config.projectId || "default",
      maxTextLength: config.maxTextLength || 50,
      debugMode: config.debugMode || false,
      batchSize: config.batchSize || 10,
      batchInterval: config.batchInterval || 2000,
      corsEnabled: config.corsEnabled ?? true,
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

  init() {
    this.log("🚀 AIR Interceptor initializing...", {
      sessionId: this.config.sessionId,
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
        try {
          sessionStorage.setItem(
            "air_pending_trace",
            JSON.stringify({
              traceId: this.pendingTraceId,
              timestamp: Date.now(),
            }),
          );
        } catch (e) {
          // Storage quota full or disabled
        }
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

  scanPageAnchors() {
    const anchors = [];
    // 1. URL Path (Strongest Anchor)
    anchors.push(`URL:${window.location.pathname}`);

    // 2. Interactive Elements & Landmarks
    // We only care about things that define the "Function" of the page.
    const elements = document.querySelectorAll(
      'input, button, select, textarea, form, h1, h2, h3, [role="button"]',
    );

    elements.forEach((el) => {
      if (el.type === "hidden" || el.style.display === "none") return;

      const tag = el.tagName.toUpperCase();

      // Prioritize Stable Attributes
      // Logic: ID > Name > TestID > Role > Text (if short)
      if (el.getAttribute("data-testid")) {
        anchors.push(`${tag}:testid=${el.getAttribute("data-testid")}`);
      } else if (el.id && !/\d{5,}/.test(el.id)) {
        // Ignore IDs with long numbers
        anchors.push(`${tag}:id=${el.id}`);
      } else if (el.name) {
        anchors.push(`${tag}:name=${el.name}`);
      } else if (el.getAttribute("role")) {
        anchors.push(`${tag}:role=${el.getAttribute("role")}`);
      } else if (tag === "BUTTON" || tag === "H1" || tag === "H2") {
        const text = (el.innerText || "").trim();
        if (text.length > 2 && text.length < 30) {
          anchors.push(`${tag}:text=${text}`);
        }
      } else if (tag === "INPUT") {
        anchors.push(`${tag}:type=${el.type || "text"}`);
      }
    });

    // Remove duplicates and sort for deterministic hashing
    return [...new Set(anchors)].sort();
  }

  /** * Wait for SPA to render and stabilize (Hydration Check)
   * VERSION: 7.0 (Quiescence Engine Integration)
   */
  waitForSPAContent(timeoutMs = 5000) {
    return new Promise(async (resolve) => {
      const { app } = this.detectSPA();
      if (!app) {
        return resolve(); // Not an SPA, proceed immediately
      }

      this.log("⏳ SPA detected. Waiting for hydration/quiescence...");

      // Trust the elite QuiescenceEngine. It perfectly handles the 
      // "loading spinner" trap by ensuring all API network calls are finished.
      if (this.quiescence) {
        await this.quiescence.waitForSettle(timeoutMs);
        this.log("✅ SPA Hydrated (Network & DOM quiescent)");
        return resolve();
      }

      // Failsafe if QuiescenceEngine failed to initialize
      setTimeout(() => {
        this.log("⚠️ SPA Hydration fallback timeout reached");
        resolve();
      }, 2000);
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
      if (name === "style") return false;
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
  capturePageSnapshot(depth, skipWait = false) {
    if (!this.config.capturePageSnapshot) return Promise.resolve(null);
    const effectiveDepth = depth ?? this.config.snapshotDepth ?? 10;
    const useIdle =
      !skipWait &&
      this.config.snapshotUseIdleCallback &&
      typeof requestIdleCallback !== "undefined";

    const runCapture = () => {
      const start = performance.now();
      let result = null;
      try {
        if (this.config.snapshotWaitForSPA && !skipWait) {
          return this.waitForSPAContent(this.config.snapshotTimeoutMs).then(
            () => {
              try {
                result = this.captureDOM(effectiveDepth);
                if (!result.html)
                  result = this.captureDOMFallback(Math.min(5, effectiveDepth));
              } catch (e) {
                result = this.captureDOMFallback(Math.min(5, effectiveDepth));
              }

              // 🌟 NEW: Calculate Anchors along with snapshot
              const anchors = this.scanPageAnchors();

              return {
                html: result.html || "",
                anchors: anchors, // <--- Added Anchors
                viewport: {
                  width: window.innerWidth,
                  height: window.innerHeight,
                },
                url: window.location.href,
                timestamp: Date.now(),
                metrics: {
                  ...result.metrics,
                  totalMs: Math.round(performance.now() - start),
                },
              };
            },
          );
        }

        try {
          result = this.captureDOM(effectiveDepth);
          if (!result.html)
            result = this.captureDOMFallback(Math.min(5, effectiveDepth));
        } catch (e) {
          result = this.captureDOMFallback(Math.min(5, effectiveDepth));
        }

        const anchors = this.scanPageAnchors();

        return Promise.resolve({
          html: result?.html || "",
          anchors: anchors, // <--- Added Anchors
          viewport: { width: window.innerWidth, height: window.innerHeight },
          url: window.location.href,
          timestamp: Date.now(),
          metrics: {
            ...(result?.metrics || {}),
            totalMs: Math.round(performance.now() - start),
          },
        });
      } catch (err) {
        return Promise.resolve(null);
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

  // ============================================================
  // NETWORK MONITORING — Unified (fetch + XHR)
  // FIX (BUG): Single entry point. Old code had two separate wrappers
  // (monitorNetwork + QuiescenceWatcher.monitor) each independently patching
  // window.fetch, causing double-counting and duplicate event emission.
  // Now: ONE sentinel (__air_patched__) covers both concerns.
  // Item 3.7: Also hooks XHR which was entirely missing before.
  // ============================================================

  monitorNetwork() {
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

    this.queueEvent({
      id:            this.generateUUID(),
      type:          'network',
      timestamp:     Date.now(),
      pageUrl:       window.location.href,
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
    // passive: true — we never call preventDefault, so the browser can optimise.
    document.addEventListener('mouseenter', this._boundHandleHover, { capture: true, passive: true });
  }

  _handleHover(e) {
    // Item 2.5: composedPath for Shadow DOM
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
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
    if (this._recentHovers.has(hoverKey)) return;
    this._recentHovers.add(hoverKey);
    setTimeout(() => this._recentHovers.delete(hoverKey), 500);

    // Observe DOM for reactive changes triggered by this hover
    const observer = new MutationObserver((mutations) => {
      observer.disconnect();

      // Only emit if there was a meaningful structural change (new nodes added/removed)
      const significant = mutations.some(m => m.addedNodes.length > 0 || m.removedNodes.length > 0);
      if (!significant) return;

      this.log('🖱️ Hover triggered DOM change', { tag, hoverKey });
      this.queueEvent({
        id:            this.generateUUID(),
        type:          'hover',
        timestamp:     Date.now(),
        pageUrl:       window.location.href,
        pageTitle:     document.title,
        sessionId:     this.config.sessionId,
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
    const slimEvents = this.eventQueue.map(ev => ({
      ...ev,
      pageSnapshot: null,
      pageState:    null,
    }));

    // ── STEP 2: Stash full events to localStorage (The Gold Standard) ─────────
    // Merges with any existing stash for this session (e.g. multiple rapid
    // navigations). Filters expired events individually using each event's own
    // timestamp — prevents stale snapshots from being sent after TTL.
    let stashSuccess = false;
    try {
      // Read existing stash for this session (may have events from prior navigation)
      let existingEvents = [];
      const raw = localStorage.getItem(stashKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.events)) {
          // Filter out individually expired events — per-event TTL check
          existingEvents = parsed.events.filter(
            ev => ev.timestamp && (now - ev.timestamp) < STASH_TTL_MS
          );
        }
      }

      // Merge: existing non-expired events + current queue events
      const mergedEvents = [...existingEvents, ...this.eventQueue];

      localStorage.setItem(stashKey, JSON.stringify({
        events:    mergedEvents,
        sessionId: this.config.sessionId,
        // No stash-level timestamp — per-event timestamps used for TTL
      }));

      stashSuccess = true;
      this.log(`📦 Stashed ${this.eventQueue.length} events to localStorage (total in stash: ${mergedEvents.length})`);
    } catch (e) {
      // localStorage unavailable (Private Browsing, quota exceeded, security policy)
      // Beacon fallback below is the only delivery path in this case.
      this.log("⚠️ localStorage stash failed — beacon is sole delivery path", e.message);
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
        window.__air_gmBeacon(this.apiEndpoint, lightPayload);
        this.log(`🚀 GM stripped beacon dispatched (${slimEvents.length} events)`);
      } else {
        // Native sendBeacon — slim payload guaranteed under 64KB after snapshot strip
        const blob = new Blob([lightPayload], { type: "application/json" });
        const sent = navigator.sendBeacon(this.apiEndpoint, blob);
        if (sent) {
          this.log(`🚀 Stripped beacon dispatched (${slimEvents.length} events)`);
        } else {
          // Extremely unlikely after stripping — payload would need to be >64KB
          // of pure event metadata with no snapshots
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
      const raw = localStorage.getItem(stashKey);
      if (!raw) return 0; // Nothing stashed for this session

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.events) || parsed.events.length === 0) {
        localStorage.removeItem(stashKey);
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
        localStorage.removeItem(stashKey);
        this.log('🧹 Stash cleared — all events expired');
        return 0;
      }

      // Unshift onto FRONT of queue (not append) — critical for ordering.
      // These events happened BEFORE this page loaded. They must be processed
      // before the outcome that checkPendingOutcome() is about to queue.
      this.eventQueue.unshift(...validEvents);
      recovered = validEvents.length;

      // Clear stash immediately — events are now in queue and will be sent
      // via normal flushQueue on stable network. If page unloads again before
      // they flush, _beaconFlushAll will re-stash them.
      localStorage.removeItem(stashKey);

      this.log(`📬 Recovered ${recovered} stashed event(s) — prepended to queue`, {
        sessionId: this.config.sessionId,
        oldestEvent: new Date(validEvents[0].timestamp).toISOString(),
        newestEvent: new Date(validEvents[validEvents.length - 1].timestamp).toISOString(),
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
    // Item 2.5: composedPath()[0] pierces Shadow DOM — e.target stops at the shadow host.
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!target || !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

    const key = this._fieldKey(target);
    if (this.activeInputSessions.has(key)) return; // already tracking

    this.activeInputSessions.set(key, {
      traceId:         this.pendingTraceId || this.generateUUID(),
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
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!target || !["INPUT", "TEXTAREA"].includes(target.tagName)) return;

    const key = this._fieldKey(target);

    // Ensure a session exists (covers cases where focus was missed)
    if (!this.activeInputSessions.has(key)) {
      this.activeInputSessions.set(key, {
        traceId:        this.pendingTraceId || this.generateUUID(),
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

  /**
   * Emit a single structured input event.
   * @param {HTMLElement} target
   * @param {string|null} traceId
   * @param {"blur"|"change"|"input:progress"} trigger  — what caused this emission
   */
  _emitInputEvent(target, traceId, trigger) {
    const fingerprint = this.generateFingerprint(target);
    const rawValue    = target.value || "";
    const isSensitive = this.isSensitiveField(target);
    const hasPII      = this.containsPII(rawValue);

    // For non-sensitive fields we record value LENGTH as a signal (not the text).
    // For sensitive / PII fields we record nothing beyond "entered".
    const maskedValue = (isSensitive || hasPII)
      ? "[REDACTED]"
      : "*".repeat(Math.min(rawValue.length, 20));

    // SELECT: also record which option was chosen (text label only, not value, for safety)
    let selectedLabel = undefined;
    if (target.tagName === "SELECT" && !isSensitive) {
      selectedLabel = target.options[target.selectedIndex]?.text || undefined;
    }

    this.queueEvent({
      id:            this.generateUUID(),
      type:          "input",
      trigger,                          // blur | change | input:progress
      timestamp:     Date.now(),
      pageUrl:       window.location.href,
      pageTitle:     document.title,
      viewport:      { width: window.innerWidth, height: window.innerHeight },
      fingerprint,
      inputValueMasked: maskedValue,
      inputLength:   rawValue.length,   // useful signal for analytics
      selectedLabel,                    // SELECT-only
      traceId:       traceId || undefined,
      sessionId:     this.config.sessionId,
      schemaVersion: "air:v2",
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
    ];
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
  _onDropdownOpened(triggerEl, triggerFingerprint) {
    const expanded = triggerEl.getAttribute("aria-expanded");

    // If expanded didn't flip to "true", this wasn't really a dropdown open
    // (could be a button click that does something else). Still proceed for
    // class-only dropdowns where aria-expanded may not be used.
    this.log("🔽 Custom dropdown trigger activated", {
      selector:  triggerFingerprint?.selector,
      expanded,
    });

    // Close any previously orphaned session
    if (this._openDropdown) {
      this.log("⚠️ Orphaned dropdown session replaced", { old: this._openDropdown.traceId });
    }
    if (this._dropdownObserver) {
      this._dropdownObserver.disconnect();
      this._dropdownObserver = null;
    }

    const traceId = this.generateUUID();
    this._openDropdown = {
      traceId,
      triggerEl,
      triggerFingerprint,
      openTimestamp: Date.now(),
    };
    this.pendingTraceId = traceId;

    // Auto-expire the session after 30 s to prevent memory leaks on
    // dropdowns that are opened but the user clicks away without selecting.
    this._openDropdown._expireTimer = setTimeout(() => {
      if (this._openDropdown?.traceId === traceId) {
        this.log("⏰ Dropdown session expired without selection");
        this._closeDropdownSession();
      }
    }, 30_000);

    // Watch for option panels injected into the DOM by the framework
    this._watchForDropdownPanel(traceId);
  }

  /**
   * Attach a MutationObserver that listens for new option panels
   * appended to the document. Fires once, then disconnects.
   * Useful for frameworks that portal their dropdowns to <body>.
   */
  _watchForDropdownPanel(traceId) {
    if (this._dropdownObserver) this._dropdownObserver.disconnect();

    this._dropdownObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const role = (node.getAttribute?.("role") || "").toLowerCase();
          const cls  = (node.className              || "").toLowerCase();
          const isPanel =
            AIRInterceptor.CONTAINER_ROLES.has(role) ||
            AIRInterceptor.CONTAINER_CLASS_PATTERNS.some(p => cls.includes(p));

          if (isPanel) {
            this.log("👁️ Dropdown panel detected in DOM", { tag: node.tagName, cls: node.className });
            // Panel appeared — no need to watch further
            this._dropdownObserver.disconnect();
            this._dropdownObserver = null;
            return;
          }
        }
      }
    });

    this._dropdownObserver.observe(document.body, {
      childList: true,
      subtree:   true,
    });

    // Disconnect after 5 s regardless to avoid long-lived observers
    setTimeout(() => {
      if (this._dropdownObserver) {
        this._dropdownObserver.disconnect();
        this._dropdownObserver = null;
      }
    }, 5000);
  }

  // ──────────────────────────────────────────────────────────────
  // PHASE 2 — OPTION SELECTED
  // ──────────────────────────────────────────────────────────────

  /**
   * Called by handleClick when we confirm the click target is an option.
   * Emits a structured "custom-select" event and closes the session.
   */
  _handleCustomDropdownSelection(optionData, clickEvent) {
    const { label, value, index, el } = optionData;
    const session = this._openDropdown;

    this.log("✅ Custom dropdown option selected", { label, value, index });

    // Stop observing — selection is final
    if (this._dropdownObserver) {
      this._dropdownObserver.disconnect();
      this._dropdownObserver = null;
    }

    const traceId          = session?.traceId          || this.pendingTraceId || this.generateUUID();
    const triggerFp        = session?.triggerFingerprint || null;
    const durationMs       = session ? Date.now() - session.openTimestamp : null;
    const optionFingerprint = this.generateFingerprint(el);

    this.queueEvent({
      id:            this.generateUUID(),
      type:          "custom-select",          // distinct from native "input" / "change"
      trigger:       "option-click",
      timestamp:     Date.now(),
      traceId,
      pageUrl:       window.location.href,
      pageTitle:     document.title,
      viewport:      { width: window.innerWidth, height: window.innerHeight },
      sessionId:     this.config.sessionId,
      schemaVersion: "air:v2",
      // ── Selection payload ──
      selection: {
        label,                                 // human-readable text of chosen option
        value,                                 // data-value / value attr (may equal label)
        index,                                 // 0-based position in the list
      },
      // ── Relationship back to the trigger element ──
      triggerFingerprint: triggerFp,
      // ── Option element identity ──
      fingerprint: optionFingerprint,
      // ── Timing ──
      meta: {
        durationMs,                            // time between open and select
        hadExplicitSession: !!session,         // did we track the trigger click?
      },
    });

    this._closeDropdownSession();
  }

  /**
   * Tear down the open dropdown session cleanly.
   */
  _closeDropdownSession() {
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
  // CLICK HANDLER
  // ─────────────────────────────────────────────────────────────
  async handleClick(e) {
    // Item 2.5: Resolve the TRUE click target through Shadow DOM boundaries.
    // e.target is retargeted to the shadow host; composedPath()[0] is the real element.
    const clickTarget = (e.composedPath && e.composedPath()[0]) || e.target;

    // ══════════════════════════════════════════════════════════════
    // CUSTOM DROPDOWN INTERCEPT — must run FIRST, before dedup logic,
    // because option clicks are intentionally short-circuited below.
    // ══════════════════════════════════════════════════════════════

    // ── Phase 2: Is this click selecting an option inside an open dropdown? ──
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
      requestAnimationFrame(() => this._onDropdownOpened(probableTrigger, triggerFingerprint));
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
    const traceId = this.generateUUID();
    this.pendingTraceId = traceId;
    const fingerprint = this.generateFingerprint(target);
    const seek = this.detectSeekStrategy(target);
    const startUrl = window.location.href;

    // 3. Capture Initial State (Snapshot A - "Where we are")
    let initialSnapshot = undefined;
    if (this.config.capturePageSnapshot) {
      try {
        initialSnapshot = await this.capturePageSnapshot(
          this.config.snapshotDepth,
          true,
        );
      } catch (err) {
        this.log("Failed to capture initial snapshot", err);
      }
    }

    // 4. Send ACTION Event (Immediate User Intent)
    const actionEvent = {
      id: this.generateUUID(),
      type: EventType.CLICK,
      timestamp: Date.now(),
      traceId: traceId, // <--- SHARED ID
      pageUrl: startUrl,
      pageTitle: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fingerprint,
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
    const isLink =
      anchor &&
      anchor.href &&
      !anchor.href.startsWith("javascript:") &&
      !anchor.href.includes("#") &&
      anchor.target !== "_blank"; // New tabs don't change current URL

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
      let settleResult = "immediate";
      if (this.quiescence) {
        settleResult = await this.quiescence.waitForSettle(2000);
      }

      // 6. Capture Final State (Snapshot B - "Where we ended up")
      let finalSnapshot = undefined;
      if (this.config.capturePageSnapshot) {
        try {
          finalSnapshot = await this.capturePageSnapshot(
            this.config.snapshotDepth,
            true,
          );
        } catch (err) {
          this.log("Failed to capture final snapshot", err);
        }
      }

    // 7. Build OUTCOME Event (The Result)
    const outcomeEvent = {
      id: this.generateUUID(),
      type: "outcome",
      traceId: traceId,
      timestamp: Date.now(),
      sessionId: this.config.sessionId,
      pageUrl: window.location.href,
      meta: {
        settleType: settleResult,
        urlAfter: window.location.href,
        titleAfter: document.title,
      },
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

      // Wait for the SPA to render the new view
      if (self.quiescence) await self.quiescence.waitForSettle(2000);

      const newAnchors     = self.scanPageAnchors();
      const addedAnchors   = newAnchors.filter(a => !lastAnchors.includes(a));
      const removedAnchors = lastAnchors.filter(a => !newAnchors.includes(a));
      const domChanged     = addedAnchors.length > 0 || removedAnchors.length > 0;

      self.log(`🗺️ SPA route change [${changeType}]`, { from: lastUrl, to: newUrl, domChanged });

      const snapshot = self.config.capturePageSnapshot
        ? await self.capturePageSnapshot(self.config.snapshotDepth, true).catch(() => null)
        : null;

      self.queueEvent({
        id:            self.generateUUID(),
        type:          'spa-route-change',
        changeType,                        // pushState | replaceState | popstate | hashchange
        timestamp:     Date.now(),
        pageUrl:       newUrl,
        pageTitle:     document.title,
        sessionId:     self.config.sessionId,
        schemaVersion: 'air:v2',
        traceId: self.pendingTraceId || ('baseline-' + self.generateUUID()),
        navigation: {
          from:    lastUrl,
          to:      newUrl,
          domDiff: { added: addedAnchors, removed: removedAnchors, changed: domChanged },
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
                ? `#${CSS.escape(scrollTarget.id)}`
                : (scrollTarget.getAttribute("data-testid")
                    ? `[data-testid="${escapeCssString(scrollTarget.getAttribute("data-testid"))}"]`
                    : scrollTarget.className?.split(" ")[0] 
                        ? `.${CSS.escape(scrollTarget.className.split(" ")[0])}`
                        : "unknown"),
            };

        this.queueEvent({
          id:        this.generateUUID(),
          type:      "scroll",
          timestamp: Date.now(),
          pageUrl:   window.location.href,
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

    const fingerprint = this.generateFingerprint(e.target);
    const traceId = this.generateUUID(); 
    // FIX: Assign it to the class property so beforeunload can grab it
    this.pendingTraceId = traceId;

    const baseEvent = {
      id: this.generateUUID(),
      type: "submit",
      timestamp: Date.now(),
      traceId: traceId,
      pageUrl: window.location.href,
      pageTitle: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fingerprint,
      sessionId: this.config.sessionId,
      schemaVersion: "air:v2",
      meta: { eventType: "formSubmit", formId: e.target.id },
    };
    if (!this.config.capturePageSnapshot) {
      this.queueEvent({ ...baseEvent });
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
          selector: `#${CSS.escape(id)}`,
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
        selector: `.${CSS.escape(stableClass)}`,
        priority: "class",
        rank: rankForPriority("class"),
      };
    }

    // Priority 8: Compound selector (tag + text for buttons/links)
    if (["button", "a", "submit"].includes(tagName)) {
      const text = this.extractText(element);
      if (text && text.length > 0 && text.length < 50) {
        return {
          selector: `${tagName}:has-text("${escapeCssString(text)}")`,
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
          ? `#${CSS.escape(parent.id)}`
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
    // Use textContent instead of innerText for consistency
    const text = element.textContent || element.innerText || "";
    return (
      text
        .trim()
        .replace(/\s+/g, " ")
        .substring(0, this.config.maxTextLength) || null
    );
  }

  extractContext(element) {
    const parentTag = element.parentElement?.tagName?.toLowerCase() || null;

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

    return { parentTag, nearestContainerTag: nearestContainerTag || "div" };
  }

  extractAttributes(element) {
    const attrs = {
      name: element.name || null,
      role: element.getAttribute("role") || null,
      ariaLabel: element.getAttribute("aria-label") || null,
      type: element.type || null,
      placeholder: element.placeholder || null,
      value: element.value || null,
      href: element.href || null,
      title: element.title || null,
      alt: element.alt || null,
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
    this.eventQueue.push(event);

    const debugInfo = {
      type: event.type,
      queueLength: this.eventQueue.length,
      hasSnapshot: !!event.pageSnapshot,
      traceId: event.traceId,
    };

    this.log("📋 Event queued", debugInfo);

    if (this.eventQueue.length >= this.config.batchSize) {
      this.flushQueue();
    }
  }

  startBatchProcessor() {
    this.batchTimer = setInterval(() => {
      if (this.eventQueue.length > 0) {
        this.flushQueue();
      }
    }, this.config.batchInterval);
  }

  async flushQueue(options = {}) {
    // ── Concurrency guard ─────────────────────────────────────────────────
    // Prevents the batchInterval timer, the batchSize trigger, and the
    // fast-forward setTimeout from all racing to send the same head event.
    if (this._isFlushing) return;
    if (this.eventQueue.length === 0) return;

    this._isFlushing = true;

    try {
      const currentEvent = this.eventQueue[0];

      // Navigation-resilience path (FIX: GM beacon instead of sendBeacon)
      // Outcome events before a page load need fire-and-forget delivery.
      // sendBeacon is intercepted by ad blockers; __air_gmBeacon is not.
      const isNavigation =
        options.navigation === true ||
        (currentEvent.type === "outcome" &&
          currentEvent.meta?.settleType === "navigation" &&
          !currentEvent.meta?.isRecovery); // 🚀 NEW: Skip beacon-stripping for recovery

      if (isNavigation) {
        const lightEvent = { ...currentEvent, pageSnapshot: null, pageState: null };
        const navPayload = JSON.stringify(lightEvent);

        // Priority 1: GM beacon (extension context, ad-blocker immune)
        if (typeof window.__air_gmBeacon === 'function') {
          const accepted = window.__air_gmBeacon(this.apiEndpoint, navPayload);
          if (accepted) {
            this._retryState.delete(currentEvent.id);
            this.eventQueue.shift();
            this.log("GM beacon: navigation event dispatched");
            if (this.eventQueue.length > 0) setTimeout(() => this.flushQueue(), 10);
            return;
          }
        }

        // Priority 2: native sendBeacon (non-TM fallback)
        const blob = new Blob([navPayload], { type: "application/json" });
        const sent = navigator.sendBeacon(this.apiEndpoint, blob);
        if (sent) {
          this._retryState.delete(currentEvent.id);
          this.eventQueue.shift();
          this.log("sendBeacon: navigation event dispatched");
          if (this.eventQueue.length > 0) setTimeout(() => this.flushQueue(), 10);
          return;
        }
        this.log("sendBeacon declined (payload too large) - falling back to fetch");
      }
      // ─────────────────────────────────────────────────────────────────

      let payload = JSON.stringify(currentEvent);

      // Size guard — browser keepalive cap is ~64 KB
      const payloadSize = new Blob([payload]).size;
      // 🚀 NEW: Bypass size guard for recovery events (page is stable, no size limits)
      if (payloadSize > 60_000 && currentEvent.pageSnapshot && !currentEvent.meta?.isRecovery) {
        this.log(
          `⚠️ Payload too big (${payloadSize} bytes). Stripping snapshot to ensure delivery.`,
        );
        currentEvent.pageSnapshot = null;
        currentEvent.pageState = null;
        payload = JSON.stringify(currentEvent);
      }

      this.log(
        `📤 Sending event: ${currentEvent.type} (${new Blob([payload]).size} bytes)`,
      );

        // ── Send via GM transport (no CORS) or _rawFetch ──────────────────────────
      // Priority 1: _gmSend uses GM_xmlhttpRequest (extension context).
      //   • Runs outside the page’s CORS policy entirely.
      //   • No preflight, no Access-Control-Allow-Headers checks.
      //   • Not intercepted by any page-level fetch wrapper.
      //
      // Priority 2: _rawFetch (pre-captured native fetch).
      //   • Does NOT increment quiescence.networkCount (no waitForSettle race).
      //   • Does NOT increment activeRequests (checkQuiescence stays accurate).
      //   • Symbol sentinel [_AIR_INTERNAL] is non-enumerable + non-serializable.
      let response;
      try {
        if (this._gmSend) {
          // GM transport path — Tampermonkey extension context, zero CORS friction
          response = await this._gmSend(this.apiEndpoint, payload);
        } else {
          // Raw fetch path — direct <script> injection without Tampermonkey
          response = await this._rawFetch(this.apiEndpoint, {
            method:    "POST",
            headers:   { "Content-Type": "application/json" },
            body:      payload,
            mode:      "cors",
            keepalive: !currentEvent.meta?.isRecovery,
            [_AIR_INTERNAL]: true,   // Symbol — non-enumerable, stripped before native fetch
          });
        }
      } catch (networkErr) {
        // TypeError: Failed to fetch — network abort, navigation, or server unreachable.
        this._scheduleRetry(currentEvent, networkErr, "network");
        return;
      }

      // ── HTTP-level error handling ──────────────────────────────────────
      if (!response.ok) {
        if (response.status >= 500) {
          // Server-side fault — transient, retry with backoff
          this._scheduleRetry(
            currentEvent,
            new Error(`HTTP ${response.status}`),
            "server",
          );
        } else {
          // 4xx — client/payload error, permanent. Drop the event so it
          // doesn't block the queue forever, but log clearly.
          this.log(
            `🚫 Event dropped (HTTP ${response.status} — permanent error)`,
            { type: currentEvent.type, id: currentEvent.id },
          );
          this._retryState.delete(currentEvent.id);
          this.eventQueue.shift();
          if (this.eventQueue.length > 0)
            setTimeout(() => this.flushQueue(), 10);
        }
        return;
      }

      // ── Success ────────────────────────────────────────────────────────
      this._retryState.delete(currentEvent.id);
      this.eventQueue.shift();
      this.log(`✅ Event sent successfully`);

      if (this.eventQueue.length > 0) setTimeout(() => this.flushQueue(), 10);
    } finally {
      // Always release the lock, even if an unexpected exception escapes
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
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  dispatchEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  checkPendingOutcome() {
    const pending = sessionStorage.getItem("air_pending_trace");
    if (pending) {
      const data = JSON.parse(pending);
      sessionStorage.removeItem("air_pending_trace");
      this.log("🔄 Recovering pending outcome from navigation", {
        traceId: data.traceId,
      });

      // We just loaded a new page. This IS the outcome!
      // Send the 'outcome' event immediately for the previous action.
      this.capturePageSnapshot(this.config.snapshotDepth, false).then(
        (snapshot) => {
          this.queueEvent({
            id: this.generateUUID(),
            type: "outcome",
            traceId: data.traceId,
            timestamp: Date.now(),
            sessionId: this.config.sessionId,
            meta: { 
              settleType: "navigation",
              urlAfter: window.location.href,
              isRecovery: true // 🚀 NEW: Tells flushQueue NOT to strip this snapshot
            },
            pageSnapshot: snapshot,
            pageState: snapshot,
            pageUrl: window.location.href,
          });
        },
      );
      return true;
    }
    return false;
  }

  captureBaseline() {
    // ✅ NEW: Fresh start? Capture the page so we have a node to anchor input events to.
    this.capturePageSnapshot(this.config.snapshotDepth, false).then(
      (snapshot) => {
        this.queueEvent({
          id: this.generateUUID(),
          type: "outcome",
          traceId: "baseline-" + this.generateUUID(),
          timestamp: Date.now(),
          sessionId: this.config.sessionId,
          meta: { settleType: "baseline" },
          pageSnapshot: snapshot,
          pageState: snapshot,
          pageUrl: window.location.href,
        });
      },
    );
  }

  log(...args) {
    if (this.config.debugMode) {
      console.log("[AIR]", ...args);
    }
  }

  destroy() {
    clearInterval(this.batchTimer);
    this.flushQueue();
    // FIX: Clean up QuiescenceWatcher resources
    if (this.quiescence) {
      this.quiescence.timers.forEach((t) => clearTimeout(t));
      this.quiescence.observer.disconnect();
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
